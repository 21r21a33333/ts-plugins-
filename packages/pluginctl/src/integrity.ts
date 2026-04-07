/**
 * Hashing and integrity helpers for packed or installed plugin artifacts.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { PluginManifest } from "./manifest-schema.js";
import type { PluginServiceDefinition } from "@balance/plugin-codegen";

export async function sha256File(filePath: string): Promise<string> {
  return sha256Bytes(await readFile(filePath));
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function computePackageDigest(rootDir: string): Promise<string> {
  const filePaths = await listFiles(rootDir);
  const hash = createHash("sha256");

  for (const filePath of filePaths) {
    const relativePath = normalizeRelativePath(relative(rootDir, filePath));
    hash.update(`${relativePath}\n`);

    if (relativePath === "plugin.json") {
      hash.update(
        JSON.stringify(normalizeManifestForDigest(
          JSON.parse(await readFile(filePath, "utf8")) as PluginManifest,
        )),
      );
      hash.update("\n");
      continue;
    }

    hash.update(await readFile(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

export function computeMethodIdsDigest(
  service: PluginServiceDefinition,
): string {
  return sha256Text(
    JSON.stringify(
      service.methods.map((method) => ({
        canonicalName: method.canonicalName,
        methodId: method.methodId,
      })),
    ),
  );
}

async function listFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeManifestForDigest(manifest: PluginManifest): PluginManifest {
  if (manifest.integrity?.packageSha256 === undefined) {
    return manifest;
  }

  const { integrity: _integrity, ...manifestWithoutIntegrity } = manifest;
  const integrity = { ...manifest.integrity };
  delete integrity.packageSha256;
  const normalizedIntegrity =
    Object.keys(integrity).length === 0 ? undefined : integrity;

  if (normalizedIntegrity === undefined) {
    return manifestWithoutIntegrity as PluginManifest;
  }

  return {
    ...manifestWithoutIntegrity,
    integrity: normalizedIntegrity,
  };
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}
