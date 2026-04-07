/**
 * Warm-cache helpers and memory-pressure handling for long-lived runtimes.
 */

export interface MemoryPressureConfig {
  softLimitBytes: number;
  hardLimitBytes: number;
}

export type MemoryPressureState = "normal" | "soft" | "hard";

export interface WarmCacheOptions {
  maxEntries: number;
  maxAgeMs: number;
  memoryPressure?: MemoryPressureConfig;
}

export interface WarmCacheSetOptions {
  weightBytes?: number;
  now?: number;
}

interface CacheEntry<TValue> {
  value: TValue;
  insertedAt: number;
  weightBytes: number;
}

export class WarmCache<TKey, TValue> {
  private readonly entries = new Map<TKey, CacheEntry<TValue>>();
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private readonly memoryPressure?: MemoryPressureConfig;

  constructor(options: WarmCacheOptions) {
    this.maxEntries = options.maxEntries;
    this.maxAgeMs = options.maxAgeMs;
    this.memoryPressure = options.memoryPressure;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: TKey, now = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  get(key: TKey, now = Date.now()): TValue | undefined {
    this.pruneExpired(now);
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: TKey, value: TValue, options: WarmCacheSetOptions = {}): void {
    const now = options.now ?? Date.now();
    const weightBytes = options.weightBytes ?? 1;

    this.pruneExpired(now);
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, {
      value,
      insertedAt: now,
      weightBytes,
    });

    while (this.entries.size > this.maxEntries) {
      this.evictOldest();
    }
  }

  handleMemoryPressure(currentUsageBytes: number): {
    evicted: number;
    state: MemoryPressureState;
  } {
    const state = this.memoryPressureState(currentUsageBytes);
    if (state === "normal") {
      return { evicted: 0, state };
    }

    const targetWeight =
      state === "soft"
        ? Math.max(this.memoryPressure!.softLimitBytes / 2, 0)
        : 0;
    let evicted = 0;
    while (this.totalWeight() > targetWeight && this.entries.size > 0) {
      this.evictOldest();
      evicted += 1;
    }

    return { evicted, state };
  }

  memoryPressureState(currentUsageBytes: number): MemoryPressureState {
    if (this.memoryPressure === undefined) {
      return "normal";
    }

    if (currentUsageBytes >= this.memoryPressure.hardLimitBytes) {
      return "hard";
    }

    if (currentUsageBytes >= this.memoryPressure.softLimitBytes) {
      return "soft";
    }

    return "normal";
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.insertedAt > this.maxAgeMs) {
        this.entries.delete(key);
      }
    }
  }

  private evictOldest(): void {
    const oldestKey = this.entries.keys().next().value;
    if (oldestKey !== undefined) {
      this.entries.delete(oldestKey);
    }
  }

  private totalWeight(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.weightBytes;
    }
    return total;
  }
}
