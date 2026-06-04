# contracts Consumer Specs

This layer documents how frontend/browser consumers should use `@tsian/contracts`. The package itself has no Vue components, hooks, or frontend state.

| Guide | Use When | Status |
|-------|----------|--------|
| [Type Safety](./type-safety.md) | Consuming shared contracts from platform-web or play frontends | Filled |

## Required Checks

- Run `npm run build:contracts` after editing contract source.
- Run the consuming frontend build, usually `npm run build:web`.

## Source References

- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`
- `packages/contracts/src/debug.ts`
- `packages/contracts/src/workflow.ts`
- `apps/platform-web/src/bridge/play-frontend-bridge.ts`
- `apps/platform-web/src/platform-host/index.ts`
