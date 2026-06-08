# Special Node Standardization Research

## Question

How should state database authoring nodes and AI call nodes fit into a standardized workflow node definition model?

## Files Inspected

* `apps/platform-web/src/components/workflow/StateDatabaseEditorDialog.vue`
* `apps/platform-web/src/components/workflow/state-model-view.ts`
* `apps/platform-web/src/components/workflow/state-contract.ts`
* `apps/platform-web/src/workflow-host/state-model-compiler.ts`
* `apps/platform-web/src/components/workflow/inspector/AiCallForm.vue`
* `apps/platform-web/src/workflow-host/executors/ai-call.ts`
* `apps/platform-web/src/workflow-host/executors/state-query.ts`
* `apps/platform-web/src/workflow-host/executors/state-write.ts`
* `apps/platform-web/src/workflow-host/index.ts`
* `apps/platform-web/src/workflow-host/types.ts`

## Findings

### State Database

The visual state database node is not an executable DAG node. It is an authoring anchor stored under `WorkflowStateModel`:

* `stateModel.schema` owns the durable state schema.
* `stateModel.anchors` render visual database anchors and ports.
* `stateModel.links` bind anchors to executable `state-query` and `state-write` nodes.
* `compileWorkflowStateModel` compiles those links into executable node config (`namespace`, `collection`, `schema`) before runtime.

This means the state database visual node should not be forced into the same definition shape as executable function nodes. The executable nodes to standardize are `state-query` and `state-write`; the database anchor should remain a special authoring surface for state schema and collection-port binding.

### State Query / State Write

`state-query` and `state-write` are executable nodes and should be standard definitions.

Important dynamic port behavior:

* `state-query` input port name comes from `config.queryVarName`, fallback `query`.
* `state-write` input port name comes from `config.operationsVarName`, fallback `operations`.
* Their state target UI depends on `WorkflowStateModel` link targets and schema collection views.

They need standard display, ports, defaults, and executor references, but should keep custom config form support for state model-aware selectors.

### AI Call

`ai-call` is an executable DAG node and should be a standard definition, but its internals are specialized:

* It requires platform workflow context with `presets`, `worldBooks`, `history`, and `macros`.
* Inputs are merged into prompt macros, including flattened dot-path macros.
* It assembles messages through `@tsian/prompt-engine` using prompt presets and world books.
* It always outputs `raw`; declared output ports use extract rules (`raw`, `tag`, `regex`) with optional parsing.
* The current form needs prompt preset/resource selectors and world book selectors.

AI call should standardize its outer shell: display metadata, default outputs, output declaration behavior, config defaults, and executor reference. The prompt-engine-specific editor can remain a custom editor keyed by the definition.

### Executor Registry

The runtime currently builds executors from a hard-coded map in `workflow-host/index.ts`. Node standardization can introduce a definition registry that references builtin executor IDs. The initial implementation can keep the executor map but make definitions point at the same IDs.

## Recommendation

Use a three-category model for MVP:

1. **Executable workflow nodes**: normal standard definitions with executor IDs. Includes `ai-call`, `state-query`, `state-write`, `compute`, `template-compose`, record nodes, `switch`, and `result`.
2. **Authoring-only visual anchors**: not workflow definitions and not executors. Includes state database anchors under `WorkflowStateModel`.
3. **Custom editors for complex definitions**: a standard definition may specify a custom editor component key. AI call and state query/write can use this while still sharing registry-driven display, ports, defaults, diagnostics, and executor references.

This keeps the player-facing function model intact without pretending every canvas object is the same kind of executable node.

## Feasible Approaches

### Approach A: Standard shell, custom internals (recommended)

Standardize all executable nodes, including AI call and state query/write, but keep custom editors where needed. Keep state database anchors outside executable node definitions.

Pros:

* Covers core AIRP nodes in the new model.
* Avoids forcing state database anchors into an incorrect abstraction.
* Keeps implementation scope moderate.

Cons:

* Does not make every config form generic in the first pass.

### Approach B: Generic config forms for everything possible

Move most node forms to definition-driven fields and use custom editors only for complex subsections.

Pros:

* Reduces form code over time.
* Moves closer to player-created nodes.

Cons:

* Larger first pass.
* Harder for AI call and state model-aware selectors.

### Approach C: Exclude special nodes initially

Standardize only simple function nodes first and leave AI/state nodes fully legacy.

Pros:

* Lowest implementation risk.

Cons:

* Leaves the most important AIRP nodes outside the new model.
* Delays validation of the abstraction where it matters most.
