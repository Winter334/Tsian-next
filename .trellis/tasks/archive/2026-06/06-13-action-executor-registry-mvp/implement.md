# Implementation Plan

## Checklist

1. Read applicable specs with `trellis-before-dev`.
2. Extend parsed Skill action declarations with executor metadata.
3. Add a built-in executor registry in `workspace-tools.ts`.
4. Route successful `action_call` validation through executor resolution.
5. Implement `validation` and `echo` executors.
6. Add structured errors for malformed, unsupported, or unknown executors.
7. Update runtime prompt instructions.
8. Update direction docs, current handoff, and Trellis type-safety spec.
9. Validate with `npm run build:web`, `git diff --check`, and in-memory runtime probes.
10. Commit, archive the task, and record journal.

## Validation

- `npm run build:web`
- `git diff --check`
- In-memory probes:
  - action with no executor uses `validation`
  - action with built-in `echo` returns output equal to validated input
  - unsupported executor type returns `ACTION_EXECUTOR_UNSUPPORTED`
  - unknown built-in executor returns `ACTION_EXECUTOR_NOT_FOUND`
  - invalid input fails before executor execution

## Risky Files

- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `docs/active/agent-framework-runtime-workspace-direction.md`
- `docs/active/current-state-handoff.md`

## Rollback

Revert executor parsing/registry changes and docs/spec updates together. No storage migration is involved.
