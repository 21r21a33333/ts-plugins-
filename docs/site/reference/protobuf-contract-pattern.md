# Protobuf Contract Pattern

The library expects a specific contract style.

## Required Shape

- one service per plugin
- required `Init`
- unary RPC only
- typed result envelopes

## Result Envelope Pattern

```proto
message PluginError {
  string code = 1;
  string message = 2;
  map<string, string> details = 3;
}

message GetPriceSuccess {
  string price = 1;
  string currency = 2;
  string expires_at = 3;
}

message GetPriceResponse {
  oneof outcome {
    GetPriceSuccess ok = 1;
    PluginError error = 2;
  }
}
```

This keeps business failures in the contract and leaves runtime faults outside the contract.

## Why This Matters

The Rust caller can cleanly reason about:

- transport success + business success
- transport success + business error
- transport failure

That separation is one of the core design goals of the library.
