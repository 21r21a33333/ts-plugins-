import { afterEach, describe, expect, it } from "vitest";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as pluginctl from "../src/index.js";

describe("pluginctl cli", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  });

  async function createPluginFixture(): Promise<{
    rootDir: string;
    manifestPath: string;
  }> {
    const rootDir = await mkdtemp(join(tmpdir(), "pluginctl-cli-"));
    tempRoots.push(rootDir);

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
    const manifestPath = join(rootDir, "plugin.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
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
            activation: { mode: "lazy" },
            concurrency: { mode: "serial" },
            initTimeoutMs: 5_000,
            requestTimeoutMs: 10_000,
          },
        },
        null,
        2,
      )}\n`,
    );

    return { rootDir, manifestPath };
  }

  it("prints service and method metadata for inspect", async () => {
    const fixture = await createPluginFixture();
    const output: string[] = [];

    expect(typeof (pluginctl as { runCli?: unknown }).runCli).toBe("function");

    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(["inspect", fixture.manifestPath], {
      stdout: {
        write(value: string) {
          output.push(value);
        },
      },
    });

    const joined = output.join("");
    expect(joined).toContain("\"serviceName\": \"QuotePluginService\"");
    expect(joined).toContain("\"methodId\"");
    expect(joined).toContain("\"GetPrice\"");
  });

  it("packs a plugin directory through the cli", async () => {
    const fixture = await createPluginFixture();
    const outputDir = await mkdtemp(join(tmpdir(), "pluginctl-cli-output-"));
    tempRoots.push(outputDir);
    const output: string[] = [];

    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(["pack", fixture.rootDir, "--output", outputDir], {
      stdout: {
        write(value: string) {
          output.push(value);
        },
      },
    });

    const tarballPath = output.join("").trim();
    expect(tarballPath).toContain("quote-plugin-1.0.0.tgz");
  });

  it("installs a local folder through the cli", async () => {
    const fixture = await createPluginFixture();
    const pluginHome = await mkdtemp(join(tmpdir(), "pluginctl-cli-home-"));
    tempRoots.push(pluginHome);
    const output: string[] = [];

    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(
      [
        "install",
        "--kind",
        "folder",
        "--plugin-home",
        pluginHome,
        fixture.rootDir,
      ],
      {
        stdout: {
          write(value: string) {
            output.push(value);
          },
        },
      },
    );

    const installDir = output.join("").trim();
    const installMetadata = JSON.parse(
      await readFile(join(installDir, "metadata", "install.json"), "utf8"),
    ) as { source: { kind: string } };

    expect(installDir).toContain("/registry/plugins/quote-plugin/1.0.0");
    expect(installMetadata.source.kind).toBe("folder");
  });
});
