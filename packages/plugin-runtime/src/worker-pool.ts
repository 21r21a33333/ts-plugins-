import { availableParallelism } from "node:os";

import Piscina from "piscina";

export type PluginConcurrencyMode =
  | { mode: "serial" }
  | { mode: "parallel-safe" }
  | { mode: "max_concurrency"; maxConcurrency: number };

export interface PluginWorkerPoolOptions {
  workerFile: string;
  concurrency: PluginConcurrencyMode;
  minThreads?: number;
  maxThreads?: number;
  idleTimeoutMs?: number;
  taskTimeoutBufferMs?: number;
}

export class PluginWorkerPool<TTask, TResult> {
  private readonly piscina: Piscina;
  private readonly taskTimeoutBufferMs: number;

  constructor(options: PluginWorkerPoolOptions) {
    const maxThreads = resolveMaxThreads(
      options.concurrency,
      options.maxThreads ?? Math.max(availableParallelism() - 1, 1),
    );
    const minThreads = Math.min(options.minThreads ?? 1, maxThreads);

    this.piscina = new Piscina({
      filename: options.workerFile,
      minThreads,
      maxThreads,
      idleTimeout: options.idleTimeoutMs ?? 30_000,
      concurrentTasksPerWorker: 1,
    });
    this.taskTimeoutBufferMs = options.taskTimeoutBufferMs ?? 250;
  }

  async run(task: TTask, timeoutMs?: number): Promise<TResult> {
    const execution = this.piscina.run(task) as Promise<TResult>;
    if (timeoutMs === undefined) {
      return execution;
    }

    return Promise.race([
      execution,
      new Promise<TResult>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Worker task timed out after ${timeoutMs + this.taskTimeoutBufferMs}ms`));
        }, timeoutMs + this.taskTimeoutBufferMs);
        execution.finally(() => {
          clearTimeout(timer);
        });
      }),
    ]);
  }

  async destroy(): Promise<void> {
    await this.piscina.destroy();
  }

  queueSize(): number {
    return this.piscina.queueSize;
  }
}

function resolveMaxThreads(
  concurrency: PluginConcurrencyMode,
  configuredMaxThreads: number,
): number {
  if (concurrency.mode === "serial") {
    return 1;
  }

  if (concurrency.mode === "max_concurrency") {
    return Math.min(configuredMaxThreads, concurrency.maxConcurrency);
  }

  return configuredMaxThreads;
}
