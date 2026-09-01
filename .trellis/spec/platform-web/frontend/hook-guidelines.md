# Composable Guidelines

Composables are for reusable Vue state and UI coordination. They should not hide platform persistence or Agent Runtime side effects unless the composable name and scope make that explicit.

## Rules

- Return explicit commands for domain mutations; callers decide when to save or refresh.
- Keep Dexie writes in storage helpers or platform-host APIs.
- Keep model calls in platform-host/runtime-host, not in composables.
- Clear timers and subscriptions in `onBeforeUnmount`.

## Avoid

- Do not create composables that mutate global singleton state without making that explicit.
- Do not bypass bridge/platform APIs from play frontend code.
- Do not use composables to recreate workflow editor state for the retired DAG system.

## Pattern: Break composable ↔ composable init cycles with dynamic import

**Problem**: `useTsian` needs to consume `useRuntime` inside its `send()` method to
snapshot the runtime state at send time. But `useRuntime` already `import`s
`useTsian` at module top-level to register turn/sync/stale refresh triggers.
A reverse static `import` from `useTsian` back into `useRuntime` creates a
module init cycle: `useRuntime` calls `useTsian()` in `registerTriggers` before
`useTsian`'s module fully initialized.

**Solution**: Keep the "leaf" composable (`useTsian`) free of static imports from
the "consumer" composable (`useRuntime`). Do a dynamic `await import()` only at
call-site where the singleton is actually consumed:

```ts
// composables/useTsian.ts
async send(text: string): Promise<void> {
  // ... state guards ...
  const { useRuntime } = await import("./useRuntime")
  const { runtimeData } = useRuntime()
  const result = await buildContextInjection({
    workspace: tsian.workspace,
    runtimeData: runtimeData.value,
  })
  // ...
}
```

**Trade-off**: Vite emits an informational warning
("dynamically imported but also statically imported ... will not move module
into another chunk"). This is expected and non-fatal — leave a code comment
next to the dynamic import so future readers do not "fix" it back into a
static import.

**When NOT to use**: If the consumer composable can accept the singleton as an
argument (dependency injection) or if the state read can be pushed up to the
caller, prefer that. Dynamic import is a last resort for module-level
singleton composables.

## Pattern: Pure lib + composable-thin-wire for pre-send injection

When the frontend needs to derive extra context per action (e.g. inject
runtime/scene/character summaries into `interaction.sendMessage`), keep the
logic in a **pure lib module** (`lib/*.ts`) that takes `workspace.read` +
snapshot data as inputs and returns a discriminated `{ status: "ok" | "blocked" }`
result. Do NOT put the build logic in a composable — pure functions are
unit-testable without vue mounting and reusable from non-vue call sites.

The composable only does 3 things:
1. Read the current snapshot from the relevant `useRuntime` / `useScene` singletons.
2. Call the pure builder.
3. Forward ok result to the bridge call or expose the blocked reason via a
   readonly `Ref` so UI can render an error banner.

Example: `apps/play-frontend-dev/src/lib/context-injection.ts` +
`useTsian.send`.
