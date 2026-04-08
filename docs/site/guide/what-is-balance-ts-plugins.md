# What Is Balance TS Plugins?

Balance TS Plugins is a contract-first plugin system with a strict separation of responsibilities:

- the Rust side owns calling, activation, supervision, scheduling, and transport
- the TypeScript side owns plugin implementation
- the contract is defined ahead of time in Protobuf

This is not a generic extension sandbox and it is not a full gRPC microservice platform. It is a local plugin runtime designed for strong typing, high performance, and predictable lifecycle behavior.

## Core Design Decisions

- Plugins run out of process.
- Rust always initiates RPC calls.
- v1 supports unary RPC only.
- Each plugin package implements exactly one Protobuf service.
- Each service must provide `Init`.
- Each business RPC returns a typed result envelope so domain errors stay in the contract.
- `plugin.json` carries runtime metadata while the packaged descriptor set is the runtime source of truth.

## Who This Is For

This library fits teams who want:

- a stable Rust control plane
- ergonomic TypeScript authoring for plugin logic
- battle-tested schema tooling through Protobuf + Buf
- a warm, local-first runtime instead of network-heavy service infrastructure
- operational features like KV, tracing, and restart recovery from the start

## What A Plugin Author Feels

A plugin author should feel like they are implementing a typed server surface, not building transport plumbing.

They:

1. write a `.proto` file
2. run `pluginctl generate`
3. implement generated TypeScript handlers with `definePlugin(...)`
4. build, test, and pack the plugin

They do not manually manage:

- sockets
- framing
- raw protobuf encoding
- activation wiring
- worker lifecycle

## Product Shape

- [Getting Started](/guide/getting-started) shows the end-to-end setup flow.
- [Authoring A Plugin](/guide/authoring-a-plugin) shows the developer workflow.
- [Running And Installing Plugins](/guide/running-and-installing-plugins) shows packaging and deployment.
