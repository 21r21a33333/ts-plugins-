# High-Performance Rust Host / TypeScript Plugin Infrastructure Design

> Status: Draft for review
> Date: 2026-04-07
> Scope: v1 open source plugin platform

## 1. Overview

This document specifies a contract-first, high-performance plugin infrastructure where:

- the host and caller are written in Rust
- plugins are authored in TypeScript
- plugins execute out-of-process
- the API contract is defined in Protobuf and generated with Buf
- v1 supports unary RPC only
- each plugin package implements exactly one Protobuf service
- each plugin package must expose a required `Init` RPC
- expected domain failures are modeled as typed Protobuf result envelopes
- plugin runtime behavior is described in a separate `plugin.json` manifest

The target is a best-in-class developer experience for plugin authors and host integrators while preserving strong type safety, high throughput, clear failure boundaries, durable state, and production-grade observability.

This architecture intentionally borrows the strongest ideas from:

- OpenZeppelin Relayer's plugin runtime architecture:
  - separate execution environment for plugin code
  - persistent warm runtime
  - queueing, restart, circuit breaker, timeout, and health handling
  - local socket-based transport
  - Redis-backed plugin KV store with namespacing and locking
  - internal worker pool for throughput
- Visual Studio Code's extension architecture:
  - separate extension host process for isolation
  - lazy activation via manifest metadata
  - strict separation between host control plane and extension runtime
  - manifest-first runtime metadata
  - explicit lifecycle and predictable loading behavior

The design does not copy either project verbatim. Instead it combines:

- VS Code-style lifecycle and manifest discipline
- OpenZeppelin-style runtime and performance mechanics
- a Protobuf-first typed RPC contract layer optimized for Rust-to-TS local plugin execution

## 2. Goals

### 2.1 Primary goals

1. Provide first-class type safety between Rust callers and TS plugin handlers.
2. Make plugin authoring feel like implementing typed handlers, not building a transport server.
3. Optimize for low overhead on the hot path.
4. Support persistent warm workers, lazy activation, and predictable restart behavior.
5. Provide a standard testing stack from unit tests to full end-to-end process tests.
6. Provide a standard package/distribution format for local folders, tarballs, and npm packages.
7. Provide first-class logs, metrics, and tracing.
8. Provide durable plugin state via host-managed KV.
9. Keep v1 small enough to ship while leaving clean extension points for v2.

### 2.2 Non-goals for v1

- Notifications or event handlers
- Streaming RPC
- Multiple services per plugin
- Hard security sandboxing against malicious plugins
- Signed plugins and trust-chain infrastructure
- Arbitrary host API surface beyond the explicit runtime context
- Cross-language plugin authorship beyond TypeScript

## 3. Borrowed Ideas and How They Are Applied

### 3.1 OpenZeppelin Relayer

Borrowed ideas:

- Separate plugin execution environment and host control plane
- Local socket communication between Rust and Node components
- Warm runtime plus internal worker pool for throughput
- Admission control, queueing, restart, and circuit breaker behavior
- Redis-backed plugin KV store
- Best-effort in-memory caches plus durable shared state in Redis

Relevant references:

- OpenZeppelin plugin architecture:
  - `plugins/ARCHITECTURE.md`
  - local Unix socket transport
  - `pool-server.ts`
  - Piscina-based worker pool
  - queue, connection pool, circuit breaker, memory pressure handling
- OpenZeppelin plugin author docs:
  - `plugins/README.md`
  - separate process execution
  - plugin KV API
  - timeout configuration
- OpenZeppelin KV implementation:
  - `plugins/lib/kv.ts`
  - per-plugin namespacing
  - Redis-backed persistence
  - distributed lock helper

Applied to this design:

- Keep the Rust side as the source of truth for supervision and scheduling.
- Use a persistent per-plugin Node runtime with an internal `worker_threads` pool.
- Use host-managed KV backed by Redis in production.
- Retain queueing, timeout, circuit breaker, and restart semantics.
- Replace OpenZeppelin's JSON-line hot path with binary Protobuf framing.

### 3.2 VS Code

Borrowed ideas:

- Separate host process for isolation and performance protection
- Lazy activation driven by manifest metadata
- Manifest-first runtime behavior declaration
- Strict separation between host internals and extension-facing API surface
- Explicit lifecycle with one-time activation and cleanup expectations

Relevant references:

- VS Code extension host docs:
  - separate extension host runtimes
  - stability and performance focus
  - lazy loading of extensions
- VS Code activation events:
  - manifest-driven activation rules
- VS Code "our approach" docs:
  - run extensions in their own host process
  - prevent direct DOM access
  - use protocol-based extension models for isolation

Applied to this design:

- Use `plugin.json` as the runtime/lifecycle manifest.
- Default to lazy activation.
- Keep plugins isolated from host internals.
- Expose a narrow and typed runtime context instead of arbitrary host internals.
- Treat process boundaries as a product feature, not an implementation detail.

## 4. Architectural Summary

The v1 system is composed of six major subsystems:

1. Contract system
   - Protobuf service and message definitions
   - Buf-based generation and compatibility checks
   - descriptor-set packaging and numeric method ID generation
2. Packaging system
   - `plugin.json`
   - built package layout
   - integrity metadata
   - local folder / tarball / npm installation
3. Rust host control plane
   - registry
   - install/load/activate
   - scheduling
   - health/recovery
   - transport server
   - KV, logs, metrics, tracing
4. Node plugin runtime
   - package loading
   - generated dispatcher bootstrap
   - internal worker pool
   - request execution
   - lifecycle callbacks
5. Developer tooling
   - opinionated CLI
   - code generation
   - build
   - test
   - pack/install/inspect
6. Test infrastructure
   - unit test helpers
   - in-process runtime harness
   - Rust-host plus real plugin runtime E2E harness

## 5. System Model

### 5.1 Trust model

Plugins are treated as trusted code in v1.

This means:

- plugins may use third-party npm libraries
- plugins may perform direct outbound network calls
- plugins may perform their own local I/O within the runtime environment
- the framework does not attempt to hard-sandbox untrusted code in v1

This does not mean:

- plugins may reach into arbitrary Rust host internals
- plugins may bypass the typed contract
- plugin lifecycle and execution are unmanaged

The host still owns:

- installation
- activation
- lifecycle
- process supervision
- timeout enforcement
- metrics and tracing
- host-managed KV
- contract validation

### 5.2 Isolation model

Each activated plugin runs in a dedicated warm Node runtime process.

Inside that runtime:

- a generated runtime bootstrap loads the compiled plugin entrypoint
- a dispatcher maps numeric method IDs to generated handler calls
- an internal `worker_threads` pool executes calls according to configured concurrency

This gives:

- stronger crash isolation than an embedded runtime
- better warm-path performance than process-per-call
- room for future stricter isolation modes without redesigning the host API

### 5.3 Concurrency model

Each plugin manifest must declare one of:

- `serial`
- `parallel-safe`
- `max_concurrency = N`

`serial` is the safe default in v1.

Semantics:

- `serial`: at most one request active per plugin instance at a time
- `parallel-safe`: host/runtime may execute multiple requests concurrently
- `max_concurrency = N`: bounded concurrency per plugin instance

This is intentionally more explicit than OpenZeppelin's operationally managed concurrency model.

## 6. Repository and Package Layout

This section defines the canonical plugin package layout.

```text
quote-plugin/
  plugin.json
  buf.yaml
  proto/
    quote_plugin.proto
  gen/
    ts/
      ...
  src/
    index.ts
  dist/
    index.js
    index.js.map
  descriptors/
    plugin.pb
  package.json
  README.md
```

At publish/install time, the host relies on the packaged descriptor set and manifest, not source parsing.

### 6.1 Installed cache layout

The host installs each resolved package into a deterministic cache location:

```text
$PLUGIN_HOME/
  registry/
    plugins/
      quote-plugin/
        1.0.0/
          manifest.json
          descriptors/
            plugin.pb
            method-ids.json
          dist/
            index.js
            index.js.map
          proto/
            quote_plugin.proto
          metadata/
            install.json
            integrity.json
```

Rules:

- installs are immutable
- runtime executes only from the installed cache
- upgrades create a new versioned directory
- activation resolves a concrete installed version, never a mutable source path

## 7. Contract Specification

### 7.1 Contract source of truth

The API contract source of truth is:

- `.proto` files for human-authored source
- generated descriptor set for runtime loading

At runtime, the descriptor set is authoritative.

The host does not need to re-parse `.proto` files during plugin load.

### 7.2 Service model

Rules:

- exactly one service per plugin package
- unary RPC only in v1
- `Init` RPC is required
- no notifications
- no streaming

Example:

```proto
syntax = "proto3";

package balance.plugins.quote.v1;

message InitRequest {
  string plugin_instance_id = 1;
  string environment = 2;
  map<string, string> config = 3;
}

message PluginError {
  string code = 1;
  string message = 2;
  map<string, string> details = 3;
}

message InitResponse {
  string plugin_name = 1;
  string plugin_version = 2;
}

message InitResult {
  oneof outcome {
    InitResponse ok = 1;
    PluginError error = 2;
  }
}

message GetPriceRequest {
  string asset = 1;
  string amount = 2;
}

message GetPriceResponse {
  string price = 1;
  string currency = 2;
  string expires_at = 3;
}

message GetPriceResult {
  oneof outcome {
    GetPriceResponse ok = 1;
    PluginError error = 2;
  }
}

service QuotePlugin {
  rpc Init(InitRequest) returns (InitResult);
  rpc GetPrice(GetPriceRequest) returns (GetPriceResult);
}
```

### 7.3 Typed result envelope

Every RPC returns a typed result envelope.

Rationale:

- domain failures remain part of the typed contract
- transport/runtime failures remain outside the business response
- Rust callers can clearly distinguish:
  - plugin returned a business error
  - host/runtime/transport failed

Host-side call result model:

- success:
  - transport succeeded
  - plugin returned `ok`
- domain failure:
  - transport succeeded
  - plugin returned `error`
- framework failure:
  - timeout
  - decode error
  - runtime crash
  - circuit breaker open
  - activation failure

Handler authors should return domain failures using the typed result envelope.

If a handler throws or rejects unexpectedly:

- the runtime must classify it as a framework/plugin-execution failure
- the failure must not be reinterpreted as a typed domain error
- logs and traces must capture the thrown error

This preserves a clean distinction between:

- expected business outcomes
- unexpected execution failures

### 7.4 Versioning

There are two separate version axes:

- Protobuf package version:
  - contract compatibility
  - example: `balance.plugins.quote.v1`
- manifest/plugin version:
  - implementation/package release
  - example: `1.3.2`

Buf compatibility checks govern contract evolution.

### 7.5 Method naming and numeric IDs

Developer-facing metadata uses human-readable fully-qualified method names, for example:

- `balance.plugins.quote.v1.QuotePlugin/Init`
- `balance.plugins.quote.v1.QuotePlugin/GetPrice`

Runtime wire protocol uses generated numeric method IDs.

Rationale:

- readable tooling and debugging
- compact wire format
- constant-time dispatch tables

Descriptor generation must emit:

- service metadata
- stable numeric method IDs
- handler mapping metadata for TS bootstrap

### 7.6 Method ID generation rules

Method IDs must be deterministic across builds for the same fully-qualified service and method name.

Recommended algorithm:

1. build canonical method name:
   - `<package>.<service>/<method>`
2. hash canonical name using a stable non-cryptographic 32-bit hash
3. reserve `0` as invalid
4. emit generated `method-ids.json` and generated Rust/TS constants

Collision handling:

- the generation step must detect collisions inside the package
- collisions fail generation
- generated outputs must include both the numeric ID and canonical name

Rationale:

- numeric IDs are fast on the wire
- generated metadata keeps debugging readable
- deterministic generation avoids a registry-assigned ID service

## 8. Manifest Specification

### 8.1 Purpose

`plugin.json` carries runtime metadata that should not live in the Protobuf contract.

This mirrors the discipline VS Code applies with `package.json` manifests.

### 8.2 Example manifest

```json
{
  "schemaVersion": 1,
  "id": "quote-plugin",
  "version": "1.0.0",
  "displayName": "Quote Plugin",
  "description": "Returns asset quotes.",
  "main": "./dist/index.js",
  "sourceMap": "./dist/index.js.map",
  "contract": {
    "descriptorSet": "./descriptors/plugin.pb",
    "service": "balance.plugins.quote.v1.QuotePlugin",
    "protoSources": ["./proto/quote_plugin.proto"]
  },
  "runtime": {
    "language": "node",
    "activation": {
      "mode": "lazy"
    },
    "concurrency": {
      "mode": "serial"
    },
    "initTimeoutMs": 5000,
    "requestTimeoutMs": 10000,
    "idleEvictionMs": 300000
  },
  "observability": {
    "emitLogs": true,
    "emitTraces": true,
    "emitMetrics": true
  },
  "integrity": {
    "packageSha256": "..."
  }
}
```

### 8.3 Manifest fields

Required:

- `schemaVersion`
- `id`
- `version`
- `main`
- `contract.descriptorSet`
- `contract.service`
- `runtime.activation.mode`
- `runtime.concurrency.mode`
- `runtime.initTimeoutMs`
- `runtime.requestTimeoutMs`

Optional:

- `displayName`
- `description`
- `sourceMap`
- `contract.protoSources`
- `runtime.idleEvictionMs`
- `observability.*`
- `integrity.*`

### 8.4 Activation semantics

Borrowed from VS Code:

- activation behavior is manifest-driven
- default should avoid loading unused code

v1 activation modes:

- `lazy` default
- `startup` opt-in

Semantics:

- `lazy`: runtime starts when the first RPC is invoked
- `startup`: runtime starts during host boot or plugin preload stage

### 8.5 Concurrency semantics

Allowed values:

- `{ "mode": "serial" }`
- `{ "mode": "parallel-safe" }`
- `{ "mode": "max", "value": N }`

Host and Node runtime must interpret this consistently.

### 8.6 Compatibility validation

`pluginctl build` and host installation must validate:

- manifest service name matches descriptor service
- `main` exists in the built artifact
- generated method IDs match packaged descriptor metadata
- concurrency mode is valid
- timeout values are sane and non-zero
- package version and service version metadata are present

## 9. Package and Distribution Specification

### 9.1 Supported distribution inputs

v1 host installation supports:

- local folder
- packaged tarball
- npm package

### 9.2 Installed artifact model

The host resolves the source package once, validates it, then installs it into a managed plugin cache directory as an immutable installed artifact.

Installed artifact contains:

- `plugin.json`
- compiled `dist/`
- descriptor set
- Protobuf source files for debugging/reference
- generated assets as needed
- integrity metadata

### 9.3 Integrity model

v1 integrity support is basic but mandatory:

- lockfile and hash verification for tarball/npm installs
- runtime uses installed artifact contents only after integrity validation succeeds

Out of scope for v1:

- publisher signatures
- trust chain and key management

### 9.4 Package resolution behavior

Local folder install:

- validate layout in place
- copy into immutable host cache

Tarball install:

- verify tarball hash
- unpack into staging area
- validate manifest, descriptor set, and entrypoint
- move into immutable host cache

npm install:

- resolve exact version
- record resolved tarball URL and package integrity
- fetch into staging area
- validate and install as immutable artifact

## 10. Rust Host Specification

### 10.1 Responsibilities

The Rust host is the control plane and source of truth.

Responsibilities:

- plugin installation
- descriptor and manifest validation
- plugin registry
- activation and deactivation
- process lifecycle supervision
- request scheduling
- timeout enforcement
- circuit breaker and health model
- logs, metrics, tracing aggregation
- host-managed KV access
- package integrity validation

### 10.2 Internal components

Recommended Rust module layout:

```text
crates/
  plugin-host/
    src/
      install/
        mod.rs
        resolver.rs
        integrity.rs
        manifest.rs
        descriptors.rs
      registry/
        mod.rs
        catalog.rs
      activation/
        mod.rs
        manager.rs
      runtime/
        mod.rs
        supervisor.rs
        scheduler.rs
        transport.rs
        circuit_breaker.rs
        health.rs
      protocol/
        mod.rs
        framing.rs
        envelope.rs
        method_ids.rs
      kv/
        mod.rs
        backend.rs
        memory.rs
        redis.rs
      observability/
        mod.rs
        logs.rs
        metrics.rs
        tracing.rs
      api/
        mod.rs
        generated/
```

### 10.3 Registry

The registry stores:

- installed package location
- manifest
- descriptor-derived metadata
- activation policy
- runtime health state
- circuit breaker state
- current runtime handle if active

### 10.4 Activation manager

Behavior:

- on first call to a lazy plugin, resolve installed artifact
- verify healthy runtime exists
- if absent, spawn Node runtime
- perform runtime bootstrap
- call `Init`
- if `Init` succeeds, mark plugin active
- if `Init` fails, mark plugin unhealthy and apply retry backoff

`Init` must be treated as idempotent from the host's point of view.

This is required because:

- runtime process restarts may happen
- idle-evicted plugins may later reactivate
- circuit-breaker recovery may trigger re-initialization

### 10.5 Scheduler

The scheduler owns:

- routing incoming calls to the correct plugin runtime
- queueing when concurrency limits are reached
- admission control under overload
- enforcing per-plugin concurrency semantics

### 10.6 Runtime supervisor

The supervisor owns:

- Node runtime process creation
- IPC endpoint creation
- readiness handshake
- restart on process crash
- idle eviction
- in-flight request failure propagation

### 10.7 Circuit breaker

Borrowed from OpenZeppelin:

- maintain failure counters and recovery probing
- open the breaker under repeated failures
- stop sending traffic to obviously unhealthy runtimes

Recommended states:

- `closed`
- `open`
- `half_open`

Recommended default triggers:

- repeated init failures
- repeated timeout failures
- repeated transport failures
- repeated decode/protocol errors

### 10.8 Host-facing Rust API

The Rust application should not construct frames manually.

v1 should expose:

- generated typed clients for plugin services
- a generic host runtime API for dynamic invocation

Recommended typed call surface:

```rust
let host = PluginHost::new(config)?;
let quote = host.client::<balance::plugins::quote::v1::QuotePlugin>("quote-plugin")?;
let result = quote.get_price(GetPriceRequest {
    asset: "BTC".into(),
    amount: "0.5".into(),
}).await?;
```

Recommended dynamic call surface:

```rust
let result = host.call("quote-plugin", "balance.plugins.quote.v1.QuotePlugin/GetPrice", bytes).await?;
```

Typed clients are the preferred path.

## 11. Node Plugin Runtime Specification

### 11.1 Responsibilities

The Node runtime is not the control plane.

Its responsibilities are narrower:

- load the installed JS entrypoint
- load generated descriptor/runtime metadata
- create the dispatcher
- execute incoming RPC requests
- host the internal worker pool
- surface logs/traces
- expose host-managed KV and runtime context

### 11.2 Internal components

Recommended package layout:

```text
packages/
  plugin-runtime/
    src/
      bootstrap.ts
      dispatcher.ts
      context.ts
      tracing.ts
      logger.ts
      kv.ts
      worker-pool.ts
      worker-entry.ts
      framing.ts
      lifecycle.ts
      errors.ts
      protocol.ts
```

### 11.3 Bootstrap flow

1. Start process with runtime arguments from the Rust host.
2. Connect to IPC endpoint.
3. Load `plugin.json`.
4. Load descriptor metadata and generated dispatch table.
5. Import `main`.
6. Validate exported plugin object against generated handler metadata.
7. Create worker pool according to concurrency mode.
8. Wait for `Init` RPC from host.

### 11.3.1 Bootstrap versus `Init`

Bootstrap and `Init` have distinct responsibilities:

- bootstrap:
  - loads code
  - validates manifest and generated metadata
  - starts the runtime plumbing
- `Init`:
  - passes deployment-specific config
  - lets plugin validate runtime dependencies
  - lets plugin warm caches and clients
  - decides readiness

The plugin is not considered ready to serve business RPCs until `Init` returns `ok`.

### 11.4 Worker pool model

Borrowed from OpenZeppelin's pool execution idea, but adapted:

- each plugin gets its own warm runtime process
- internal worker pool uses `worker_threads`
- worker pool is used only when concurrency mode allows it

Execution modes:

- `serial`: dispatch all calls through one active execution lane
- `parallel-safe`: fan out across worker pool
- `max_concurrency = N`: bound active tasks to `N`

### 11.4.1 Worker pool sizing

v1 should support both:

- sensible defaults
- explicit host tuning knobs

Recommended knobs:

- min workers
- max workers
- max queued tasks
- worker idle timeout
- per-task timeout buffer

Default sizing should be conservative for `serial` plugins and scale only when concurrency mode permits it.

### 11.5 In-memory state model

Warm memory is allowed for:

- SDK clients
- HTTP clients
- parsed config
- short-lived caches

Warm memory must not be treated as durable correctness-critical state.

Durable or shared state belongs in host-managed KV.

## 12. Wire Protocol Specification

### 12.1 Transport

Primary transport:

- Unix domain sockets on Unix platforms
- named pipes on Windows

Rationale:

- matches the best local-plugin ideas from OpenZeppelin
- lower overhead than local HTTP
- preserves process boundary
- clean fit for persistent runtimes

### 12.1.1 Why Protobuf without gRPC

This architecture intentionally uses Protobuf for schema and code generation without adopting gRPC as the local plugin transport.

Reasons:

- plugins are local worker runtimes, not remote microservices
- the framework needs fine control over lifecycle, activation, and warm-worker semantics
- unary local RPC over binary framed sockets is simpler and lower overhead than a full HTTP/2 stack
- the plugin author does not benefit from gRPC server ceremony in this local execution model

In short:

- Protobuf is used for type system, compatibility, and code generation
- the framework's own framed IPC protocol is used for local runtime transport

### 12.1.2 Why sockets instead of stdio

VS Code frequently uses protocol-based subprocess communication over `stdin/stdout`, and that remains a viable pattern.

This design prefers sockets or named pipes because they fit the performance-oriented runtime model better:

- easier persistent connection management
- cleaner separation from process stdout/stderr used for diagnostics
- better support for supervisor-owned connection pools and health probes
- closer to the OpenZeppelin operational model

### 12.2 Framing

Hot-path transport uses binary length-prefixed Protobuf frames.

Frame format:

```text
[u32 length][protobuf bytes]
```

Message envelope concept:

```proto
message RuntimeEnvelope {
  uint32 protocol_version = 1;
  uint64 request_id = 2;
  uint32 method_id = 3;
  oneof body {
    InitRequest init_request = 10;
    InitResult init_result = 11;
    GetPriceRequest get_price_request = 12;
    GetPriceResult get_price_result = 13;
    FrameworkError framework_error = 14;
    ControlMessage control = 15;
  }
}
```

This document does not require a single monolithic envelope schema, but v1 must define a stable internal wire envelope with:

- protocol version
- request correlation
- method identity
- typed payload
- framework error path
- tracing metadata or references

### 12.2.1 Control-plane messages

In addition to RPC envelopes, the transport must support control-plane messages for:

- runtime handshake
- ready signal
- graceful shutdown
- idle eviction notification
- runtime diagnostics
- ping/pong health probes

Control-plane messages must be versioned separately from plugin service payloads.

### 12.3 Why not JSON-line IPC

OpenZeppelin uses newline-delimited JSON over local sockets.

That is operationally simple and easy to inspect, but for this project:

- Protobuf is already the contract system
- binary framing is smaller and cheaper to parse
- typed transport decoding is more stable than ad hoc JSON payloads
- the framework can still provide debug tooling that renders frames in human-readable form

### 12.4 Method dispatch

Dispatch algorithm:

1. read frame
2. decode envelope
3. resolve `method_id` to generated handler binding
4. decode typed request payload
5. execute handler
6. encode typed result envelope
7. write response frame

## 13. Initialization and Request Flow

### 13.1 Installation flow

1. User installs plugin from folder, tarball, or npm package.
2. Host resolves package contents.
3. Host verifies integrity.
4. Host reads `plugin.json`.
5. Host validates descriptor set and service metadata.
6. Host stores installed artifact in plugin cache.
7. Host registers plugin in registry.

### 13.1.2 Build and generate flow

The canonical author workflow is:

1. author writes `.proto`
2. `pluginctl generate` runs Buf generation
3. generation emits:
   - TS message types
   - TS handler interfaces
   - Rust message and client helpers
   - descriptor set
   - method ID metadata
4. author implements TS handlers
5. `pluginctl build` compiles TS to JS and validates package consistency
6. `pluginctl pack` creates distributable artifact

The host never depends on generation happening implicitly at install time.

### 13.1.1 Installation metadata

The host should record:

- package source
- resolved package version
- install timestamp
- integrity hash
- descriptor digest
- generated method ID digest

This metadata supports reproducibility and debugging.

### 13.2 Activation flow

For lazy activation:

1. Rust caller requests method on plugin.
2. Registry sees plugin inactive.
3. Activation manager starts Node runtime.
4. Runtime connects to host IPC endpoint.
5. Host sends `Init`.
6. Plugin returns `InitResult`.
7. If successful, runtime becomes active and request execution continues.
8. If unsuccessful, activation fails and plugin remains unhealthy.

`Init` responsibilities:

- validate runtime config
- initialize plugin-scoped clients
- establish backend connections if needed
- warm caches if useful
- return typed plugin metadata or typed init error

### 13.3 Request flow

End-to-end flow:

1. Rust application uses generated client or host API wrapper.
2. Host resolves plugin and method metadata.
3. Host ensures runtime is active.
4. Host allocates request ID and tracing context.
5. Host serializes request into framed Protobuf envelope.
6. Node runtime receives and dispatches request.
7. Worker executes typed handler.
8. Result envelope is returned.
9. Host decodes response.
10. Host returns:
   - success value
   - typed domain error
   - framework failure

### 13.4 Example request flow

Rust:

```rust
let result = quote_client.get_price(GetPriceRequest {
    asset: "BTC".into(),
    amount: "0.5".into(),
}).await?;
```

TS:

```ts
export default definePlugin<QuotePluginHandlers>({
  async init(req, ctx) {
    ctx.logger.info("init");
    return { ok: { pluginName: "quote-plugin", pluginVersion: "1.0.0" } };
  },

  async getPrice(req, ctx) {
    const quote = await ctx.kv.get<{ price: string }>(`quote:${req.asset}`);
    if (!quote) {
      return {
        error: {
          code: "QUOTE_NOT_FOUND",
          message: "No quote available",
          details: { asset: req.asset }
        }
      };
    }
    return {
      ok: {
        price: quote.price,
        currency: "USD",
        expiresAt: new Date(Date.now() + 30_000).toISOString()
      }
    };
  }
});
```

## 14. Runtime Context Specification

### 14.1 Author-facing API

Plugin authors implement generated handlers through:

```ts
export default definePlugin<QuotePluginHandlers>({
  async init(req, ctx) { ... },
  async getPrice(req, ctx) { ... }
});
```

The author should never manually manage:

- socket servers
- framed message parsing
- descriptor lookup
- protobuf encoding/decoding plumbing
- worker-pool integration

### 14.1.1 Author ergonomics requirements

The framework must optimize for this feeling:

- "I write a `.proto` file."
- "I run generation."
- "I implement typed functions."
- "Rust can call my service safely."

It must not feel like:

- building a custom IPC service
- manually encoding Protobuf frames
- writing host bootstrap code
- registering handlers through stringly-typed APIs

### 14.2 `PluginContext`

Recommended v1 context surface:

- `logger`
- `tracer`
- `kv`
- `config`
- `plugin`
- `runtime`

Example:

```ts
interface PluginContext {
  logger: PluginLogger;
  tracer: PluginTracer;
  kv: PluginKVStore;
  config: Readonly<Record<string, string>>;
  plugin: {
    id: string;
    version: string;
    instanceId: string;
  };
  runtime: {
    requestId: string;
    deadline?: number;
  };
}
```

### 14.2.1 Context construction rules

The runtime creates a fresh request-scoped context for each RPC containing:

- immutable request metadata
- request-scoped logger/tracer
- plugin-scoped KV client
- read-only config snapshot from successful `Init`

Plugin-scoped values may be reused internally by the runtime for efficiency, but the author-facing context object must behave as request-scoped and isolated.

### 14.3 Config delivery

Static package/runtime metadata stays in `plugin.json`.

Environment-specific and deployment-specific configuration is delivered through `InitRequest`.

This avoids mutating package artifacts per environment.

## 15. KV Store Specification

### 15.1 Model

This subsystem directly borrows the best parts of OpenZeppelin's plugin KV model.

v1 provides a host-managed KV store with:

- per-plugin namespacing
- JSON-encoded values
- optional TTL
- existence checks
- key listing
- namespace clear
- lock helper for serialized mutation

### 15.2 Backends

Supported backends:

- `memory`
  - local development
  - tests
  - non-durable
- `redis`
  - production
  - durable across process restarts

### 15.2.1 Backend ownership

The host manages KV backend configuration, but the Node runtime may talk to the backend directly using host-provided configuration.

This intentionally follows the practical OpenZeppelin model more closely than proxying every KV operation through Rust.

Rationale:

- lower hot-path overhead for KV-heavy plugins
- simpler reuse of mature Redis clients in the Node runtime
- host still owns backend choice, configuration, and plugin-scoped namespacing policy

Required behavior:

- host chooses backend
- host injects backend configuration during bootstrap or `Init`
- runtime exposes only the narrowed `kv` interface to plugin authors
- plugin authors do not receive arbitrary host storage internals

### 15.3 API surface

```ts
interface PluginKVStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<boolean>;
  del(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  listKeys(pattern?: string, batch?: number): Promise<string[]>;
  clear(): Promise<number>;
  withLock<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { ttlSec?: number; onBusy?: "throw" | "skip" }
  ): Promise<T | null>;
}
```

### 15.4 Persistence semantics

If Redis is configured:

- KV state survives plugin process crashes
- KV state survives host restarts
- KV state can coordinate across multiple warm workers

If memory backend is configured:

- KV state does not survive restart

### 15.5 Namespacing

Keys must be namespaced by plugin ID and plugin instance conventions defined by the host.

The design should follow OpenZeppelin's discipline of per-plugin namespacing to prevent cross-plugin key collision.

## 16. Observability Specification

### 16.1 Logs

v1 must support structured plugin logs.

Requirements:

- per-request association
- plugin ID and version tagging
- runtime instance tagging
- log level
- message
- structured fields

### 16.2 Metrics

Per-plugin metrics:

- requests total
- successful responses
- typed domain failures
- timeout failures
- transport failures
- init failures
- queue depth
- active concurrency
- restart count
- circuit breaker transitions
- worker pool utilization

### 16.3 Tracing

v1 includes full tracing.

Requirements:

- host-originated trace/span propagation into plugin execution
- request-scoped trace context in `PluginContext`
- spans for:
  - host scheduling
  - activation
  - init
  - transport send/receive
  - handler execution
  - KV operations
  - external I/O when instrumented by plugin author or runtime wrappers

### 16.3.1 Correlation propagation

Every RPC must carry:

- request ID
- trace ID
- parent span ID when present
- plugin ID
- runtime instance ID

This metadata must be available to:

- Rust host logs
- Node runtime logs
- worker execution spans
- KV operations

### 16.4 Visibility policy

The framework should support runtime controls for whether plugin-originated logs and traces are surfaced to callers, stored internally, or both.

This is inspired by OpenZeppelin's explicit handling of emitted logs/traces.

## 17. Failure Model and Recovery Policy

### 17.1 Failure classes

1. Domain error
   - encoded in typed result envelope
2. Init failure
   - typed init error or framework init failure
3. Request timeout
4. Decode or protocol mismatch
5. Worker thread crash
6. Runtime process crash
7. Circuit breaker rejection
8. KV backend failure
9. unexpected handler exception

### 17.2 Default policy

Opinionated defaults are required in v1.

Framework defaults should be configurable only through narrow operational knobs, not by rewriting the failure model per plugin.

#### Init failure

- plugin marked unhealthy
- activation fails
- exponential backoff before retry

#### Request timeout

- request returns framework timeout error
- in-flight worker task is cancelled or abandoned according to runtime limits
- repeated timeouts contribute to breaker state

#### Worker thread crash

- fail in-flight tasks for that worker
- replace worker thread if pool policy allows
- keep process alive if safe

#### Runtime process crash

- fail in-flight requests
- supervisor restarts runtime
- host re-runs `Init`

#### Decode/protocol error

- fail request immediately
- mark runtime suspect
- usually recycle process because descriptor/runtime mismatch is severe

#### Unexpected handler exception

- classify as framework/plugin-execution failure
- capture stack, logs, and trace details
- return non-domain framework error to Rust caller
- contribute to health and breaker metrics

#### Circuit breaker

- open after threshold
- reject traffic during open period
- allow probe traffic in half-open state

## 18. Testing Specification

### 18.1 Overview

v1 includes all three test layers:

1. unit test helpers
2. in-process runtime harness
3. end-to-end Rust host plus real plugin runtime harness

### 18.2 Unit test helpers

Purpose:

- test handler logic directly
- bypass transport/runtime cost

Example:

```ts
import { createTestContext } from "@balance/plugin-testkit";
import plugin from "../src";

test("returns typed domain error when quote missing", async () => {
  const ctx = createTestContext();
  const result = await plugin.getPrice({ asset: "BTC", amount: "1.0" }, ctx);
  expect(result.error?.code).toBe("QUOTE_NOT_FOUND");
});
```

### 18.3 In-process runtime harness

Purpose:

- test generated dispatch layer
- test framing and runtime context without needing Rust host
- test `Init`, timeout, KV, and tracing behavior inside Node

### 18.4 End-to-end harness

Purpose:

- validate real descriptor loading
- validate Rust host to Node runtime communication
- validate install/activation/request flow
- validate crash recovery and circuit breaker behavior

## 19. CLI Specification

### 19.1 Philosophy

v1 provides one opinionated CLI workflow rather than forcing users to compose low-level tools manually.

### 19.2 Commands

- `pluginctl init`
  - scaffold package
  - create `.proto`, `plugin.json`, TS entrypoint, Buf config, tests
- `pluginctl generate`
  - run Buf generation
  - emit Rust and TS artifacts
  - emit descriptor set and method ID map
- `pluginctl build`
  - compile TS to JS
  - validate manifest
  - verify contract/runtime consistency
- `pluginctl test`
  - run unit, harness, and optionally E2E tests
- `pluginctl pack`
  - create distributable tarball
- `pluginctl inspect`
  - print manifest, service metadata, method IDs, compatibility info
- `pluginctl install`
  - install local/tarball/npm package into host registry

### 19.2.1 `pluginctl generate` details

`pluginctl generate` is responsible for:

- invoking Buf generation
- emitting descriptor set
- generating method ID constants and maps
- generating TS handler interfaces
- generating Rust typed clients
- failing if descriptors and manifest expectations diverge

### 19.2.2 `pluginctl build` details

`pluginctl build` is responsible for:

- compiling TS source to JS
- ensuring `main` resolves correctly
- ensuring exported handlers match generated interfaces
- ensuring source maps and packaged artifacts are coherent

### 19.2.3 `pluginctl pack` details

`pluginctl pack` is responsible for:

- assembling immutable package contents
- writing integrity metadata
- ensuring descriptor set and method ID metadata are included
- producing a tarball suitable for local or registry distribution

### 19.3 Developer flow

1. `pluginctl init`
2. write `.proto`
3. `pluginctl generate`
4. implement handlers in TS
5. `pluginctl test`
6. `pluginctl build`
7. `pluginctl pack`
8. host installs and activates plugin

## 20. Implementation Plan Shape

This section captures implementation detail at the component level. The execution plan will be written separately after spec approval.

### 20.1 Rust deliverables

- plugin installer and integrity validator
- manifest parser and validator
- descriptor loader and method-ID generator/validator
- registry and activation manager
- runtime supervisor
- socket transport and frame codec
- scheduler and concurrency manager
- circuit breaker and health subsystem
- KV backends
- tracing, metrics, logs integration
- Rust-side generated client helpers

### 20.2 TypeScript deliverables

- `definePlugin` author API
- runtime bootstrap
- generated dispatcher
- worker pool manager
- context construction
- KV client bindings
- tracing/logger adapters
- error normalization
- in-process harness
- unit-test helpers

### 20.3 Code generation deliverables

- Buf integration
- TS message and handler types
- Rust message and client/server helper types
- descriptor set generation
- method ID map generation
- `plugin.json` validation against generated metadata

### 20.3.1 Generated TS artifacts

The generated TS layer should include:

- message types
- result-envelope helpers
- handler interface
- `definePlugin` type binding
- dispatcher registration table
- method ID constants

Example shape:

```ts
export interface QuotePluginHandlers {
  init(req: InitRequest, ctx: PluginContext): Promise<InitResult>;
  getPrice(req: GetPriceRequest, ctx: PluginContext): Promise<GetPriceResult>;
}
```

### 20.3.2 Generated Rust artifacts

The generated Rust layer should include:

- message types
- result-envelope helpers
- typed service client
- dynamic service metadata
- method ID constants
- descriptor metadata helpers

### 20.4 Packaging deliverables

- pack/install format
- cache directory layout
- hash verification
- package inspection

## 21. Open Questions Deferred to v2

- notifications
- streaming RPC
- multiple services per plugin
- signed plugins
- hard sandboxing
- alternative runtimes besides Node
- `child_process` isolation mode
- richer KV semantics like transactions or secondary indexes

## 22. Recommended v1 Defaults

- activation: `lazy`
- concurrency: `serial`
- request transport: local socket plus binary framed Protobuf
- runtime source of truth: descriptor set
- package source of truth: installed immutable artifact
- state backend in dev: memory
- state backend in prod: Redis
- tracing: enabled
- integrity: basic hash verification

## 23. Summary

The resulting platform is:

- contract-first
- manifest-driven
- Protobuf-native
- Rust-supervised
- TypeScript-authored
- out-of-process
- warm-worker based
- lazy-activated
- observable
- testable
- packageable

This is the smallest v1 that still feels like a serious plugin infrastructure rather than a thin RPC wrapper.

## 24. References

- OpenZeppelin Relayer repository: https://github.com/OpenZeppelin/openzeppelin-relayer
- OpenZeppelin plugin architecture: https://github.com/OpenZeppelin/openzeppelin-relayer/blob/main/plugins/ARCHITECTURE.md
- OpenZeppelin plugin docs: https://docs.openzeppelin.com/relayer/plugins
- OpenZeppelin storage docs: https://docs.openzeppelin.com/relayer/configuration/storage
- VS Code extension host docs: https://code.visualstudio.com/api/advanced-topics/extension-host
- VS Code activation events: https://code.visualstudio.com/api/references/activation-events
- VS Code architecture approach: https://vscode-docs.readthedocs.io/en/latest/extensions/our-approach/
