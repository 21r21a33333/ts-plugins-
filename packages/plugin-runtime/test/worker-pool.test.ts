import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PluginWorkerPool } from "../src/worker-pool.js";

describe("PluginWorkerPool", () => {
  let tempDir: string;
  let workerFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "plugin-runtime-worker-pool-"));
    workerFile = join(tempDir, "timed-worker.mjs");
    await writeFile(
      workerFile,
      [
        "import { setTimeout as delay } from 'node:timers/promises';",
        "",
        "export default async function timedWorker(task) {",
        "  const counters = new Int32Array(task.counterBuffer);",
        "  const current = Atomics.add(counters, 0, 1) + 1;",
        "  while (true) {",
        "    const knownMax = Atomics.load(counters, 1);",
        "    if (current <= knownMax) break;",
        "    if (Atomics.compareExchange(counters, 1, knownMax, current) === knownMax) break;",
        "  }",
        "  await delay(task.delayMs);",
        "  Atomics.sub(counters, 0, 1);",
        "  return task.label;",
        "}",
      ].join("\n"),
      "utf8",
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("serial mode never overlaps requests", async () => {
    const pool = new PluginWorkerPool<
      { counterBuffer: SharedArrayBuffer; delayMs: number; label: string },
      string
    >({
      workerFile,
      concurrency: { mode: "serial" },
      maxThreads: 4,
    });
    const counters = new Int32Array(new SharedArrayBuffer(8));

    try {
      const results = await Promise.all([
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 40, label: "a" }),
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 40, label: "b" }),
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 40, label: "c" }),
      ]);

      expect(results).toEqual(["a", "b", "c"]);
      expect(Atomics.load(counters, 1)).toBe(1);
    } finally {
      await pool.destroy();
    }
  });

  it("parallel-safe mode can overlap requests", async () => {
    const pool = new PluginWorkerPool<
      { counterBuffer: SharedArrayBuffer; delayMs: number; label: string },
      string
    >({
      workerFile,
      concurrency: { mode: "parallel-safe" },
      maxThreads: 3,
    });
    const counters = new Int32Array(new SharedArrayBuffer(8));

    try {
      await Promise.all([
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 50, label: "a" }),
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 50, label: "b" }),
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 50, label: "c" }),
      ]);

      expect(Atomics.load(counters, 1)).toBeGreaterThanOrEqual(2);
    } finally {
      await pool.destroy();
    }
  });

  it("max concurrency mode enforces the configured cap", async () => {
    const pool = new PluginWorkerPool<
      { counterBuffer: SharedArrayBuffer; delayMs: number; label: string },
      string
    >({
      workerFile,
      concurrency: { mode: "max_concurrency", maxConcurrency: 2 },
      maxThreads: 6,
    });
    const counters = new Int32Array(new SharedArrayBuffer(8));

    try {
      await Promise.all([
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 50, label: "a" }),
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 50, label: "b" }),
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 50, label: "c" }),
        pool.run({ counterBuffer: counters.buffer as SharedArrayBuffer, delayMs: 50, label: "d" }),
      ]);

      expect(Atomics.load(counters, 1)).toBe(2);
    } finally {
      await pool.destroy();
    }
  });
});
