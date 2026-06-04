# Component Guidelines

Vue components use `<script setup lang="ts">` and keep behavior close to the UI when it is screen-local. Shared state logic moves to composables.

## Component Shapes

- Route views in `src/views/` own screen layout, orchestration, and calls to storage/platform APIs. `ResourceLibraryView.vue` is the reference for a complex route view with tabs, draft state, resource persistence, and fullscreen editors.
- Domain components live under a feature folder. `components/workflow/WorkflowEditorCanvas.vue` composes Vue Flow, toolbar, validation, inspector, and edge editing.
- Primitive UI components live under `components/ui/<primitive>/` and export through `index.ts`. `components/ui/button/Button.vue` wraps `reka-ui` `Primitive` and composes classes with `cn`.
- Inspector/form components receive data and callbacks instead of importing persistence. `NodeInspector.vue` delegates config updates through `onUpdateConfig`, `onUpdateOutputs`, `onDeleteNode`, and related props.

## Props And Events

- Prefer explicit `defineProps` and `defineEmits` signatures. Example: `WorkflowEditorCanvas.vue` emits `change`, `resetWorkflow`, and `saveWorkflow` with concrete payloads.
- For callback-style child forms, type callback props directly. Example: workflow inspector forms receive `onUpdate` callbacks and replace full config objects.
- In reusable components, preserve `class` passthrough and primitive props. `Button.vue` accepts `PrimitiveProps`, variant props, and `HTMLAttributes["class"]`.

## Local Draft Editing

- Resource editors clone incoming data before mutating. `PromptPresetEditor.vue` deep-clones `props.preset`, edits `localPreset`, and emits cloned data through `change`.
- Keep draft save state explicit. `ResourceLibraryView.vue` tracks `workflowSaveStatus` as `saved | dirty | saving | error`.
- Block destructive resource delete when references exist. `ResourceLibraryView.vue` checks workflow references before deleting prompt presets or world books.

## Styling

- Current platform UI uses Tailwind utility classes and project tokens such as `bg-void`, `bg-panel`, `text-neon`, `border-neon-muted`, and `font-mono`.
- For UI primitives, compose variants with `class-variance-authority` and merge user classes with `cn` from `src/lib/utils.ts`.
- Domain screens currently use bold cyber/terminal styling. Preserve it unless a task explicitly redesigns the visual language.

## Avoid

- Do not let a component silently write storage when it should emit a draft change. Route views or storage helpers should own persistence.
- Do not expose Vue refs through bridge or contracts. Bridge contracts are framework-neutral.
- Do not add untyped `any` props for reusable components unless the upstream library type forces it, as Vue Flow node data currently does in workflow inspector code.
