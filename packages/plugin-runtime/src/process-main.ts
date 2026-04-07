import { pathToFileURL } from "node:url";

import type { PluginServiceDefinition } from "@balance/plugin-codegen";
import type { RuntimeKvConfig } from "./kv.js";
import type { PluginRuntimeManifest } from "./context.js";

import { loadRuntimeServiceDefinition } from "./service-definition.js";
import { startPluginSocketRuntimeServer } from "./socket-server.js";

interface RuntimeProcessEnvironment {
  socketPath: string;
  entrypointPath: string;
  manifest: PluginRuntimeManifest;
  kvConfig?: RuntimeKvConfig;
  descriptorPath?: string;
  serviceName?: string;
  serviceModulePath?: string;
  serviceExportName?: string;
}

const runtimeEnvironment = readRuntimeProcessEnvironment(process.env);
const service = await resolveServiceMetadata(runtimeEnvironment);
const server = await startPluginSocketRuntimeServer({
  socketPath: runtimeEnvironment.socketPath,
  entrypointPath: runtimeEnvironment.entrypointPath,
  manifest: runtimeEnvironment.manifest,
  service,
  kvConfig: runtimeEnvironment.kvConfig,
});

let closing = false;
const shutdown = async (exitCode: number) => {
  if (closing) {
    return;
  }
  closing = true;
  await server.close();
  process.exit(exitCode);
};

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

await new Promise<void>((resolve, reject) => {
  process.on("beforeExit", () => resolve());
  process.on("uncaughtException", (error) => reject(error));
  process.on("unhandledRejection", (reason) =>
    reject(reason instanceof Error ? reason : new Error(String(reason))),
  );
});

function readRuntimeProcessEnvironment(
  env: NodeJS.ProcessEnv,
): RuntimeProcessEnvironment {
  const socketPath = requireEnv(env, "BALANCE_PLUGIN_SOCKET_PATH");
  const entrypointPath = requireEnv(env, "BALANCE_PLUGIN_ENTRYPOINT");
  const manifest = JSON.parse(
    requireEnv(env, "BALANCE_PLUGIN_MANIFEST_JSON"),
  ) as RuntimeProcessEnvironment["manifest"];
  const kvConfig = env.BALANCE_PLUGIN_KV_JSON === undefined
    ? undefined
    : JSON.parse(env.BALANCE_PLUGIN_KV_JSON) as RuntimeKvConfig;
  const descriptorPath = env.BALANCE_PLUGIN_DESCRIPTOR_PATH;
  const serviceName = env.BALANCE_PLUGIN_SERVICE_NAME;
  const serviceModulePath = env.BALANCE_PLUGIN_SERVICE_MODULE;
  const serviceExportName = env.BALANCE_PLUGIN_SERVICE_EXPORT ?? "default";

  return {
    socketPath,
    entrypointPath,
    manifest,
    kvConfig,
    descriptorPath,
    serviceName,
    serviceModulePath,
    serviceExportName,
  };
}

async function resolveServiceMetadata(
  environment: RuntimeProcessEnvironment,
): Promise<PluginServiceDefinition> {
  if (
    environment.descriptorPath !== undefined &&
    environment.serviceName !== undefined
  ) {
    return loadRuntimeServiceDefinition({
      descriptorPath: environment.descriptorPath,
      serviceName: environment.serviceName,
    });
  }

  if (
    environment.serviceModulePath === undefined ||
    environment.serviceModulePath.length === 0
  ) {
    throw new Error(
      "Runtime requires either BALANCE_PLUGIN_DESCRIPTOR_PATH + BALANCE_PLUGIN_SERVICE_NAME or BALANCE_PLUGIN_SERVICE_MODULE",
    );
  }

  return loadServiceMetadataFromModule(
    environment.serviceModulePath,
    environment.serviceExportName ?? "default",
  );
}

async function loadServiceMetadataFromModule(
  modulePath: string,
  exportName: string,
): Promise<PluginServiceDefinition> {
  const loadedModule = await import(pathToFileURL(modulePath).href);
  if (!(exportName in loadedModule)) {
    throw new Error(
      `Runtime service module ${modulePath} did not export ${exportName}`,
    );
  }

  return loadedModule[exportName] as PluginServiceDefinition;
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}
