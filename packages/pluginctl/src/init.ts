/**
 * Scaffolds new plugin projects from the repository's default template set.
 */

import { renderDefaultPluginTemplate } from "@balance/plugin-templates";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface InitPluginInput {
  projectDir: string;
  id: string;
  packageName: string;
  serviceName: string;
}

export interface InitializedPluginProject {
  projectDir: string;
  manifestPath: string;
  protoPath: string;
}

export async function initPluginProject(
  input: InitPluginInput,
): Promise<InitializedPluginProject> {
  const projectDir = resolve(input.projectDir);
  await assertDirectoryEmpty(projectDir);

  const rendered = renderDefaultPluginTemplate({
    id: input.id,
    packageName: input.packageName,
    serviceName: input.serviceName,
    projectName: input.id,
  });

  for (const file of rendered.files) {
    const targetPath = join(projectDir, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.contents);
  }

  return {
    projectDir,
    manifestPath: join(projectDir, rendered.manifestPath),
    protoPath: join(projectDir, rendered.protoPath),
  };
}

async function assertDirectoryEmpty(projectDir: string): Promise<void> {
  try {
    await access(projectDir);
  } catch {
    await mkdir(projectDir, { recursive: true });
    return;
  }

  const entries = await readdir(projectDir);
  if (entries.length > 0) {
    throw new Error(`Project directory must be empty: ${projectDir}`);
  }
}
