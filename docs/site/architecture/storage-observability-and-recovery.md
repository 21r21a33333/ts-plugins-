# Storage, Observability, And Recovery

The runtime model assumes processes can restart and warm memory can disappear.

## Storage Model

### Warm Memory

Use process memory for:

- caches
- pooled clients
- parsed config
- precomputed lookups

Do not use it as the only source of correctness-critical state.

### Host-Managed KV

The runtime exposes `ctx.kv` with:

- `get`
- `set`
- `del`
- `exists`
- `listKeys`
- `clear`
- `withLock`

Backends:

- in-memory for dev and tests
- Redis for production durability

### External Storage

Plugins are trusted code in v1, so they can also own their own durable storage.

The CRUD demo combines:

- SQLite for primary record storage
- Redis-backed KV for mutation counters and restart-safe shared state
- in-memory cache for warm reads

## Observability

### Logs

Request-scoped structured logs include:

- plugin id
- runtime instance id
- request id
- trace id

### Metrics

Runtime metrics track:

- request counts by outcome
- queue depth
- latency
- restart behavior

### Tracing

Trace context originates on the Rust side and is propagated into the TypeScript runtime. The runtime can then create child spans inside handlers.

## Failure Recovery

Opinionated defaults cover:

- activation backoff
- runtime restart
- breaker opening after repeated failures
- timeout accounting
- overload refusal under hard memory pressure

The end-to-end CRUD path proves that restart can happen without losing durable state.
