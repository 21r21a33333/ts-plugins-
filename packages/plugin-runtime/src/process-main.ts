import { pathToFileURL } from "node:url";

import type { PluginServiceDefinition } from "@balance/plugin-codegen";

import { startPluginSocketRuntimeServer } from "./socket-server.js";

interface RuntimeProcessEnvironment {
  socketPath: string;
  entrypointPath: string;
  manifest: {
    id: string;
    version: string;
  };
  serviceModulePath: string;
  serviceExportName: string;
}

const runtimeEnvironment = readRuntimeProcessEnvironment(process.env);
const service = await loadServiceMetadata(
  runtimeEnvironment.serviceModulePath,
  runtimeEnvironment.serviceExportName,
);
const server = await startPluginSocketRuntimeServer({
  socketPath: runtimeEnvironment.socketPath,
  entrypointPath: runtimeEnvironment.entrypointPath,
  manifest: runtimeEnvironment.manifest,
  service,
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
  const serviceModulePath = requireEnv(env, "BALANCE_PLUGIN_SERVICE_MODULE");
  const serviceExportName = env.BALANCE_PLUGIN_SERVICE_EXPORT ?? "default";
  const manifest = JSON.parse(
    requireEnv(env, "BALANCE_PLUGIN_MANIFEST_JSON"),
  ) as RuntimeProcessEnvironment["manifest"];

  return {
    socketPath,
    entrypointPath,
    manifest,
    serviceModulePath,
    serviceExportName,
  };
}

async function loadServiceMetadata(
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
