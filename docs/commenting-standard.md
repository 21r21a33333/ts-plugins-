# Commenting Standard

This repository uses comments to explain architecture and intent, not to restate syntax.

## Module Comments

- Every maintained source module should start with a short module comment.
- Rust modules use `//!`.
- TypeScript modules use a top-of-file `/** ... */` block.
- The module comment should answer: what role does this file play in the system?

## Function And API Docs

- Public Rust items should use `///` doc comments when they define reusable behavior, contracts, or lifecycle semantics.
- Exported TypeScript APIs should use JSDoc/TSDoc comments when they are part of the runtime, CLI, codegen, or testkit surface.
- Prefer documenting behavior, invariants, and important side effects over parameter-by-parameter repetition.

## Inline Comments

- Add inline comments only when a block is non-obvious or preserves an important invariant.
- Good inline comments explain why a branch exists, why a fallback is safe, or why a piece of state is structured a certain way.
- Do not add comments that only restate the next line of code.

## Scope

- Generated files are exempt unless manually maintained.
- Tests should stay readable first; add comments only where setup or assertions are otherwise hard to follow.
- When in doubt, prefer fewer comments with higher information density.
