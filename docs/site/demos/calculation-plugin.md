# Calculation Plugin

The calculation demo is the simplest complete example.

Source: `examples/calculation-plugin/src/index.ts`

## What It Demonstrates

- required `Init`
- typed request and response handling
- authoring through `definePlugin(...)`
- minimal business logic

## Key Behavior

The `add` RPC returns the sum of two integers through a typed success envelope.

## Test Command

```bash
cargo test -p plugin-e2e-harness --test e2e_calc -- --nocapture
```

## Why It Matters

This is the best demo to start with when you want to understand the bare-minimum authoring model before adding state, HTTP, or recovery logic.
