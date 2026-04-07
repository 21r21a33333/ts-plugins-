import {
  createMemoryKvBackend,
  createPluginContext,
  createPluginKvStore,
  extractTraceContext,
  type LogEvent,
  type PluginContext,
  type PluginContextFactoryInput,
  type TraceEvent,
} from "@balance/plugin-runtime";

export interface TestContextState {
  logs: LogEvent[];
  traces: TraceEvent[];
}

export interface CreateTestContextOptions {
  now?: () => number;
}

export function createTestContextFactory(options: CreateTestContextOptions = {}): {
  createContext(input: PluginContextFactoryInput): PluginContext;
  state: TestContextState;
} {
  const memoryBackend = createMemoryKvBackend({
    now: options.now,
  });
  const state: TestContextState = {
    logs: [],
    traces: [],
  };

  return {
    createContext(input) {
      const context = createPluginContext({
        ...input,
        traceContext: extractTraceContext(input.traceContext),
        logSink: (event) => {
          state.logs.push(event);
        },
        traceSink: (event) => {
          state.traces.push(event);
        },
      });

      return {
        ...context,
        kv: createPluginKvStore(
          {
            backend: { kind: "memory" },
            namespacePrefix: `test:${input.manifest.id}:${input.runtimeInstanceId}`,
          },
          {
            memoryBackend,
          },
        ),
      };
    },
    state,
  };
}
