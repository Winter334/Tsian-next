# contracts Authoring Specs

`packages/contracts` is a pure TypeScript contract package. It has no runtime dependency, database layer, logging layer, Vue components, or business execution logic.

Use this layer when adding or changing shared shapes in `packages/contracts/src/**`.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Choosing the contract source file and export boundary | Filled |
| [Error Handling](./error-handling.md) | Modeling errors in shared interfaces | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Verifying cross-package contract changes | Filled |

## Required Checks

- Run `npm run build:contracts` for every contracts change.
- Run the consuming package build when a changed type is used there, usually `npm run build:web` and sometimes `npm run build:runtime-core`.

## Source References

- `packages/contracts/CLAUDE.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/memory.ts`
- `packages/contracts/src/bridge.ts`
- `packages/contracts/src/debug.ts`
- `packages/contracts/src/frontend-package.ts`
