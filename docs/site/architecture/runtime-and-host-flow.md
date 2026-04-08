# Runtime And Host Flow

This page describes the actual execution path from host call to plugin response.

## Activation

Activation is manifest-driven:

- `lazy` starts the runtime on first use
- `startup` allows eager activation

The host loads installed manifest metadata, decides whether the plugin should be active, and creates a runtime when needed.

## Init Handshake

Every plugin must implement `Init`.

The host passes runtime-specific config in the `InitRequest`, which keeps the package portable while allowing environment-specific deployment data such as:

- endpoints
- feature flags
- db paths
- Redis namespace prefixes

If `Init` fails:

- the plugin does not become healthy
- activation fails
- the host can retry with backoff

## Transport

The runtime uses:

- local sockets
- binary framed Protobuf envelopes
- compact numeric method ids on the hot path

This avoids the overhead of JSON line protocols while keeping the contract defined in standard Protobuf.

## Scheduling

The host scheduler handles:

- queue admission
- per-request timeouts
- overload rejection
- circuit breaker policy

## Worker Pool

The TypeScript runtime can dispatch through a worker pool when the plugin concurrency mode opts into it:

- `serial`
- `parallel-safe`
- `max_concurrency`

The worker pool is used only when it adds value; `Init` stays on the primary runtime path.

## Error Model

Business failures should come back as typed contract errors.

Framework failures remain separate and include:

- timeout
- decode failure
- protocol mismatch
- runtime crash

This gives callers a clean split between domain semantics and infrastructure semantics.
