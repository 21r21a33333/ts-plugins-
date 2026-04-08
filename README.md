# Balance TS Plugins

Contract-first plugin infrastructure with a Rust host and TypeScript plugin runtimes.

## What Ships In v1

- Protobuf + Buf contracts
- Rust host/control plane
- out-of-process Node plugin runtimes
- socket IPC with binary protobuf frames
- required `Init` RPC and typed result envelopes
- host-managed KV with in-memory and Redis backends
- tracing, logs, and metrics primitives
- `pluginctl` for scaffolding, generate, build, test, pack, install, and inspect
- end-to-end demos for calculation, HTTP, and CRUD/stateful plugins

## Repository Layout

- `contracts/`: protobuf contracts
- `crates/plugin-host`: Rust host-side transport and lifecycle code
- `crates/plugin-kv`: Rust KV config helpers
- `crates/plugin-observability`: Rust logs/metrics/tracing helpers
- `crates/plugin-e2e-harness`: real process-boundary tests
- `packages/plugin-runtime`: TS runtime bootstrap and socket server
- `packages/plugin-codegen`: descriptor-driven method/handler generation
- `packages/pluginctl`: opinionated CLI
- `packages/plugin-templates`: scaffold templates used by `pluginctl init`
- `examples/`: demo plugins and the Rust caller example

## Install

```bash
pnpm install
cargo test --no-run
pnpm exec buf lint
```

## Quickstart

Scaffold a new plugin project:

```bash
pnpm --filter @balance/pluginctl exec pluginctl init ./tmp/weather-plugin \
  --id weather-plugin \
  --package balance.plugins.weather.v1 \
  --service WeatherPluginService
```

Inside the generated project:

```bash
pnpm exec pluginctl generate .
pnpm exec pluginctl build .
pnpm exec pluginctl test .
pnpm exec pluginctl inspect ./plugin.json
```

The scaffold includes:

- `plugin.json`
- `buf.yaml`
- `buf.gen.yaml`
- `proto/.../*.proto`
- `src/index.ts`
- `test/plugin.test.ts`

## Packaging And Installation

Pack a compiled plugin:

```bash
pnpm --filter @balance/pluginctl exec pluginctl pack ./examples/quote-plugin --output ./artifacts
```

Install from a local folder:

```bash
pnpm --filter @balance/pluginctl exec pluginctl install \
  --kind folder \
  --plugin-home ./.plugin-home \
  ./examples/quote-plugin
```

Install from a tarball:

```bash
pnpm --filter @balance/pluginctl exec pluginctl install \
  --kind tarball \
  --plugin-home ./.plugin-home \
  ./artifacts/quote-plugin-0.1.0.tgz
```

Install from npm:

```bash
pnpm --filter @balance/pluginctl exec pluginctl install \
  --kind npm \
  --plugin-home ./.plugin-home \
  @balance/example-quote-plugin@0.1.0
```

## Build And Test

Workspace-wide verification:

```bash
pnpm -r build
pnpm -r test
cargo test
```

Documentation site:

```bash
pnpm run docs:dev
pnpm run docs:build
```

Targeted end-to-end checks:

```bash
cargo test -p plugin-e2e-harness --test e2e_quote -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_calc -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_http -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_crud -- --nocapture
cargo test -p plugin-e2e-harness --test e2e_rust_caller -- --nocapture
```

## Demo Plugins

- `examples/calculation-plugin`: typed arithmetic RPC
- `examples/http-plugin`: outbound HTTP call and typed response shaping
- `examples/crud-plugin`: SQLite + cache + Redis-backed state recovery
- `examples/quote-plugin`: minimal quote service used by the host examples
- `examples/rust-caller`: Rust binary that connects to a live plugin socket and performs typed RPC calls

Run the Rust caller example against a running quote plugin socket:

```bash
cargo run --manifest-path examples/rust-caller/Cargo.toml -- \
  --socket /tmp/quote-plugin.sock \
  --asset BTC \
  --amount 0.25 \
  --currency EUR
```

## Operations

Operational notes for Redis-backed KV, restart recovery, and tracing are in [docs/operations.md](./docs/operations.md).
Published-style developer docs live under [docs/site](./docs/site).
