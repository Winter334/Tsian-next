# platform-web Frontend Specs

`apps/platform-web` is the browser platform shell. It owns the Vue app, local platform host, Agent Runtime MVP implementation, Dexie persistence, bridge implementation, AI client/debug records, and remote/packaged frontend loading.

Use these specs when changing `apps/platform-web/src/**`.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Choosing where code belongs | Filled |
| [Component Guidelines](./component-guidelines.md) | Writing Vue route views and UI primitives | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Writing composables | Filled |
| [State Management](./state-management.md) | Updating Vue refs, Dexie state, and bridge state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Pre-commit checks and forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | Runtime boundary normalization and contract use | Filled |

## Required Checks

- Run `npm run build:web` for any platform-web change.
- Run `npm run build:contracts` when imported contract shapes change.

## Source References

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/views/LobbyView.vue`
- `apps/platform-web/src/views/DebugView.vue`

## Related Specs

- [Storage specs](../storage/index.md) — Dexie schema, checkpoint storage model, content-addressing. Read when changing `src/storage/**` or any Dexie table.
