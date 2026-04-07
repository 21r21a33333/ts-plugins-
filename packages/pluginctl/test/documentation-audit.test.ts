import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const documentedSourceFiles = [
  "crates/plugin-host/src/activation.rs",
  "crates/plugin-host/src/client.rs",
  "crates/plugin-host/src/registry.rs",
  "crates/plugin-host/src/runtime_handle.rs",
  "crates/plugin-host/src/scheduler.rs",
  "crates/plugin-host/src/supervisor.rs",
  "crates/plugin-host/src/unix_socket.rs",
  "crates/plugin-kv/src/config.rs",
  "crates/plugin-kv/src/memory.rs",
  "crates/plugin-kv/src/redis.rs",
  "crates/plugin-observability/src/logs.rs",
  "crates/plugin-observability/src/metrics.rs",
  "crates/plugin-observability/src/tracing.rs",
  "crates/plugin-protocol/src/control.rs",
  "crates/plugin-protocol/src/envelope.rs",
  "crates/plugin-protocol/src/framing.rs",
  "crates/plugin-e2e-harness/src/lib.rs",
  "crates/plugin-host/src/circuit_breaker.rs",
  "crates/plugin-host/src/dynamic.rs",
  "crates/plugin-host/src/health.rs",
  "crates/plugin-host/src/lib.rs",
  "packages/plugin-codegen/src/descriptor-loader.ts",
  "packages/plugin-codegen/src/generate-ts-handlers.ts",
  "packages/plugin-codegen/src/method-ids.ts",
  "packages/plugin-codegen/src/plugin-contract.ts",
  "packages/plugin-runtime/src/bootstrap.ts",
  "packages/plugin-runtime/src/cache.ts",
  "packages/plugin-runtime/src/context.ts",
  "packages/plugin-runtime/src/define-plugin.ts",
  "packages/plugin-runtime/src/dispatcher.ts",
  "packages/plugin-runtime/src/errors.ts",
  "packages/plugin-runtime/src/kv.ts",
  "packages/plugin-runtime/src/logger.ts",
  "packages/plugin-runtime/src/metrics.ts",
  "packages/plugin-runtime/src/process-main.ts",
  "packages/plugin-runtime/src/protocol.ts",
  "packages/plugin-runtime/src/request-worker.ts",
  "packages/plugin-runtime/src/service-definition.ts",
  "packages/plugin-runtime/src/socket-server.ts",
  "packages/plugin-runtime/src/tracing.ts",
  "packages/plugin-runtime/src/worker-entry.ts",
  "packages/plugin-runtime/src/worker-pool.ts",
  "packages/plugin-testkit/src/create-test-context.ts",
  "packages/plugin-testkit/src/in-process-harness.ts",
  "packages/plugin-templates/src/index.ts",
  "packages/pluginctl/src/build.ts",
  "packages/pluginctl/src/cli.ts",
  "packages/pluginctl/src/command-runner.ts",
  "packages/pluginctl/src/generate.ts",
  "packages/pluginctl/src/init.ts",
  "packages/pluginctl/src/install.ts",
  "packages/pluginctl/src/integrity.ts",
  "packages/pluginctl/src/manifest-schema.ts",
  "packages/pluginctl/src/pack.ts",
  "packages/pluginctl/src/test.ts",
  "packages/pluginctl/src/validate-manifest.ts",
  "examples/calculation-plugin/src/index.ts",
  "examples/crud-plugin/src/index.ts",
  "examples/http-plugin/src/index.ts",
  "examples/quote-plugin/src/index.ts",
] as const;

describe("documentation audit", () => {
  it("keeps maintained source modules annotated with top-level documentation comments", async () => {
    const root = resolve(process.cwd(), "../../");
    const undocumented: string[] = [];

    for (const relativePath of documentedSourceFiles) {
      const source = await readFile(resolve(root, relativePath), "utf8");
      const firstMeaningfulLine = source
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("#!"));

      const hasModuleComment = firstMeaningfulLine?.startsWith("//!")
        || firstMeaningfulLine?.startsWith("/**");
      if (!hasModuleComment) {
        undocumented.push(relativePath);
      }
    }

    expect(undocumented).toEqual([]);
  });
});
