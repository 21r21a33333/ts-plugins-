export interface LogEvent {
  level: "info" | "warn" | "error";
  message: string;
  pluginId: string;
  runtimeInstanceId: string;
  requestId: string;
  traceId: string | null;
  attributes: Record<string, unknown>;
}

export interface StructuredLoggerOptions {
  pluginId: string;
  runtimeInstanceId: string;
  requestId: string;
  traceId: string | null;
  sink?: (event: LogEvent) => void;
}

export interface StructuredLogger {
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export function createStructuredLogger(
  options: StructuredLoggerOptions,
): StructuredLogger {
  const sink = options.sink ?? (() => {});

  return {
    info(message, attributes) {
      emit("info", message, attributes);
    },
    warn(message, attributes) {
      emit("warn", message, attributes);
    },
    error(message, attributes) {
      emit("error", message, attributes);
    },
  };

  function emit(
    level: LogEvent["level"],
    message: string,
    attributes?: Record<string, unknown>,
  ): void {
    sink({
      level,
      message,
      pluginId: options.pluginId,
      runtimeInstanceId: options.runtimeInstanceId,
      requestId: options.requestId,
      traceId: options.traceId,
      attributes: attributes ?? {},
    });
  }
}
