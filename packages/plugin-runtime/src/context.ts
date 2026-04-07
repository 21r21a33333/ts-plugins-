/**
 * Builds the request-scoped context object exposed to plugin handlers.
 */

import type { PluginMethodDefinition, PluginServiceDefinition } from "@balance/plugin-codegen";

import { createStructuredLogger, type LogEvent } from "./logger.js";
import {
  createPluginTracer,
  extractTraceContext,
  type RuntimeTraceContext,
  type TraceEvent,
} from "./tracing.js";

export interface PluginLogger {
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export interface PluginSpan {
  setAttribute(name: string, value: string | number | boolean): void;
  end(): void;
}

export interface PluginTracer {
  startSpan(name: string, attributes?: Record<string, unknown>): PluginSpan;
}

export interface PluginKv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<boolean>;
  del(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  listKeys(pattern?: string, batch?: number): Promise<string[]>;
  clear(): Promise<number>;
  withLock<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { ttlSec?: number; onBusy?: "throw" | "skip" },
  ): Promise<T | null>;
}

export interface PluginContext {
  logger: PluginLogger;
  tracer: PluginTracer;
  kv: PluginKv;
  config: Readonly<Record<string, string>>;
  plugin: {
    id: string;
    version: string;
    runtimeInstanceId: string;
    service: PluginServiceDefinition["typeName"];
  };
  request: {
    id: string;
    methodId: number;
    methodName: string;
    canonicalName: string;
    traceId: string | null;
  };
}

export interface PluginContextFactoryInput {
  manifest: PluginRuntimeManifest;
  service: PluginServiceDefinition;
  method: PluginMethodDefinition;
  requestId: string;
  runtimeInstanceId: string;
  config: Readonly<Record<string, string>>;
  kv?: PluginKv;
  traceContext?: RuntimeTraceContext;
  logSink?: (event: LogEvent) => void;
  traceSink?: (event: TraceEvent) => void;
}

export interface PluginRuntimeManifest {
  id: string;
  version: string;
  runtime?: {
    initTimeoutMs?: number;
    requestTimeoutMs?: number;
    idleEvictionMs?: number;
    concurrency?: {
      mode: "serial" | "parallel-safe" | "max_concurrency";
      maxConcurrency?: number;
    };
  };
  observability?: {
    emitLogs?: boolean;
    emitTraces?: boolean;
    emitMetrics?: boolean;
  };
}

export interface PluginContextFactory {
  (input: PluginContextFactoryInput): PluginContext;
}

/**
 * Creates the request-scoped context passed into each plugin handler invocation.
 */
export function createPluginContext(input: PluginContextFactoryInput): PluginContext {
  const traceContext = extractTraceContext(input.traceContext) ?? undefined;
  const logSink = resolveLogSink(input);
  const traceSink = resolveTraceSink(input);
  return {
    logger: createStructuredLogger({
      pluginId: input.manifest.id,
      runtimeInstanceId: input.runtimeInstanceId,
      requestId: input.requestId,
      traceId: traceContext?.traceId ?? null,
      sink: logSink,
    }),
    tracer: createPluginTracer({
      traceContext,
      sink: traceSink,
    }),
    kv: input.kv ?? createNoopKv(),
    config: input.config,
    plugin: {
      id: input.manifest.id,
      version: input.manifest.version,
      runtimeInstanceId: input.runtimeInstanceId,
      service: input.service.typeName,
    },
    request: {
      id: input.requestId,
      methodId: input.method.methodId,
      methodName: input.method.name,
      canonicalName: input.method.canonicalName,
      traceId: traceContext?.traceId ?? null,
    },
  };
}

function resolveLogSink(
  input: PluginContextFactoryInput,
): ((event: LogEvent) => void) | undefined {
  if (input.manifest.observability?.emitLogs === false) {
    return undefined;
  }

  if (input.logSink === undefined && isTestEnvironment()) {
    return undefined;
  }

  return input.logSink ?? defaultLogSink;
}

function resolveTraceSink(
  input: PluginContextFactoryInput,
): ((event: TraceEvent) => void) | undefined {
  if (input.manifest.observability?.emitTraces === false) {
    return undefined;
  }

  if (input.traceSink === undefined && isTestEnvironment()) {
    return undefined;
  }

  return input.traceSink ?? defaultTraceSink;
}

function defaultLogSink(event: LogEvent): void {
  console.log(JSON.stringify({
    kind: "plugin-log",
    ...event,
  }));
}

function defaultTraceSink(event: TraceEvent): void {
  console.log(JSON.stringify({
    kind: "plugin-trace",
    ...event,
  }));
}

function isTestEnvironment(): boolean {
  return process.env.VITEST !== undefined || process.env.NODE_ENV === "test";
}

function createNoopKv(): PluginKv {
  return {
    async get() {
      return null;
    },
    async set() {
      return true;
    },
    async del() {
      return true;
    },
    async exists() {
      return false;
    },
    async listKeys() {
      return [];
    },
    async clear() {
      return 0;
    },
    async withLock(_key, fn) {
      return fn();
    },
  };
}
