import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";

import * as pluginctl from "../src/index.js";

describe("packPlugin and installPlugin", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  });

  async function createPluginFixture(options?: {
    manifestPatch?: Record<string, unknown>;
    includeIntegrity?: boolean;
  }): Promise<{ rootDir: string; pluginHome: string }> {
    const rootDir = await mkdtemp(join(tmpdir(), "pluginctl-pack-"));
    const pluginHome = await mkdtemp(join(tmpdir(), "pluginctl-home-"));
    tempRoots.push(rootDir, pluginHome);

    await mkdir(join(rootDir, "dist"), { recursive: true });
    await mkdir(join(rootDir, "descriptors"), { recursive: true });

    await writeFile(join(rootDir, "dist", "index.js"), "export default {};\n");
    await writeFile(
      join(rootDir, "package.json"),
      `${JSON.stringify(
        {
          name: "quote-plugin",
          version: "1.0.0",
          private: true,
        },
        null,
        2,
      )}\n`,
    );
    await copyFile(
      join(process.cwd(), "../../descriptors/contracts.binpb"),
      join(rootDir, "descriptors", "plugin.pb"),
    );

    const manifest = {
      schemaVersion: 1,
      id: "quote-plugin",
      version: "1.0.0",
      main: "./dist/index.js",
      contract: {
        descriptorSet: "./descriptors/plugin.pb",
        service: "balance.plugins.quote.v1.QuotePluginService",
      },
      runtime: {
        language: "node",
        activation: {
          mode: "lazy",
        },
        concurrency: {
          mode: "serial",
        },
        initTimeoutMs: 5_000,
        requestTimeoutMs: 10_000,
      },
      ...(options?.includeIntegrity
        ? {
            integrity: {
              packageSha256: "definitely-wrong",
            },
          }
        : {}),
      ...options?.manifestPatch,
    };

    await writeFile(
      join(rootDir, "plugin.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    return { rootDir, pluginHome };
  }

  it("packs a local plugin and installs a tarball into the immutable cache layout", async () => {
    const { rootDir, pluginHome } = await createPluginFixture();
    const outputDir = await mkdtemp(join(tmpdir(), "pluginctl-output-"));
    tempRoots.push(outputDir);

    expect(typeof (pluginctl as { packPlugin?: unknown }).packPlugin).toBe(
      "function",
    );
    expect(typeof (pluginctl as { installPlugin?: unknown }).installPlugin).toBe(
      "function",
    );

    const packed = await (
      pluginctl as {
        packPlugin: (input: {
          sourceDir: string;
          outputDir: string;
        }) => Promise<{ tarballPath: string }>;
      }
    ).packPlugin({
      sourceDir: rootDir,
      outputDir,
    });

    const installed = await (
      pluginctl as {
        installPlugin: (input: {
          pluginHome: string;
          source:
            | { kind: "folder"; path: string }
            | { kind: "tarball"; path: string }
            | { kind: "npm"; spec: string };
        }) => Promise<{ installDir: string }>;
      }
    ).installPlugin({
      pluginHome,
      source: {
        kind: "tarball",
        path: packed.tarballPath,
      },
    });

    expect(installed.installDir).toBe(
      join(pluginHome, "registry", "plugins", "quote-plugin", "1.0.0"),
    );
    await expect(
      access(join(installed.installDir, "manifest.json")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(installed.installDir, "descriptors", "plugin.pb")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(installed.installDir, "metadata", "install.json")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(installed.installDir, "metadata", "integrity.json")),
    ).resolves.toBeUndefined();
  });

  it("installs a local folder directly into the immutable cache layout", async () => {
    const { rootDir, pluginHome } = await createPluginFixture();

    const installed = await (
      pluginctl as {
        installPlugin: (input: {
          pluginHome: string;
          source:
            | { kind: "folder"; path: string }
            | { kind: "tarball"; path: string }
            | { kind: "npm"; spec: string };
        }) => Promise<{ installDir: string }>;
      }
    ).installPlugin({
      pluginHome,
      source: {
        kind: "folder",
        path: rootDir,
      },
    });

    const installMetadata = JSON.parse(
      await readFile(
        join(installed.installDir, "metadata", "install.json"),
        "utf8",
      ),
    ) as { source: { kind: string } };

    expect(installMetadata.source.kind).toBe("folder");
  });

  it("supports pacote-style npm specs during install", async () => {
    const { rootDir, pluginHome } = await createPluginFixture();
    const outputDir = await mkdtemp(join(tmpdir(), "pluginctl-output-"));
    tempRoots.push(outputDir);

    const packed = await (
      pluginctl as {
        packPlugin: (input: {
          sourceDir: string;
          outputDir: string;
        }) => Promise<{ tarballPath: string }>;
      }
    ).packPlugin({
      sourceDir: rootDir,
      outputDir,
    });

    const installed = await (
      pluginctl as {
        installPlugin: (input: {
          pluginHome: string;
          source:
            | { kind: "folder"; path: string }
            | { kind: "tarball"; path: string }
            | { kind: "npm"; spec: string };
        }) => Promise<{ installDir: string }>;
      }
    ).installPlugin({
      pluginHome,
      source: {
        kind: "npm",
        spec: `file:${packed.tarballPath}`,
      },
    });

    const installMetadata = JSON.parse(
      await readFile(
        join(installed.installDir, "metadata", "install.json"),
        "utf8",
      ),
    ) as { source: { kind: string; spec?: string } };

    expect(installMetadata.source.kind).toBe("npm");
    expect(installMetadata.source.spec).toContain("file:");
  });

  it("rejects an integrity mismatch during install", async () => {
    const { rootDir, pluginHome } = await createPluginFixture({
      includeIntegrity: true,
    });

    await expect(
      (
        pluginctl as {
          installPlugin: (input: {
            pluginHome: string;
            source:
              | { kind: "folder"; path: string }
              | { kind: "tarball"; path: string }
              | { kind: "npm"; spec: string };
          }) => Promise<unknown>;
        }
      ).installPlugin({
        pluginHome,
        source: {
          kind: "folder",
          path: rootDir,
        },
      }),
    ).rejects.toThrow(/integrity/i);
  });

  it("rejects a tarball install when the packaged manifest is missing integrity metadata", async () => {
    const { rootDir, pluginHome } = await createPluginFixture();
    const outputDir = await mkdtemp(join(tmpdir(), "pluginctl-output-"));
    tempRoots.push(outputDir);
    const tarballPath = join(outputDir, "quote-plugin-1.0.0.tgz");

    await tar.create(
      {
        gzip: true,
        cwd: rootDir,
        file: tarballPath,
        portable: true,
      },
      ["."],
    );

    await expect(
      (
        pluginctl as {
          installPlugin: (input: {
            pluginHome: string;
            source:
              | { kind: "folder"; path: string }
              | { kind: "tarball"; path: string }
              | { kind: "npm"; spec: string };
          }) => Promise<unknown>;
        }
      ).installPlugin({
        pluginHome,
        source: {
          kind: "tarball",
          path: tarballPath,
        },
      }),
    ).rejects.toThrow(/integrity/i);
  });

  it("rejects install when the descriptor set is missing", async () => {
    const { rootDir, pluginHome } = await createPluginFixture({
      manifestPatch: {
        contract: {
          descriptorSet: "./descriptors/missing.pb",
          service: "balance.plugins.quote.v1.QuotePluginService",
        },
      },
    });

    await expect(
      (
        pluginctl as {
          installPlugin: (input: {
            pluginHome: string;
            source:
              | { kind: "folder"; path: string }
              | { kind: "tarball"; path: string }
              | { kind: "npm"; spec: string };
          }) => Promise<unknown>;
        }
      ).installPlugin({
        pluginHome,
        source: {
          kind: "folder",
          path: rootDir,
        },
      }),
    ).rejects.toThrow(/descriptor/i);
  });
});
