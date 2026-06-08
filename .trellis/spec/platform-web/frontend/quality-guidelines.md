# Quality Guidelines

Quality for `platform-web` is mostly type safety, build success, and preserving cross-layer runtime contracts.

## Required Checks

- Run `npm run build:web` after any change under `apps/platform-web`.
- Run `npm run build:contracts` if a change imports or modifies contract shapes.
- Run `npm run build:workflow-engine` and `npm run test --workspace @tsian/workflow-engine` when platform code changes workflow-engine behavior assumptions or static proof tests.

## Project Rules

- Prefer fail loud over hidden fallback. The base bridge throws for unavailable write APIs, and platform actions return explicit `PlatformActionError` objects.
- Do not expand scope opportunistically. The root project guidance says prototype work should stay on the current user-requested task.
- Do not add migrations or compatibility layers for local IndexedDB without explicit approval. The prototype rule is to clear and rebuild local data.
- Keep bridge APIs framework-neutral. Do not leak Vue refs, Dexie tables, or component types into `@tsian/contracts`.

### Convention: Viewport-Owned Fullscreen Routes

When a route bypasses the normal platform shell while `body` or the app root keeps `overflow: hidden`, that route must own its viewport height and vertical scrolling.

Why: the document cannot scroll, so short screens will clip chat panes, inspectors, and action areas unless the route provides its own bounded scroller.

Example:

```vue
<div class="h-dvh overflow-x-hidden overflow-y-auto">
  <router-view />
</div>
```

Use `dvh` instead of `vh` for route wrappers and embedded fullscreen panels that should track the visible browser viewport.

## Review Checklist

- If a resource or workflow JSON round-trips through the editor, verify unknown/advanced fields are preserved unless the task intentionally rewrites them.
- If a workflow edge changes, verify it still serializes as `from.outputName -> to.inputName`.
- If a patch path changes, verify bridge `applyPatch`/`updateGlobals` still
  share `applyMaintenancePatch`, and do not restore the retired workflow
  `apply-patch` executor.
- If runtime snapshot changes, verify `retrievalDebugBySave` or related debug state is invalidated when the active timeline changes.
- If route/view code changes, verify lazy route names and links still match `router/index.ts`.
- If a route owns the viewport outside the standard shell, verify short-height screens can still reach bottom content via route-level scrolling.

## Avoid

- Do not add broad catch blocks around workflow execution or patch application just to keep the UI quiet.
- Do not create duplicate storage helpers for the same table.
- Do not write long-running business logic inside Vue templates; move it to script helpers, storage helpers, platform-host, or workflow-host as appropriate.
