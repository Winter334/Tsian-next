# Workflow-Carried State Contract Authoring MVP

## Goal

Make workflow-carried state contracts visible and minimally authorable in the workflow editor, so workflow developers and advanced players can define custom state collections/schemas inside a workflow instead of being limited to the pre-defined AIRP `events / archives / globals` schema or raw JSON.

This task should directly support the workflow-as-system direction: a configured workflow should naturally explain what state model it maintains.

## What I Already Know

- Direction docs now treat Tsian as a workflow-as-system platform.
- The reusable system unit should eventually be a workflow block / subworkflow / system package carrying its state contract, not an isolated schema resource.
- `collection` is currently a logical key inside save-scoped `stateRecords`; it is not a separate Dexie table.
- Users can already configure `state-query` / `state-write` against arbitrary `namespace + collection`, but uncovered custom collections are storage-only.
- Default AIRP schema is currently defined in code as `defaultAirpMemorySchema` and carried by the default workflow's `state-write` node.
- `state-write.config.schema` is already the runtime schema validation boundary for covered operations.
- The workflow editor now has a canvas-first fullscreen layout with large node dialogs and a bottom drawer containing a reserved state-contract tab.
- Current `StateWriteForm.vue` exposes operations var, default namespace, default collection, and checkpoint behavior, but not schema authoring.
- `record-filter`, `record-merge`, and `record-format` are public generic workflow nodes used by the default AIRP workflow, but they still lack specialized inspector forms.

## Requirements

- Add workflow editor support for inspecting the workflow-carried state contract.
- Use the bottom drawer state-contract tab to summarize:
  - collections read by `state-query`;
  - collections written or schema-covered by `state-write`;
  - namespace / collection pairs;
  - which collections have schema coverage and which are storage-only;
  - which nodes participate in each collection.
- Add a focused schema authoring UI for `state-write.config.schema`.
- The schema authoring UI should support MVP-level fields:
  - schema `id`, `name`, `version`, `defaultNamespace`;
  - collection name, label, description, version, primaryKey;
  - fields with name, type, label, description, required, enum as raw/simple text, and default as raw JSON where practical;
  - `additionalFields` toggle for JSON extension fields;
  - field relation metadata with target collection, target field, and cardinality;
  - collection index metadata with name, fields, unique, and description.
- Keep relation/index authoring simple. The editor should help authors define the metadata, but it should not attempt to prove full workflow correctness.
- Visual relation editing is limited to collections inside the same workflow-carried schema. Cross-namespace or external-schema relations remain advanced/raw JSON territory until system package boundaries exist.
- Validation policy:
  - perform schema self-consistency checks that match existing memory-core validation where practical;
  - surface schema issues in the node dialog or workflow state-contract drawer;
  - avoid static validation of AI outputs, edge value shapes, runtime record existence, renderer compatibility, or whole-workflow semantic correctness;
  - keep `state-write` runtime validation as the final safety boundary.
- Preserve the raw node editing fallback for advanced schema details that are not covered by the form.
- Preserve runtime behavior:
  - schema-covered `state-write` operations are validated before storage;
  - custom uncovered collections remain storage-only;
  - old retired workflow nodes remain fail-loud.
- Improve authorability for current public generic record nodes enough that default AIRP workflow can be mostly understood and edited through UI:
  - `record-filter`;
  - `record-merge`;
  - `record-format`.
- Do not introduce standalone schema resources in this task.
- Do not implement workflow block/subworkflow/system package in this task.

## Acceptance Criteria

- [ ] Workflow editor bottom drawer shows a state-contract summary derived from current workflow nodes.
- [ ] The summary distinguishes schema-covered collections from storage-only collections.
- [ ] The summary links or identifies participating `state-query` and `state-write` nodes.
- [ ] `state-write` node dialog can create/edit a workflow-carried schema without using raw JSON for the common MVP fields.
- [ ] A custom namespace/collection schema can be authored in a workflow and saved/exported as part of the workflow preset.
- [ ] Relation metadata can be authored for fields with simple controls.
- [ ] Relation visual controls only target collections in the same node-carried schema.
- [ ] Index metadata can be authored for collections with simple controls.
- [ ] Schema authoring surfaces self-consistency errors without trying to guarantee full workflow/runtime correctness.
- [ ] Default AIRP `events / archives / globals` schema can be inspected without looking at raw JSON.
- [ ] Existing raw JSON fallback still supports advanced schema details not covered by form controls.
- [ ] `record-filter`, `record-merge`, and `record-format` have usable form editors.
- [ ] Existing default AIRP workflow still validates and opens in the editor.
- [ ] `npm run build:web` passes.
- [ ] Shared package builds/tests are run if contracts or runtime validation behavior change.

## Assumptions

- This task can stay mostly in platform-web editor/UI because the runtime already supports node-carried schemas.
- The existing `MemorySchemaDefinition` shape remains the MVP contract even though product language shifts toward state contract.
- Schema authoring can be node-local for now; workflow-level extraction/normalization can be derived from nodes.
- A full visual schema designer, schema resource system, and block/subworkflow packaging are future tasks.

## Open Questions

- None for the current MVP scope.

## Technical Approach

- Add a small workflow state-contract analyzer for editor use.
- Extend the bottom drawer state-contract tab to render analyzer output.
- Extend `StateWriteForm.vue` or introduce child components for schema summary and basic schema editing.
- For relation/index metadata, prefer small repeatable rows and raw text/JSON fallbacks over complex graph-aware pickers.
- Add inspector forms for record processing nodes using their existing config contracts.
- Keep all editor mutations as workflow draft changes; storage and runtime execution remain outside component forms.
- Use raw fallback for unsupported schema details rather than widening the first visual editor too far.

## Decision (ADR-lite)

**Context**: Current code already supports arbitrary state collections and node-carried schema validation, but authoring is effectively raw JSON. A workflow developer can create custom storage-only collections, but cannot comfortably define or inspect a unique schema/state contract in the editor.

**Decision**: Implement workflow-carried state contract visibility and MVP schema authoring inside the workflow editor. The state contract remains carried by workflow nodes, especially `state-write`, and is summarized at workflow level. Do not introduce standalone schema resources or system packages in this task.

**Consequences**: Authors can create custom state models as part of workflow presets. Relation/index metadata is authorable, but the editor only performs simple schema self-consistency checks; runtime `state-write` validation remains the final safety boundary. Schema resources remain deferred until workflow blocks/subworkflows/system packages make reusable system packaging meaningful.

## Out Of Scope

- Standalone schema resource storage, references, deletion checks, import/export dependencies, or resource-library schema tabs.
- Workflow block/subworkflow/system package implementation.
- Renderer adapters for maps, relationship graphs, keyword panels, or custom state panels.
- Full workflow semantic validation, runtime value-shape proof, renderer compatibility validation, or AI-output correctness checks.
- Complex graph-aware relation/index builders, cross-workflow dependency resolution, or migration planning.
- Runtime query DSL, schema-aware query planner, indexes, migrations, or old IndexedDB compatibility.
- Reintroducing retired workflow node types: `apply-patch`, `memory-query`, or `memory-write`.

## Technical Notes

- Direction doc: `docs/active/airp-workflow-platform-direction.md`.
- Deferred register: `docs/active/deferred-work.md`.
- Current handoff: `docs/active/current-state-handoff.md`.
- Workflow editor conventions: `.trellis/spec/platform-web/frontend/component-guidelines.md`.
- Schema/storage specs: `.trellis/spec/memory-core/backend/memory-schema.md`.
- Contracts:
  - `packages/contracts/src/memory.ts`
  - `packages/contracts/src/runtime.ts`
  - `packages/contracts/src/workflow.ts`
- Runtime schema default and validation:
  - `packages/memory-core/src/default-airp-schema.ts`
  - `packages/memory-core/src/validation.ts`
- Platform editor/runtime:
  - `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
  - `apps/platform-web/src/components/workflow/WorkflowNodeEditorDialog.vue`
  - `apps/platform-web/src/components/workflow/NodeInspector.vue`
  - `apps/platform-web/src/components/workflow/inspector/StateWriteForm.vue`
  - `apps/platform-web/src/components/workflow/node-schema.ts`
  - `apps/platform-web/src/workflow-host/executors/state-query.ts`
  - `apps/platform-web/src/workflow-host/executors/state-write.ts`
  - `apps/platform-web/src/storage/state-records.ts`
- Default workflow:
  - `builtin/mods/default-airp-workflow.ts`
