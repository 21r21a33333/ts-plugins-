# Testing Strategy

Testing is a first-class part of the platform, not an optional add-on.

## Three Layers

### Unit Helpers

Use the testkit to call handler logic with a realistic context object.

### In-Process Harness

Spin up the runtime logic inside Node tests for fast feedback on:

- handler resolution
- `Init` behavior
- decode/encode flow
- framework error handling

### Full End-To-End Harness

Use the Rust E2E harness to validate:

- real process boundaries
- socket transport
- runtime startup
- request/response flow
- restart behavior

## Workspace Commands

```bash
pnpm -r test
cargo test
```

## Demo E2E Commands

```bash
cargo test -p plugin-e2e-harness --test e2e_calc -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_http -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_crud -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_quote -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_rust_caller -- --nocapture
```

## What The Demos Prove

- calculation: typed arithmetic RPC
- HTTP: outbound network call with typed response shaping
- CRUD: SQLite + cache + Redis-backed restart recovery
- quote: minimal live plugin invocation
- Rust caller: standalone host client talking to a live runtime
