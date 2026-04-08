# `plugin.json`

`plugin.json` is the runtime metadata file for a plugin package.

## Example

```json
{
  "schemaVersion": 1,
  "id": "quote-plugin",
  "version": "0.1.0",
  "main": "./dist/src/index.js",
  "sourceMap": "./dist/src/index.js.map",
  "contract": {
    "descriptorSet": "./descriptors/contracts.binpb",
    "service": "balance.plugins.quote.v1.QuotePluginService",
    "protoSources": ["./proto/balance/plugins/quote/v1/quote_plugin.proto"]
  },
  "runtime": {
    "language": "node",
    "activation": { "mode": "lazy" },
    "concurrency": { "mode": "serial" },
    "initTimeoutMs": 5000,
    "requestTimeoutMs": 10000
  },
  "observability": {
    "emitLogs": true,
    "emitTraces": true,
    "emitMetrics": true
  }
}
```

## Responsibilities

`plugin.json` describes:

- package identity
- runtime entrypoint
- descriptor and service location
- activation mode
- concurrency mode
- timeout behavior
- observability toggles

It does not carry the full API contract. That stays in Protobuf plus the packaged descriptor set.

## Important Split

- static package/runtime metadata lives here
- environment-specific runtime config arrives through `InitRequest`

This keeps packages reproducible while still allowing deployment-time configuration.
