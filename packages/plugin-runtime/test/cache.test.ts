import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PluginWorkerPool,
  WarmCache,
  WorkerPoolOverloadedError,
} from "../src/index.js";

describe("WarmCache", () => {
  it("evicts entries by age", () => {
    const cache = new WarmCache<string, string>({
      maxEntries: 10,
      maxAgeMs: 20,
    });

    cache.set("stale", "first", { now: 0 });
    cache.set("fresh", "second", { now: 10 });

    expect(cache.get("stale", 25)).toBeUndefined();
    expect(cache.get("fresh", 25)).toBe("second");
  });

  it("evicts oldest entries under memory pressure", () => {
    const cache = new WarmCache<string, string>({
      maxEntries: 10,
      maxAgeMs: 100,
      memoryPressure: {
        softLimitBytes: 30,
        hardLimitBytes: 60,
      },
    });

    cache.set("a", "one", { weightBytes: 10, now: 0 });
    cache.set("b", "two", { weightBytes: 10, now: 1 });
    cache.set("c", "three", { weightBytes: 10, now: 2 });
    cache.set("d", "four", { weightBytes: 10, now: 3 });

    const result = cache.handleMemoryPressure(35);

    expect(result).toEqual({ evicted: 3, state: "soft" });
    expect(cache.has("a", 4)).toBe(false);
    expect(cache.has("b", 4)).toBe(false);
    expect(cache.has("c", 4)).toBe(false);
    expect(cache.has("d", 4)).toBe(true);
  });
});

describe("PluginWorkerPool memory pressure", () => {
  let tempDir: string;
  let workerFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "plugin-runtime-cache-"));
    workerFile = join(tempDir, "noop-worker.mjs");
    await writeFile(
      workerFile,
      "export default async function noopWorker(task) { return task; }\n",
      "utf8",
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("refuses overload under emergency memory pressure", async () => {
    const pool = new PluginWorkerPool<{ value: number }, { value: number }>({
      workerFile,
      concurrency: { mode: "parallel-safe" },
      memoryPressure: {
        softLimitBytes: 10,
        hardLimitBytes: 20,
      },
      currentHeapUsageBytes: () => 25,
    });

    try {
      await expect(pool.run({ value: 1 })).rejects.toBeInstanceOf(
        WorkerPoolOverloadedError,
      );
      expect(pool.memoryPressureState()).toBe("hard");
    } finally {
      await pool.destroy();
    }
  });
});
