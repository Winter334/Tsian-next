# prompt-engine Consumer Specs

This layer documents browser/frontend consumption of `@tsian/prompt-engine`. The package has no Vue components, hooks, or frontend state.

| Guide | Use When | Status |
|-------|----------|--------|
| [Type Safety](./type-safety.md) | Calling prompt assembly APIs from platform-web or workflow executors | Filled |

## Source References

- `packages/prompt-engine/src/tsian/assemble.ts`
- `apps/platform-web/src/workflow-host/executors/ai-call.ts`
- `apps/platform-web/src/workflow-host/builtin-presets/`
