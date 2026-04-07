import { describe, expect, it } from "vitest";

import {
  PluginExecutionError,
  definePlugin,
  extractTraceContext,
  type PluginContext,
} from "@balance/plugin-runtime";
import type { PluginServiceDefinition } from "@balance/plugin-codegen";

import { createInProcessHarness, createTestContextFactory } from "../src/index.js";

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
      inputType: "InitRequest",
      outputType: "InitResponse",
    },
    {
      name: "GetPrice",
      localName: "getPrice",
      canonicalName: "balance.plugins.quote.v1.QuotePluginService/GetPrice",
      methodId: 202,
      inputType: "GetPriceRequest",
      outputType: "GetPriceResponse",
    },
  ],
};

describe("createTestContextFactory", () => {
  it("provides in-memory kv plus captured logs and traces", async () => {
    const { createContext, state } = createTestContextFactory();
    const context = createContext({
      manifest: { id: "quote-plugin", version: "1.0.0" },
      service: quoteService,
      method: quoteService.methods[1]!,
      requestId: "req-1",
      runtimeInstanceId: "runtime-1",
      config: { region: "ap-south-1" },
      traceContext: extractTraceContext({
        traceId: "feedfacefeedfacefeedfacefeedface",
        spanId: "deadbeefdeadbeef",
        traceFlags: 1,
      }),
    });

    await context.kv.set("quote:last", { asset: "BTC" });
    expect(await context.kv.get("quote:last")).toEqual({ asset: "BTC" });

    context.logger.info("loaded");
    const span = context.tracer.startSpan("test-span");
    span.end();

    expect(state.logs[0]?.requestId).toBe("req-1");
    expect(state.logs[0]?.traceId).toBe("feedfacefeedfacefeedfacefeedface");
    expect(state.traces[0]?.traceContext.traceId).toBe(
      "feedfacefeedfacefeedfacefeedface",
    );
  });
});

describe("createInProcessHarness", () => {
  it("exercises init, encoded request flow, and typed business responses", async () => {
    const harness = await createInProcessHarness({
      manifest: { id: "quote-plugin", version: "1.0.0" },
      runtimeInstanceId: "runtime-9",
      service: quoteService,
      plugin: definePlugin({
        async init(req: { config?: Record<string, string> }) {
          return {
            outcome: {
              case: "ok",
              value: { region: req.config?.region ?? "missing" },
            },
          };
        },
        async getPrice(req: { asset: string }, ctx: PluginContext) {
          await ctx.kv.set(`price:${req.asset}`, { source: "cache" });
          if (req.asset === "DOGE") {
            return {
              outcome: {
                case: "error",
                value: {
                  code: "UNSUPPORTED",
                  message: "unsupported asset",
                  details: {},
                },
              },
            };
          }
          return {
            outcome: {
              case: "ok",
              value: {
                asset: req.asset,
                region: ctx.config.region ?? "missing",
              },
            },
          };
        },
      }),
    });

    const jsonCodec = {
      encode(value: unknown) {
        return new TextEncoder().encode(JSON.stringify(value));
      },
      decode<T>(bytes: Uint8Array): T {
        return JSON.parse(new TextDecoder().decode(bytes)) as T;
      },
    };

    const initResponseBytes = await harness.initEncoded(
      jsonCodec.encode({ config: { region: "ap-south-1" } }),
      jsonCodec,
      jsonCodec,
    );
    expect(jsonCodec.decode(initResponseBytes)).toEqual({
      outcome: {
        case: "ok",
        value: { region: "ap-south-1" },
      },
    });

    const successResponseBytes = await harness.invokeEncoded(
      202,
      jsonCodec.encode({ asset: "BTC" }),
      jsonCodec,
      jsonCodec,
    );
    expect(jsonCodec.decode(successResponseBytes)).toEqual({
      outcome: {
        case: "ok",
        value: {
          asset: "BTC",
          region: "ap-south-1",
        },
      },
    });

    const errorResponse = await harness.invoke<{ asset: string }, unknown>(202, {
      asset: "DOGE",
    });
    expect(errorResponse).toEqual({
      outcome: {
        case: "error",
        value: {
          code: "UNSUPPORTED",
          message: "unsupported asset",
          details: {},
        },
      },
    });
  });

  it("keeps thrown execution failures as framework errors", async () => {
    const harness = await createInProcessHarness({
      manifest: { id: "quote-plugin", version: "1.0.0" },
      service: quoteService,
      plugin: definePlugin({
        async init() {
          return { outcome: { case: "ok", value: {} } };
        },
        async getPrice() {
          throw new Error("upstream failed");
        },
      }),
    });

    await harness.init({});
    await expect(harness.invoke(202, { asset: "BTC" })).rejects.toBeInstanceOf(
      PluginExecutionError,
    );
  });
});
