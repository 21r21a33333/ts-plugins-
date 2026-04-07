# Plugin Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 Rust-host / TypeScript-plugin platform defined in the approved design spec, with contract-first Protobuf interfaces, warm out-of-process plugin runtimes, manifest-driven lifecycle, Redis-backed KV, strong testing, and an opinionated CLI.

**Architecture:** The implementation is a monorepo with a Rust workspace for the host/control plane and a pnpm workspace for the Node runtime, codegen, CLI, and testkit packages. Contracts are authored in Protobuf, compiled with Buf plus battle-tested Rust/TS protobuf generators, and wrapped with a small amount of custom codegen for method IDs, typed result helpers, handler interfaces, and host clients. Runtime behavior combines VS Code-style manifest activation and lifecycle bookkeeping with OpenZeppelin-style warm pool execution, Redis KV, health management, and performance-sensitive local IPC.

**Tech Stack:** Rust (`tokio`, `tokio-util`, `prost`, `serde`, `tracing`, `opentelemetry`, `redis`), Node/TypeScript (`pnpm`, `@bufbuild/protoc-gen-es`, `@bufbuild/protobuf`, `Piscina`, `ioredis`, `pacote`, `zod`, `commander` or `cac`, `vitest`, OpenTelemetry JS), Buf, Unix domain sockets / Windows named pipes, binary Protobuf framing.

---

## File Structure

Before implementing tasks, create and preserve this repository structure:

- Root:
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/Cargo.toml`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/package.json`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/pnpm-workspace.yaml`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/buf.yaml`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/buf.gen.yaml`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/.gitignore`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/contracts/`

- Rust workspace:
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-protocol/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-kv/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-observability/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-e2e-harness/`

- TypeScript workspace:
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-testkit/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-templates/`

- Examples:
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/quote-plugin/`
  - Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/rust-caller/`

Why this split:

- Rust owns host/runtime supervision concerns.
- TS owns author ergonomics, runtime bootstrap, codegen helpers, and CLI.
- Contracts and examples stay visible at the root.

Reference context:

- OpenZeppelin component decomposition in `plugins/ARCHITECTURE.md`
- VS Code ext host split in `src/vs/workbench/api/common/extHostExtensionService.ts`

---

## Chunk 1: Workspace, Contracts, and Code Generation

### Phase 1: Repository Foundations

#### Slice 1.1: Bootstrap the dual-workspace monorepo

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/Cargo.toml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/package.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/pnpm-workspace.yaml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/.gitignore`

- [ ] **Step 1: Create the Rust workspace manifest**

Define workspace members:

```toml
[workspace]
members = [
  "crates/plugin-host",
  "crates/plugin-protocol",
  "crates/plugin-kv",
  "crates/plugin-observability",
  "crates/plugin-e2e-harness"
]
resolver = "2"
```

- [ ] **Step 2: Create the pnpm workspace manifest**

```yaml
packages:
  - "packages/*"
  - "examples/*"
```

- [ ] **Step 3: Create the root Node package**

Include shared dev dependencies and scripts:

```json
{
  "name": "ts-plugins-workspace",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "generate": "pnpm --filter @balance/pluginctl run generate:workspace"
  }
}
```

- [ ] **Step 4: Add `.gitignore` entries for build outputs**

Include:

```gitignore
node_modules/
dist/
target/
.turbo/
.superpowers/
.pnpm-store/
```

- [ ] **Step 5: Verify both workspaces are discoverable**

Run: `cargo metadata --no-deps`
Expected: JSON output listing the Rust workspace

Run: `pnpm -r list --depth 0`
Expected: workspace package list without resolution errors

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml package.json pnpm-workspace.yaml .gitignore
git commit -m "chore: bootstrap rust and pnpm workspaces"
```

#### Slice 1.2: Add shared contract workspace and Buf configuration

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/buf.yaml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/buf.gen.yaml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/contracts/quote_plugin/v1/quote_plugin.proto`

- [ ] **Step 1: Create `buf.yaml`**

Use Buf modules as the contract entrypoint:

```yaml
version: v2
modules:
  - path: contracts
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

- [ ] **Step 2: Create `buf.gen.yaml`**

Use battle-tested generators instead of custom protobuf runtimes:

```yaml
version: v2
plugins:
  - remote: buf.build/bufbuild/es
    out: gen/ts
    opt:
      - target=ts
  - local: protoc-gen-prost
    out: gen/rust
```

Note:
- TS generation should use `@bufbuild/protoc-gen-es`
- Rust message generation should use `prost` through a compatible protoc plugin
- service-client and handler-interface wrappers will be added by our own codegen layer later

- [ ] **Step 3: Add the example quote contract**

Create the example `QuotePlugin` service with:
- `InitRequest`
- `InitResult`
- `GetPriceRequest`
- `GetPriceResult`
- `PluginError`

- [ ] **Step 4: Verify Buf lint passes**

Run: `buf lint`
Expected: success

- [ ] **Step 5: Verify descriptor generation can run**

Run: `buf generate`
Expected: generated `gen/ts` and `gen/rust` directories without schema errors

- [ ] **Step 6: Commit**

```bash
git add buf.yaml buf.gen.yaml contracts/
git commit -m "feat: add protobuf contract workspace"
```

#### Slice 1.3: Establish code reference notes from OpenZeppelin and VS Code

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/docs/references/runtime-borrowed-patterns.md`

- [ ] **Step 1: Create a short internal reference memo**

Capture the exact source files we are borrowing from:

- OpenZeppelin:
  - `plugins/ARCHITECTURE.md`
  - `plugins/lib/worker-pool.ts`
  - `plugins/lib/plugin.ts`
  - `plugins/lib/kv.ts`
  - `plugins/tests/lib/pool-server.test.ts`
  - `plugins/tests/lib/kv.test.ts`
- VS Code:
  - `src/vs/workbench/api/common/extHostExtensionService.ts`
  - `src/vs/workbench/api/common/extHostExtensionActivator.ts`
  - `src/vs/workbench/api/node/extHostExtensionService.ts`

- [ ] **Step 2: Summarize what to borrow and what to avoid**

Must include:
- borrow activation bookkeeping from VS Code
- borrow queue/pool/KV patterns from OpenZeppelin
- do not copy JSON-line transport
- do not copy editor-specific APIs

- [ ] **Step 3: Commit**

```bash
git add docs/references/runtime-borrowed-patterns.md
git commit -m "docs: capture borrowed runtime patterns"
```

### Phase 2: First-Class Code Generation

#### Slice 2.1: Create the TypeScript codegen package

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/package.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/tsconfig.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/src/index.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/src/method-ids.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/src/descriptor-loader.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/src/generate-ts-handlers.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-codegen/src/generate-rust-clients.ts`

- [ ] **Step 1: Scaffold the package with battle-tested dependencies**

Use:
- `@bufbuild/protobuf`
- `commander` or `cac`
- `typescript`
- `zod`

- [ ] **Step 2: Implement descriptor loading**

Load the packaged descriptor set and derive:
- service name
- methods
- input/output types

- [ ] **Step 3: Implement deterministic numeric method-ID generation**

Use a stable 32-bit hash on canonical names:

```ts
const canonical = `${pkg}.${service}/${method}`;
```

Fail generation on collision.

- [ ] **Step 4: Generate TS handler interfaces and metadata**

Emit files with shapes like:

```ts
export interface QuotePluginHandlers {
  init(req: InitRequest, ctx: PluginContext): Promise<InitResult>;
  getPrice(req: GetPriceRequest, ctx: PluginContext): Promise<GetPriceResult>;
}
```

- [ ] **Step 5: Generate Rust client wrapper source**

Do not write a protobuf generator from scratch.

Generate only the transport-specific thin layer on top of `prost`-generated messages:
- method ID constants
- typed host client wrapper
- dynamic metadata helpers

- [ ] **Step 6: Add unit tests for method ID stability and collision detection**

Test:
- same contract yields same IDs across repeated generation
- collisions fail generation
- missing `Init` fails generation
- multiple services fail generation

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @balance/plugin-codegen test`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/plugin-codegen
git commit -m "feat: add descriptor-based codegen package"
```

#### Slice 2.2: Add generated asset conventions to the example plugin

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/quote-plugin/gen/README.md`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/quote-plugin/plugin.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/quote-plugin/src/index.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/quote-plugin/package.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/quote-plugin/tsconfig.json`

- [ ] **Step 1: Scaffold the example plugin package**

The example must mirror the final authoring experience.

- [ ] **Step 2: Add a minimal `definePlugin`-compatible implementation stub**

Use the generated handler types from the codegen package.

- [ ] **Step 3: Add example `plugin.json` with `serial` concurrency**

Validate:
- `main`
- descriptor set path
- service name
- activation mode
- timeout values

- [ ] **Step 4: Verify generation plus TS compile works for the example**

Run: `pnpm --filter quote-plugin build`
Expected: `dist/index.js` produced without type errors

- [ ] **Step 5: Commit**

```bash
git add examples/quote-plugin
git commit -m "feat: scaffold example quote plugin"
```

---

## Chunk 2: Packaging, Manifest, and CLI Workflow

### Phase 3: Manifest and Package Validation

#### Slice 3.1: Build the manifest validation library

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/manifest-schema.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/validate-manifest.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/test/manifest.test.ts`

- [ ] **Step 1: Define the `plugin.json` schema using a mature validator**

Use `zod` rather than custom validation logic.

- [ ] **Step 2: Validate compatibility against generated descriptor metadata**

Checks:
- service name matches descriptor
- one service only
- `Init` method exists
- concurrency mode is valid
- timeout values are valid
- `main` exists

- [ ] **Step 3: Add tests**

Test:
- missing descriptor fails
- wrong service name fails
- invalid concurrency fails
- missing `Init` fails
- invalid `main` path fails

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @balance/pluginctl test -- manifest`
Expected: all cases pass

- [ ] **Step 5: Commit**

```bash
git add packages/pluginctl/src/manifest-schema.ts packages/pluginctl/src/validate-manifest.ts packages/pluginctl/test/manifest.test.ts
git commit -m "feat: add plugin manifest validation"
```

#### Slice 3.2: Implement packaging and immutable artifact layout

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/pack.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/install.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/integrity.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/test/pack-install.test.ts`

- [ ] **Step 1: Use `pacote` for npm and tarball resolution**

Do not write a custom npm resolver.

- [ ] **Step 2: Implement immutable installed cache layout**

Target:

```text
$PLUGIN_HOME/registry/plugins/<id>/<version>/
```

- [ ] **Step 3: Write integrity metadata**

Record:
- resolved source
- package hash or integrity
- install timestamp
- descriptor digest
- method ID digest

- [ ] **Step 4: Validate the package contents before final install**

Checks:
- manifest present
- descriptor set present
- compiled entrypoint present
- service metadata consistent

- [ ] **Step 5: Add tests for local folder, tarball, and npm install**

Test:
- install produces immutable cache path
- integrity mismatch fails install
- missing descriptor fails install

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @balance/pluginctl test -- pack-install`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/pluginctl/src/pack.ts packages/pluginctl/src/install.ts packages/pluginctl/src/integrity.ts packages/pluginctl/test/pack-install.test.ts
git commit -m "feat: add packaging and install pipeline"
```

### Phase 4: Opinionated CLI

#### Slice 4.1: Scaffold `pluginctl`

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/package.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/tsconfig.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/index.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/commands/init.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/commands/generate.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/commands/build.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/commands/test.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/commands/pack.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/commands/install.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/pluginctl/src/commands/inspect.ts`

- [ ] **Step 1: Create the CLI shell**

Use `commander` or `cac`; do not hand-roll argument parsing.

- [ ] **Step 2: Implement `init`**

Scaffold:
- `.proto`
- `plugin.json`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- unit test stub

- [ ] **Step 3: Implement `generate`**

Orchestrate:
- `buf generate`
- descriptor output
- custom codegen package

- [ ] **Step 4: Implement `build`**

Orchestrate:
- TS compile
- source map generation
- manifest validation
- descriptor consistency checks

- [ ] **Step 5: Implement `test`, `pack`, `install`, `inspect`**

Each command must wrap the underlying validated subsystem rather than duplicating logic.

- [ ] **Step 6: Add CLI integration tests**

Test:
- `init` scaffolds expected files
- `generate` fails on invalid contracts
- `build` fails on manifest mismatch
- `inspect` prints method IDs and service metadata

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @balance/pluginctl test`
Expected: CLI integration tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/pluginctl
git commit -m "feat: add opinionated pluginctl cli"
```

Reference context:

- OpenZeppelin `plugins/README.md` for author ergonomics
- VS Code manifest/activation discipline from `extHostExtensionService` and docs

---

## Chunk 3: Rust Host and Protocol Runtime

### Phase 5: Framed Protobuf Protocol and Host API

#### Slice 5.1: Implement the protocol crate

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-protocol/Cargo.toml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-protocol/src/lib.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-protocol/src/framing.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-protocol/src/envelope.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-protocol/src/control.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-protocol/tests/framing.rs`

- [ ] **Step 1: Define the internal runtime envelope**

Include:
- protocol version
- request ID
- method ID
- payload bytes
- control-plane message variant
- framework error variant
- trace context fields

- [ ] **Step 2: Use `tokio_util::codec::LengthDelimitedCodec`**

Do not write manual socket read loops when the codec exists.

- [ ] **Step 3: Implement encode/decode helpers on top of `prost`**

- [ ] **Step 4: Add framing tests**

Test:
- valid round trip
- invalid length / truncated frame
- invalid protocol version
- control-plane versus RPC message separation

- [ ] **Step 5: Run tests**

Run: `cargo test -p plugin-protocol`
Expected: protocol tests pass

- [ ] **Step 6: Commit**

```bash
git add crates/plugin-protocol
git commit -m "feat: add framed protobuf protocol crate"
```

#### Slice 5.2: Implement the Rust typed host client surface

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/client.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/dynamic.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/tests/client.rs`

- [ ] **Step 1: Add a generic `PluginHost` client entrypoint**

Expose both:
- typed generated clients
- dynamic invocation for debugging/tooling

- [ ] **Step 2: Integrate the generated method IDs and message wrappers**

The generated Rust layer from `plugin-codegen` should be imported here rather than duplicated.

- [ ] **Step 3: Add tests with the example quote service**

Test:
- typed call serializes expected method ID
- dynamic call path can invoke by canonical name
- typed domain error returns cleanly

- [ ] **Step 4: Run tests**

Run: `cargo test -p plugin-host client`
Expected: client tests pass

- [ ] **Step 5: Commit**

```bash
git add crates/plugin-host/src/client.rs crates/plugin-host/src/dynamic.rs crates/plugin-host/tests/client.rs
git commit -m "feat: add rust host client surface"
```

### Phase 6: Runtime Supervision, Activation, and Health

#### Slice 6.1: Implement the plugin registry and activation manager

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/Cargo.toml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/lib.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/registry.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/activation.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/runtime_handle.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/tests/activation.rs`

- [ ] **Step 1: Implement registry data structures**

Track:
- manifest
- installed path
- descriptor metadata
- activation mode
- health status
- circuit breaker state
- runtime handle if active

- [ ] **Step 2: Implement lazy activation**

Borrow conceptually from:
- VS Code `ExtensionsActivator.activateByEvent`
- `AbstractExtHostExtensionService.initialize`

But adapt to plugin RPC:
- on first method call, start runtime
- establish handshake
- call `Init`
- mark ready only on `InitResult.ok`

- [ ] **Step 3: Add startup activation support**

Manifest-driven; no ad hoc boot wiring.

- [ ] **Step 4: Add activation tests**

Test:
- first call triggers activation
- startup plugin activates on host boot
- failed `Init` keeps plugin unhealthy
- subsequent activation retries respect backoff

- [ ] **Step 5: Run tests**

Run: `cargo test -p plugin-host activation`
Expected: activation tests pass

- [ ] **Step 6: Commit**

```bash
git add crates/plugin-host/src/registry.rs crates/plugin-host/src/activation.rs crates/plugin-host/src/runtime_handle.rs crates/plugin-host/tests/activation.rs
git commit -m "feat: add registry and activation manager"
```

#### Slice 6.2: Implement runtime supervision and circuit breaker

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/supervisor.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/circuit_breaker.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/health.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/tests/supervisor.rs`

- [ ] **Step 1: Implement Node runtime process spawning**

Use `tokio::process::Command`.

- [ ] **Step 2: Implement readiness handshake and control-plane probes**

Support:
- handshake
- ping/pong
- graceful shutdown
- process liveness tracking

- [ ] **Step 3: Implement circuit breaker states**

Mirror the OpenZeppelin pattern conceptually:
- closed
- open
- half-open

- [ ] **Step 4: Add crash and timeout recovery**

Behavior:
- fail in-flight requests
- restart runtime
- require `Init` again

- [ ] **Step 5: Add supervision tests**

Test:
- runtime crash triggers restart
- repeated failures open breaker
- half-open probes allow recovery
- timeout contributes to breaker metrics

- [ ] **Step 6: Run tests**

Run: `cargo test -p plugin-host supervisor`
Expected: supervisor and circuit breaker tests pass

- [ ] **Step 7: Commit**

```bash
git add crates/plugin-host/src/supervisor.rs crates/plugin-host/src/circuit_breaker.rs crates/plugin-host/src/health.rs crates/plugin-host/tests/supervisor.rs
git commit -m "feat: add runtime supervision and circuit breaker"
```

#### Slice 6.3: Implement host-managed KV backend selection and injection

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-kv/Cargo.toml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-kv/src/lib.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-kv/src/config.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-kv/src/memory.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-kv/src/redis.rs`
- Modify: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/activation.rs`
- Modify: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/src/supervisor.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/tests/kv_config.rs`

- [ ] **Step 1: Implement the Rust-side backend configuration model**

Support:
- memory backend
- Redis backend
- plugin namespace policy
- runtime injection payload

- [ ] **Step 2: Implement backend-specific config rendering for the Node runtime**

The host owns backend choice and configuration, but the runtime may connect directly to Redis using host-provided config.

- [ ] **Step 3: Add safe defaults**

Defaults:
- tests and local harnesses can use memory
- production paths prefer Redis

- [ ] **Step 4: Add tests**

Test:
- memory backend config serializes correctly
- Redis backend config serializes correctly
- namespace policy is deterministic
- activation injects the expected KV config into runtime bootstrap

- [ ] **Step 5: Run tests**

Run: `cargo test -p plugin-kv && cargo test -p plugin-host kv_config`
Expected: KV config tests pass

- [ ] **Step 6: Commit**

```bash
git add crates/plugin-kv crates/plugin-host/src/activation.rs crates/plugin-host/src/supervisor.rs crates/plugin-host/tests/kv_config.rs
git commit -m "feat: add host-managed kv backend configuration"
```

Reference context:

- OpenZeppelin `plugins/ARCHITECTURE.md`
- OpenZeppelin `plugins/tests/lib/pool-server.test.ts`
- VS Code activation barriers in `extHostExtensionService.ts`

---

## Chunk 4: Node Runtime, Worker Pool, and KV

### Phase 7: Author Runtime and Dispatch Layer

#### Slice 7.1: Build `definePlugin` and bootstrap

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/package.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/tsconfig.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/index.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/define-plugin.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/bootstrap.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/dispatcher.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/context.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/test/bootstrap.test.ts`

- [ ] **Step 1: Implement `definePlugin`**

It should be a thin typed wrapper, not a framework-heavy DSL.

- [ ] **Step 2: Implement bootstrap**

Bootstrap responsibilities:
- load manifest
- load descriptor metadata
- load compiled entrypoint
- validate exported handlers
- start runtime plumbing
- wait for `Init`

- [ ] **Step 3: Implement numeric-ID dispatch**

Use the generated dispatch table; do not dispatch by hand-written strings.

- [ ] **Step 4: Implement request-scoped `PluginContext` creation**

Context must include:
- logger
- tracer
- kv
- config snapshot
- plugin metadata
- request metadata

- [ ] **Step 5: Add bootstrap tests**

Test:
- runtime rejects missing handler
- runtime rejects extra/mismatched service implementation
- runtime does not serve business calls before `Init`

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @balance/plugin-runtime test -- bootstrap`
Expected: bootstrap tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-runtime
git commit -m "feat: add plugin author runtime bootstrap"
```

#### Slice 7.2: Normalize handler error behavior

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/errors.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/test/errors.test.ts`

- [ ] **Step 1: Implement framework error classification**

Rules:
- returned typed `error` stays domain-level
- thrown exception becomes framework/plugin-execution failure
- timeout stays framework failure
- decode failure stays framework failure

- [ ] **Step 2: Emit structured logs and traces for thrown exceptions**

- [ ] **Step 3: Add tests**

Test:
- typed business error passes through unchanged
- thrown exception is not converted into typed result envelope

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @balance/plugin-runtime test -- errors`
Expected: error-classification tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/errors.ts packages/plugin-runtime/test/errors.test.ts
git commit -m "feat: add plugin runtime error normalization"
```

### Phase 8: Worker Pool and Concurrency

#### Slice 8.1: Implement the internal worker pool

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/worker-pool.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/worker-entry.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/test/worker-pool.test.ts`

- [ ] **Step 1: Use `Piscina` rather than a custom worker-pool**

This is a direct application of the “do not reinvent the wheel” requirement.

- [ ] **Step 2: Implement concurrency-mode routing**

Semantics:
- `serial`: one lane
- `parallel-safe`: use pool
- `max_concurrency=N`: bounded pool usage

- [ ] **Step 3: Add pool sizing knobs with safe defaults**

Borrow patterns from OpenZeppelin `worker-pool.ts`:
- min threads
- max threads
- idle timeout
- per-task timeout buffer

- [ ] **Step 4: Add tests**

Test:
- serial plugin never overlaps requests
- parallel-safe plugin can overlap
- max concurrency enforces the cap

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @balance/plugin-runtime test -- worker-pool`
Expected: worker-pool tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-runtime/src/worker-pool.ts packages/plugin-runtime/src/worker-entry.ts packages/plugin-runtime/test/worker-pool.test.ts
git commit -m "feat: add piscina-backed worker pool"
```

#### Slice 8.2: Add warm-cache and memory-pressure behavior

**Files:**
- Modify: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/worker-pool.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/cache.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/test/cache.test.ts`

- [ ] **Step 1: Add warm code/config cache support**

Borrow idea from OpenZeppelin `CompiledCodeCache`:
- bounded caches
- time-based eviction
- memory-pressure-aware eviction

- [ ] **Step 2: Add memory-pressure thresholds**

Use thresholds conceptually similar to OpenZeppelin tests, but tuned for our runtime.

- [ ] **Step 3: Add tests**

Test:
- cache evicts by age
- cache evicts under memory pressure
- runtime refuses overload under emergency threshold

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @balance/plugin-runtime test -- cache`
Expected: cache tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-runtime/src/cache.ts packages/plugin-runtime/test/cache.test.ts packages/plugin-runtime/src/worker-pool.ts
git commit -m "feat: add cache and memory pressure handling"
```

### Phase 9: Redis-Backed KV

#### Slice 9.1: Implement Node KV with OpenZeppelin-style semantics

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/kv.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/test/kv.test.ts`

- [ ] **Step 1: Use `ioredis`**

Reuse the same class of client OpenZeppelin uses.

- [ ] **Step 2: Implement the exact v1 KV surface**

Include:
- `get`
- `set`
- `del`
- `exists`
- `listKeys`
- `clear`
- `withLock`

- [ ] **Step 3: Add namespacing and key validation**

Borrow directly from OpenZeppelin `plugins/lib/kv.ts`:
- namespaced keys
- regex validation
- lock key separation

- [ ] **Step 4: Add in-memory fallback backend for tests/dev**

- [ ] **Step 5: Add tests modeled after OpenZeppelin’s KV tests**

Test:
- JSON values
- TTL
- namespace isolation
- invalid key rejection
- lock busy behavior
- lock release on throw

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @balance/plugin-runtime test -- kv`
Expected: KV tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-runtime/src/kv.ts packages/plugin-runtime/test/kv.test.ts
git commit -m "feat: add redis-backed plugin kv"
```

Reference context:

- OpenZeppelin `plugins/lib/kv.ts`
- OpenZeppelin `plugins/tests/lib/kv.test.ts`

---

## Chunk 5: Observability, Test Harnesses, and End-to-End Delivery

### Phase 10: Logs, Metrics, and Tracing

#### Slice 10.1: Add Rust and Node observability packages

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-observability/Cargo.toml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-observability/src/lib.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-observability/src/logs.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-observability/src/metrics.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-observability/src/tracing.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/logger.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/src/tracing.ts`

- [ ] **Step 1: Implement Rust-side tracing propagation**

Use:
- `tracing`
- `tracing-opentelemetry`
- `opentelemetry`

- [ ] **Step 2: Implement Node-side trace extraction and child spans**

Use OpenTelemetry JS packages rather than custom tracing abstractions.

- [ ] **Step 3: Add structured logger adapters**

Every request should tag:
- request ID
- trace ID
- plugin ID
- runtime instance ID

- [ ] **Step 4: Add metrics**

Track:
- requests
- typed errors
- framework failures
- latency
- queue depth
- restarts
- breaker transitions

- [ ] **Step 5: Add tests**

Test:
- trace context passes host to runtime
- logs contain request metadata
- metrics increment on success and failure

- [ ] **Step 6: Run tests**

Run: `cargo test -p plugin-observability`
Expected: Rust observability tests pass

Run: `pnpm --filter @balance/plugin-runtime test -- observability`
Expected: Node observability tests pass

- [ ] **Step 7: Commit**

```bash
git add crates/plugin-observability packages/plugin-runtime/src/logger.ts packages/plugin-runtime/src/tracing.ts
git commit -m "feat: add logs metrics and tracing"
```

### Phase 11: Test Harnesses

#### Slice 11.1: Implement the TS unit and in-process harness

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-testkit/package.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-testkit/tsconfig.json`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-testkit/src/index.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-testkit/src/create-test-context.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-testkit/src/in-process-harness.ts`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-testkit/test/harness.test.ts`

- [ ] **Step 1: Implement `createTestContext`**

Provide:
- in-memory KV
- fake logger
- fake tracer
- request metadata

- [ ] **Step 2: Implement in-process harness**

This should exercise:
- generated dispatch
- request decode/encode
- `Init`
- error classification

- [ ] **Step 3: Add tests against the example plugin**

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @balance/plugin-testkit test`
Expected: harness tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-testkit
git commit -m "feat: add unit and in-process plugin harness"
```

#### Slice 11.2: Implement the Rust-host E2E harness

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-e2e-harness/Cargo.toml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-e2e-harness/src/lib.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-e2e-harness/tests/e2e_quote.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/rust-caller/Cargo.toml`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/examples/rust-caller/src/main.rs`

- [ ] **Step 1: Implement a harness that installs and runs the example plugin**

The harness must exercise the real process boundary.

- [ ] **Step 2: Add E2E cases**

Test:
- install example package
- activate lazily
- successful `Init`
- successful quote request
- typed domain error
- runtime restart
- Redis-backed state survival

- [ ] **Step 3: Run tests**

Run: `cargo test -p plugin-e2e-harness -- --nocapture`
Expected: end-to-end tests pass

- [ ] **Step 4: Commit**

```bash
git add crates/plugin-e2e-harness examples/rust-caller
git commit -m "feat: add rust host end-to-end harness"
```

Reference context:

- OpenZeppelin `plugins/tests/lib/pool-server.test.ts`
- OpenZeppelin `plugins/tests/lib/kv.test.ts`

### Phase 12: Release Quality, Docs, and Acceptance Gates

#### Slice 12.1: Add performance and correctness acceptance suite

**Files:**
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/docs/acceptance/performance-budget.md`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/crates/plugin-host/tests/perf_smoke.rs`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/packages/plugin-runtime/test/perf-smoke.test.ts`

- [ ] **Step 1: Define initial performance budgets**

At minimum include:
- warm-call latency budget
- activation latency budget
- queue behavior under load
- Redis KV latency smoke threshold

- [ ] **Step 2: Add warm-runtime smoke benchmarks**

The goal is regression detection, not perfect benchmarking.

- [ ] **Step 3: Run the full test matrix**

Run: `cargo test --workspace`
Expected: all Rust tests pass

Run: `pnpm -r test`
Expected: all Node tests pass

Run: `pnpm -r build && cargo check --workspace`
Expected: full workspace builds cleanly

- [ ] **Step 4: Commit**

```bash
git add docs/acceptance/performance-budget.md crates/plugin-host/tests/perf_smoke.rs packages/plugin-runtime/test/perf-smoke.test.ts
git commit -m "test: add acceptance and performance smoke suite"
```

#### Slice 12.2: Final docs and example polish

**Files:**
- Modify: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/docs/superpowers/specs/2026-04-07-plugin-infrastructure-design.md`
- Modify: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/docs/superpowers/specs/2026-04-07-plugin-infrastructure-deliverable.md`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/README.md`
- Create: `/Users/diwakarmatsaa/Desktop/balance/ts-plugins/docs/getting-started.md`

- [ ] **Step 1: Write the root README**

Must show:
- architecture summary
- install prerequisites
- `pluginctl init/generate/build/test/pack/install`
- Rust caller example

- [ ] **Step 2: Write getting-started docs using the example plugin**

- [ ] **Step 3: Verify docs match the actual commands**

Run every documented command at least once in a clean workspace.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/getting-started.md docs/superpowers/specs/2026-04-07-plugin-infrastructure-design.md docs/superpowers/specs/2026-04-07-plugin-infrastructure-deliverable.md
git commit -m "docs: finalize v1 developer documentation"
```

---

## Review Checklist By Phase

Each phase must be reviewed before proceeding:

- Phase 1 review:
  - workspace structure is stable
  - toolchains resolve cleanly
- Phase 2 review:
  - example contract generates consistent TS and Rust outputs
  - method IDs are deterministic
- Phase 3 review:
  - manifest and install semantics are unambiguous
  - immutable cache behavior is correct
- Phase 4 review:
  - CLI mirrors the intended author workflow exactly
- Phase 5 review:
  - protocol is stable and minimal
  - typed host client is ergonomic
- Phase 6 review:
  - activation and circuit-breaker behaviors match the design spec
- Phase 7 review:
  - `definePlugin` is ergonomic and low-ceremony
- Phase 8 review:
  - concurrency semantics are correct and test-covered
- Phase 9 review:
  - KV semantics match the deliverable ledger and OpenZeppelin patterns
- Phase 10 review:
  - logs, metrics, and tracing are end-to-end
- Phase 11 review:
  - the three testing layers are all present and useful
- Phase 12 review:
  - docs are executable and acceptance budgets are documented

## Deliverable Coverage Matrix

This plan covers the deliverable file as follows:

- Contract deliverables: Chunk 1, Phase 2; Chunk 3, Phase 5
- Manifest deliverables: Chunk 2, Phase 3
- Packaging deliverables: Chunk 2, Phase 3
- Rust host deliverables: Chunk 3, Phase 5 and Phase 6
- Node runtime deliverables: Chunk 4, Phase 7 and Phase 8
- KV deliverables: Chunk 4, Phase 9
- Observability deliverables: Chunk 5, Phase 10
- Testing deliverables: Chunk 5, Phase 11 and Phase 12
- CLI deliverables: Chunk 2, Phase 4
- Documentation deliverables: Chunk 5, Phase 12

## Execution Notes

- Prefer existing libraries over custom implementations unless the custom layer is thin and specific to this framework's unique transport semantics.
- Keep the custom code surface focused on:
  - descriptor-to-handler/client code generation
  - runtime protocol envelope
  - Rust host supervision
  - manifest/install integration
- Do not build custom replacements for Buf, Piscina, Redis clients, npm resolution, or standard framing codecs.
- Use the example quote plugin and Rust caller as the standing integration contract across the whole implementation.
- Do not add capability-prompt systems, permission gates, or notification/event infrastructure in v1; the approved v1 model is trusted plugins plus unary RPC only.

## Completion Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-07-plugin-infrastructure.md`. Ready to execute?
