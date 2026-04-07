# Plugin Infrastructure Deliverable

> Date: 2026-04-07
> Status: Approved deliverable baseline for v1 planning
> Source: Consolidated from the design document and all product decisions made in this conversation

## 1. Purpose

This document is the exhaustive deliverable ledger for the v1 open source plugin infrastructure. Its job is to capture every confirmed product decision, every requested capability, every explicit constraint, and every implementation-quality requirement agreed during discovery and design.

This file is intentionally more explicit than the design spec. The design spec explains the architecture. This file records the contract with the project itself: what must exist, what must not exist, what must be borrowed from existing battle-tested systems, and what quality bar the implementation plan must satisfy.

## 2. Project Goal

Build a best-in-class plugin infrastructure where:

- the caller and control plane are written in Rust
- plugins are written in TypeScript
- the API boundary is defined up front by the developer
- the interface is strongly typed on both sides
- plugin execution is out-of-process
- plugin authoring feels like implementing typed handlers, not building a separate RPC service
- the overall system is production-grade in performance, lifecycle, testing, observability, packaging, and operational behavior

## 3. Hard Constraints

The following are non-negotiable v1 constraints.

### 3.1 Language and execution constraints

- Rust is the host, supervisor, scheduler, and caller.
- TypeScript is the plugin authoring language.
- Plugins execute out-of-process.
- Plugins are executor/responder only.
- Rust always initiates the RPC.

### 3.2 Interface constraints

- The boundary is contract-first.
- The contract is authored before implementation.
- The contract format is Protobuf.
- Buf is used as the primary schema/codegen workflow entrypoint.
- v1 supports unary RPC only.
- v1 does not support notifications.
- v1 does not support streaming.
- v1 allows exactly one Protobuf service per plugin package.
- Every plugin must implement a required `Init` RPC.
- v1 does not require a `Health` RPC.
- Every RPC returns a typed result envelope.
- Domain errors are part of the typed Protobuf contract.
- Framework/runtime/transport errors remain outside the business response.

### 3.3 Runtime constraints

- Plugins run in dedicated warm Node runtimes.
- Each plugin runtime may use an internal worker pool.
- `worker_threads` is the implemented concurrency engine in v1.
- The architecture must allow future `child_process` isolation without redesigning the system.
- The local transport is a socket-based IPC layer, not gRPC over HTTP/2.
- The transport payload format is binary Protobuf framing, not JSON-line IPC.

### 3.4 Package and lifecycle constraints

- Runtime metadata must live in `plugin.json`.
- Contract metadata must not be overloaded into `plugin.json`.
- The packaged descriptor set is the runtime source of truth.
- `.proto` remains part of the package for source/debug/reference.
- `plugin.json` holds static package/runtime metadata.
- environment-specific configuration is passed through `InitRequest`.
- v1 supports local folders, tarballs, and npm packages from day one.
- installs are immutable once resolved into the host cache.
- basic integrity verification is required in v1.
- signed plugin infrastructure is out of scope for v1.

### 3.5 Trust and security constraints

- v1 plugins are trusted code.
- plugin authors may use third-party npm libraries.
- plugin authors may perform direct outbound network calls.
- plugin authors may perform normal local I/O in the runtime environment.
- v1 is not a hard sandbox against malicious plugins.
- plugin authors must not receive arbitrary host internals.
- the runtime context must be explicit, narrow, and typed.

### 3.6 Performance constraints

- performance is a top-level goal, not a later enhancement
- no per-call plugin process spawn
- warm runtimes after activation
- internal worker-pool support for parallel plugins
- queueing, admission control, timeout, and circuit breaker must be designed from the start
- binary framed transport must be used on the hot path
- durable state should not force every call through Rust if a mature direct client path already exists

## 4. Confirmed Product Decisions

This section is the canonical decision log.

### 4.1 Contract and transport decisions

- Protobuf was chosen over a custom JSON/YAML DSL.
- Protobuf was chosen because it gives the best existing toolchain and a battle-tested type-generation story.
- We are intentionally not using full gRPC as the local runtime transport.
- We are using Protobuf for schema, compatibility, and code generation.
- We are using a custom local framed IPC protocol for runtime communication.
- Wire payloads use binary framed Protobuf.
- Developer-facing metadata uses readable fully-qualified method names.
- Runtime hot path uses generated numeric method IDs.

### 4.2 Interaction model decisions

- The earlier `Unary + notifications` possibility was explicitly reduced for v1.
- v1 only has RPC.
- No notifications in v1.
- No event handlers in v1.
- One service per plugin in v1.

### 4.3 Lifecycle decisions

- `Init` is mandatory.
- `Health` is not required in v1.
- Activation defaults to lazy.
- Startup activation is allowed via manifest.
- Activation behavior is manifest-driven.
- A plugin is not ready until `Init` succeeds.
- `Init` must be treated as idempotent from the host point of view.

### 4.4 Concurrency and runtime decisions

- `serial` is the safe default.
- `parallel-safe` is opt-in.
- `max_concurrency = N` is opt-in.
- The runtime follows a hybrid persistent-worker model inspired by OpenZeppelin.
- Warm in-memory state is allowed for caches and pooled clients.
- Warm in-memory state is not the durable source of truth.
- Durable/shared state belongs in host-managed persistence.
- The per-plugin warm runtime internally uses a worker pool.
- v1 uses `worker_threads`.
- architecture leaves room for future `child_process` mode.

### 4.5 State and persistence decisions

- v1 includes host-managed plugin KV.
- The KV model should follow OpenZeppelin closely.
- Production KV backend is Redis.
- Development/test KV backend may be in-memory.
- KV must be namespaced per plugin.
- KV should support TTL.
- KV should support a lock helper.
- Shared or restart-safe plugin state should use KV instead of process memory.

### 4.6 Packaging and distribution decisions

- Source-first authoring is the preferred author experience.
- The host actually runs compiled JS from `dist/`.
- Plugin packages include:
  - `plugin.json`
  - compiled JS
  - descriptor set
  - `.proto`
  - generated metadata
  - source maps when available
- v1 supports local folders.
- v1 supports tarballs.
- v1 supports npm packages.
- integrity verification is required.

### 4.7 Versioning decisions

- Protobuf package version is the contract compatibility version.
- Manifest/package version is the plugin implementation release version.
- These are separate on purpose.

### 4.8 Testing decisions

- v1 includes unit test helpers.
- v1 includes an in-process Node runtime harness.
- v1 includes full end-to-end Rust host plus real plugin process tests.
- Testing is a core framework deliverable, not optional tooling.

### 4.9 Observability decisions

- v1 includes structured logs.
- v1 includes metrics.
- v1 includes full tracing.
- correlation IDs and trace context must propagate across the Rust-to-TS boundary.

### 4.10 Tooling decisions

- v1 ships a single opinionated CLI workflow.
- The CLI surface includes:
  - `init`
  - `generate`
  - `build`
  - `test`
  - `pack`
  - `install`
  - `inspect`

### 4.11 API ergonomics decisions

- Plugin authors implement typed handlers through `definePlugin(...)`.
- Class-based authoring was not chosen.
- Notifications-as-void-handlers is not relevant for v1 because notifications were removed.
- The plugin author must never manually manage sockets, framing, or raw protobuf decoding.

### 4.12 Failure policy decisions

- v1 includes opinionated failure defaults.
- Init failure, timeout, worker crash, runtime crash, decode/protocol errors, and circuit breaker states must all be explicitly handled.
- The system should not leave recovery behavior as an exercise for integrators.

## 5. Required Borrowing From Existing Systems

The implementation plan must explicitly reuse proven patterns and libraries where possible. We are not building a research project from scratch.

### 5.1 From OpenZeppelin Relayer

Required architectural borrowing:

- persistent runtime with internal worker pool
- queueing and admission control
- circuit breaker and health monitoring
- local socket-based communication
- Redis-backed KV with namespacing and locking
- practical plugin author ergonomics
- runtime restart and memory pressure awareness

Relevant source references:

- `plugins/ARCHITECTURE.md`
- `plugins/README.md`
- `plugins/lib/worker-pool.ts`
- `plugins/lib/plugin.ts`
- `plugins/lib/kv.ts`
- `plugins/tests/lib/pool-server.test.ts`
- `plugins/tests/lib/kv.test.ts`

What must be borrowed as a pattern:

- separate Rust control plane versus Node execution plane
- per-plugin or pool execution lifecycle
- runtime warmness
- queueing before overload
- durability through Redis, not in-memory state
- operationally meaningful tests for pool and KV behavior

What must not be copied blindly:

- JSON-line hot-path transport
- HTTP-centric plugin invocation assumptions
- ad hoc error envelopes where the typed contract should be authoritative

### 5.2 From VS Code

Required architectural borrowing:

- manifest-driven activation behavior
- separate extension/plugin host mindset
- activation accounting and timing
- lifecycle barriers and explicit readiness states
- strict separation between host internals and plugin-facing API

Relevant source references:

- `src/vs/workbench/api/node/extHostExtensionService.ts`
- `src/vs/workbench/api/common/extHostExtensionService.ts`
- `src/vs/workbench/api/common/extHostExtensionActivator.ts`
- extension host docs
- activation events docs

What must be borrowed as a pattern:

- lazy activation as the default
- explicit activation bookkeeping
- host/runtime isolation as a performance and stability feature
- manifest discipline

What must not be copied blindly:

- VS Code’s editor-specific API model
- DOM/editor surface assumptions
- extension semantics unrelated to a Rust-to-TS RPC platform

## 6. Deliverables By System Area

This section is the exhaustive required deliverable list.

### 6.1 Contract deliverables

- Protobuf-first contract format
- Buf-based generation workflow
- one-service-per-plugin validation
- required `Init` RPC support
- typed result-envelope pattern
- descriptor-set generation
- deterministic numeric method-ID generation
- Rust generated types
- TypeScript generated types
- TypeScript generated handler interfaces
- Rust generated typed client helpers or wrappers
- compatibility/versioning rules

### 6.2 Manifest deliverables

- `plugin.json` schema
- activation metadata
- concurrency metadata
- timeout metadata
- descriptor-set path metadata
- source map metadata
- observability metadata
- integrity metadata
- manifest validation in build and install flows

### 6.3 Packaging deliverables

- local folder resolution
- tarball resolution
- npm resolution
- immutable install cache layout
- integrity verification
- package inspection tooling
- packaged descriptor set as runtime truth

### 6.4 Rust host deliverables

- plugin registry
- install/load/activate/deactivate flow
- activation manager
- runtime supervisor
- socket transport layer
- framed Protobuf protocol layer
- request scheduler
- concurrency enforcement
- health subsystem
- circuit breaker
- runtime restart policy
- idle eviction support
- Rust typed client surface
- dynamic invocation surface

### 6.5 Node runtime deliverables

- runtime bootstrap
- `definePlugin(...)`
- generated dispatcher
- context creation
- `Init` handling
- worker-pool integration
- serial and parallel execution semantics
- method dispatch by numeric ID
- error normalization
- logs/traces emission

### 6.6 KV deliverables

- plugin-scoped namespaces
- Redis backend
- in-memory backend
- `get`
- `set`
- `del`
- `exists`
- `listKeys`
- `clear`
- `withLock`
- TTL support
- key validation
- namespace isolation tests
- restart-survival semantics with Redis

### 6.7 Observability deliverables

- structured logs
- request IDs
- trace IDs
- runtime instance IDs
- metrics counters
- latency metrics
- queue depth metrics
- restart metrics
- full tracing propagation
- per-plugin tagging

### 6.8 Testing deliverables

- TS unit-test helpers
- Node in-process runtime harness
- Rust-host plus real plugin end-to-end harness
- contract generation tests
- manifest validation tests
- package install/integrity tests
- activation tests
- restart tests
- timeout tests
- KV backend tests
- worker-pool tests

### 6.9 CLI deliverables

- `pluginctl init`
- `pluginctl generate`
- `pluginctl build`
- `pluginctl test`
- `pluginctl pack`
- `pluginctl install`
- `pluginctl inspect`
- scaffolding templates
- build validation
- generation validation
- consistency checks against the descriptor set and manifest

### 6.10 Documentation deliverables

- architecture design spec
- deliverable ledger
- implementation plan
- example plugin
- example Rust caller
- install/build/test instructions
- operational guidance for Redis and tracing

## 7. Explicit Feature Requests From This Conversation

This section traces the chat as requirements, not just architecture.

### 7.1 User-stated product asks

- “user provide a schema much like a grpc in file format”
- “file format defines the types of the request and response”
- “there should be two component”
- “one which calls the plugin”
- “plugin in itself is simple fn”
- “most important the plugin should also be type dependent”
- “important features type safety”
- “a nice framework for testing and initing system”
- “best in class plugin infrastructure”
- “for the v1 version the caller will be rust and plugin will be written in ts”

### 7.2 UX asks

- developer-authored typed boundary
- simple developer experience
- proactive design
- no slop
- no unnecessary code
- use existing tools and libraries where battle-tested
- deep and complete design and plan with no gaps

### 7.3 Performance asks

- performance is the utmost priority
- review OpenZeppelin and VS Code and pick the best architecture
- use the best of the two, not generic advice

### 7.4 Packaging and runtime asks

- packaged plugin tarballs and npm packages from day one
- basic integrity from day one
- source-first but runtime-ready shipping

### 7.5 Architecture asks that were later refined

- early discussion included notifications, but v1 was later explicitly constrained to RPC only
- early discussion considered broader host capability questions, but v1 ultimately uses a trusted-plugin model instead of capability-restricted execution as a security feature
- concurrency was first considered globally parallel-safe, then corrected to explicit manifest declarations with `serial` as the safe default

## 8. Enhancements Over The Raw Initial Ask

These were not fully specified in the original idea but are now required because they materially improve the system.

- explicit manifest versus contract split
- typed domain-error envelopes
- deterministic numeric method IDs
- packaged descriptor set as runtime truth
- immutable installed artifact model
- full tracing in v1
- three-layer testing model
- runtime supervisor and circuit breaker
- idle activation and warm runtime lifecycle
- Redis-backed KV with lock helper
- worker-thread pool architecture
- installation integrity verification
- exact source borrowing plan from OpenZeppelin and VS Code

## 9. Required Existing Packages And Libraries To Reuse

This section exists to enforce the “do not reinvent the wheel” requirement.

### 9.1 Rust

The implementation plan must prefer these kinds of battle-tested crates:

- `tokio` for async runtime, process handling, sockets, timers, synchronization
- `tokio-util` for length-delimited framing
- `prost` and `prost-build` or compatible protobuf generation/runtime crates
- `bytes`
- `serde` and `serde_json` for manifest and metadata parsing
- `thiserror` and `anyhow`
- `tracing`, `tracing-subscriber`, `tracing-opentelemetry`
- `opentelemetry`
- `redis` crate for Redis backend
- `sha2` or equivalent for integrity hashing

### 9.2 TypeScript / Node

The implementation plan must prefer these kinds of battle-tested libraries:

- Buf TS generation tools such as `@bufbuild/protoc-gen-es` and `@bufbuild/protobuf`
- `Piscina` for worker-pool management
- `ioredis` for Redis KV
- `commander` or `cac` for the CLI
- `zod` or equivalent schema validation for manifest/config validation
- `esbuild`, `tsup`, or `tsc` rather than custom compilers
- `pacote` for npm/tarball resolution
- `vitest` or `jest` for TS tests
- OpenTelemetry JS packages for tracing
- `pino` or similarly mature structured logging tools if a dedicated logger abstraction is needed

### 9.3 Things we should not build ourselves

- a custom Redis client
- a custom worker-pool scheduler when Piscina solves the main problem
- a custom tarball/npm resolver when `pacote` already exists
- a custom Protobuf encoder/decoder
- a custom ad hoc test runner when Vitest/Jest and Cargo tests already cover the need

## 10. Quality Bar

The implementation must satisfy all of the following.

- No slop code.
- No placeholder architecture disguised as implementation.
- No unnecessary abstractions.
- No unused code paths.
- No speculative v2 scaffolding that complicates v1.
- No giant monolithic modules when the design calls for clear boundaries.
- No hand-rolled infrastructure where proven libraries exist.
- No hidden transport details leaking into plugin author code.
- No ambiguity over ownership between Rust host and Node runtime.

## 11. Required Review Standard

The plan and eventual implementation must be reviewable slice by slice.

Each slice must be:

- independently understandable
- independently testable
- small enough for code review
- tied back to a specific deliverable in this document
- grounded in the design spec
- explicit about existing code or libraries being reused

## 12. Acceptance Checklist

The implementation plan must fully satisfy this checklist.

- [ ] Contract-first Protobuf architecture is preserved.
- [ ] Rust remains the caller and control plane.
- [ ] TS remains the plugin executor/responder.
- [ ] Plugins are out-of-process.
- [ ] v1 remains unary RPC only.
- [ ] v1 remains one service per plugin.
- [ ] `Init` is required.
- [ ] typed result envelopes exist for all business RPCs.
- [ ] `plugin.json` exists and is validated.
- [ ] activation defaults to lazy.
- [ ] `serial` is the safe default concurrency mode.
- [ ] `parallel-safe` and `max_concurrency = N` are available.
- [ ] per-plugin warm runtime exists.
- [ ] worker-thread pool exists.
- [ ] Redis-backed KV exists.
- [ ] in-memory KV exists for dev/test.
- [ ] source-first shipping with compiled runtime artifact exists.
- [ ] tarball and npm installation exists.
- [ ] integrity verification exists.
- [ ] logs, metrics, and tracing exist.
- [ ] all three testing layers exist.
- [ ] opinionated CLI exists.
- [ ] OpenZeppelin and VS Code references are used concretely, not performatively.
- [ ] unnecessary custom infrastructure is avoided.

## 13. Traceability Into The Implementation Plan

The implementation plan must map every slice back to one or more of:

- contract deliverables
- manifest deliverables
- packaging deliverables
- Rust host deliverables
- Node runtime deliverables
- KV deliverables
- observability deliverables
- testing deliverables
- CLI deliverables

## 14. Final Deliverable Statement

If the implementation plan does not satisfy every item in this document, it is incomplete.

If the plan proposes reinventing infrastructure that mature packages already provide, it must be revised.

If the plan leaves lifecycle, failure handling, or testing as vague future work, it must be revised.

If the plan does not materially reflect the best applicable ideas from OpenZeppelin Relayer and VS Code, it must be revised.

This file is the acceptance ledger for the v1 project.
