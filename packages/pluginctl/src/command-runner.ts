import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const binRoot = join(repoRoot, "node_modules", ".bin");

export async function runTool(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<void> {
  const binaryPath = join(binRoot, command);
  await ensurePathExists(binaryPath, `Required tool ${command} was not found at ${binaryPath}`);

  await execFileAsync(binaryPath, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH ?? ""}`,
    },
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function ensurePathExists(path: string, errorMessage: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(errorMessage);
  }
}
