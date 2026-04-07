import { describe, expect, it } from "vitest";

import type { PluginServiceDefinition } from "@balance/plugin-codegen";

import {
  PluginExecutionError,
  bootstrapPluginRuntime,
  createPluginContext,
  definePlugin,
  type PluginContextFactory,
} from "../src/index.js";

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

describe("runtime error normalization", () => {
  it("passes through a typed business error unchanged", async () => {
    const runtime = await bootstrapPluginRuntime({
      manifest: { id: "quote-plugin", version: "1.0.0" },
      service: quoteService,
      loadModule: async () => ({
        default: definePlugin({
          async init() {
            return { outcome: { case: "ok", value: {} } };
          },
          async getPrice() {
            return {
              outcome: {
                case: "error",
                value: {
                  code: "ASSET_UNSUPPORTED",
                  message: "asset is not supported",
                  details: {},
                },
              },
            };
          },
        }),
      }),
    });

    await runtime.initialize({});
    await expect(runtime.invoke(202, { asset: "DOGE" })).resolves.toEqual({
      outcome: {
        case: "error",
        value: {
          code: "ASSET_UNSUPPORTED",
          message: "asset is not supported",
          details: {},
        },
      },
    });
  });

  it("turns thrown exceptions into framework errors and records telemetry", async () => {
    const logEvents: Array<Record<string, unknown>> = [];
    const spanEvents: Array<Record<string, unknown>> = [];
    const contextFactory: PluginContextFactory = (input) => {
      const context = createPluginContext(input);
      return {
        ...context,
        logger: {
          info: context.logger.info,
          warn: context.logger.warn,
          error(message, attributes) {
            logEvents.push({
              level: "error",
              message,
              attributes,
            });
          },
        },
        tracer: {
          startSpan(name, attributes) {
            const entry: Record<string, unknown> = {
              name,
              attributes,
              ended: false,
              spanAttributes: [] as Array<Record<string, unknown>>,
            };
            spanEvents.push(entry);
            return {
              setAttribute(attributeName, value) {
                (entry.spanAttributes as Array<Record<string, unknown>>).push({
                  name: attributeName,
                  value,
                });
              },
              end() {
                entry.ended = true;
              },
            };
          },
        },
      };
    };

    const runtime = await bootstrapPluginRuntime({
      manifest: { id: "quote-plugin", version: "1.0.0" },
      service: quoteService,
      contextFactory,
      loadModule: async () => ({
        default: definePlugin({
          async init() {
            return { outcome: { case: "ok", value: {} } };
          },
          async getPrice() {
            throw new Error("upstream socket hung up");
          },
        }),
      }),
    });

    await runtime.initialize({});

    await expect(runtime.invoke(202, { asset: "BTC" })).rejects.toBeInstanceOf(
      PluginExecutionError,
    );
    await expect(runtime.invoke(202, { asset: "BTC" })).rejects.not.toMatchObject({
      outcome: {
        case: "error",
      },
    });

    expect(logEvents).toHaveLength(2);
    expect(logEvents[0]).toMatchObject({
      level: "error",
      message: "Plugin handler threw an exception",
    });
    expect(spanEvents).toHaveLength(3);
    expect(spanEvents[2]).toMatchObject({
      name: "plugin.handler",
      ended: true,
    });
    expect(spanEvents[2]?.spanAttributes).toContainEqual({
      name: "plugin.error",
      value: true,
    });
  });
});
