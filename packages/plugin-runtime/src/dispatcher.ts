/**
 * Dispatches validated RPC calls into plugin handlers after Init completes.
 */

import type { PluginMethodDefinition, PluginServiceDefinition } from "@balance/plugin-codegen";

import {
  createPluginContext,
  type PluginContextFactory,
  type PluginRuntimeManifest,
} from "./context.js";
import type { PluginHandlerMap } from "./define-plugin.js";
import { executePluginHandler } from "./errors.js";
import type { RuntimeTraceContext } from "./tracing.js";

export interface PluginDispatcher {
  initialize(request: unknown, options?: RequestDispatchOptions): Promise<unknown>;
  invoke(methodId: number, request: unknown, options?: RequestDispatchOptions): Promise<unknown>;
  isInitialized(): boolean;
}

export interface CreatePluginDispatcherInput {
  manifest: PluginRuntimeManifest;
  service: PluginServiceDefinition;
  handlers: PluginHandlerMap;
  contextFactory?: PluginContextFactory;
  runtimeInstanceId?: string;
}

export interface RequestDispatchOptions {
  traceContext?: RuntimeTraceContext;
}

export function createPluginDispatcher(
  input: CreatePluginDispatcherInput,
): PluginDispatcher {
  const initMethod = input.service.methods.find((method) => method.name === "Init");
  if (initMethod === undefined) {
    throw new Error("Plugin service metadata must define an Init method");
  }

  const methodsById = new Map(
    input.service.methods.map((method) => [method.methodId, method] as const),
  );
  let initialized = false;
  let requestCounter = 0;
  let configSnapshot: Readonly<Record<string, string>> = Object.freeze({});
  const runtimeInstanceId = input.runtimeInstanceId ?? `${input.manifest.id}-runtime`;

  return {
    async initialize(request: unknown, options?: RequestDispatchOptions): Promise<unknown> {
      const result = await invokeMethod(initMethod, request, options);
      initialized = true;
      configSnapshot = deriveConfigSnapshot(request);
      return result;
    },

    async invoke(
      methodId: number,
      request: unknown,
      options?: RequestDispatchOptions,
    ): Promise<unknown> {
      const method = methodsById.get(methodId);
      if (method === undefined) {
        throw new Error(`Unknown plugin method id: ${methodId}`);
      }

      if (method.name === "Init") {
        return this.initialize(request, options);
      }

      if (!initialized) {
        throw new Error(
          `Plugin ${input.manifest.id} cannot serve ${method.localName} before Init completes`,
        );
      }

      return invokeMethod(method, request, options);
    },

    isInitialized(): boolean {
      return initialized;
    },
  };

  async function invokeMethod(
    method: PluginMethodDefinition,
    request: unknown,
    options?: RequestDispatchOptions,
  ): Promise<unknown> {
    const handler = input.handlers[method.localName];
    if (handler === undefined) {
      throw new Error(`Handler ${method.localName} is not implemented`);
    }

    requestCounter += 1;
    const requestId = `${input.manifest.id}-${requestCounter}`;
    const contextFactory = input.contextFactory ?? createPluginContext;
    const context = contextFactory({
      manifest: input.manifest,
      service: input.service,
      method,
      requestId,
      runtimeInstanceId,
      config: configSnapshot,
      traceContext: options?.traceContext,
    });

    return executePluginHandler({
      handler,
      request,
      context,
      method,
    });
  }
}

function deriveConfigSnapshot(request: unknown): Readonly<Record<string, string>> {
  if (request === null || typeof request !== "object") {
    return Object.freeze({});
  }

  const candidate = (request as { config?: unknown }).config;
  if (candidate === null || typeof candidate !== "object") {
    return Object.freeze({});
  }

  const entries = Object.entries(candidate).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );

  return Object.freeze(Object.fromEntries(entries));
}
