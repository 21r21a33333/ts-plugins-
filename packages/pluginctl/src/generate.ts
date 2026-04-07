import {
  buildPluginServiceDefinition,
  generateTsHandlersSource,
  loadDescriptorRegistry,
} from "@balance/plugin-codegen";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { pluginManifestSchema, type PluginManifest } from "./manifest-schema.js";
import { runTool } from "./command-runner.js";

export interface GeneratePluginBindingsInput {
  projectDir: string;
}

export interface GeneratedPluginBindings {
  descriptorPath: string;
  handlersPath: string;
}

export async function generatePluginBindings(
  input: GeneratePluginBindingsInput,
): Promise<GeneratedPluginBindings> {
  const projectDir = resolve(input.projectDir);
  const manifestPath = join(projectDir, "plugin.json");
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as PluginManifest,
  );

  if ((manifest.contract.protoSources?.length ?? 0) === 0) {
    throw new Error(
      "Plugin manifest must declare contract.protoSources before running generate",
    );
  }

  await runTool("buf", ["generate"], { cwd: projectDir });

  const descriptorPath = resolve(projectDir, manifest.contract.descriptorSet);
  await mkdir(dirname(descriptorPath), { recursive: true });
  await runTool(
    "buf",
    ["build", "--as-file-descriptor-set", "-o", descriptorPath],
    { cwd: projectDir },
  );

  const registry = await loadDescriptorRegistry(descriptorPath);
  const service = registry.getService(manifest.contract.service);
  if (service === undefined) {
    throw new Error(
      `Plugin service ${manifest.contract.service} was not found in generated descriptors`,
    );
  }

  const definition = buildPluginServiceDefinition([service]);
  const protoSource = manifest.contract.protoSources![0]!;
  const handlersPath = join(projectDir, "gen", "plugin-handlers.ts");
  await mkdir(dirname(handlersPath), { recursive: true });

  const messageModulePath = join(
    projectDir,
    "gen",
    "ts",
    normalizeProtoSource(protoSource).replace(/\.proto$/, "_pb.js"),
  );
  const messagesModuleSpecifier = normalizeModuleSpecifier(
    relative(dirname(handlersPath), messageModulePath),
  );

  await writeFile(
    handlersPath,
    generateTsHandlersSource({
      service: definition,
      messagesModuleSpecifier,
    }),
  );

  return {
    descriptorPath,
    handlersPath,
  };
}

function normalizeProtoSource(protoSource: string): string {
  const normalized = protoSource.replace(/^\.\//, "");
  return normalized.startsWith("proto/")
    ? normalized.slice("proto/".length)
    : normalized;
}

function normalizeModuleSpecifier(value: string): string {
  const normalized = value.split(sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}
