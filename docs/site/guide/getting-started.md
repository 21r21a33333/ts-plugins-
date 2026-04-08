# Getting Started

This guide brings up the workspace, verifies the toolchain, and shows the fastest path from clone to working plugin.

## Prerequisites

- Node.js 22+
- `pnpm`
- Rust toolchain
- `buf`
- Redis only if you want to exercise the durable KV path used by the CRUD demo

## Install The Workspace

From the repository root:

```bash
pnpm install
cargo test --no-run
pnpm exec buf lint
```

## Verify The Entire Workspace

```bash
pnpm -r build
pnpm -r test
cargo test
```

This runs:

- package builds for codegen, runtime, CLI, templates, and demos
- Vitest suites for TypeScript packages
- Rust unit and end-to-end process-boundary tests

## Scaffold A New Plugin

```bash
pnpm --filter @balance/pluginctl exec pluginctl init ./tmp/weather-plugin \
  --id weather-plugin \
  --package balance.plugins.weather.v1 \
  --service WeatherPluginService
```

The scaffold includes:

- `plugin.json`
- `buf.yaml`
- `buf.gen.yaml`
- `proto/.../*.proto`
- `src/index.ts`
- `test/plugin.test.ts`

## Generate, Build, And Test The Plugin

```bash
cd ./tmp/weather-plugin
pnpm install
pnpm exec pluginctl generate .
pnpm exec pluginctl build .
pnpm exec pluginctl test .
pnpm exec pluginctl inspect ./plugin.json
```

## What Happens During Generate

`pluginctl generate` drives the contract workflow:

1. runs Buf generation
2. produces the descriptor set
3. generates TypeScript message types
4. generates typed handler interfaces and method metadata from the descriptor set

## What Happens During Build

`pluginctl build` compiles the plugin and validates:

- the compiled entrypoint matches `plugin.json`
- the descriptor set exists
- the declared service exists in the contract
- source maps and packaged contract metadata line up

## Next Steps

- [Authoring A Plugin](/guide/authoring-a-plugin)
- [System Overview](/architecture/system-overview)
- [CLI Reference](/reference/cli)
