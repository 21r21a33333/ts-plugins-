import { describe, expect, it } from "vitest";

import type { PluginServiceDefinition } from "@balance/plugin-codegen";

import { bootstrapPluginRuntime, definePlugin } from "../src/index.js";

const quoteService: PluginServiceDefinition = {
  packageName: "balance.plugins.quote.v1",
  serviceName: "QuotePluginService",
  typeName: "balance.plugins.quote.v1.QuotePluginService",
  methods: [
    {
      name: "Init",
      localName: "init",
      canonicalName: "balance.plugins.quote.v1.QuotePluginService/Init",
      methodId: 101,
      inputType: "balance.plugins.quote.v1.InitRequest",
      outputType: "balance.plugins.quote.v1.InitResponse",
    },
    {
      name: "GetPrice",
      localName: "getPrice",
      canonicalName: "balance.plugins.quote.v1.QuotePluginService/GetPrice",
      methodId: 202,
      inputType: "balance.plugins.quote.v1.GetPriceRequest",
      outputType: "balance.plugins.quote.v1.GetPriceResponse",
    },
  ],
};

describe("bootstrapPluginRuntime", () => {
  it("rejects a module with a missing handler", async () => {
    await expect(
      bootstrapPluginRuntime({
        manifest: { id: "quote-plugin", version: "1.0.0" },
        service: quoteService,
        loadModule: async () => ({
          default: definePlugin({
            async init() {
              return { outcome: { case: "ok", value: {} } };
            },
          }),
        }),
      }),
    ).rejects.toThrow(/missing handler/i);
  });

  it("rejects a module with extra handlers", async () => {
    await expect(
      bootstrapPluginRuntime({
        manifest: { id: "quote-plugin", version: "1.0.0" },
        service: quoteService,
        loadModule: async () => ({
          default: definePlugin({
            async init() {
              return { outcome: { case: "ok", value: {} } };
            },
            async getPrice() {
              return { outcome: { case: "ok", value: {} } };
            },
            async listPrices() {
              return { outcome: { case: "ok", value: {} } };
            },
          }),
        }),
      }),
    ).rejects.toThrow(/unexpected handlers/i);
  });

  it("does not serve business calls before Init", async () => {
    const runtime = await bootstrapPluginRuntime({
        manifest: { id: "quote-plugin", version: "1.0.0" },
        service: quoteService,
        loadModule: async () => ({
          default: definePlugin({
            async init(
              req: { environment: string; config?: Record<string, string> },
              ctx,
            ) {
              return {
                outcome: {
                  case: "ok",
                value: {
                  pluginName: ctx.plugin.id,
                  pluginVersion: ctx.plugin.version,
                  environment: req.environment,
                },
              },
            };
          },
            async getPrice(req: { asset: string }, ctx) {
              return {
                outcome: {
                  case: "ok",
                value: {
                  price: `${req.asset}:${ctx.config.region ?? "missing"}`,
                },
              },
            };
          },
        }),
      }),
    });

    await expect(
      runtime.invoke(202, { asset: "BTC" }),
    ).rejects.toThrow(/before Init/i);

    await runtime.initialize({
      environment: "production",
      config: { region: "ap-south-1" },
    });

    await expect(runtime.invoke(202, { asset: "BTC" })).resolves.toEqual({
      outcome: {
        case: "ok",
        value: {
          price: "BTC:ap-south-1",
        },
      },
    });
  });
});
