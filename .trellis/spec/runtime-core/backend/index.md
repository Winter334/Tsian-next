# runtime-core Authoring Specs

`packages/runtime-core` is a tiny shared interface package. It defines `RuntimeEngine` and re-exports it. The browser implementation lives in `apps/platform-web/src/runtime-host/engine.ts`.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Editing the interface package | Filled |
| [Error Handling](./error-handling.md) | Deciding where runtime errors belong | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Verifying interface changes | Filled |

## Required Checks

- Run `npm run build:runtime-core` for every runtime-core change.
- Run `npm run build:web` if `RuntimeEngine` changes, because platform-web implements it.
- Run `npm run build:contracts` first if the change depends on new contract types.
