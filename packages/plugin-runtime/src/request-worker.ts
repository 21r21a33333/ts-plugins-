/**
 * Piscina worker entry logic for parallel-safe plugin request execution.
 */

import { pathToFileURL } from "node:url";

import { createPluginContext, type PluginRuntimeManifest } from "./context.js";
import { createPluginKvStore, type PluginKvStore, type RuntimeKvConfig } from "./kv.js";
import type { RuntimeTraceContext } from "./tracing.js";

interface WorkerMethodDefinition {
  name: string;
  localName: string;
  canonicalName: string;
  methodId: number;
  inputType: string;
  outputType: string;
}

interface WorkerDispatchTask {
  entrypointPath: string;
  manifest: PluginRuntimeManifest;
  serviceTypeName: string;
  runtimeInstanceId: string;
  requestId: string;
  method: WorkerMethodDefinition;
  request: unknown;
  initRequest?: unknown;
  kvConfig?: RuntimeKvConfig;
  traceContext?: RuntimeTraceContext;
}

type HandlerMap = Record<
  string,
  (request: unknown, context: ReturnType<typeof createPluginContext>) => Promise<unknown> | unknown
>;

interface WorkerState {
  handlers: HandlerMap;
  initialized: boolean;
  configSnapshot: Readonly<Record<string, string>>;
  kv?: PluginKvStore;
}

const workerStates = new Map<string, Promise<WorkerState>>();

export default async function runWorkerDispatchTask(
  task: WorkerDispatchTask,
): Promise<unknown> {
  const state = await getWorkerState(task);

  if (task.method.name !== "Init" && !state.initialized && task.initRequest !== undefined) {
    await invokeHandler(state, {
      ...task,
      method: {
        ...task.method,
        name: "Init",
        localName: "init",
      },
      request: task.initRequest,
    });
    state.initialized = true;
    state.configSnapshot = deriveConfigSnapshot(task.initRequest);
  }

  const result = await invokeHandler(state, task);
  if (task.method.name === "Init") {
    state.initialized = true;
    state.configSnapshot = deriveConfigSnapshot(task.request);
  }
  return result;
}

async function getWorkerState(task: WorkerDispatchTask): Promise<WorkerState> {
  let pending = workerStates.get(task.entrypointPath);
  if (pending === undefined) {
    pending = createWorkerState(task);
    workerStates.set(task.entrypointPath, pending);
  }
  return pending;
}

async function createWorkerState(task: WorkerDispatchTask): Promise<WorkerState> {
  const loadedModule = await import(pathToFileURL(task.entrypointPath).href);
  const handlers = resolveHandlers(loadedModule);
  return {
    handlers,
    initialized: false,
    configSnapshot: Object.freeze({}),
    kv: task.kvConfig === undefined ? undefined : createPluginKvStore(task.kvConfig),
  };
}

function resolveHandlers(module: unknown): HandlerMap {
  if (module === null || typeof module !== "object") {
    throw new Error("plugin worker module must export an object");
  }

  const candidate = "default" in module
    ? (module as { default: unknown }).default
    : module;
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("plugin worker default export must be a handler object");
  }

  return candidate as HandlerMap;
}

async function invokeHandler(
  state: WorkerState,
  task: WorkerDispatchTask,
): Promise<unknown> {
  const localName = task.method.localName;
  const normalizedLocalName =
    task.method.name === "Init" ? "init" : localName;
  const handler = state.handlers[normalizedLocalName];
  if (handler === undefined) {
    throw new Error(`handler ${normalizedLocalName} is not implemented`);
  }

  const context = createPluginContext({
    manifest: task.manifest,
    service: {
      packageName: "",
      serviceName: task.serviceTypeName.split(".").pop() ?? task.serviceTypeName,
      typeName: task.serviceTypeName,
      methods: [],
    },
    method: task.method,
    requestId: task.requestId,
    runtimeInstanceId: task.runtimeInstanceId,
    config: task.method.name === "Init" ? Object.freeze({}) : state.configSnapshot,
    kv: state.kv,
    traceContext: task.traceContext,
  });

  return handler(task.request, context);
}

function deriveConfigSnapshot(request: unknown): Readonly<Record<string, string>> {
  if (request === null || typeof request !== "object") {
    return Object.freeze({});
  }

  const candidate = (request as { config?: unknown }).config;
  if (candidate === null || typeof candidate !== "object") {
    return Object.freeze({});
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(candidate).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
}
