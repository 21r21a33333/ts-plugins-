# Demo Overview

The repository ships multiple demos so developers can see the platform under different workloads.

## Included Demos

### Calculation Plugin

Shows the smallest possible useful plugin:

- `Init`
- a typed arithmetic RPC
- minimal handler implementation

### HTTP Plugin

Shows a trusted plugin making direct outbound HTTP calls and shaping the response through a typed contract.

### CRUD Plugin

Shows a more realistic stateful workflow:

- SQLite persistence
- warm in-memory cache
- Redis-backed KV
- restart-safe end-to-end behavior

### Quote Plugin

Shows a minimal live plugin used by host examples and process-boundary tests.

### Rust Caller

Shows how a standalone Rust binary can connect to a live plugin runtime socket and issue typed RPC calls.

## Run The Demo Test Matrix

```bash
cargo test -p plugin-e2e-harness --test e2e_calc --test e2e_http --test e2e_crud --test e2e_quote --test e2e_rust_caller
```
