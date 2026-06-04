# Directory Structure

`platform-web` is organized by runtime responsibility, not by generic Vue feature folders. Place new code where the state owner already lives.

## Top-Level Areas

- `src/views/` contains route-level screens loaded by `src/router/index.ts`. Keep route names kebab-case and view filenames PascalCase, as in `ResourceLibraryView.vue` and `DebugView.vue`.
- `src/components/` contains reusable Vue SFCs. Domain components live under subdirectories such as `components/workflow/` and `components/resource-library/`; primitive UI wrappers live under `components/ui/<primitive>/`.
- `src/composables/` contains reusable Vue state logic. `useWorkflowEditor.ts` is the reference for translating platform contracts into Vue Flow state.
- `src/storage/` owns Dexie tables and persistence helpers. Table interfaces and schema are centralized in `storage/db.ts`.
- `src/platform-host/` owns platform orchestration, bridge extension, workflow source resolution, and the main `interaction.sendMessage` path.
- `src/runtime-host/` owns browser runtime engine pieces: AI client, retrieval, patch applier, and `LocalRuntimeEngine`.
- `src/workflow-host/` owns platform-specific workflow executors, built-in workflow presets, and output state bridging.
- `src/bridge/` owns the base `PlayFrontendBridge`. Platform-specific capabilities are added in `platform-host`.

## Placement Rules

- Put browser persistence in `storage/`, not in view components. Example: resource CRUD lives in `storage/resources.ts`, while `ResourceLibraryView.vue` calls it.
- Put contract-to-editor mapping in composables or workflow helper files, not inline in templates. Example: `useWorkflowEditor.ts` normalizes `WorkflowDefinition` to Vue Flow nodes and edges.
- Put workflow executor behavior in `workflow-host/executors/`, not in `workflow-engine`. The engine package is pure scheduling and validation.
- Keep `platform-host/index.ts` as the orchestration boundary until a behavior is reused by multiple actions. The module document explicitly keeps this file cohesive because bridge, validation, and main-chain execution are tightly coupled.

## Import Rules

- Use `@/` for platform-web local imports when the file already uses alias style, as in `ResourceLibraryView.vue`.
- Use relative imports inside tightly coupled feature folders, as in `components/workflow/WorkflowEditorCanvas.vue`.
- Import shared shapes from `@tsian/contracts` and runtime interface types from `@tsian/runtime-core`; Vite and TS config map these aliases directly to workspace source.

## Avoid

- Do not add a new global store library. The current app uses Vue refs/computed/watch plus Dexie and bridge state.
- Do not place IndexedDB schema fields outside `storage/db.ts`.
- Do not implement concrete workflow nodes in `packages/workflow-engine`; use `apps/platform-web/src/workflow-host/executors/`.
