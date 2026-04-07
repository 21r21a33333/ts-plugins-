import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDescriptorRegistry } from "../src/descriptor-loader.js";
import { buildPluginServiceDefinition } from "../src/plugin-contract.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const descriptorPath = join(
  currentDir,
  "../../../descriptors/contracts.binpb",
);

describe("loadDescriptorRegistry", () => {
  it("loads the packaged descriptor set and finds the quote service", async () => {
    const registry = await loadDescriptorRegistry(descriptorPath);
    const service = registry.getService(
      "balance.plugins.quote.v1.QuotePluginService",
    );

    expect(service?.name).toBe("QuotePluginService");
    expect(service?.methods.map((method) => method.name)).toEqual([
      "Init",
      "GetPrice",
    ]);
  });
});

describe("buildPluginServiceDefinition", () => {
  it("builds a validated service definition from the descriptor registry", async () => {
    const registry = await loadDescriptorRegistry(descriptorPath);
    const service = registry.getService(
      "balance.plugins.quote.v1.QuotePluginService",
    );

    expect(service).toBeDefined();

    const definition = buildPluginServiceDefinition([service!]);

    expect(definition.packageName).toBe("balance.plugins.quote.v1");
    expect(definition.serviceName).toBe("QuotePluginService");
    expect(definition.methods.map((method) => method.name)).toEqual([
      "Init",
      "GetPrice",
    ]);
    expect(definition.methods.every((method) => method.methodId > 0)).toBe(true);
  });

  it("rejects a contract with no services", () => {
    expect(() => buildPluginServiceDefinition([])).toThrow(
      /exactly one service/i,
    );
  });

  it("rejects a contract without Init", () => {
    expect(() =>
      buildPluginServiceDefinition([
        {
          typeName: "balance.plugins.demo.v1.DemoService",
          name: "DemoService",
          methods: [
            {
              name: "Compute",
              localName: "compute",
              methodKind: "unary",
              input: { typeName: "balance.plugins.demo.v1.ComputeRequest" },
              output: { typeName: "balance.plugins.demo.v1.ComputeResponse" },
            },
          ],
        },
      ]),
    ).toThrow(/required Init RPC/i);
  });

  it("rejects a non-unary method", () => {
    expect(() =>
      buildPluginServiceDefinition([
        {
          typeName: "balance.plugins.demo.v1.DemoService",
          name: "DemoService",
          methods: [
            {
              name: "Init",
              localName: "init",
              methodKind: "unary",
              input: { typeName: "balance.plugins.demo.v1.InitRequest" },
              output: { typeName: "balance.plugins.demo.v1.InitResponse" },
            },
            {
              name: "StreamStuff",
              localName: "streamStuff",
              methodKind: "server_streaming",
              input: { typeName: "balance.plugins.demo.v1.StreamRequest" },
              output: { typeName: "balance.plugins.demo.v1.StreamResponse" },
            },
          ],
        },
      ]),
    ).toThrow(/must be unary/i);
  });
});
