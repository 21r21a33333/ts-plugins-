import { ROOT_CONTEXT, trace } from "@opentelemetry/api";

import type { PluginSpan, PluginTracer } from "./context.js";

export interface RuntimeTraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface TraceEvent {
  name: string;
  traceContext: RuntimeTraceContext;
  parentTraceContext: RuntimeTraceContext | null;
  ended: boolean;
  attributes: Record<string, unknown>;
}

export interface PluginTracerOptions {
  traceContext?: RuntimeTraceContext;
  sink?: (event: TraceEvent) => void;
}

export function extractTraceContext(
  value: Partial<RuntimeTraceContext> | null | undefined,
): RuntimeTraceContext | undefined {
  if (value?.traceId === undefined || value.spanId === undefined || value.traceFlags === undefined) {
    return undefined;
  }

  if (!/^[0-9a-f]{32}$/i.test(value.traceId)) {
    throw new Error("invalid trace id");
  }
  if (!/^[0-9a-f]{16}$/i.test(value.spanId)) {
    throw new Error("invalid span id");
  }

  return {
    traceId: value.traceId.toLowerCase(),
    spanId: value.spanId.toLowerCase(),
    traceFlags: value.traceFlags,
  };
}

export function createPluginTracer(options: PluginTracerOptions = {}): PluginTracer {
  const parent = extractTraceContext(options.traceContext);
  const tracer = trace.getTracer("balance.plugin-runtime");
  const sink = options.sink ?? (() => {});

  return {
    startSpan(name, attributes) {
      const normalizedAttributes = normalizeAttributes(attributes);
      const parentContext = parent === undefined
        ? ROOT_CONTEXT
        : trace.setSpan(
            ROOT_CONTEXT,
            trace.wrapSpanContext({
              traceId: parent.traceId,
              spanId: parent.spanId,
              isRemote: true,
              traceFlags: parent.traceFlags,
            }),
          );

      const rawSpan = tracer.startSpan(name, { attributes: normalizedAttributes }, parentContext);
      const rawSpanContext = rawSpan.spanContext();
      const traceContext = isValidSpanContext(rawSpanContext)
        ? {
            traceId: rawSpanContext.traceId,
            spanId: rawSpanContext.spanId,
            traceFlags: rawSpanContext.traceFlags,
          }
        : createSyntheticChildTraceContext(parent);

      const entry: TraceEvent = {
        name,
        traceContext,
        parentTraceContext: parent ?? null,
        ended: false,
        attributes: { ...(attributes ?? {}) },
      };
      sink(entry);

      const pluginSpan: PluginSpan = {
        setAttribute(attributeName, value) {
          rawSpan.setAttribute(attributeName, value);
          entry.attributes[attributeName] = value;
        },
        end() {
          rawSpan.end();
          entry.ended = true;
        },
      };

      return pluginSpan;
    },
  };
}

function normalizeAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (attributes === undefined) {
    return undefined;
  }

  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function isValidSpanContext(context: {
  traceId: string;
  spanId: string;
}): boolean {
  return /^[0-9a-f]{32}$/i.test(context.traceId) && /^[0-9a-f]{16}$/i.test(context.spanId);
}

function createSyntheticChildTraceContext(
  parent: RuntimeTraceContext | undefined,
): RuntimeTraceContext {
  return {
    traceId: parent?.traceId ?? randomHex(32),
    spanId: randomHex(16),
    traceFlags: parent?.traceFlags ?? 1,
  };
}

function randomHex(length: number): string {
  let output = "";
  while (output.length < length) {
    output += Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  }
  return output.slice(0, length);
}
