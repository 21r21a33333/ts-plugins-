# System Overview

Balance TS Plugins uses a split-plane design:

- Rust owns control-plane behavior
- TypeScript owns plugin execution

## Major Components

### Rust Host

The host is responsible for:

- registry and manifest loading
- activation and lazy startup
- request scheduling and queueing
- timeout handling
- circuit breaker behavior
- transport and process supervision
- trace propagation

Key crates:

- `crates/plugin-host`
- `crates/plugin-kv`
- `crates/plugin-observability`
- `crates/plugin-protocol`

### TypeScript Runtime

The runtime is responsible for:

- loading the plugin entrypoint
- validating generated handlers against the descriptor set
- decoding incoming protobuf payloads
- creating request-scoped context
- dispatching handlers
- optional worker-pool execution
- encoding typed responses

Key packages:

- `packages/plugin-runtime`
- `packages/plugin-codegen`
- `packages/pluginctl`

### Contract Tooling

- Protobuf defines the interface
- Buf drives generation and descriptor emission
- the packaged descriptor set is the runtime truth source

## High-Level Request Flow

1. Rust host resolves the installed plugin and its manifest.
2. The host activates a warm Node runtime if needed.
3. The host calls `Init` if the runtime is not yet ready.
4. The host serializes the typed request as a Protobuf payload.
5. The request moves over a local socket in a length-prefixed wire envelope.
6. The runtime decodes the envelope, finds the method by id, and dispatches the handler.
7. The handler returns a typed result envelope.
8. The runtime encodes the typed response and sends it back to Rust.

## Why This Shape

This architecture is optimized for:

- contract fidelity
- local throughput
- operational recovery
- developer-friendly TypeScript authoring

It borrows:

- VS Code’s manifest-driven activation mindset
- OpenZeppelin Relayer’s warm runtime, worker-pool, KV, and recovery instincts

without turning the local plugin path into a heavy HTTP service system.
