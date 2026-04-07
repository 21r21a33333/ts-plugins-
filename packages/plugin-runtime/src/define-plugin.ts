/**
 * Declares the handler object exported by a TypeScript plugin.
 */

/**
 * Signature shared by generated plugin handler interfaces.
 */
export type PluginHandler<TRequest = unknown, TResponse = unknown> = (
  req: TRequest,
  ctx: import("./context.js").PluginContext,
) => Promise<TResponse> | TResponse;

type AnyPluginHandler = (
  req: any,
  ctx: import("./context.js").PluginContext,
) => Promise<any> | any;

export type PluginHandlerMap = Record<string, AnyPluginHandler>;

type PluginHandlerSet<THandlers extends object> = {
  [TKey in keyof THandlers]: THandlers[TKey] extends AnyPluginHandler
    ? THandlers[TKey]
    : never;
};

/**
 * Wraps a typed handler map without adding runtime behavior so authoring stays ergonomic.
 */
export function definePlugin<THandlers extends object>(
  handlers: PluginHandlerSet<THandlers>,
): THandlers {
  return handlers as THandlers;
}
