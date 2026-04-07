/**
 * Validates a plugin manifest against on-disk artifacts and the packaged descriptor set.
 */

import {
  buildPluginServiceDefinition,
  loadDescriptorRegistry,
  type PluginServiceDefinition,
} from "@balance/plugin-codegen";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { pluginManifestSchema, type PluginManifest } from "./manifest-schema.js";

export interface ValidatedPluginManifest {
  manifest: PluginManifest;
  contract: PluginServiceDefinition;
  rootDir: string;
}

export async function validatePluginManifest(
  manifestPath: string,
): Promise<ValidatedPluginManifest> {
  const manifestAbsolutePath = resolve(manifestPath);
  const rootDir = dirname(manifestAbsolutePath);
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(manifestAbsolutePath, "utf8")),
  );

  const mainPath = resolve(rootDir, manifest.main);
  await assertPathExists(mainPath, `Plugin main entrypoint does not exist: ${manifest.main}`);

  if (manifest.sourceMap !== undefined) {
    const sourceMapPath = resolve(rootDir, manifest.sourceMap);
    await assertPathExists(
      sourceMapPath,
      `Plugin source map does not exist: ${manifest.sourceMap}`,
    );
  }

  const descriptorPath = resolve(rootDir, manifest.contract.descriptorSet);
  await assertPathExists(
    descriptorPath,
    `Plugin descriptor set does not exist: ${manifest.contract.descriptorSet}`,
  );

  const registry = await loadDescriptorRegistry(descriptorPath);
  const service = registry.getService(manifest.contract.service);
  if (service === undefined) {
    throw new Error(
      `Plugin manifest service ${manifest.contract.service} was not found in the descriptor set`,
    );
  }

  return {
    manifest,
    contract: buildPluginServiceDefinition([service]),
    rootDir,
  };
}

async function assertPathExists(path: string, errorMessage: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(errorMessage);
  }
}
