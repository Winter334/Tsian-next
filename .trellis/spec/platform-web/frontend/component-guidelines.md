# Component Guidelines

Vue components use `<script setup lang="ts">`. Route views may own screen-local state and call platform APIs; shared logic should move to small helpers or composables.

## Route Views

- `LobbyView.vue` owns contentless session create/select/delete flows.
- `SettingsView.vue` owns browser chat model configuration.
- `DebugView.vue` owns read-only observability for AI debug, history, checkpoints, and snapshot.
- `PlayView.vue` mounts the active play frontend and should remain a thin loader.

## UI Rules

- Preserve the current restrained cyber/terminal styling unless a task explicitly redesigns the visual language.
- Use existing UI primitives under `components/ui/`.
- Keep repeated fixed-format elements stable with explicit grid/flex constraints.
- Do not put long-running runtime logic inside templates.

## Bridge And Persistence

- Components may call exported platform-host functions for platform shell actions.
- Play frontends must use `PlayFrontendBridge`; they must not import platform-web storage or model code.
- Components should not silently write Dexie except through storage helpers or platform-host APIs.

## Avoid

- Do not restore mod/resource/workflow editor routes as part of routine UI work.
- Do not expose Vue refs through contracts or bridge payloads.
- Do not add untyped `any` props to reusable components unless an upstream library forces it.
