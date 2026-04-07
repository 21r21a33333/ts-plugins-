import type { PluginServiceDefinition } from "@balance/plugin-codegen";
import {
  PluginExecutionError,
  bootstrapPluginRuntime,
  type PluginHandlerMap,
  type PluginRuntimeManifest,
  type RuntimeTraceContext,
} from "@balance/plugin-runtime";

import { createTestContextFactory, type TestContextState } from "./create-test-context.js";

export interface MessageCodec<TValue> {
  encode(value: TValue): Uint8Array;
  decode(bytes: Uint8Array): TValue;
}

export interface InProcessHarnessOptions {
  manifest: PluginRuntimeManifest;
  service: PluginServiceDefinition;
  plugin: PluginHandlerMap;
  runtimeInstanceId?: string;
}

export interface InProcessHarness {
  state: TestContextState;
  init<TRequest, TResponse>(
    request: TRequest,
    options?: { traceContext?: RuntimeTraceContext },
  ): Promise<TResponse>;
  invoke<TRequest, TResponse>(
    methodId: number,
    request: TRequest,
    options?: { traceContext?: RuntimeTraceContext },
  ): Promise<TResponse>;
  initEncoded<TRequest, TResponse>(
    bytes: Uint8Array,
    requestCodec: MessageCodec<TRequest>,
    responseCodec: MessageCodec<TResponse>,
    options?: { traceContext?: RuntimeTraceContext },
  ): Promise<Uint8Array>;
  invokeEncoded<TRequest, TResponse>(
    methodId: number,
    bytes: Uint8Array,
    requestCodec: MessageCodec<TRequest>,
    responseCodec: MessageCodec<TResponse>,
    options?: { traceContext?: RuntimeTraceContext },
  ): Promise<Uint8Array>;
}

export async function createInProcessHarness(
  options: InProcessHarnessOptions,
): Promise<InProcessHarness> {
  const { createContext, state } = createTestContextFactory();
  const runtime = await bootstrapPluginRuntime({
    manifest: options.manifest,
    service: options.service,
    runtimeInstanceId: options.runtimeInstanceId,
    contextFactory: createContext,
    loadModule: async () => ({
      default: options.plugin,
    }),
  });

  return {
    state,
    async init<TRequest, TResponse>(
      request: TRequest,
      requestOptions?: { traceContext?: RuntimeTraceContext },
    ) {
      return runtime.initialize(request, requestOptions) as Promise<TResponse>;
    },
    async invoke<TRequest, TResponse>(
      methodId: number,
      request: TRequest,
      requestOptions?: { traceContext?: RuntimeTraceContext },
    ) {
      return runtime.invoke(methodId, request, requestOptions) as Promise<TResponse>;
    },
    async initEncoded<TRequest, TResponse>(
      bytes: Uint8Array,
      requestCodec: MessageCodec<TRequest>,
      responseCodec: MessageCodec<TResponse>,
      requestOptions?: { traceContext?: RuntimeTraceContext },
    ) {
      const decodedRequest = requestCodec.decode(bytes);
      const response = await runtime.initialize(decodedRequest, requestOptions) as TResponse;
      return responseCodec.encode(response);
    },
    async invokeEncoded<TRequest, TResponse>(
      methodId: number,
      bytes: Uint8Array,
      requestCodec: MessageCodec<TRequest>,
      responseCodec: MessageCodec<TResponse>,
      requestOptions?: { traceContext?: RuntimeTraceContext },
    ) {
      try {
        const decodedRequest = requestCodec.decode(bytes);
        const response = await runtime.invoke(methodId, decodedRequest, requestOptions) as TResponse;
        return responseCodec.encode(response);
      } catch (error) {
        if (error instanceof PluginExecutionError) {
          throw error;
        }
        throw error;
      }
    },
  };
}
