import { buildPluginServiceDefinition } from "@balance/plugin-codegen";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import pacote from "pacote";

import {
  computeMethodIdsDigest,
  computePackageDigest,
  sha256File,
} from "./integrity.js";
import type { PluginManifest } from "./manifest-schema.js";
import { validatePluginManifest } from "./validate-manifest.js";

export type PluginInstallSource =
  | { kind: "folder"; path: string }
  | { kind: "tarball"; path: string }
  | { kind: "npm"; spec: string };

export interface InstallPluginInput {
  pluginHome: string;
  source: PluginInstallSource;
}

export interface InstalledPlugin {
  installDir: string;
  manifest: PluginManifest;
}

export async function installPlugin(
  input: InstallPluginInput,
): Promise<InstalledPlugin> {
  const stagingRoot = await mkdtemp(join(tmpdir(), "pluginctl-install-stage-"));
  const packageRoot = join(stagingRoot, "package");
  await mkdir(packageRoot, { recursive: true });

  try {
    const pacoteManifest =
      input.source.kind === "npm"
        ? await pacote.manifest(input.source.spec)
        : undefined;

    if (input.source.kind === "folder") {
      await cp(resolve(input.source.path), packageRoot, { recursive: true });
    } else if (input.source.kind === "tarball") {
      await pacote.extract(resolve(input.source.path), packageRoot);
    } else {
      await pacote.extract(input.source.spec, packageRoot);
    }

    const validated = await validatePluginManifest(join(packageRoot, "plugin.json"));
    const packageSha256 = await computePackageDigest(packageRoot);
    const expectedPackageSha256 = validated.manifest.integrity?.packageSha256;
    if (
      expectedPackageSha256 !== undefined &&
      expectedPackageSha256 !== packageSha256
    ) {
      throw new Error(
        `Plugin package integrity mismatch: expected ${expectedPackageSha256}, got ${packageSha256}`,
      );
    }

    const installDir = join(
      input.pluginHome,
      "registry",
      "plugins",
      validated.manifest.id,
      validated.manifest.version,
    );

    await mkdir(join(installDir, "metadata"), { recursive: true });
    await writeFile(
      join(installDir, "manifest.json"),
      `${JSON.stringify(validated.manifest, null, 2)}\n`,
    );

    for (const relativeEntry of collectInstallEntries(validated.manifest)) {
      await cp(join(validated.rootDir, relativeEntry), join(installDir, relativeEntry), {
        recursive: true,
      });
    }

    const descriptorPath = join(
      installDir,
      validated.manifest.contract.descriptorSet.replace(/^\.\//, ""),
    );
    const descriptorSha256 = await sha256File(descriptorPath);
    const methodIdsSha256 = computeMethodIdsDigest(validated.contract);

    await writeFile(
      join(installDir, "metadata", "install.json"),
      `${JSON.stringify(
        {
          installedAt: new Date().toISOString(),
          source: serializeSource(input.source, pacoteManifest),
          plugin: {
            id: validated.manifest.id,
            version: validated.manifest.version,
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(installDir, "metadata", "integrity.json"),
      `${JSON.stringify(
        {
          packageSha256,
          descriptorSha256,
          methodIdsSha256,
        },
        null,
        2,
      )}\n`,
    );

    return {
      installDir,
      manifest: validated.manifest,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function collectInstallEntries(manifest: PluginManifest): string[] {
  const entries = new Set<string>();
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

function serializeSource(
  source: PluginInstallSource,
  pacoteManifest?: {
    _integrity?: string;
    _resolved?: string;
    dist?: { integrity?: string; tarball?: string };
  },
): Record<string, unknown> {
  if (source.kind === "folder") {
    return {
      kind: "folder",
      path: resolve(source.path),
    };
  }

  if (source.kind === "tarball") {
    return {
      kind: "tarball",
      path: resolve(source.path),
    };
  }

  return {
    kind: "npm",
    spec: source.spec,
    resolved: pacoteManifest?._resolved ?? pacoteManifest?.dist?.tarball,
    integrity: pacoteManifest?._integrity ?? pacoteManifest?.dist?.integrity,
  };
}
