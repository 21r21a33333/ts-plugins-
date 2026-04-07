/**
 * Builds a reproducible tarball from a validated plugin project.
 */

import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import * as tar from "tar";

import { computePackageDigest } from "./integrity.js";
import { validatePluginManifest } from "./validate-manifest.js";

export interface PackPluginInput {
  sourceDir: string;
  outputDir: string;
}

export interface PackedPluginArtifact {
  tarballPath: string;
  manifestPath: string;
  packageSha256: string;
}

export async function packPlugin(
  input: PackPluginInput,
): Promise<PackedPluginArtifact> {
  const sourceManifest = await validatePluginManifest(
    join(input.sourceDir, "plugin.json"),
  );
  const stagingRoot = await mkdtemp(join(tmpdir(), "pluginctl-pack-stage-"));
  const packageRoot = join(stagingRoot, "package");
  await mkdir(packageRoot, { recursive: true });

  const packageEntries = collectPackageEntries(sourceManifest.manifest);
  for (const relativeEntry of packageEntries) {
    await cp(join(sourceManifest.rootDir, relativeEntry), join(packageRoot, relativeEntry), {
      recursive: true,
    });
  }
  if (await pathExists(join(sourceManifest.rootDir, "package.json"))) {
    await cp(
      join(sourceManifest.rootDir, "package.json"),
      join(packageRoot, "package.json"),
    );
  }

  const manifestPath = join(packageRoot, "plugin.json");
  const packageSha256 = await computePackageDigest(packageRoot);
  const packedManifest = {
    ...sourceManifest.manifest,
    integrity: {
      ...sourceManifest.manifest.integrity,
      packageSha256,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(packedManifest, null, 2)}\n`);

  await mkdir(input.outputDir, { recursive: true });
  const tarballPath = join(
    input.outputDir,
    `${sourceManifest.manifest.id}-${sourceManifest.manifest.version}.tgz`,
  );

  await tar.create(
    {
      gzip: true,
      cwd: packageRoot,
      file: tarballPath,
      portable: true,
    },
    ["."],
  );

  return {
    tarballPath,
    manifestPath,
    packageSha256,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function collectPackageEntries(manifest: {
  main: string;
  sourceMap?: string;
  contract: { descriptorSet: string; protoSources?: string[] };
}): string[] {
  const entries = new Set<string>(["plugin.json"]);

  addTopLevelEntry(entries, manifest.main);
  if (manifest.sourceMap !== undefined) {
    addTopLevelEntry(entries, manifest.sourceMap);
  }
  addTopLevelEntry(entries, manifest.contract.descriptorSet);
  for (const protoSource of manifest.contract.protoSources ?? []) {
    addTopLevelEntry(entries, protoSource);
  }

  return [...entries];
}

function addTopLevelEntry(entries: Set<string>, value: string): void {
  const normalized = value.replace(/^\.\//, "");
  const [topLevel] = normalized.split("/");
  if (topLevel !== undefined && topLevel.length > 0) {
    entries.add(topLevel);
  }
}
