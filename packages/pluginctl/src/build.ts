/**
 * Compiles a plugin project and re-validates its packaged manifest inputs.
 */

import { resolve } from "node:path";

import { runTool } from "./command-runner.js";
import { validatePluginManifest } from "./validate-manifest.js";

export interface BuildPluginInput {
  projectDir: string;
}

export interface BuiltPlugin {
  manifestPath: string;
  mainPath: string;
}

export async function buildPlugin(
  input: BuildPluginInput,
): Promise<BuiltPlugin> {
  const projectDir = resolve(input.projectDir);
  await runTool("tsc", ["-p", joinProject(projectDir, "tsconfig.json")], {
    cwd: projectDir,
  });

  const validated = await validatePluginManifest(joinProject(projectDir, "plugin.json"));

  return {
    manifestPath: joinProject(projectDir, "plugin.json"),
    mainPath: resolve(projectDir, validated.manifest.main),
  };
}

function joinProject(projectDir: string, path: string): string {
  return resolve(projectDir, path);
}
