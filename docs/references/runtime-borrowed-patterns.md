# Runtime Borrowed Patterns

This note records the concrete architecture sources we are borrowing from during implementation.

## OpenZeppelin Relayer

Reference files:

- `plugins/ARCHITECTURE.md`
- `plugins/README.md`
- `plugins/lib/worker-pool.ts`
- `plugins/lib/plugin.ts`
- `plugins/lib/kv.ts`
- `plugins/tests/lib/pool-server.test.ts`
- `plugins/tests/lib/kv.test.ts`

Borrow:

- separate Rust control plane and Node execution plane
- warm runtime and worker-pool execution patterns
- queueing, circuit breaker, and restart behavior
- Redis-backed KV with namespacing and locking
- operationally meaningful pool and KV tests

Avoid copying directly:

- JSON-line transport on the hot path
- HTTP-specific plugin assumptions

## VS Code

Reference files:

- `src/vs/workbench/api/common/extHostExtensionService.ts`
- `src/vs/workbench/api/common/extHostExtensionActivator.ts`
- `src/vs/workbench/api/node/extHostExtensionService.ts`

Borrow:

- lazy activation discipline
- activation bookkeeping and readiness barriers
- separate host/runtime mindset
- manifest-driven lifecycle behavior

Avoid copying directly:

- editor-specific APIs
- DOM/editor extension assumptions
