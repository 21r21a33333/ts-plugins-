/**
 * Bootstraps a plugin entrypoint into the typed dispatcher used by the socket runtime.
 */

import { pathToFileURL } from "node:url";

import type { PluginServiceDefinition } from "@balance/plugin-codegen";

import { createPluginDispatcher, type PluginDispatcher } from "./dispatcher.js";
import type { PluginHandlerMap } from "./define-plugin.js";
import type {
  PluginContextFactory,
  PluginRuntimeManifest,
} from "./context.js";

export interface BootstrapPluginRuntimeInput {
  manifest: PluginRuntimeManifest;
  service: PluginServiceDefinition;
  entrypointPath?: string;
  loadModule?: () => Promise<unknown>;
  contextFactory?: PluginContextFactory;
  runtimeInstanceId?: string;
}

export interface PluginRuntime extends PluginDispatcher {
  readonly manifest: PluginRuntimeManifest;
  readonly service: PluginServiceDefinition;
}

/**
 * Loads a plugin entrypoint, validates the exported handlers, and returns the initialized dispatcher.
 */
export async function bootstrapPluginRuntime(
  input: BootstrapPluginRuntimeInput,
): Promise<PluginRuntime> {
  const module = await loadEntrypointModule(input);
  const handlers = resolvePluginHandlers(module);
  validateHandlers(handlers, input.service);
  const dispatcher = createPluginDispatcher({
    manifest: input.manifest,
    service: input.service,
    handlers,
    contextFactory: input.contextFactory,
    runtimeInstanceId: input.runtimeInstanceId,
  });

  return {
    manifest: input.manifest,
    service: input.service,
    initialize: dispatcher.initialize,
    invoke: dispatcher.invoke,
    isInitialized: dispatcher.isInitialized,
  };
}

async function loadEntrypointModule(
  input: BootstrapPluginRuntimeInput,
): Promise<unknown> {
  if (input.loadModule !== undefined) {
    return input.loadModule();
  }

  if (input.entrypointPath === undefined) {
    throw new Error("Either entrypointPath or loadModule must be provided");
  }

  return import(pathToFileURL(input.entrypointPath).href);
}

function resolvePluginHandlers(module: unknown): PluginHandlerMap {
  if (module === null || typeof module !== "object") {
    throw new Error("Plugin entrypoint did not export a handler object");
  }

  const candidate = "default" in module
    ? (module as { default: unknown }).default
    : module;
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("Plugin default export must be an object of handlers");
  }

  return candidate as PluginHandlerMap;
}

function validateHandlers(
  handlers: PluginHandlerMap,
  service: PluginServiceDefinition,
): void {
  const expected = new Set(service.methods.map((method) => method.localName));
  const actual = Object.keys(handlers);

  const missing = service.methods
    .map((method) => method.localName)
    .filter((name) => !(name in handlers));
  if (missing.length > 0) {
    throw new Error(`Plugin is missing handler implementations: ${missing.join(", ")}`);
  }

  // Strict handler validation keeps the runtime aligned with the generated protobuf contract.
  const extra = actual.filter((name) => !expected.has(name));
  if (extra.length > 0) {
    throw new Error(`Plugin exports unexpected handlers: ${extra.join(", ")}`);
  }
}
