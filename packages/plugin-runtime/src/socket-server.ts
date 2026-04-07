import net from "node:net";
import { rm } from "node:fs/promises";
import type { DescMessage } from "@bufbuild/protobuf";

import type {
  PluginMethodDefinition,
  PluginServiceDefinition,
} from "@balance/plugin-codegen";
import {
  ControlMessageKind,
  FrameworkErrorCode,
  type WireEnvelope,
} from "@balance/plugin-generated/generated/balance/runtime/v1/plugin_protocol_pb";

import { bootstrapPluginRuntime, type BootstrapPluginRuntimeInput } from "./bootstrap.js";
import { createPluginContext } from "./context.js";
import {
  createMemoryKvBackend,
  createPluginKvStore,
  type MemoryKvBackend,
  type RuntimeKvConfig,
} from "./kv.js";
import {
  PluginWorkerPool,
  type PluginConcurrencyMode,
} from "./worker-pool.js";
import {
  createControlEnvelope,
  createFrameworkErrorEnvelope,
  createRpcResponseEnvelope,
  decodePayload,
  encodeFrame,
  encodePayload,
  PROTOCOL_VERSION,
  tryDecodeFrames,
} from "./protocol.js";
import { PluginExecutionError } from "./errors.js";

type SchemaAwarePluginMethodDefinition = PluginMethodDefinition & {
  inputSchema: DescMessage;
  outputSchema: DescMessage;
};

type SchemaAwarePluginServiceDefinition = Omit<PluginServiceDefinition, "methods"> & {
  methods: SchemaAwarePluginMethodDefinition[];
};

export interface StartPluginSocketRuntimeServerInput
  extends Omit<BootstrapPluginRuntimeInput, "service"> {
  socketPath: string;
  service: PluginServiceDefinition;
  kvConfig?: RuntimeKvConfig;
  memoryKvBackend?: MemoryKvBackend;
  createWorkerPool?: (
    options: PluginSocketWorkerPoolOptions,
  ) => PluginSocketWorkerPool;
}

export interface PluginSocketRuntimeServer {
  close(): Promise<void>;
}

export interface PluginSocketWorkerPoolTask {
  entrypointPath: string;
  manifest: BootstrapPluginRuntimeInput["manifest"];
  serviceTypeName: string;
  runtimeInstanceId: string;
  requestId: string;
  method: Omit<SchemaAwarePluginMethodDefinition, "inputSchema" | "outputSchema">;
  request: unknown;
  initRequest?: unknown;
  kvConfig?: RuntimeKvConfig;
  traceContext?: WireEnvelope["traceContext"];
}

export interface PluginSocketWorkerPool {
  run(task: PluginSocketWorkerPoolTask, timeoutMs?: number): Promise<unknown>;
  queueSize(): number;
  destroy(): Promise<void>;
}

export interface PluginSocketWorkerPoolOptions {
  workerFile: string;
  concurrency: PluginConcurrencyMode;
}

export async function startPluginSocketRuntimeServer(
  input: StartPluginSocketRuntimeServerInput,
): Promise<PluginSocketRuntimeServer> {
  const service = assertSchemaAwareService(input.service);
  const kvStore =
    input.kvConfig === undefined
      ? undefined
      : createPluginKvStore(input.kvConfig, {
        memoryBackend: input.memoryKvBackend ?? createMemoryKvBackend(),
      });
  const runtime = await bootstrapPluginRuntime({
    ...input,
    service,
    contextFactory: (contextInput) =>
      input.contextFactory?.({
        ...contextInput,
        kv: kvStore,
      }) ?? createPluginContext({
        ...contextInput,
        kv: kvStore,
      }),
  });
  const methodsById = new Map(
    service.methods.map((method) => [method.methodId, method] as const),
  );
  let lastInitRequest: unknown;
  const workerPool = createWorkerPoolIfNeeded(input);

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);

    socket.on("data", async (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const decoded = tryDecodeFrames(buffer);
      buffer = Buffer.from(decoded.remainder);

      for (const envelope of decoded.frames) {
        const response = await handleEnvelope(envelope);
        if (response !== null) {
          socket.write(encodeFrame(response));
        }
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });

    socket.on("error", () => {
      sockets.delete(socket);
    });

    async function handleEnvelope(envelope: WireEnvelope): Promise<WireEnvelope | null> {
      if (envelope.protocolVersion !== PROTOCOL_VERSION) {
        return createFrameworkErrorEnvelope({
          requestId: envelope.requestId,
          traceContext: envelope.traceContext,
          code: FrameworkErrorCode.PROTOCOL_VERSION_MISMATCH,
          message: `unsupported protocol version ${envelope.protocolVersion}`,
        });
      }

      switch (envelope.body.case) {
        case "rpcRequest":
          return await handleRpcRequest(envelope.requestId, envelope.body.value.methodId, envelope.body.value.payload, envelope.traceContext);
        case "control":
          if (envelope.body.value.kind === ControlMessageKind.PING) {
            return createControlEnvelope({
              requestId: envelope.requestId,
              traceContext: envelope.traceContext,
              kind: ControlMessageKind.PONG,
            });
          }

          if (envelope.body.value.kind === ControlMessageKind.SHUTDOWN) {
            socket.end();
            return null;
          }

          return createFrameworkErrorEnvelope({
            requestId: envelope.requestId,
            traceContext: envelope.traceContext,
            code: FrameworkErrorCode.UNKNOWN,
            message: `unsupported control message kind ${envelope.body.value.kind}`,
          });
        default:
          return createFrameworkErrorEnvelope({
            requestId: envelope.requestId,
            traceContext: envelope.traceContext,
            code: FrameworkErrorCode.UNKNOWN,
            message: `unsupported envelope body ${envelope.body.case ?? "undefined"}`,
          });
      }
    }

    async function handleRpcRequest(
      requestId: bigint,
      methodId: number,
      payload: Uint8Array,
      traceContext: WireEnvelope["traceContext"],
    ): Promise<WireEnvelope> {
      const method = methodsById.get(methodId);
      if (method === undefined) {
        return createFrameworkErrorEnvelope({
          requestId,
          traceContext,
          code: FrameworkErrorCode.UNKNOWN,
          message: `unknown plugin method id ${methodId}`,
        });
      }

      try {
        const request = decodePayload(method.inputSchema, payload);
        const timeoutMs =
          method.name === "Init"
            ? input.manifest.runtime?.initTimeoutMs
            : input.manifest.runtime?.requestTimeoutMs;
        const invocation =
          workerPool !== undefined && method.name !== "Init"
            ? workerPool.run(
                {
                  entrypointPath: input.entrypointPath!,
                  manifest: input.manifest,
                  serviceTypeName: service.typeName,
                  runtimeInstanceId: `${input.manifest.id}-runtime`,
                  requestId: requestId.toString(),
                  method: stripSchemas(method),
                  request,
                  initRequest: lastInitRequest,
                  kvConfig: input.kvConfig,
                  traceContext,
                },
                timeoutMs,
              )
            : method.name === "Init"
              ? runtime.initialize(request, { traceContext })
              : runtime.invoke(methodId, request, { traceContext });
        const result = await withTimeout(
          invocation,
          timeoutMs,
          `${method.canonicalName} timed out after ${timeoutMs}ms`,
        );
        if (method.name === "Init") {
          lastInitRequest = request;
        }

        return createRpcResponseEnvelope({
          requestId,
          traceContext,
          payload: encodePayload(method.outputSchema, result),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof PluginExecutionError
            ? FrameworkErrorCode.UNKNOWN
            : FrameworkErrorCode.DECODE_FAILED;

        return createFrameworkErrorEnvelope({
          requestId,
          traceContext,
          code,
          message,
        });
      }
    }
  });

  await rm(input.socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    async close(): Promise<void> {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await workerPool?.destroy();
      await kvStore?.disconnect();
      await rm(input.socketPath, { force: true });
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs === undefined) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      promise.finally(() => {
        clearTimeout(timer);
      });
    }),
  ]);
}

function assertSchemaAwareService(
  service: PluginServiceDefinition,
): SchemaAwarePluginServiceDefinition {
  const missingSchemas = service.methods.find(
    (method) =>
      (method as { inputSchema?: DescMessage }).inputSchema === undefined
      || (method as { outputSchema?: DescMessage }).outputSchema === undefined,
  );
  if (missingSchemas !== undefined) {
    throw new Error(
      `Plugin service metadata for ${missingSchemas.canonicalName} is missing generated schemas`,
    );
  }

  return service as SchemaAwarePluginServiceDefinition;
}

function createWorkerPoolIfNeeded(
  input: StartPluginSocketRuntimeServerInput,
): PluginSocketWorkerPool | undefined {
  const concurrency = input.manifest.runtime?.concurrency;
  if (concurrency === undefined || concurrency.mode === "serial") {
    return undefined;
  }

  if (input.createWorkerPool !== undefined) {
    return input.createWorkerPool({
      workerFile: new URL("./request-worker.js", import.meta.url).pathname,
      concurrency: normalizeConcurrency(concurrency),
    });
  }

  if (input.entrypointPath === undefined) {
    return undefined;
  }

  return new PluginWorkerPool<PluginSocketWorkerPoolTask, unknown>({
    workerFile: new URL("./request-worker.js", import.meta.url).pathname,
    concurrency: normalizeConcurrency(concurrency),
  });
}

function stripSchemas(
  method: SchemaAwarePluginMethodDefinition,
): Omit<SchemaAwarePluginMethodDefinition, "inputSchema" | "outputSchema"> {
  const { inputSchema: _inputSchema, outputSchema: _outputSchema, ...rest } = method;
  return rest;
}

function normalizeConcurrency(
  concurrency: NonNullable<
    NonNullable<StartPluginSocketRuntimeServerInput["manifest"]["runtime"]>["concurrency"]
  >,
): PluginConcurrencyMode {
  if (concurrency.mode === "serial") {
    return { mode: "serial" };
  }
  if (concurrency.mode === "parallel-safe") {
    return { mode: "parallel-safe" };
  }
  return {
    mode: "max_concurrency",
    maxConcurrency: concurrency.maxConcurrency ?? 1,
  };
}
