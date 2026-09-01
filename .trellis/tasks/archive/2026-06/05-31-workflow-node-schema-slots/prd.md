# Workflow Node Input/Output Schema and Semantic Slots

## Goal

Add a first-class way for workflow nodes to describe their expected input slots and produced output slots so the editor can show meaningful handles, labels, and connection guidance while preserving the current runtime model where edges inject upstream outputs into downstream `inputs[varName]`.

## What I Already Know

* The active task is `.trellis/tasks/05-31-workflow-node-schema-slots` and is currently in `in_progress`.
* `packages/contracts/src/workflow.ts` defines `WorkflowNode`, `WorkflowEdge`, `NodeOutputDeclaration`, and `NodeOutputExtractRule`.
* Current edges connect `from.nodeId/outputName` to `to.nodeId/varName`; `outputName` defaults to `raw`.
* `WorkflowNodeBase` has optional `outputs?: NodeOutputDeclaration[]` for `ai-call` and `compute`; it has no explicit `inputs` schema.
* The editor serializes workflow definitions through `apps/platform-web/src/composables/useWorkflowEditor.ts`.
* `WorkflowNode.vue` renders source handles from declared outputs and switch config; it always renders one target handle named `input`.
* `NodeInspector.vue` only shows `OutputsEditor` for `ai-call` and `compute`.
* `WorkflowEditorCanvas.vue` validates through `validateWorkflowDefinition`, emits full workflow definitions, and lets users edit edge `varName`.
* `workflow-engine` validation currently checks graph shape, node types, result names, and `apply-patch` input completeness, but not generic port/schema compatibility.
* Earlier PRDs intentionally left typed input schemas out of scope, so this task is the natural follow-up rather than a regression fix.

## Assumptions (Temporary)

* Existing saved workflow JSON must remain loadable without migration.
* Schema/slot metadata should help users build workflows but should not immediately change executor behavior.
* Semantic slots should be open strings rather than a closed enum at first, because the platform will likely add node kinds and mod-defined semantics later.
* The MVP should avoid adding a full expression language, runtime coercion layer, or JSON Schema dependency.

## Requirements (Evolving)

* Extend the workflow contract with optional node input declarations.
* Extend output declarations with human/editor metadata without breaking existing `extract` behavior.
* Preserve current edge serialization and runtime injection semantics.
* Let the editor display declared input and output slots with stable handle IDs.
* Keep legacy workflows working when schema fields are absent.
* Provide default slot/schema metadata for existing built-in node types where it can be derived safely.
* Keep result nodes as the external workflow output surface; do not add top-level `workflow.outputs`.

## Acceptance Criteria (Evolving)

* [x] Existing workflow presets without `inputs` or output metadata still load, render, export, and execute.
* [x] Workflow JSON can round-trip optional input declarations and output metadata.
* [x] Built-in node types show useful input/output slot labels in the editor.
* [x] Edges still serialize as `from.outputName -> to.varName`.
* [x] Validation remains backward compatible for old workflows.
* [x] Build/typecheck commands pass for touched packages.

## Definition of Done

* Tests added or updated for contract round-trip and editor serialization where practical.
* `npm run build:web` passes.
* `npm run build:contracts` passes if contracts are touched.
* Relevant `.trellis/spec` docs reviewed before implementation.
* Any new cross-layer workflow contract is captured in `.trellis/spec` if it proves reusable.

## Research References

* [`research/workflow-schema-slots-patterns.md`](research/workflow-schema-slots-patterns.md) - comparable workflow tools favor visible variable/port metadata first, with stronger runtime enforcement as a separate step.

## Technical Approach Options

### Approach A: Schema Metadata Only (Recommended MVP)

Add optional `inputs` on workflow nodes and optional metadata fields on outputs:

* `valueType?: "string" | "number" | "boolean" | "object" | "array" | "unknown"` or similar lightweight value kinds.
* `label?: string`
* `description?: string`
* `semanticSlot?: string`
* `required?: boolean` for input declarations only.

Runtime remains unchanged. The editor uses the metadata for handles, labels, suggestions, and documentation.

### Approach B: Metadata + Editor Validation

Implement Approach A and add non-breaking editor validation for required inputs, unknown declared slots, duplicate port names, and obvious type mismatch warnings.

### Approach C: Runtime-Enforced Schemas

Make schemas authoritative during `validateWorkflowDefinition` and/or execution. Reject incompatible edges or invalid produced values before node execution.

## Recommended Decision

Choose Approach A for this task. Defer Approach B and C until there are concrete failures or UX gaps that justify stronger guardrails or runtime enforcement.

## Decision (ADR-lite)

**Context**: The current workflow model already uses edge-injected inputs and does not declare `inputs` schemas. We need slot metadata for editor clarity without breaking existing saved workflows or runtime behavior.

**Decision**: Implement schema/slot metadata only. Add optional node input declarations and output metadata, but keep execution semantics unchanged.

**Consequences**:

* Existing workflows remain valid without migration.
* The editor can show richer handles, labels, and guidance.
* Runtime validation remains conservative and backward compatible.
* Strong type enforcement stays out of scope for this task.

## Expansion Sweep

### Future Evolution

* Mod-defined/custom node types may need to contribute their own default slot metadata.
* A later workflow debugger could use declared schemas to render better input/output previews.

### Related Scenarios

* Resource-library workflow presets should display the same slot metadata in preview and edit modes.
* Import/export should preserve fields even if the current editor does not expose every metadata field yet.

### Failure and Edge Cases

* Duplicate port names can break edge identity and handle targeting.
* Renaming a port should not silently orphan existing edges.
* Workflows with old JSON should avoid false validation errors.
* Semantic slot names should not be treated as executable permissions.

## Out of Scope (Proposed)

* Adding new executable node types.
* Replacing `WorkflowEdge.to.varName` with typed target handles.
* Full JSON Schema validation or runtime coercion.
* Expression language, JSONPath routing, or computed edge mappings.
* Retrieval node-ization or broader memory architecture changes.

## Technical Notes

* Contracts: `packages/contracts/src/workflow.ts`
* Editor serialization: `apps/platform-web/src/composables/useWorkflowEditor.ts`
* Canvas and validation UI: `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
* Node rendering: `apps/platform-web/src/components/workflow/WorkflowNode.vue`
* Inspector: `apps/platform-web/src/components/workflow/NodeInspector.vue`
* Output editor: `apps/platform-web/src/components/workflow/inspector/OutputsEditor.vue`
* Built-in workflow fixture: `apps/platform-web/src/workflow-host/default-workflow.ts`
* Engine validation: `packages/workflow-engine/src/validator.ts`

## Open Questions

* None.
