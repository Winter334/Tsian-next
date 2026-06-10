# Component Guidelines

Vue components use `<script setup lang="ts">` and keep behavior close to the UI when it is screen-local. Shared state logic moves to composables.

## Component Shapes

- Route views in `src/views/` own screen layout, orchestration, and calls to storage/platform APIs. `ResourceLibraryView.vue` is the reference for a complex route view with tabs, draft state, resource persistence, and fullscreen editors.
- Domain components live under a feature folder. `components/workflow/WorkflowEditorCanvas.vue` composes Vue Flow, toolbar, validation, inspector, and edge editing.
- Primitive UI components live under `components/ui/<primitive>/` and export through `index.ts`. `components/ui/button/Button.vue` wraps `reka-ui` `Primitive` and composes classes with `cn`.
- Inspector/form components receive data and callbacks instead of importing persistence. `NodeInspector.vue` delegates config updates through `onUpdateConfig`, `onUpdateOutputs`, `onDeleteNode`, and related props.

## Workflow Editor Authoring Surface

- Fullscreen workflow editing is canvas-first. Do not reintroduce a permanent left palette or narrow right inspector as the primary editing path for authorable workflows.
- Add nodes from the canvas context menu and open node editors through double-click or node context-menu actions. Complex node configuration belongs in a large dialog that can host the existing form inspector plus advanced fallback controls.
- Node raw editing is limited to the authoring payload fields `label`, `config`, `inputs`, `outputs`, and `retry`. It must reject graph identity or layout fields such as `id`, `type`, and `position`.
- Edge dialogs and edge context menus should treat workflow edges as pure
  connections. They may show/delete a connection, but must serialize through
  the workflow edge contract: `from.outputName` feeds `to.inputName`.
- Workflow-level diagnostics and future state-contract summaries belong in the collapsible bottom drawer so the graph canvas remains the dominant workspace.

### Convention: Node Port Handle Alignment

**What**: Workflow node cards should render each Vue Flow `Handle` inside the
same DOM row as its visible input/output port label, then offset the handle to
the card edge from that row.

**Why**: Node headers and config summaries can change height. Independent
percentage-based handle positioning drifts away from the visible port labels
and makes authors connect the wrong input/output.

**Example**:

```vue
<div class="workflow-port-row relative flex items-center">
  <Handle
    type="target"
    :id="slot.name"
    :position="Position.Left"
    class="workflow-port-handle workflow-port-handle--input"
  />
  <p>{{ portLabel(slot) }}</p>
</div>
```

**Rules**:
- Keep the runtime contract as `from.outputName -> to.inputName`; handle IDs
  must remain contract port names, not visual-only IDs.
- Preserve the fallback `input` handle for legacy/custom nodes without explicit
  input declarations.
- Avoid calculating port handle `top` from the whole card unless there is no
  corresponding visible port row.

### Convention: Editor-Only Workflow Diagnostics

**What**: Platform workflow editors may add authoring diagnostics on top of
`validateWorkflowDefinition`, but the engine validator remains the structural
contract. Editor diagnostics should live in feature-local helpers such as
`components/workflow/workflow-diagnostics.ts` and return user-facing Chinese
messages for missing config, missing resource references, and invalid
declared/derived ports.

**Why**: Runtime validation proves graph structure, while authors need earlier
feedback for configuration that would fail or behave surprisingly at execution
time. Keeping these checks editor-local prevents platform-web UI guidance from
changing `packages/workflow-engine` scheduling semantics.

**Example**:

```typescript
function runValidation(def: WorkflowDefinition): void {
  const messages: string[] = []
  try {
    validateWorkflowDefinition(def)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    messages.push(translateValidationError(message))
  }
  messages.push(...collectWorkflowEditorDiagnostics(def, { promptPresetOptions }))
  validationErrors.value = Array.from(new Set(messages))
}
```

**Rules**:
- Do not contradict or suppress `validateWorkflowDefinition` errors.
- Do not save editor-only handle IDs or diagnostics into the workflow runtime schema.
- Keep edge checks aligned with the runtime contract: `from.outputName -> to.inputName`.
- Only warn about missing external resources when the relevant option list has been loaded.

### Scenario: Workflow-Carried State Database Model

#### 1. Scope / Trigger

- Trigger: authorable workflows need visible durable-state data flow, including
  collection schema, database read links, and database write links.
- Goal: the editor shows a state database model without turning database anchors
  into executable workflow nodes or state links into runtime DAG edges.

#### 2. Signatures

- Contract owner: `WorkflowDefinition.stateModel`.
- Schema owner: `stateModel.schema?: MemorySchemaDefinition`.
- Visual anchors: `stateModel.anchors?: WorkflowStateModelAnchor[]`.
- Visual read/write bindings: `stateModel.links?: WorkflowStateModelLink[]`.
- Runtime compile boundary:
  `compileWorkflowStateModel(def: WorkflowDefinition): WorkflowDefinition`.

#### 3. Contracts

- `stateModel.schema` is the source of truth for collection definitions. Do not
  create new schema-authoring UI under `state-write.config.schema`.
- Database anchors are editor-only Vue Flow nodes rendered from
  `stateModel.anchors`; they must be filtered out of executable
  `WorkflowDefinition.nodes` on export.
- Database links are editor-only Vue Flow edges rendered from
  `stateModel.links`; they must be filtered out of executable
  `WorkflowDefinition.edges` on export.
- Read links are `database collection -> state-query`; write links are
  `state-write -> database collection`.
- Runtime execution uses a temporary compiled definition. The source workflow
  keeps `stateModel` clean, while the compiled definition injects
  `namespace`, `collection`, and schema into existing `state-query` /
  `state-write` configs.
- Node cards and inspector forms may read `stateModel.links` to display
  database read/write target summaries. If Vue Flow node data carries an
  editor-only `stateModel` snapshot for that display, export code must strip it
  and must not serialize it into executable `WorkflowNode` payloads.
- The bottom drawer is a read-only state database/field-definition view. Field
  editing belongs in the database node editor dialog. Field rows should expose
  usable input paths such as `records[].data.<field>` so authors can map schema
  fields to structured workflow variables.

#### 4. Validation & Error Matrix

- Missing linked anchor/port/node -> editor diagnostic and compile-time error.
- Unbound database port -> editor diagnostic and compile-time error.
- Read link targeting non-`state-query` -> diagnostic/compile error.
- Write link targeting non-`state-write` -> diagnostic/compile error.
- Multiple read links for one `state-query` -> MVP diagnostic/compile error.
- Write link to multiple collections -> allowed; operations must carry explicit
  `collection` unless there is only one target.

#### 5. Good/Base/Bad Cases

- Good: a workflow stores `archives/events/globals` definitions in
  `stateModel.schema`, renders two database anchors for read/write layout, and
  compiles links only immediately before execution.
- Base: an advanced imported workflow still carries manual
  `state-query.config.namespace/collection`; editor diagnostics treat it as a
  compatibility path when no state link exists.
- Bad: adding a no-op `state-database` executable node type so the scheduler can
  "run" database anchors.
- Bad: saving state link handle IDs into normal `WorkflowEdge` objects.
- Bad: editing collection fields from both the database dialog and the
  `state-write` form, creating two apparent schema sources.

#### 6. Tests Required

- Run `npm run build:contracts` when `WorkflowDefinition.stateModel` changes.
- Run `npm run build:web` for editor rendering, import/export, or compiler
  integration changes.
- Run `npm run build:workflow-engine` and
  `npm run test --workspace @tsian/workflow-engine` when default workflow static
  proofs or scheduler-facing assumptions change.
- Browser smoke should verify resource workflow preview/fullscreen editor show
  database anchors, state links, node read/write target summaries, bottom-drawer
  field paths, and the database editor dialog.

#### 7. Wrong vs Correct

##### Wrong

```ts
const workflow: WorkflowDefinition = {
  nodes: [{ id: "db", type: "state-database", config: {} }],
  edges: [{ from: { nodeId: "db" }, to: { nodeId: "query", inputName: "collection" } }],
}
```

##### Correct

```ts
const workflow: WorkflowDefinition = {
  nodes: [{ id: "query", type: "state-query", config: { source: "collection" } }],
  edges: [],
  stateModel: {
    schema,
    anchors: [{ id: "dbRead", kind: "database", ports: [{ id: "archives", collection: "archives" }] }],
    links: [{ id: "readArchives", kind: "read", anchorId: "dbRead", portId: "archives", nodeId: "query" }],
  },
}
```

Editor UI may surface schema self-consistency issues by reusing the memory-core
schema validator, but it must not attempt whole-workflow semantic proofs of AI
output shapes, runtime record existence, renderer compatibility, or edge value
payloads. Runtime `state-write` validation remains the final write safety
boundary.

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
