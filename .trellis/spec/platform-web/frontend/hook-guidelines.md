# Composable Guidelines

Composables are used for reusable Vue state and contract mapping. They should not hide platform persistence or workflow execution side effects.

## Reference Pattern: `useWorkflowEditor`

`apps/platform-web/src/composables/useWorkflowEditor.ts` is the main local example.

- It owns Vue Flow `nodes`, `edges`, and `selectedNodeId` as `Ref` values.
- It translates `WorkflowDefinition` into Vue Flow nodes and edges, and back again.
- It normalizes unknown imported JSON before placing it in reactive state.
- It returns explicit commands such as `loadWorkflowDefinition`, `toWorkflowDefinition`, `addNode`, `updateNodeConfig`, and `updateEdgeData`.

## Boundary Rules

- Keep contract normalization inside the composable when the state is editor-specific. Example: `normalizeInputs`, `normalizeOutputs`, and `normalizeExtractRule` keep imported workflow JSON safe for the editor.
- Keep persistence outside the composable unless the composable name and scope make persistence explicit. `useWorkflowEditor` does not call Dexie.
- Return commands, not hidden watchers, for domain mutations. The caller should decide when to save, emit, or validate.
- Preserve existing contract semantics when mapping to UI. Workflow edges
  serialize as `from.outputName -> to.inputName`; visual handles are derived
  from declarations.

## Watcher Use

- Watchers are acceptable for synchronization with props and debounced validation. `WorkflowEditorCanvas.vue` watches `props.initialDefinition` and `[nodes, edges]`.
- Use guard flags for load cycles. `WorkflowEditorCanvas.vue` uses `isLoadingDefinition`, `lastLoadedDefinitionJson`, and `lastEmittedDefinitionJson` to prevent self-emitted changes from reloading the canvas.
- Clear timers in `onBeforeUnmount` when a watcher schedules work.

## Avoid

- Do not create composables that mutate global singleton state without making that explicit in the name and docs.
- Do not make a composable depend on browser-only storage if it is meant to be reusable by domain components.
- Do not bypass existing normalization helpers when importing JSON into editor state.
