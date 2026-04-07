export type PluginHandler<TRequest = unknown, TResponse = unknown> = (
  req: TRequest,
  ctx: import("./context.js").PluginContext,
) => Promise<TResponse> | TResponse;

type AnyPluginHandler = (
  req: any,
  ctx: import("./context.js").PluginContext,
) => Promise<any> | any;

export type PluginHandlerMap = Record<string, AnyPluginHandler>;

export function definePlugin<THandlers extends PluginHandlerMap>(handlers: THandlers): THandlers {
  return handlers;
}
