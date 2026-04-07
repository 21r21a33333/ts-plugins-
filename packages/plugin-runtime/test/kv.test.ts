import { describe, expect, it } from "vitest";

import {
  createMemoryKvBackend,
  createPluginKvStore,
  type RuntimeKvConfig,
} from "../src/index.js";

describe("plugin KV", () => {
  it("stores and retrieves JSON values", async () => {
    const store = createPluginKvStore(memoryConfig("balance:plugins:quote-plugin"));

    await expect(
      store.set("quote:last", { asset: "BTC", price: "65000.00" }),
    ).resolves.toBe(true);
    await expect(store.get("quote:last")).resolves.toEqual({
      asset: "BTC",
      price: "65000.00",
    });
  });

  it("honors TTL for in-memory values", async () => {
    let now = 1_000;
    const backend = createMemoryKvBackend({
      now: () => now,
    });
    const store = createPluginKvStore(memoryConfig("balance:plugins:quote-plugin"), {
      memoryBackend: backend,
    });

    await store.set("session", { ok: true }, { ttlSec: 2 });
    now += 1_500;
    await expect(store.get("session")).resolves.toEqual({ ok: true });

    now += 600;
    await expect(store.get("session")).resolves.toBeNull();
  });

  it("isolates namespaces", async () => {
    const backend = createMemoryKvBackend();
    const left = createPluginKvStore(memoryConfig("balance:plugins:left"), {
      memoryBackend: backend,
    });
    const right = createPluginKvStore(memoryConfig("balance:plugins:right"), {
      memoryBackend: backend,
    });

    await left.set("shared", { side: "left" });
    await right.set("shared", { side: "right" });

    await expect(left.get("shared")).resolves.toEqual({ side: "left" });
    await expect(right.get("shared")).resolves.toEqual({ side: "right" });
  });

  it("rejects invalid keys", async () => {
    const store = createPluginKvStore(memoryConfig("balance:plugins:quote-plugin"));

    await expect(store.set("bad key", { ok: false })).rejects.toThrow(/invalid key/i);
  });

  it("supports lock busy skip behavior", async () => {
    const backend = createMemoryKvBackend();
    const first = createPluginKvStore(memoryConfig("balance:plugins:quote-plugin"), {
      memoryBackend: backend,
    });
    const second = createPluginKvStore(memoryConfig("balance:plugins:quote-plugin"), {
      memoryBackend: backend,
    });

    const held = first.withLock(
      "cursor",
      async () =>
        second.withLock("cursor", async () => "never", {
          onBusy: "skip",
        }),
    );

    await expect(held).resolves.toBeNull();
  });

  it("releases locks when the protected function throws", async () => {
    const backend = createMemoryKvBackend();
    const store = createPluginKvStore(memoryConfig("balance:plugins:quote-plugin"), {
      memoryBackend: backend,
    });

    await expect(
      store.withLock("cursor", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);

    await expect(
      store.withLock("cursor", async () => "recovered"),
    ).resolves.toBe("recovered");
  });
});

function memoryConfig(namespacePrefix: string): RuntimeKvConfig {
  return {
    backend: { kind: "memory" },
    namespacePrefix,
  };
}
