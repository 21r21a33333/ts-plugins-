#!/usr/bin/env node

import cac from "cac";
import { pathToFileURL } from "node:url";

import { buildPlugin } from "./build.js";
import { generatePluginBindings } from "./generate.js";
import { initPluginProject } from "./init.js";
import { installPlugin } from "./install.js";
import { packPlugin } from "./pack.js";
import { testPlugin } from "./test.js";
import { validatePluginManifest } from "./validate-manifest.js";

export interface CliIo {
  stdout?: { write: (value: string) => void };
}

export function createCli(io: CliIo = {}) {
  const stdout = io.stdout ?? process.stdout;
  const cli = cac("pluginctl");

  cli.help();
  cli.version("0.1.0");

  cli
    .command("init <projectDir>", "Scaffold a new plugin project from the default template")
    .option("--id <id>", "Plugin package identifier", {
      type: [String],
    })
    .option("--package <protobufPackage>", "Protobuf package name", {
      type: [String],
    })
    .option("--service <serviceName>", "Protobuf service name", {
      type: [String],
    })
    .action(
      async (
        projectDir: string,
        options: {
          id?: string | string[];
          package?: string | string[];
          service?: string | string[];
        },
      ) => {
        const id = firstOptionValue(options.id);
        const packageName = firstOptionValue(options.package);
        const serviceName = firstOptionValue(options.service);

        if (id === undefined || packageName === undefined || serviceName === undefined) {
          throw new Error("The --id, --package, and --service options are required for init");
        }

        const initialized = await initPluginProject({
          projectDir,
          id,
          packageName,
          serviceName,
        });
        stdout.write(`${JSON.stringify(initialized, null, 2)}\n`);
      },
    );

  cli
    .command("inspect <manifestPath>", "Print manifest and contract metadata")
    .action(async (manifestPath: string) => {
      const validated = await validatePluginManifest(manifestPath);
      stdout.write(
        `${JSON.stringify(
          {
            manifest: validated.manifest,
            contract: serializeContractForInspect(validated.contract),
          },
          null,
          2,
        )}\n`,
      );
    });

  cli
    .command("pack <sourceDir>", "Pack a plugin directory into a tarball")
    .option("--output <dir>", "Directory for the packed artifact", {
      type: [String],
    })
    .action(async (sourceDir: string, options: { output?: string | string[] }) => {
      const outputDir = firstOptionValue(options.output);
      if (outputDir === undefined) {
        throw new Error("The --output option is required for pack");
      }

      const packed = await packPlugin({
        sourceDir,
        outputDir,
      });
      stdout.write(`${packed.tarballPath}\n`);
    });

  cli
    .command("generate <projectDir>", "Generate protobuf artifacts and typed handlers")
    .action(async (projectDir: string) => {
      const generated = await generatePluginBindings({
        projectDir,
      });
      stdout.write(
        `${JSON.stringify(
          {
            descriptorPath: generated.descriptorPath,
            handlersPath: generated.handlersPath,
          },
          null,
          2,
        )}\n`,
      );
    });

  cli
    .command("build <projectDir>", "Compile the plugin and validate the manifest")
    .action(async (projectDir: string) => {
      const built = await buildPlugin({ projectDir });
      stdout.write(
        `${JSON.stringify(
          {
            manifestPath: built.manifestPath,
            mainPath: built.mainPath,
          },
          null,
          2,
        )}\n`,
      );
    });

  cli
    .command("test <projectDir>", "Run the plugin project's test command")
    .action(async (projectDir: string) => {
      const tested = await testPlugin({ projectDir });
      stdout.write(`${JSON.stringify(tested, null, 2)}\n`);
    });

  cli
    .command("install <source>", "Install a plugin into the immutable cache")
    .option("--kind <kind>", "Source kind: folder, tarball, or npm", {
      type: [String],
    })
    .option("--plugin-home <dir>", "Plugin home root for immutable installs", {
      type: [String],
    })
    .action(
      async (
        source: string,
        options: { kind?: string | string[]; pluginHome?: string | string[] },
      ) => {
        const pluginHome = firstOptionValue(options.pluginHome);
        if (pluginHome === undefined) {
          throw new Error("The --plugin-home option is required for install");
        }

        const kind = firstOptionValue(options.kind) ?? "folder";
        if (kind !== "folder" && kind !== "tarball" && kind !== "npm") {
          throw new Error(`Unsupported install kind: ${kind}`);
        }

        const installed = await installPlugin({
          pluginHome,
          source:
            kind === "npm"
              ? { kind: "npm", spec: source }
              : kind === "tarball"
                ? { kind: "tarball", path: source }
                : { kind: "folder", path: source },
        });
        stdout.write(`${installed.installDir}\n`);
      },
    );

  return cli;
}

export async function runCli(argv: string[], io: CliIo = {}): Promise<void> {
  const cli = createCli(io);
  cli.parse(["node", "pluginctl", ...argv], { run: false });
  await cli.runMatchedCommand();
}

function firstOptionValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function serializeContractForInspect(contract: {
  packageName: string;
  serviceName: string;
  typeName: string;
  methods: Array<{
    name: string;
    localName: string;
    canonicalName: string;
    methodId: number;
    inputType: string;
    outputType: string;
  }>;
}) {
  return {
    packageName: contract.packageName,
    serviceName: contract.serviceName,
    typeName: contract.typeName,
    methods: contract.methods.map((method) => ({
      name: method.name,
      localName: method.localName,
      canonicalName: method.canonicalName,
      methodId: method.methodId,
      inputType: method.inputType,
      outputType: method.outputType,
    })),
  };
}

if (process.argv[1] !== undefined) {
  const invokedPath = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === invokedPath) {
    await runCli(process.argv.slice(2));
  }
}
