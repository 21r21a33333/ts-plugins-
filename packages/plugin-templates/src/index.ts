/**
 * Renders the opinionated starter workspace used by `pluginctl init`.
 */

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_PROTOC_GEN_ES_VERSION = "^2.9.0";
const DEFAULT_BUF_VERSION = "^1.67.0";
const DEFAULT_PROTOBUF_VERSION = "^2.11.0";
const DEFAULT_TYPESCRIPT_VERSION = "^5.9.3";
const DEFAULT_VITEST_VERSION = "^3.2.4";
const DEFAULT_NODE_TYPES_VERSION = "^24.6.0";

export interface PluginTemplateInput {
  id: string;
  packageName: string;
  serviceName: string;
  projectName?: string;
  version?: string;
}

/**
 * Single file emitted by the scaffold generator.
 */
export interface PluginTemplateFile {
  path: string;
  contents: string;
}

/**
 * Complete scaffold result returned by the template renderer.
 */
export interface PluginTemplateOutput {
  files: PluginTemplateFile[];
  manifestPath: string;
  protoPath: string;
}

/**
 * Produces the starter files for a new TypeScript plugin package.
 */
export function renderDefaultPluginTemplate(
  input: PluginTemplateInput,
): PluginTemplateOutput {
  const normalizedId = normalizePluginId(input.id);
  const packageName = input.packageName.trim();
  const serviceName = input.serviceName.trim();
  const projectName = input.projectName?.trim() || normalizedId;
  const version = input.version?.trim() || DEFAULT_VERSION;
  const packageSegments = packageName.split(".").filter((segment) => segment.length > 0);

  if (packageSegments.length < 3) {
    throw new Error(
      `Plugin package must contain at least three segments, received ${packageName}`,
    );
  }

  const featureName = packageSegments[packageSegments.length - 2]!;
  const protoBasename = `${featureName}_plugin.proto`;
  const protoDir = ["proto", ...packageSegments].join("/");
  const protoPath = `${protoDir}/${protoBasename}`;
  const typeName = `${packageName}.${serviceName}`;
  const handlerName = toLocalMethodName("Execute");
  const interfaceName = `${serviceName.replace(/Service$/, "")}Handlers`;
  const sourceMapPath = "./dist/src/index.js.map";

  const files: PluginTemplateFile[] = [
    {
      path: "package.json",
      contents: formatJson({
        name: projectName,
        version,
        private: true,
        type: "module",
        scripts: {
          generate: "pluginctl generate .",
          build: "pluginctl build .",
          lint: "tsc -p tsconfig.json --noEmit",
          test: "vitest run",
        },
        dependencies: {
          "@balance/plugin-runtime": `^${DEFAULT_VERSION}`,
          "@bufbuild/protobuf": DEFAULT_PROTOBUF_VERSION,
        },
        devDependencies: {
          "@balance/pluginctl": `^${DEFAULT_VERSION}`,
          "@bufbuild/buf": DEFAULT_BUF_VERSION,
          "@bufbuild/protoc-gen-es": DEFAULT_PROTOC_GEN_ES_VERSION,
          "@types/node": DEFAULT_NODE_TYPES_VERSION,
          typescript: DEFAULT_TYPESCRIPT_VERSION,
          vitest: DEFAULT_VITEST_VERSION,
        },
      }),
    },
    {
      path: "tsconfig.json",
      contents: formatJson({
        compilerOptions: {
          target: "ES2022",
          module: "ES2022",
          moduleResolution: "Bundler",
          outDir: "dist",
          rootDir: ".",
          declaration: true,
          sourceMap: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ["src/**/*.ts", "gen/**/*.ts", "test/**/*.ts"],
      }),
    },
    {
      path: "buf.yaml",
      contents: `version: v2\nmodules:\n  - path: proto\nlint:\n  use:\n    - STANDARD\nbreaking:\n  use:\n    - FILE\n`,
    },
    {
      path: "buf.gen.yaml",
      contents:
        `version: v2\nplugins:\n  - local: protoc-gen-es\n    out: gen/ts\n    opt:\n      - target=ts\n      - import_extension=none\n`,
    },
    {
      path: "plugin.json",
      contents: formatJson({
        schemaVersion: 1,
        id: normalizedId,
        version,
        main: "./dist/src/index.js",
        sourceMap: sourceMapPath,
        contract: {
          descriptorSet: "./descriptors/plugin.pb",
          service: typeName,
          protoSources: [`./${protoPath}`],
        },
        runtime: {
          language: "node",
          activation: { mode: "lazy" },
          concurrency: { mode: "serial" },
          initTimeoutMs: 5_000,
          requestTimeoutMs: 10_000,
        },
        observability: {
          emitLogs: true,
          emitTraces: true,
          emitMetrics: true,
        },
      }),
    },
    {
      path: protoPath,
      contents: renderProtoSource({
        packageName,
        serviceName,
      }),
    },
    {
      path: "src/index.ts",
      contents: `import { definePlugin } from "@balance/plugin-runtime";

import type { ${interfaceName} } from "../gen/plugin-handlers.js";

export default definePlugin<${interfaceName}>({
  async init(_req, ctx) {
    return {
      outcome: {
        case: "ok",
        value: {
          pluginName: ctx.plugin.id,
          pluginVersion: ctx.plugin.version,
        },
      },
    };
  },

  async ${handlerName}(req, ctx) {
    return {
      outcome: {
        case: "ok",
        value: {
          message: \`Hello \${req.subject} from \${ctx.plugin.id}\`,
        },
      },
    };
  },
});
`,
    },
    {
      path: "test/plugin.test.ts",
      contents: `import { describe, expect, it } from "vitest";

describe("${normalizedId}", () => {
  it("has a scaffolded placeholder test", () => {
    expect(true).toBe(true);
  });
});
`,
    },
  ];

  return {
    files,
    manifestPath: "plugin.json",
    protoPath,
  };
}

function renderProtoSource(input: {
  packageName: string;
  serviceName: string;
}): string {
  return `syntax = "proto3";

package ${input.packageName};

message PluginError {
  string code = 1;
  string message = 2;
  map<string, string> details = 3;
}

message InitRequest {
  string plugin_instance_id = 1;
  string environment = 2;
  map<string, string> config = 3;
}

message InitSuccess {
  string plugin_name = 1;
  string plugin_version = 2;
}

message InitResponse {
  oneof outcome {
    InitSuccess ok = 1;
    PluginError error = 2;
  }
}

message ExecuteRequest {
  string subject = 1;
}

message ExecuteSuccess {
  string message = 1;
}

message ExecuteResponse {
  oneof outcome {
    ExecuteSuccess ok = 1;
    PluginError error = 2;
  }
}

service ${input.serviceName} {
  rpc Init(InitRequest) returns (InitResponse);
  rpc Execute(ExecuteRequest) returns (ExecuteResponse);
}
`;
}

function normalizePluginId(id: string): string {
  const normalized = id.trim();
  if (normalized.length === 0) {
    throw new Error("Plugin id must not be empty");
  }
  return normalized;
}

function toLocalMethodName(methodName: string): string {
  return methodName.charAt(0).toLowerCase() + methodName.slice(1);
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
