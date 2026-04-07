import { describe, expect, it } from "vitest";

import { loadDescriptorRegistry } from "../src/descriptor-loader.js";
import { buildPluginServiceDefinition } from "../src/plugin-contract.js";

describe("descriptor-backed service definitions", () => {
  it("preserves message schemas needed for runtime decoding", async () => {
    const registry = await loadDescriptorRegistry(
      new URL("../../../descriptors/contracts.binpb", import.meta.url).pathname,
    );
    const service = registry.getService("balance.plugins.quote.v1.QuotePluginService");
    expect(service).toBeDefined();

    const definition = buildPluginServiceDefinition([service!]);
    const init = definition.methods.find((method) => method.name === "Init");
    const getPrice = definition.methods.find((method) => method.name === "GetPrice");

    expect(init?.inputSchema?.typeName).toBe("balance.plugins.quote.v1.InitRequest");
    expect(init?.outputSchema?.typeName).toBe("balance.plugins.quote.v1.InitResponse");
    expect(getPrice?.inputSchema?.typeName).toBe(
      "balance.plugins.quote.v1.GetPriceRequest",
    );
    expect(getPrice?.outputSchema?.typeName).toBe(
      "balance.plugins.quote.v1.GetPriceResponse",
    );
  });
});
