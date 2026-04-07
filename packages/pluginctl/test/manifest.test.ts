import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as pluginctl from "../src/index.js";

describe("validatePluginManifest", () => {
  let fixtureRoot: string | undefined;

  afterEach(async () => {
    if (fixtureRoot !== undefined) {
      await rm(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = undefined;
    }
  });

  async function createPluginFixture(
    manifestOverride: Partial<Record<string, unknown>> = {},
  ): Promise<{ rootDir: string; manifestPath: string }> {
    fixtureRoot = await mkdtemp(join(tmpdir(), "pluginctl-manifest-"));
    await mkdir(join(fixtureRoot, "dist"), { recursive: true });
    await mkdir(join(fixtureRoot, "descriptors"), { recursive: true });

    await writeFile(join(fixtureRoot, "dist", "index.js"), "export default {};\n");
    await copyFile(
      join(process.cwd(), "../../descriptors/contracts.binpb"),
      join(fixtureRoot, "descriptors", "plugin.pb"),
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
      ...manifestOverride,
    };

    const manifestPath = join(fixtureRoot, "plugin.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    return {
      rootDir: fixtureRoot,
      manifestPath,
    };
  }

  it("validates a manifest against the descriptor set and runtime defaults", async () => {
    const fixture = await createPluginFixture();

    expect(typeof (pluginctl as { validatePluginManifest?: unknown }).validatePluginManifest).toBe(
      "function",
    );

    const result = await (
      pluginctl as {
        validatePluginManifest: (manifestPath: string) => Promise<{
          manifest: {
            id: string;
            runtime: {
              activation: { mode: string };
              concurrency: { mode: string };
            };
          };
          contract: {
            serviceName: string;
            methods: Array<{ name: string }>;
          };
        }>;
      }
    ).validatePluginManifest(fixture.manifestPath);

    expect(result.manifest.id).toBe("quote-plugin");
    expect(result.manifest.runtime.activation.mode).toBe("lazy");
    expect(result.manifest.runtime.concurrency.mode).toBe("serial");
    expect(result.contract.serviceName).toBe("QuotePluginService");
    expect(result.contract.methods.map((method) => method.name)).toEqual([
      "Init",
      "GetPrice",
    ]);
  });

  it("rejects an invalid concurrency mode", async () => {
    const fixture = await createPluginFixture({
      runtime: {
        language: "node",
        activation: {
          mode: "lazy",
        },
        concurrency: {
          mode: "turbo",
        },
        initTimeoutMs: 5_000,
        requestTimeoutMs: 10_000,
      },
    });

    await expect(
      (
        pluginctl as {
          validatePluginManifest: (manifestPath: string) => Promise<unknown>;
        }
      ).validatePluginManifest(fixture.manifestPath),
    ).rejects.toThrow(/concurrency/i);
  });

  it("rejects a manifest whose service name disagrees with the descriptor", async () => {
    const fixture = await createPluginFixture({
      contract: {
        descriptorSet: "./descriptors/plugin.pb",
        service: "balance.plugins.quote.v1.WrongService",
      },
    });

    await expect(
      (
        pluginctl as {
          validatePluginManifest: (manifestPath: string) => Promise<unknown>;
        }
      ).validatePluginManifest(fixture.manifestPath),
    ).rejects.toThrow(/service/i);
  });

  it("rejects a manifest whose main entrypoint does not exist", async () => {
    const fixture = await createPluginFixture({
      main: "./dist/missing.js",
    });

    await expect(
      (
        pluginctl as {
          validatePluginManifest: (manifestPath: string) => Promise<unknown>;
        }
      ).validatePluginManifest(fixture.manifestPath),
    ).rejects.toThrow(/main/i);
  });
});
