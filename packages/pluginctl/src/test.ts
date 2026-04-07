import { resolve } from "node:path";

import { runTool } from "./command-runner.js";

export interface TestPluginInput {
  projectDir: string;
}

export interface TestedPlugin {
  projectDir: string;
  status: "ok";
}

export async function testPlugin(input: TestPluginInput): Promise<TestedPlugin> {
  const projectDir = resolve(input.projectDir);
  await runTool("pnpm", ["test"], { cwd: projectDir });
  return {
    projectDir,
    status: "ok",
  };
}
