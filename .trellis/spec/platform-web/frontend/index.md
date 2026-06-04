# platform-web Frontend Specs

`apps/platform-web` is the browser platform shell. It owns the Vue app, local runtime host, Dexie persistence, bridge implementation, resource library, and workflow editor.

Use these specs when changing `apps/platform-web/src/**`.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Choosing where code belongs | Filled |
| [Component Guidelines](./component-guidelines.md) | Writing Vue SFCs and UI primitives | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Writing composables such as workflow editor state | Filled |
| [State Management](./state-management.md) | Updating Vue refs, Dexie state, bridge state, and workflow output state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Pre-commit checks and forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | Runtime boundary normalization and contract use | Filled |

## Required Checks

- Run `npm run build:web` for any platform-web change.
- Run `npm run build:contracts` too when imported contract shapes change.
- For workflow execution or patch behavior, also run `npm run build:workflow-engine` and relevant workflow-engine tests when touched.

## Source References

- `apps/platform-web/CLAUDE.md`
- `apps/platform-web/src/router/index.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/composables/useWorkflowEditor.ts`
- `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
