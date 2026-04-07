import { describe, expect, it } from "vitest";

import {
  RuntimeMetrics,
  bootstrapPluginRuntime,
  createStructuredLogger,
  definePlugin,
  extractTraceContext,
  type LogEvent,
  type TraceEvent,
} from "../src/index.js";

describe("runtime observability", () => {
  it("trace context passes into the runtime request context", async () => {
    const observedTraceIds: string[] = [];
    const runtime = await bootstrapPluginRuntime({
      manifest: { id: "quote-plugin", version: "1.0.0" },
      runtimeInstanceId: "runtime-42",
      service: {
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
      },
      loadModule: async () => ({
        default: definePlugin({
          async init() {
            return { outcome: { case: "ok", value: {} } };
          },
          async getPrice(_req: { asset: string }, ctx) {
            observedTraceIds.push(ctx.request.traceId ?? "missing");
            return { outcome: { case: "ok", value: { ok: true } } };
          },
        }),
      }),
    });

    await runtime.initialize({});
    await runtime.invoke(
      202,
      { asset: "BTC" },
      {
        traceContext: extractTraceContext({
          traceId: "feedfacefeedfacefeedfacefeedface",
          spanId: "deadbeefdeadbeef",
          traceFlags: 1,
        }),
      },
    );

    expect(observedTraceIds).toEqual(["feedfacefeedfacefeedfacefeedface"]);
  });

  it("structured logs contain request metadata", () => {
    const events: LogEvent[] = [];
    const logger = createStructuredLogger({
      pluginId: "quote-plugin",
      runtimeInstanceId: "runtime-7",
      requestId: "req-1",
      traceId: "feedfacefeedfacefeedfacefeedface",
      sink: (event) => {
        events.push(event);
      },
    });

    logger.info("hello", { asset: "BTC" });

    expect(events).toEqual([
      {
        level: "info",
        message: "hello",
        pluginId: "quote-plugin",
        runtimeInstanceId: "runtime-7",
        requestId: "req-1",
        traceId: "feedfacefeedfacefeedfacefeedface",
        attributes: { asset: "BTC" },
      },
    ]);
  });

  it("metrics increment on success and failure", () => {
    const metrics = new RuntimeMetrics();
    metrics.recordRequest("quote-plugin", "GetPrice", "success", 10);
    metrics.recordRequest("quote-plugin", "GetPrice", "typed_error", 12);
    metrics.recordRequest("quote-plugin", "GetPrice", "framework_failure", 15);
    metrics.setQueueDepth("quote-plugin", 4);
    metrics.recordRestart("quote-plugin");
    metrics.recordBreakerTransition("quote-plugin", "closed_to_open");

    expect(metrics.requestCount("quote-plugin", "GetPrice", "success")).toBe(1);
    expect(metrics.requestCount("quote-plugin", "GetPrice", "typed_error")).toBe(1);
    expect(metrics.requestCount("quote-plugin", "GetPrice", "framework_failure")).toBe(1);
    expect(metrics.currentQueueDepth("quote-plugin")).toBe(4);
    expect(metrics.restartCount("quote-plugin")).toBe(1);
    expect(metrics.breakerTransitionCount("quote-plugin", "closed_to_open")).toBe(1);
  });
});
