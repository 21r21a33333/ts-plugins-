# Rust Caller

The Rust caller demo shows how an external Rust binary can connect to a live plugin runtime and perform typed calls.

Source: `examples/rust-caller/src/main.rs`

## What It Demonstrates

- live Unix socket connection from Rust
- dynamic method lookup by canonical RPC name
- typed request/response serialization
- consuming a running plugin as a real client, not only inside tests

## Example Command

```bash
cargo run --manifest-path examples/rust-caller/Cargo.toml -- \
  --socket /tmp/quote-plugin.sock \
  --asset BTC \
  --amount 0.25 \
  --currency EUR
```

## End-To-End Test

```bash
cargo test -p plugin-e2e-harness --test e2e_rust_caller -- --nocapture
```
