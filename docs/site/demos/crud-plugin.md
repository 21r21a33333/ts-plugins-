# CRUD Plugin

The CRUD demo is the strongest demonstration of the full platform shape.

Source: `examples/crud-plugin/src/index.ts`

## What It Demonstrates

- SQLite persistence inside the plugin runtime
- warm in-memory caching
- Redis-backed host-managed KV
- typed CRUD RPCs
- restart-safe behavior under a real process boundary

## Storage Layout

- SQLite stores notes durably
- `ctx.kv` stores mutation counters and lightweight shared metadata
- the in-memory cache speeds up reads but is not the only source of truth

## Test Command

```bash
cargo test -p plugin-e2e-harness --test e2e_crud -- --nocapture
```

## What The E2E Test Proves

- notes survive runtime restart because SQLite is durable
- KV state survives because Redis is durable
- warm cache repopulates after restart
- the host can reinitialize and continue calling the plugin cleanly
