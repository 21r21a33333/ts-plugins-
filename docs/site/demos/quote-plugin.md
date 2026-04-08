# Quote Plugin

The quote plugin is the smallest live process-boundary demo used by both the host harness and the standalone Rust caller example.

Source: `examples/quote-plugin/src/index.ts`

## What It Demonstrates

- real plugin process startup
- required `Init`
- deterministic typed response handling
- host-to-plugin RPC over the real local socket transport

## Test Command

```bash
cargo test -p plugin-e2e-harness --test e2e_quote -- --nocapture
```

## Why It Matters

This is the easiest demo to inspect when you want a full real-runtime flow without adding extra concerns like HTTP or storage.
