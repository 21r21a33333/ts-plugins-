# HTTP Plugin

The HTTP demo shows a trusted plugin performing outbound network calls directly from the TypeScript runtime.

Source: `examples/http-plugin/src/index.ts`

## What It Demonstrates

- direct outbound HTTP calls from plugin code
- typed response shaping
- clean separation between plugin business logic and host transport/runtime logic

## Test Command

```bash
cargo test -p plugin-e2e-harness --test e2e_http -- --nocapture
```

## Why It Matters

This proves the v1 trust model:

- plugins can use normal runtime APIs and third-party packages
- the host still owns lifecycle, framing, scheduling, and observability
