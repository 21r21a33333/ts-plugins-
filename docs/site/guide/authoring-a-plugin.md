# Authoring A Plugin

The authoring model is intentionally simple:

1. define the Protobuf service
2. generate types and handler metadata
3. implement handlers with `definePlugin(...)`
4. build and test

## 1. Define The Contract

Each plugin package owns exactly one service in v1, and that service must define `Init`.

Example:

```proto
syntax = "proto3";

package balance.plugins.calc.v1;

message PluginError {
  string code = 1;
  string message = 2;
  map<string, string> details = 3;
}

message InitRequest {
  string plugin_instance_id = 1;
  string environment = 2;
  map<string, string> config = 3;
}

message InitSuccess {
  string plugin_name = 1;
  string plugin_version = 2;
}

message InitResponse {
  oneof outcome {
    InitSuccess ok = 1;
    PluginError error = 2;
  }
}

message AddRequest {
  int32 left = 1;
  int32 right = 2;
}

message AddSuccess {
  int32 sum = 1;
}

message AddResponse {
  oneof outcome {
    AddSuccess ok = 1;
    PluginError error = 2;
  }
}

service CalcPluginService {
  rpc Init(InitRequest) returns (InitResponse);
  rpc Add(AddRequest) returns (AddResponse);
}
```

## 2. Generate Types

```bash
pnpm exec pluginctl generate .
```

This gives the TypeScript plugin author:

- generated request/response message types
- a typed handler interface for the service
- stable method metadata derived from the descriptor set

## 3. Implement Handlers

From the calculation demo:

```ts
import { definePlugin } from "@balance/plugin-runtime";
import type { CalcPluginHandlers } from "../gen/plugin-handlers.js";

export default definePlugin<CalcPluginHandlers>({
  init(_req, ctx) {
    return {
      outcome: {
        case: "ok",
        value: {
          pluginName: ctx.plugin.id,
          pluginVersion: ctx.plugin.version,
        },
      },
    };
  },

  add(req) {
    return {
      outcome: {
        case: "ok",
        value: {
          sum: req.left + req.right,
        },
      },
    };
  },
});
```

## Plugin Handler Context

Handlers receive a typed `ctx` with:

- `ctx.logger`
- `ctx.tracer`
- `ctx.kv`
- `ctx.config`
- `ctx.plugin`
- `ctx.request`

This keeps the runtime surface narrow and explicit while still giving plugin authors useful operational primitives.

## Domain Errors

Business failures belong in the typed contract, not in transport exceptions.

Example pattern:

```ts
return {
  outcome: {
    case: "error",
    value: {
      code: "not_found",
      message: `Note ${id} was not found`,
      details: { id },
    },
  },
};
```

The host can then distinguish:

- typed domain errors returned by the plugin
- framework failures like timeout, decode issues, or runtime crash

## Concurrency

Concurrency is declared in `plugin.json`:

- `serial`
- `parallel-safe`
- `max_concurrency`

Use `serial` unless the plugin is truly safe to run concurrently.

## Durable State

Process memory is good for caches and warmed clients.

Anything correctness-critical should use:

- plugin-managed durable storage such as SQLite or an external database
- host-managed KV for shared counters, cursors, dedup markers, or lightweight state

The CRUD demo shows this pattern in practice.
