import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import * as pluginctl from "../src/index.js";

const execFile = promisify(execFileCallback);

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

  async function createAuthoringFixture(options?: {
    invalidContract?: boolean;
    mainPath?: string;
  }): Promise<{
    rootDir: string;
    manifestPath: string;
  }> {
    const rootDir = await mkdtemp(join(tmpdir(), "pluginctl-authoring-"));
    tempRoots.push(rootDir);

    await mkdir(join(rootDir, "proto", "balance", "plugins", "quote", "v1"), {
      recursive: true,
    });
    await mkdir(join(rootDir, "src"), { recursive: true });
    await mkdir(join(rootDir, "descriptors"), { recursive: true });

    await writeFile(
      join(rootDir, "package.json"),
      `${JSON.stringify(
        {
          name: "quote-plugin",
          version: "1.0.0",
          private: true,
          type: "module",
          scripts: {
            test: "node --eval \"console.log('plugin tests passed')\"",
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(rootDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ES2022",
            moduleResolution: "Bundler",
            outDir: "dist",
            rootDir: "src",
            sourceMap: true,
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(rootDir, "buf.yaml"),
      `version: v2\nmodules:\n  - path: proto\nlint:\n  use:\n    - STANDARD\n`,
    );
    await writeFile(
      join(rootDir, "buf.gen.yaml"),
      `version: v2\nplugins:\n  - local: protoc-gen-es\n    out: gen/ts\n    opt:\n      - target=ts\n      - import_extension=none\n`,
    );
    await writeFile(
      join(rootDir, "src", "index.ts"),
      "export default { kind: 'quote-plugin' };\n",
    );
    await writeFile(
      join(rootDir, "proto", "balance", "plugins", "quote", "v1", "quote_plugin.proto"),
      options?.invalidContract
        ? `syntax = "proto3";\npackage balance.plugins.quote.v1;\nmessage GetPriceRequest { string asset = 1; }\nmessage GetPriceResponse { string price = 1; }\nservice QuotePluginService {\n  rpc GetPrice(GetPriceRequest) returns (GetPriceResponse);\n}\n`
        : `syntax = "proto3";\npackage balance.plugins.quote.v1;\nmessage InitRequest { string plugin_instance_id = 1; }\nmessage InitResponse { string plugin_name = 1; }\nmessage GetPriceRequest { string asset = 1; }\nmessage GetPriceResponse { string price = 1; }\nservice QuotePluginService {\n  rpc Init(InitRequest) returns (InitResponse);\n  rpc GetPrice(GetPriceRequest) returns (GetPriceResponse);\n}\n`,
    );

    const manifestPath = join(rootDir, "plugin.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id: "quote-plugin",
          version: "1.0.0",
          main: options?.mainPath ?? "./dist/index.js",
          sourceMap: "./dist/index.js.map",
          contract: {
            descriptorSet: "./descriptors/plugin.pb",
            service: "balance.plugins.quote.v1.QuotePluginService",
            protoSources: ["./proto/balance/plugins/quote/v1/quote_plugin.proto"],
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

  it("ships pluginctl as an executable workspace command", { timeout: 15_000 }, async () => {
    await execFile("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], {
      cwd: process.cwd(),
    });
    const cliPath = join(process.cwd(), "dist", "cli.js");
    await chmod(cliPath, 0o755);

    const result = await execFile("node", [cliPath, "--help"], {
      cwd: process.cwd(),
    });

    expect(result.stdout).toContain("pluginctl");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("generate");
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

  it("scaffolds a new plugin project through the cli", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "pluginctl-init-"));
    tempRoots.push(workspaceRoot);
    const projectDir = join(workspaceRoot, "weather-plugin");
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
        "init",
        projectDir,
        "--id",
        "weather-plugin",
        "--package",
        "balance.plugins.weather.v1",
        "--service",
        "WeatherPluginService",
      ],
      {
        stdout: {
          write(value: string) {
            output.push(value);
          },
        },
      },
    );

    expect(output.join("")).toContain("\"projectDir\"");
    await expect(
      readFile(join(projectDir, "plugin.json"), "utf8"),
    ).resolves.toContain("\"id\": \"weather-plugin\"");
    await expect(
      readFile(
        join(
          projectDir,
          "proto",
          "balance",
          "plugins",
          "weather",
          "v1",
          "weather_plugin.proto",
        ),
        "utf8",
      ),
    ).resolves.toContain("service WeatherPluginService");
    await expect(
      readFile(join(projectDir, "src", "index.ts"), "utf8"),
    ).resolves.toContain("definePlugin");
    await access(join(projectDir, "tsconfig.json"));
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

  it("generates descriptors and typed handlers for an authoring workspace", async () => {
    const fixture = await createAuthoringFixture();
    const output: string[] = [];

    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(["generate", fixture.rootDir], {
      stdout: {
        write(value: string) {
          output.push(value);
        },
      },
    });

    const result = JSON.parse(output.join("")) as {
      descriptorPath: string;
      handlersPath: string;
    };

    await expect(access(result.descriptorPath)).resolves.toBeUndefined();
    await expect(access(result.handlersPath)).resolves.toBeUndefined();

    const handlersSource = await readFile(result.handlersPath, "utf8");
    expect(handlersSource).toContain("export interface QuotePluginHandlers");
    expect(handlersSource).toContain("getPrice(req: GetPriceRequest");
  });

  it("fails generate when the contract does not define Init", async () => {
    const fixture = await createAuthoringFixture({ invalidContract: true });

    await expect(
      (
        pluginctl as {
          runCli: (
            argv: string[],
            options?: { stdout?: { write: (value: string) => void } },
          ) => Promise<void>;
        }
      ).runCli(["generate", fixture.rootDir]),
    ).rejects.toThrow(/Init/i);
  });

  it("builds a generated plugin workspace and validates its manifest", async () => {
    const fixture = await createAuthoringFixture();
    const generationOutput: string[] = [];

    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(["generate", fixture.rootDir], {
      stdout: {
        write(value: string) {
          generationOutput.push(value);
        },
      },
    });

    expect(JSON.parse(generationOutput.join(""))).toHaveProperty("descriptorPath");

    const output: string[] = [];
    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(["build", fixture.rootDir], {
      stdout: {
        write(value: string) {
          output.push(value);
        },
      },
    });

    const result = JSON.parse(output.join("")) as {
      mainPath: string;
    };

    await expect(access(result.mainPath)).resolves.toBeUndefined();
    await expect(access(join(fixture.rootDir, "dist", "index.js.map"))).resolves.toBeUndefined();
  });

  it("fails build when the compiled entrypoint does not match plugin.json", async () => {
    const fixture = await createAuthoringFixture({
      mainPath: "./dist/wrong.js",
    });
    const generationOutput: string[] = [];

    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(["generate", fixture.rootDir], {
      stdout: {
        write(value: string) {
          generationOutput.push(value);
        },
      },
    });

    expect(JSON.parse(generationOutput.join(""))).toHaveProperty("handlersPath");

    await expect(
      (
        pluginctl as {
          runCli: (
            argv: string[],
            options?: { stdout?: { write: (value: string) => void } },
          ) => Promise<void>;
        }
      ).runCli(["build", fixture.rootDir]),
    ).rejects.toThrow(/main/i);
  });

  it("runs the plugin project's tests through the cli", async () => {
    const fixture = await createAuthoringFixture();
    const output: string[] = [];

    await (
      pluginctl as {
        runCli: (
          argv: string[],
          options?: { stdout?: { write: (value: string) => void } },
        ) => Promise<void>;
      }
    ).runCli(["test", fixture.rootDir], {
      stdout: {
        write(value: string) {
          output.push(value);
        },
      },
    });

    expect(JSON.parse(output.join(""))).toEqual({
      projectDir: fixture.rootDir,
      status: "ok",
    });
  });
});
