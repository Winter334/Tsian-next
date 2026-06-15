# Directory Structure

`platform-web` is organized by runtime responsibility.

## Top-Level Areas

- `src/agent-runtime/` owns browser-hosted Agent Runtime orchestration.
- `src/platform-host/` owns local platform orchestration, save lifecycle, bridge implementation, model-call injection, checkpoint creation, and the active `interaction.sendMessage` path.
- `src/runtime-host/` owns `LocalRuntimeEngine` and browser AI client/debug records.
- `src/storage/` owns Dexie schema and persistence helpers. Table interfaces and schema stay in `storage/db.ts`.
- `src/bridge/` owns framework-neutral bridge adapters.
- `src/views/` owns route-level Vue screens.
- `src/package-loader/` owns packaged frontend virtual URL loading.
- `src/components/ui/` owns reusable UI primitives.

## Placement Rules

- Put Agent Runtime turn composition in `agent-runtime`, not in Vue components or play frontends.
- Inject platform capabilities into Agent Runtime from `platform-host`; Agent Runtime should not import bridge objects or Dexie tables directly.
- Put browser persistence in `storage/`, not in route views.
- Keep `platform-host/index.ts` as the orchestration boundary until behavior is reused by multiple actions.
- Do not add a same-realm built-in game frontend; default playable UI should be a remote or packaged Game Card frontend.

## Import Rules

- Import shared shapes from `@tsian/contracts`.
- Import `RuntimeEngine` from `@tsian/runtime-core`.
- Use `@/` for local platform-web imports when the file already uses alias style.

## Avoid

- Do not reintroduce workflow-host, workflow editor, prompt preset resource UI, or builtin mod dependencies as active runtime surfaces.
- Do not place IndexedDB schema fields outside `storage/db.ts`.
- Do not add a global store library; use Vue refs/computed/watch plus Dexie and explicit platform APIs.
