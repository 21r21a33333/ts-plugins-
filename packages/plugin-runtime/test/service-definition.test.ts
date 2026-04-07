import { describe, expect, it } from "vitest";

import { loadRuntimeServiceDefinition } from "../src/service-definition.js";

describe("loadRuntimeServiceDefinition", () => {
  it("loads schema-aware service metadata directly from a descriptor set", async () => {
    const definition = await loadRuntimeServiceDefinition({
      descriptorPath: new URL("../../../descriptors/contracts.binpb", import.meta.url).pathname,
      serviceName: "balance.plugins.quote.v1.QuotePluginService",
    });

    expect(definition.typeName).toBe("balance.plugins.quote.v1.QuotePluginService");
    expect(definition.methods.map((method) => method.methodId)).toEqual([
      2026714057,
      758358830,
    ]);
    expect(definition.methods[0]?.inputSchema.typeName).toBe(
      "balance.plugins.quote.v1.InitRequest",
    );
  });
});
