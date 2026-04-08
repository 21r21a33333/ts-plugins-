---
layout: home

hero:
  name: "Balance TS Plugins"
  text: "Typed plugin infrastructure for Rust hosts and TypeScript runtimes"
  tagline: "Define the contract in Protobuf, generate types on both sides, run plugins out of process, and ship with real operational primitives."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View Architecture
      link: /architecture/system-overview

features:
  - title: Contract-First
    details: Write one Protobuf service per plugin, enforce a required Init RPC, and generate Rust and TypeScript types from the same descriptor set.
  - title: Local-First Runtime
    details: The Rust host activates warm Node runtimes over local sockets with binary framed Protobuf messages, typed result envelopes, and predictable lifecycle handling.
  - title: Built For Operations
    details: Use Redis-backed KV, queueing, circuit breakers, worker pools, tracing, logs, metrics, and end-to-end tests from day one.
---

## Why This Library Exists

Balance TS Plugins is for teams that want plugin flexibility without giving up system design discipline.

Instead of hand-rolled JSON protocols or loosely typed extension APIs, the platform gives you:

- a Rust control plane
- TypeScript plugin authoring
- Protobuf contracts
- generated handler interfaces
- out-of-process execution
- a first-party CLI and testkit

## What Ships In v1

- Protobuf + Buf contract workflow
- required `Init` RPC and typed result envelopes
- one service per plugin
- `plugin.json` runtime metadata
- socket IPC with binary Protobuf frames
- warm Node runtimes with optional worker pool concurrency
- host-managed KV with memory and Redis backends
- structured logs, metrics, and tracing
- `pluginctl` for `init`, `generate`, `build`, `test`, `pack`, `install`, and `inspect`
- end-to-end demo plugins for calculation, HTTP, CRUD/state, and Rust caller flows

## Read Next

- [Getting Started](/guide/getting-started)
- [System Overview](/architecture/system-overview)
- [Demo Overview](/demos/overview)
