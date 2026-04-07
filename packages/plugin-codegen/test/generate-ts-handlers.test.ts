import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as codegen from "../src/index.js";
import { buildPluginServiceDefinition } from "../src/plugin-contract.js";
import { loadDescriptorRegistry } from "../src/descriptor-loader.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const descriptorPath = join(
  currentDir,
  "../../../descriptors/contracts.binpb",
);

describe("generateTsHandlersSource", () => {
  it("emits a typed handler interface and method metadata for the plugin service", async () => {
    const registry = await loadDescriptorRegistry(descriptorPath);
    const service = registry.getService(
      "balance.plugins.quote.v1.QuotePluginService",
    );

    expect(service).toBeDefined();
    expect(typeof (codegen as { generateTsHandlersSource?: unknown }).generateTsHandlersSource).toBe(
      "function",
    );

    const output = (
      codegen as {
        generateTsHandlersSource: (input: {
          service: ReturnType<typeof buildPluginServiceDefinition>;
          messagesModuleSpecifier: string;
        }) => string;
      }
    ).generateTsHandlersSource({
      service: buildPluginServiceDefinition([service!]),
      messagesModuleSpecifier:
        "../../gen/ts/balance/plugins/quote/v1/quote_plugin_pb.js",
    });

    expect(output).toContain(
      'import type { GetPriceRequest, GetPriceResponse, InitRequest, InitResponse } from "../../gen/ts/balance/plugins/quote/v1/quote_plugin_pb.js";',
    );
    expect(output).toContain(
      'import { GetPriceRequestSchema, GetPriceResponseSchema, InitRequestSchema, InitResponseSchema } from "../../gen/ts/balance/plugins/quote/v1/quote_plugin_pb.js";',
    );
    expect(output).toContain(
      'export interface QuotePluginHandlers',
    );
    expect(output).toContain(
      "init(req: InitRequest, ctx: PluginContext): Promise<InitResponse>;",
    );
    expect(output).toContain(
      "getPrice(req: GetPriceRequest, ctx: PluginContext): Promise<GetPriceResponse>;",
    );
    expect(output).toContain("canonicalName: \"balance.plugins.quote.v1.QuotePluginService/Init\"");
    expect(output).toContain("localName: \"getPrice\"");
    expect(output).toContain("inputSchema: InitRequestSchema");
    expect(output).toContain("outputSchema: GetPriceResponseSchema");
    expect(output).toContain("methodId:");
  });
});
