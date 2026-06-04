# workflow-engine Authoring Specs

`packages/workflow-engine` is the pure workflow DAG scheduler and validator. It does not implement concrete nodes, browser storage, Vue state, or patch application.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Editing scheduler, validator, errors, or public exports | Filled |
| [Error Handling](./error-handling.md) | Changing validation, abort, retry, or node failure behavior | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Adding scheduler diagnostics | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Verifying workflow-engine changes | Filled |

## Required Checks

- Run `npm run build:workflow-engine`.
- Run `npm run test --workspace @tsian/workflow-engine` for scheduler, validator, errors, outputs hooks, or static proof changes.
- Run `npm run build:web` when engine behavior assumptions affect platform-web workflow host code.

## Source References

- `packages/workflow-engine/CLAUDE.md`
- `packages/workflow-engine/src/scheduler.ts`
- `packages/workflow-engine/src/validator.ts`
- `packages/workflow-engine/src/errors.ts`
- `packages/workflow-engine/src/types.ts`
- `packages/workflow-engine/test/sc-crit.test.ts`
- `packages/workflow-engine/test/p-i-1.test.ts`
- `packages/workflow-engine/test/workflow-preset-resolution.test.ts`
