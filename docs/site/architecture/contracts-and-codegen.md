# Contracts And Codegen

The contract system is the backbone of the platform.

## Why Protobuf

Protobuf was chosen because it gives:

- mature schema evolution practices
- battle-tested code generation
- clear message typing on both sides
- descriptors that can be packaged and consumed at runtime

## Contract Rules In v1

- one service per plugin package
- required `Init` RPC
- unary RPC only
- typed result envelopes for business outcomes
- no streaming
- no notifications

## Buf Workflow

The workspace uses Buf for:

- linting
- message/service generation
- descriptor set emission

At the workspace root:

```bash
pnpm exec buf lint
pnpm exec buf generate
pnpm exec buf build --as-file-descriptor-set -o descriptors/contracts.binpb
```

For plugin authors, `pluginctl generate` wraps this workflow.

## Generated Outputs

The plugin workflow produces:

- TS message types
- Rust message types
- descriptor sets
- TS handler interfaces
- stable method metadata

## Runtime Descriptor Use

The packaged descriptor set is used to:

- validate the service declared by `plugin.json`
- resolve method metadata
- retain message schemas for runtime decoding and encoding

This is why the runtime does not need to re-parse raw `.proto` source files during activation.
