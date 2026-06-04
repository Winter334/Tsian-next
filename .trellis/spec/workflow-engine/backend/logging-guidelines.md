# Logging Guidelines

Workflow-engine has almost no logging. Diagnostics are allowed only when they do not affect execution semantics.

## Current Logging

- `safeHook` uses `console.warn` when an `outputsHooks.*` callback throws.
- Abort paths use `console.debug` to report how many nodes were aborted.
- Tests may spy on `console.debug` to prove abort diagnostics occur.

## Rules

- Do not log normal scheduler progress.
- Do not log node inputs or outputs by default; they can contain prompt text, patches, or user content.
- If a diagnostic is needed, keep it scoped to scheduler infrastructure and make tests resilient to it.
- Logging must never replace throwing the correct workflow error.

## Avoid

- Do not add noisy per-node success logs.
- Do not catch and log errors without rethrowing, except for outputs hook errors inside `safeHook`.
- Do not introduce a logging dependency into this package.
