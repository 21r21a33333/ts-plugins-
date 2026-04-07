/**
 * Runs external toolchain commands with consistent error handling.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const binRoot = join(repoRoot, "node_modules", ".bin");

export async function runTool(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<void> {
  const binaryPath = join(binRoot, command);
  const resolvedBinary = await resolveBinary(command, binaryPath);

  await execFileAsync(resolvedBinary, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH ?? ""}`,
    },
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function resolveBinary(command: string, localPath: string): Promise<string> {
  try {
    await access(localPath);
    return localPath;
  } catch {
    return command;
  }
}
