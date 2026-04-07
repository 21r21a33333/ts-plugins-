import type { PluginMethodDefinition } from "@balance/plugin-codegen";

import type { PluginContext } from "./context.js";
import type { PluginHandler } from "./define-plugin.js";

export class PluginExecutionError extends Error {
  readonly pluginId: string;
  readonly methodName: string;
  readonly requestId: string;

  constructor(input: {
    pluginId: string;
    methodName: string;
    requestId: string;
    cause: unknown;
  }) {
    const causeMessage =
      input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(
      `Plugin ${input.pluginId} failed while executing ${input.methodName}: ${causeMessage}`,
      { cause: input.cause },
    );
    this.name = "PluginExecutionError";
    this.pluginId = input.pluginId;
    this.methodName = input.methodName;
    this.requestId = input.requestId;
  }
}

export async function executePluginHandler<TRequest, TResponse>(input: {
  handler: PluginHandler<TRequest, TResponse>;
  request: TRequest;
  context: PluginContext;
  method: PluginMethodDefinition;
}): Promise<TResponse> {
  const span = input.context.tracer.startSpan("plugin.handler", {
    "plugin.id": input.context.plugin.id,
    "plugin.method": input.method.canonicalName,
    "plugin.request_id": input.context.request.id,
  });

  try {
    return await input.handler(input.request, input.context);
  } catch (error) {
    span.setAttribute("plugin.error", true);
    input.context.logger.error("Plugin handler threw an exception", {
      pluginId: input.context.plugin.id,
      methodName: input.method.canonicalName,
      requestId: input.context.request.id,
      error,
    });

    throw new PluginExecutionError({
      pluginId: input.context.plugin.id,
      methodName: input.method.canonicalName,
      requestId: input.context.request.id,
      cause: error,
    });
  } finally {
    span.end();
  }
}
