# workflow-engine Consumer Specs

This layer documents frontend/browser integration with `@tsian/workflow-engine`. The package itself has no Vue components or hooks.

| Guide | Use When | Status |
|-------|----------|--------|
| [Type Safety](./type-safety.md) | Using workflow engine APIs from platform-web | Filled |
| [State Management](./state-management.md) | Wiring outputs hooks into browser debug state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Verifying frontend integration assumptions | Filled |

## Source References

- `packages/workflow-engine/src/scheduler.ts`
- `packages/workflow-engine/src/types.ts`
- `apps/platform-web/src/workflow-host/outputs-store.ts`
- `apps/platform-web/src/workflow-host/executors/`
- `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
