const moduleCache = new Map<string, (task: unknown) => Promise<unknown> | unknown>();

export interface WorkerTask {
  modulePath: string;
  exportName?: string;
  payload: unknown;
}

export default async function runWorkerTask(task: WorkerTask): Promise<unknown> {
  const exportName = task.exportName ?? "default";
  const cacheKey = `${task.modulePath}#${exportName}`;
  let handler = moduleCache.get(cacheKey);

  if (handler === undefined) {
    const loadedModule = await import(task.modulePath);
    const candidate = loadedModule[exportName];
    if (typeof candidate !== "function") {
      throw new Error(
        `Worker module ${task.modulePath} did not export function ${exportName}`,
      );
    }
    handler = candidate as (task: unknown) => Promise<unknown> | unknown;
    moduleCache.set(cacheKey, handler);
  }

  return handler(task.payload);
}
