/**
 * Host-managed KV implementations for runtime-side plugin access.
 */

import { randomUUID } from "node:crypto";

import IORedis from "ioredis/built/index.js";
import type Redis from "ioredis/built/Redis.js";

const KEY_REGEX = /^[A-Za-z0-9:_-]{1,512}$/;
const UNLOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("UNLINK", KEYS[1]) else return 0 end';

/**
 * Runtime-facing KV contract exposed to plugins through `ctx.kv`.
 */
export interface PluginKvStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<boolean>;
  del(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  listKeys(pattern?: string, batch?: number): Promise<string[]>;
  clear(): Promise<number>;
  withLock<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { ttlSec?: number; onBusy?: "throw" | "skip" },
  ): Promise<T | null>;
  disconnect(): Promise<void>;
}

/**
 * Host-supplied KV configuration injected during runtime bootstrap.
 */
export interface RuntimeKvConfig {
  backend: { kind: "memory" } | { kind: "redis"; url: string };
  namespacePrefix: string;
}

/**
 * Test/dev options for the in-memory KV backend.
 */
export interface MemoryKvBackendOptions {
  now?: () => number;
}

interface MemoryValue {
  payload: string;
  expiresAt: number | null;
}

interface MemoryLock {
  token: string;
  expiresAt: number;
}

/**
 * Shared in-memory storage used by test harnesses and local runtime mode.
 */
export class MemoryKvBackend {
  readonly values = new Map<string, MemoryValue>();
  readonly locks = new Map<string, MemoryLock>();
  readonly now: () => number;

  constructor(options: MemoryKvBackendOptions = {}) {
    this.now = options.now ?? Date.now;
  }
}

/**
 * Creates a reusable in-memory backend instance so multiple stores can share state in tests.
 */
export function createMemoryKvBackend(options: MemoryKvBackendOptions = {}): MemoryKvBackend {
  return new MemoryKvBackend(options);
}

/**
 * Selects the concrete KV implementation requested by the host configuration.
 */
export function createPluginKvStore(
  config: RuntimeKvConfig,
  options: { memoryBackend?: MemoryKvBackend } = {},
): PluginKvStore {
  if (config.backend.kind === "memory") {
    return new MemoryPluginKvStore(
      config.namespacePrefix,
      options.memoryBackend ?? createMemoryKvBackend(),
    );
  }

  return new RedisPluginKvStore(config.namespacePrefix, config.backend.url);
}

abstract class BasePluginKvStore {
  protected readonly namespacePrefix: string;

  constructor(namespacePrefix: string) {
    this.namespacePrefix = namespacePrefix;
  }

  protected dataKey(key: string): string {
    return `${this.namespacePrefix}:data:${this.validateKey(key)}`;
  }

  protected lockKey(key: string): string {
    return `${this.namespacePrefix}:lock:${this.validateKey(key)}`;
  }

  protected validateKey(key: string): string {
    if (!KEY_REGEX.test(key)) {
      throw new Error("invalid key");
    }
    return key;
  }

  protected bareKey(key: string, segment: "data" | "lock"): string {
    const prefix = `${this.namespacePrefix}:${segment}:`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }
}

export class MemoryPluginKvStore extends BasePluginKvStore implements PluginKvStore {
  private readonly backend: MemoryKvBackend;

  constructor(namespacePrefix: string, backend: MemoryKvBackend = createMemoryKvBackend()) {
    super(namespacePrefix);
    this.backend = backend;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = this.readValue(this.dataKey(key));
    if (value === undefined) {
      return null;
    }
    return JSON.parse(value.payload) as T;
  }

  async set(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<boolean> {
    if (value === undefined) {
      throw new Error("value must not be undefined");
    }

    const ttlSec = Math.max(0, Math.floor(opts?.ttlSec ?? 0));
    this.backend.values.set(this.dataKey(key), {
      payload: JSON.stringify(value),
      expiresAt: ttlSec > 0 ? this.backend.now() + ttlSec * 1000 : null,
    });
    return true;
  }

  async del(key: string): Promise<boolean> {
    return this.backend.values.delete(this.dataKey(key));
  }

  async exists(key: string): Promise<boolean> {
    return this.readValue(this.dataKey(key)) !== undefined;
  }

  async listKeys(pattern = "*", _batch = 500): Promise<string[]> {
    const matcher = globToRegExp(pattern);
    const keys: string[] = [];
    for (const key of this.backend.values.keys()) {
      const value = this.readValue(key);
      if (value === undefined) {
        continue;
      }

      const bare = this.bareKey(key, "data");
      if (matcher.test(bare)) {
        keys.push(bare);
      }
    }
    return keys.sort();
  }

  async clear(): Promise<number> {
    let deleted = 0;
    for (const key of [...this.backend.values.keys()]) {
      if (key.startsWith(`${this.namespacePrefix}:data:`) && this.backend.values.delete(key)) {
        deleted += 1;
      }
    }
    for (const key of [...this.backend.locks.keys()]) {
      if (key.startsWith(`${this.namespacePrefix}:lock:`)) {
        this.backend.locks.delete(key);
      }
    }
    return deleted;
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { ttlSec?: number; onBusy?: "throw" | "skip" },
  ): Promise<T | null> {
    const ttlSec = opts?.ttlSec ?? 30;
    const onBusy = opts?.onBusy ?? "throw";
    const lockKey = this.lockKey(key);
    const token = randomUUID();
    const existing = this.readLock(lockKey);

    if (existing !== undefined) {
      if (onBusy === "skip") {
        return null;
      }
      throw new Error("lock busy");
    }

    // Locks are ephemeral and scoped by token so a stale finally block cannot release a new lock.
    this.backend.locks.set(lockKey, {
      token,
      expiresAt: this.backend.now() + ttlSec * 1000,
    });

    try {
      return await fn();
    } finally {
      const activeLock = this.backend.locks.get(lockKey);
      if (activeLock?.token === token) {
        this.backend.locks.delete(lockKey);
      }
    }
  }

  async disconnect(): Promise<void> {}

  private readValue(key: string): MemoryValue | undefined {
    const value = this.backend.values.get(key);
    if (value === undefined) {
      return undefined;
    }

    if (value.expiresAt !== null && value.expiresAt <= this.backend.now()) {
      this.backend.values.delete(key);
      return undefined;
    }

    return value;
  }

  private readLock(key: string): MemoryLock | undefined {
    const value = this.backend.locks.get(key);
    if (value === undefined) {
      return undefined;
    }

    if (value.expiresAt <= this.backend.now()) {
      this.backend.locks.delete(key);
      return undefined;
    }

    return value;
  }
}

/**
 * Redis-backed KV store used for production durability across runtime restarts.
 */
export class RedisPluginKvStore extends BasePluginKvStore implements PluginKvStore {
  private readonly client: Redis;

  constructor(namespacePrefix: string, url: string, client?: Redis) {
    super(namespacePrefix);
    this.client =
      client ??
      new IORedis(url, {
        connectionName: `plugin_kv:${namespacePrefix}`,
        lazyConnect: true,
        enableOfflineQueue: true,
        enableAutoPipelining: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (retry: number) => Math.min(retry * 50, 1000),
      });
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(this.dataKey(key));
    if (value == null) {
      return null;
    }
    return JSON.parse(value) as T;
  }

  async set(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<boolean> {
    if (value === undefined) {
      throw new Error("value must not be undefined");
    }
    const payload = JSON.stringify(value);
    const ttlSec = Math.max(0, Math.floor(opts?.ttlSec ?? 0));
    const redisKey = this.dataKey(key);
    const result =
      ttlSec > 0
        ? await this.client.set(redisKey, payload, "EX", ttlSec)
        : await this.client.set(redisKey, payload);
    return result === "OK";
  }

  async del(key: string): Promise<boolean> {
    return (await this.client.unlink(this.dataKey(key))) === 1;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(this.dataKey(key))) === 1;
  }

  async listKeys(pattern = "*", batch = 500): Promise<string[]> {
    const prefix = `${this.namespacePrefix}:data:`;
    const results: string[] = [];
    let cursor = "0";

    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        `${prefix}${pattern}`,
        "COUNT",
        batch,
      );
      cursor = next;
      for (const key of keys) {
        results.push(this.bareKey(key, "data"));
      }
    } while (cursor !== "0");

    return results;
  }

  async clear(): Promise<number> {
    let cursor = "0";
    let deleted = 0;
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        `${this.namespacePrefix}:*`,
        "COUNT",
        1000,
      );
      cursor = next;
      if (keys.length === 0) {
        continue;
      }

      const pipeline = this.client.pipeline();
      for (const key of keys) {
        pipeline.unlink(key);
      }
      const results = await pipeline.exec();
      for (const [, count] of results ?? []) {
        if (typeof count === "number") {
          deleted += count;
        }
      }
    } while (cursor !== "0");

    return deleted;
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { ttlSec?: number; onBusy?: "throw" | "skip" },
  ): Promise<T | null> {
    const ttlSec = opts?.ttlSec ?? 30;
    const onBusy = opts?.onBusy ?? "throw";
    const redisKey = this.lockKey(key);
    const token = randomUUID();
    const acquired = await this.client.set(redisKey, token, "PX", ttlSec * 1000, "NX");

    if (acquired !== "OK") {
      if (onBusy === "skip") {
        return null;
      }
      throw new Error("lock busy");
    }

    try {
      return await fn();
    } finally {
      // The Lua unlock script preserves lock ownership even if another worker acquired a later lock.
      await this.client.eval(UNLOCK_SCRIPT, 1, redisKey, token);
    }
  }

  async disconnect(): Promise<void> {
    this.client.disconnect();
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`);
}
