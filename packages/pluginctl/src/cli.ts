import cac from "cac";

import { installPlugin } from "./install.js";
import { packPlugin } from "./pack.js";
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
    .command("inspect <manifestPath>", "Print manifest and contract metadata")
    .action(async (manifestPath: string) => {
      const validated = await validatePluginManifest(manifestPath);
      stdout.write(
        `${JSON.stringify(
          {
            manifest: validated.manifest,
            contract: validated.contract,
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
