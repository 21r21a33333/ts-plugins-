import { create, fromBinary, toBinary, type DescMessage } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { join } from "node:path";

import type {
  PluginMethodDefinition,
  PluginServiceDefinition,
} from "@balance/plugin-codegen";
import {
  ControlMessageKind,
  FrameworkErrorCode,
  WireEnvelopeSchema,
} from "@balance/plugin-generated/generated/balance/runtime/v1/plugin_protocol_pb";
import {
  GetPriceRequestSchema,
  GetPriceResponseSchema,
  InitRequestSchema,
  InitResponseSchema,
} from "@balance/plugin-generated/generated/balance/plugins/quote/v1/quote_plugin_pb";

import { definePlugin } from "../src/index.js";
import { startPluginSocketRuntimeServer } from "../src/socket-server.js";

type SchemaAwareRuntimeService = PluginServiceDefinition & {
  methods: Array<PluginMethodDefinition & {
    inputSchema: DescMessage;
    outputSchema: DescMessage;
  }>;
};

const runtimeService: SchemaAwareRuntimeService = {
  packageName: "balance.plugins.quote.v1",
  serviceName: "QuotePluginService",
  typeName: "balance.plugins.quote.v1.QuotePluginService",
  methods: [
    {
      name: "Init",
      localName: "init",
      canonicalName: "balance.plugins.quote.v1.QuotePluginService/Init",
      methodId: 2026714057,
      inputType: "balance.plugins.quote.v1.InitRequest",
      outputType: "balance.plugins.quote.v1.InitResponse",
      inputSchema: InitRequestSchema,
      outputSchema: InitResponseSchema,
    },
    {
      name: "GetPrice",
      localName: "getPrice",
      canonicalName: "balance.plugins.quote.v1.QuotePluginService/GetPrice",
      methodId: 758358830,
      inputType: "balance.plugins.quote.v1.GetPriceRequest",
      outputType: "balance.plugins.quote.v1.GetPriceResponse",
      inputSchema: GetPriceRequestSchema,
      outputSchema: GetPriceResponseSchema,
    },
  ],
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("startPluginSocketRuntimeServer", () => {
  it("serves init and rpc calls over the framed protobuf socket protocol", async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), "plugin-runtime-socket-"));
    tempDirs.push(tempDir);
    const socketPath = join(tempDir, "plugin.sock");

    const server = await startPluginSocketRuntimeServer({
      socketPath,
      manifest: { id: "quote-plugin", version: "1.0.0" },
      service: runtimeService,
      loadModule: async () => ({
        default: definePlugin({
          async init(req: { environment: string }) {
            return {
              outcome: {
                case: "ok",
                value: {
                  pluginName: "quote-plugin",
                  pluginVersion: `env:${req.environment}`,
                },
              },
            };
          },
          async getPrice(req: { asset: string; amount: string }, ctx) {
            return {
              outcome: {
                case: "ok",
                value: {
                  price: `${req.asset}:${req.amount}`,
                  currency: ctx.config.currency ?? "USD",
                  expiresAt: "2030-01-01T00:00:00Z",
                },
              },
            };
          },
        }),
      }),
    });

    const socket = await connect(socketPath);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 1n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 2026714057,
            payload: toBinary(
              InitRequestSchema,
              create(InitRequestSchema, {
                pluginInstanceId: "quote-plugin",
                environment: "production",
                config: { currency: "EUR" },
              }),
            ),
          },
        },
      }),
    );

    const initResponse = await readEnvelope(socket);
    expect(initResponse.body.case).toBe("rpcResponse");

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 2n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 758358830,
            payload: toBinary(
              GetPriceRequestSchema,
              create(GetPriceRequestSchema, {
                asset: "BTC",
                amount: "0.5",
              }),
            ),
          },
        },
      }),
    );

    const quoteResponse = await readEnvelope(socket);
    expect(quoteResponse.body.case).toBe("rpcResponse");

    if (quoteResponse.body.case !== "rpcResponse") {
      throw new Error(`expected rpcResponse, received ${quoteResponse.body.case}`);
    }

    const decodedQuote = fromBinary(GetPriceResponseSchema, quoteResponse.body.value.payload);
    expect(decodedQuote.outcome.case).toBe("ok");
    if (decodedQuote.outcome.case !== "ok") {
      throw new Error(`expected ok quote outcome, received ${decodedQuote.outcome.case}`);
    }
    expect(decodedQuote.outcome.value.price).toBe("BTC:0.5");
    expect(decodedQuote.outcome.value.currency).toBe("EUR");

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 3n,
        body: {
          case: "control",
          value: {
            kind: ControlMessageKind.PING,
          },
        },
      }),
    );

    const pong = await readEnvelope(socket);
    expect(pong.body.case).toBe("control");
    if (pong.body.case !== "control") {
      throw new Error(`expected control response, received ${pong.body.case}`);
    }
    expect(pong.body.value.kind).toBe(ControlMessageKind.PONG);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 4n,
        body: {
          case: "control",
          value: {
            kind: ControlMessageKind.SHUTDOWN,
          },
        },
      }),
    );

    await expect(waitForClose(socket)).resolves.toBeUndefined();
    await server.close();
  });

  it("returns a framework decode error when request payloads do not match the method schema", async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), "plugin-runtime-socket-"));
    tempDirs.push(tempDir);
    const socketPath = join(tempDir, "plugin.sock");

    const server = await startPluginSocketRuntimeServer({
      socketPath,
      manifest: { id: "quote-plugin", version: "1.0.0" },
      service: runtimeService,
      loadModule: async () => ({
        default: definePlugin({
          async init() {
            return {
              outcome: {
                case: "ok",
                value: {
                  pluginName: "quote-plugin",
                  pluginVersion: "1.0.0",
                },
              },
            };
          },
          async getPrice() {
            return {
              outcome: {
                case: "ok",
                value: {
                  price: "ignored",
                  currency: "USD",
                  expiresAt: "2030-01-01T00:00:00Z",
                },
              },
            };
          },
        }),
      }),
    });

    const socket = await connect(socketPath);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 1n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 758358830,
            payload: Buffer.from([1, 2, 3, 4]),
          },
        },
      }),
    );

    const response = await readEnvelope(socket);
    expect(response.body.case).toBe("frameworkError");
    if (response.body.case !== "frameworkError") {
      throw new Error(`expected frameworkError response, received ${response.body.case}`);
    }
    expect(response.body.value.code).toBe(FrameworkErrorCode.DECODE_FAILED);

    socket.destroy();
    await server.close();
  });

  it("injects the configured host-managed kv store into plugin handlers", async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), "plugin-runtime-socket-"));
    tempDirs.push(tempDir);
    const socketPath = join(tempDir, "plugin.sock");

    const server = await startPluginSocketRuntimeServer({
      socketPath,
      manifest: { id: "quote-plugin", version: "1.0.0" },
      service: runtimeService,
      kvConfig: {
        backend: { kind: "memory" },
        namespacePrefix: "balance:test:quote-plugin",
      },
      loadModule: async () => ({
        default: definePlugin({
          async init(_req, ctx) {
            await ctx.kv.set("quote_count", 0);
            return {
              outcome: {
                case: "ok",
                value: {
                  pluginName: "quote-plugin",
                  pluginVersion: "1.0.0",
                },
              },
            };
          },
          async getPrice(_req, ctx) {
            const nextCount = ((await ctx.kv.get<number>("quote_count")) ?? 0) + 1;
            await ctx.kv.set("quote_count", nextCount);
            return {
              outcome: {
                case: "ok",
                value: {
                  price: String(nextCount),
                  currency: "USD",
                  expiresAt: "2030-01-01T00:00:00Z",
                },
              },
            };
          },
        }),
      }),
    });

    const socket = await connect(socketPath);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 1n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 2026714057,
            payload: toBinary(
              InitRequestSchema,
              create(InitRequestSchema, {
                pluginInstanceId: "quote-plugin",
                environment: "test",
                config: {},
              }),
            ),
          },
        },
      }),
    );
    await readEnvelope(socket);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 2n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 758358830,
            payload: toBinary(
              GetPriceRequestSchema,
              create(GetPriceRequestSchema, {
                asset: "BTC",
                amount: "0.5",
              }),
            ),
          },
        },
      }),
    );
    const first = await readEnvelope(socket);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 3n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 758358830,
            payload: toBinary(
              GetPriceRequestSchema,
              create(GetPriceRequestSchema, {
                asset: "BTC",
                amount: "0.5",
              }),
            ),
          },
        },
      }),
    );
    const second = await readEnvelope(socket);

    if (first.body.case !== "rpcResponse" || second.body.case !== "rpcResponse") {
      throw new Error("expected rpc responses for kv-backed requests");
    }

    const firstQuote = fromBinary(GetPriceResponseSchema, first.body.value.payload);
    const secondQuote = fromBinary(GetPriceResponseSchema, second.body.value.payload);
    if (firstQuote.outcome.case !== "ok" || secondQuote.outcome.case !== "ok") {
      throw new Error("expected ok quote outcomes");
    }

    expect(firstQuote.outcome.value.price).toBe("1");
    expect(secondQuote.outcome.value.price).toBe("2");

    socket.destroy();
    await server.close();
  });

  it("enforces request timeout settings from the runtime manifest", async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), "plugin-runtime-socket-"));
    tempDirs.push(tempDir);
    const socketPath = join(tempDir, "plugin.sock");

    const server = await startPluginSocketRuntimeServer({
      socketPath,
      manifest: {
        id: "quote-plugin",
        version: "1.0.0",
        runtime: {
          requestTimeoutMs: 5,
        },
      },
      service: runtimeService,
      loadModule: async () => ({
        default: definePlugin({
          async init() {
            return {
              outcome: {
                case: "ok",
                value: {
                  pluginName: "quote-plugin",
                  pluginVersion: "1.0.0",
                },
              },
            };
          },
          async getPrice() {
            await new Promise((resolve) => setTimeout(resolve, 25));
            return {
              outcome: {
                case: "ok",
                value: {
                  price: "late",
                  currency: "USD",
                  expiresAt: "2030-01-01T00:00:00Z",
                },
              },
            };
          },
        }),
      }),
    });

    const socket = await connect(socketPath);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 1n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 2026714057,
            payload: toBinary(
              InitRequestSchema,
              create(InitRequestSchema, {
                pluginInstanceId: "quote-plugin",
                environment: "production",
                config: {},
              }),
            ),
          },
        },
      }),
    );
    await readEnvelope(socket);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 2n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 758358830,
            payload: toBinary(
              GetPriceRequestSchema,
              create(GetPriceRequestSchema, {
                asset: "BTC",
                amount: "1",
              }),
            ),
          },
        },
      }),
    );

    const timeoutResponse = await readEnvelope(socket);
    expect(timeoutResponse.body.case).toBe("frameworkError");
    if (timeoutResponse.body.case !== "frameworkError") {
      throw new Error(`expected frameworkError, received ${timeoutResponse.body.case}`);
    }
    expect(timeoutResponse.body.value.message).toContain("timed out");

    await server.close();
  });

  it("routes non-serial request handling through the worker-pool path", async () => {
    const tempDir = await mkdtemp(join(os.tmpdir(), "plugin-runtime-socket-"));
    tempDirs.push(tempDir);
    const socketPath = join(tempDir, "plugin.sock");
    const seenTasks: unknown[] = [];

    const server = await startPluginSocketRuntimeServer({
      socketPath,
      manifest: {
        id: "quote-plugin",
        version: "1.0.0",
        runtime: {
          concurrency: {
            mode: "parallel-safe",
          },
        },
      },
      service: runtimeService,
      loadModule: async () => ({
        default: definePlugin({
          async init() {
            return {
              outcome: {
                case: "ok",
                value: {
                  pluginName: "quote-plugin",
                  pluginVersion: "1.0.0",
                },
              },
            };
          },
          async getPrice() {
            throw new Error("main-thread handler should not run");
          },
        }),
      }),
      createWorkerPool: () => ({
        async run(task: unknown) {
          seenTasks.push(task);
          return {
            outcome: {
              case: "ok",
              value: {
                price: "worker",
                currency: "USD",
                expiresAt: "2030-01-01T00:00:00Z",
              },
            },
          };
        },
        queueSize() {
          return 0;
        },
        async destroy() {},
      }),
    });

    const socket = await connect(socketPath);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 1n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 2026714057,
            payload: toBinary(
              InitRequestSchema,
              create(InitRequestSchema, {
                pluginInstanceId: "quote-plugin",
                environment: "production",
                config: {},
              }),
            ),
          },
        },
      }),
    );
    await readEnvelope(socket);

    await writeEnvelope(
      socket,
      create(WireEnvelopeSchema, {
        protocolVersion: 1,
        requestId: 2n,
        body: {
          case: "rpcRequest",
          value: {
            methodId: 758358830,
            payload: toBinary(
              GetPriceRequestSchema,
              create(GetPriceRequestSchema, {
                asset: "BTC",
                amount: "1",
              }),
            ),
          },
        },
      }),
    );

    const response = await readEnvelope(socket);
    expect(response.body.case).toBe("rpcResponse");
    expect(seenTasks).toHaveLength(1);

    await server.close();
  });
});

async function connect(socketPath: string): Promise<net.Socket> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function writeEnvelope(
  socket: net.Socket,
  envelope: ReturnType<typeof create<typeof WireEnvelopeSchema>>,
): Promise<void> {
  const payload = toBinary(WireEnvelopeSchema, envelope);
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  Buffer.from(payload).copy(frame, 4);

  await new Promise<void>((resolve, reject) => {
    socket.write(frame, (error) => (error ? reject(error) : resolve()));
  });
}

async function readEnvelope(socket: net.Socket) {
  return await new Promise<ReturnType<typeof fromBinary<typeof WireEnvelopeSchema>>>(
    (resolve, reject) => {
      let buffer = Buffer.alloc(0);

      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onClose = () => {
        cleanup();
        reject(new Error("socket closed before a full frame was received"));
      };

      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 4) {
          return;
        }

        const expectedLength = buffer.readUInt32BE(0);
        if (buffer.length < 4 + expectedLength) {
          return;
        }

        const payload = buffer.subarray(4, 4 + expectedLength);
        cleanup();
        resolve(fromBinary(WireEnvelopeSchema, payload));
      };

      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("close", onClose);
    },
  );
}

async function waitForClose(socket: net.Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("close", () => resolve());
    socket.once("error", reject);
  });
}
