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
}

export interface PluginSocketRuntimeServer {
  close(): Promise<void>;
}

export async function startPluginSocketRuntimeServer(
  input: StartPluginSocketRuntimeServerInput,
): Promise<PluginSocketRuntimeServer> {
  const service = assertSchemaAwareService(input.service);
  const runtime = await bootstrapPluginRuntime({
    ...input,
    service,
  });
  const methodsById = new Map(
    service.methods.map((method) => [method.methodId, method] as const),
  );

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
        const result = method.name === "Init"
          ? await runtime.initialize(request, { traceContext })
          : await runtime.invoke(methodId, request, { traceContext });

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
      await rm(input.socketPath, { force: true });
    },
  };
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
