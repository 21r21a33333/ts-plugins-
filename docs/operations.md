# Operations Guide

## Redis-Backed KV

The plugin runtime accepts KV configuration through the runtime init context. In the real process bridge this arrives via `BALANCE_PLUGIN_KV_JSON` and is turned into a runtime KV store by `packages/plugin-runtime/src/socket-server.ts`.

Two KV modes are supported:

- `memory`
- `redis`

Example runtime KV config:

```json
{
  "backend": {
    "kind": "redis",
    "url": "redis://127.0.0.1:6379/0"
  },
  "namespacePrefix": "balance:plugins:crud-plugin"
}
```

### What Survives Restarts

- process memory does not survive restarts
- Redis-backed KV does survive restarts
- the CRUD demo proves restart-safe state using Redis KV plus SQLite persistence

The restart-safe end-to-end test is:

```bash
cargo test -p plugin-e2e-harness --test e2e_crud -- --nocapture
```

That flow validates:

- plugin restart
- persisted mutation counters in Redis
- persisted note state in SQLite
- warm cache repopulation after restart

## Tracing

Trace context originates on the Rust host side in `crates/plugin-observability/src/tracing.rs` and is attached to outgoing protocol requests by `crates/plugin-host/src/client.rs`.

The TS runtime:

- reads the propagated trace context
- injects it into the request context
- creates child spans through `packages/plugin-runtime/src/tracing.ts`
- attaches the trace ID to request-scoped logs via `packages/plugin-runtime/src/context.ts`

What is included per request:

- plugin ID
- runtime instance ID
- request ID
- method ID and canonical method name
- trace ID when present

## Structured Logs

The TS runtime logger emits request-scoped log events with:

- `pluginId`
- `runtimeInstanceId`
- `requestId`
- `traceId`
- arbitrary attributes

The logger implementation is in `packages/plugin-runtime/src/logger.ts`.

## Metrics

The runtime metrics helpers track:

- request counts by plugin/method/outcome
- queue depth
- restart counts
- breaker transitions
- per-method latency samples

Relevant implementations:

- Rust: `crates/plugin-observability/src/metrics.rs`
- TS: `packages/plugin-runtime/src/metrics.ts`

## Failure Recovery Defaults

The host/runtime stack uses opinionated defaults for:

- activation backoff after failed `Init`
- runtime restart on failed probes
- circuit breaker opening after repeated failures or timeouts
- worker-pool overload refusal under hard memory pressure

Relevant code paths:

- `crates/plugin-host/src/activation.rs`
- `crates/plugin-host/src/supervisor.rs`
- `crates/plugin-host/src/circuit_breaker.rs`
- `packages/plugin-runtime/src/worker-pool.ts`
- `packages/plugin-runtime/src/cache.ts`
