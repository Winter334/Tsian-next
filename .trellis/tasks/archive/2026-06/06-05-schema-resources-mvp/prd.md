# State Schema Boundary MVP

## Goal

Clarify and implement the first state-schema boundary that matches Tsian's
workflow-as-system direction. The MVP should move the default AIRP schema away
from a code-only, hard-coded validation policy while preserving the ability for
workflows, resources, and future renderers to describe configurable systems.

The immediate pressure is the current default AIRP schema: it lives as a
code-only runtime constant and `memory-write` hard-codes it as policy. This task
should decide the smallest durable schema organization before implementation,
without assuming that workflow-carried schema, standalone schema resources, or
pure node-output inference is automatically correct.

## What I Already Know

* The direction document defines Tsian as a workflow-as-system platform:
  systems should be assembled from workflow presets, schemas/resources,
  platform capabilities, and renderers.
* Recent cleanup retired `memory-query(source: "event-archive")` and
  `apply-patch` from workflow node syntax. The next useful move is positive
  infrastructure for configurable systems, not another compatibility shim.
* `packages/contracts/src/memory.ts` already defines the lightweight memory
  schema contract:
  `MemorySchemaDefinition`, `MemoryCollectionDefinition`,
  `MemoryFieldDefinition`, relation metadata, indexes, and validation issues.
* `packages/memory-core/src/default-airp-schema.ts` already exports
  `defaultAirpMemorySchema` and `DEFAULT_AIRP_MEMORY_SCHEMA_ID`.
* `packages/memory-core/src/validation.ts` already validates schemas and
  schema-covered `MemoryWriteOperation` values.
* `apps/platform-web/src/workflow-host/executors/memory-write.ts` currently
  hard-codes `defaultAirpMemorySchema` as its only schema validation source.
  Custom namespace/collection writes remain storage-only.
* `apps/platform-web/src/storage/resources.ts` already has resource helpers and
  builtin seed flows for prompt presets, world books, and workflow presets.
* `apps/platform-web/src/storage/db.ts` currently has separate Dexie tables for
  `promptPresets`, `worldBooks`, and `workflowPresets`, but no state schema
  resource/materialization table.
* `apps/platform-web/src/views/ResourceLibraryView.vue` manages the three
  existing resource kinds. It can likely host a fourth "state schema" tab, but
  a rich schema form editor is probably larger than this MVP needs.
* Builtin workflow preset seed lives in `builtin/mods/workflow-presets.ts` and
  the default AIRP workflow queries/writes `airp/events`, `airp/archives`, and
  `airp/globals`.
* User expectation: after configuring a workflow, the schema should be visible
  from the workflow itself. Authors should not have to separately create a
  schema resource and remember to wire it by id before the workflow feels valid.
  This is an important product direction hypothesis, not yet a finalized
  implementation decision.
* User hypothesis: node configuration can declare output formats and field
  shapes; once nodes and edges are configured, a workflow naturally describes a
  schema without separate references. This likely applies well to dataflow
  contracts, but may not fully cover durable state contracts such as storage
  validation, relations, indexes, versioning, renderer expectations, and
  migration boundaries.
* User proposal: introduce a persistence node, similar in graph role to a
  result node, that receives upstream outputs and persists them into the AIRP
  runtime database. Retrieval/query nodes can then consume those persisted
  collections. This may let durable state contracts live near the node that
  writes the state instead of as a disconnected resource.
* Naming concern: if the persistence node becomes the generic runtime state
  persistence primitive, `memory-write` is too narrow. The public workflow node
  name should move toward generic state/persistence language.
* "Memory schema" is probably too narrow as product language. The schema should
  cover generic state systems such as memory, maps, relationship graphs, style
  rules, or keyword fragments.

## Assumptions (Temporary)

* This task should make state schema a first-class contract while avoiding both
  a disconnected authoring flow and an unsafe inference-only model.
* The MVP can keep using existing `MemorySchemaDefinition` internally, but the
  product/resource language should move toward "state schema".
* The final organization is not locked yet. Schema may be workflow-carried,
  standalone resource-backed, node-declared, or a staged mix of these.
* Existing default AIRP behavior must remain valid.
* Custom memory collections without schema coverage should remain storage-only
  in this slice, preserving the current permissive prototyping path.
* We should not implement renderer adapters, block/subgraph, mod import/export,
  or full schema dependency resolution in the same slice.

## Conceptual Split: Dataflow Schema vs Durable State Schema

This task should avoid treating all schema needs as one thing.

### Dataflow schema

Dataflow schema describes values moving between workflow nodes:

* output carrier format such as JSON, XML, DSL, text, or mixed payload;
* field shape of a node output;
* whether a downstream node can consume a connected output;
* editor hints and static validation for node wiring.

This is where "configure the workflow and schema naturally appears" is most
convincing. Existing contracts already have a small start:
`NodeInputDeclaration`, `NodeOutputDeclaration`, `WorkflowPortValueType`, and
`NodeOutputExtractRule`.

### Durable state schema

Durable state schema describes state that persists beyond one workflow edge:

* namespace / collection identity;
* required fields and allowed unknown fields;
* relationships, indexes, primary keys, and versions;
* validation before platform storage writes;
* future renderer expectations and migration boundaries.

This is where pure inference from node output is risky. A node can output a JSON
object that looks like an event, but platform storage still needs a stable
contract for required fields, relation targets, versioning, and failure
behavior.

### Working Recommendation

Long-term direction should allow workflow configuration to expose both layers.
For the next MVP, prefer the smallest durable state schema improvement with a
path toward richer dataflow schemas later, rather than attempting whole-workflow
automatic schema inference now. A promising shape is to let persistence/write
nodes own the durable state contract they write, while query/retrieval nodes
consume the resulting platform-owned collections.

## Candidate Directions

### Approach A: Persistence Node-Carried State Contract (Recommended)

Treat the durable write/persistence node as the workflow location where
persistent state contracts are declared. The node receives upstream outputs,
maps them into `namespace / collection / record` writes, and declares or points
to the schema used to validate those writes. Runtime data remains in
platform-owned storage; the node definition stores the contract and mapping, not
the live database contents.

In current code, `memory-write` is already the closest implementation of this
idea. The MVP should likely evolve and rename `memory-write` toward a generic
persistence node contract instead of adding a second redundant node.

Pros:

* Fits workflow authoring: the node that persists state is also where the
  durable state shape becomes visible.
* Avoids a disconnected schema-resource-first workflow.
* Keeps platform storage, checkpoint, rollback, and validation boundaries under
  platform control.
* Reuses existing `memory-write`, `MemoryWriteOperation`, and memory-core
  validation machinery.

Cons:

* The node config may become more complex than today's `memory-write`.
* Shared schemas across multiple persistence nodes need a reuse story later
  (resource extraction, schema id, or workflow-level registry).
* Query nodes still need clear target collection metadata; they should not read
  "from a node" as live state, but from platform storage described by the node's
  state target.

### Approach B: Workflow-Carried State Schema, Resource-Backed Validation

Extend workflow definitions or workflow preset resources with a lightweight
state schema section that can be derived from configured state read/write
targets. The default AIRP workflow carries the schema contract for
`airp/events`, `airp/archives`, and `airp/globals`; platform storage can
materialize this as a reusable `state-schema` resource. Update `memory-write`
so schema validation resolves from the workflow execution schema registry
instead of hard-coding `defaultAirpMemorySchema` as policy. Keep custom
collections storage-only when no matching schema exists.

Pros:

* Directly advances the direction document: schema becomes a resource, not just
  code, while authoring still starts from the workflow.
* Matches the desired UX: configured workflows naturally expose their state
  contract.
* Reuses existing `MemorySchemaDefinition` and validators.
* Preserves current custom collection behavior.

Cons:

* Requires a new top-level workflow/preset schema field or equivalent metadata.
* Inference cannot be fully automatic from arbitrary AI output; nodes still need
  declarative output/state contracts where persistence is involved.

### Approach C: Standalone State Schema Resources Referenced By Workflow

Add a `state-schema` platform resource kind and require workflow presets to
reference schema resource ids explicitly. Execution resolves schemas from those
resources before running state writes.

Pros:

* Clear reuse and deletion-reference semantics.
* Sets up future mod/package dependency checks.

Cons:

* Feels disconnected from the user's desired workflow-first authoring model.
* Authors must maintain a separate resource and id wiring before the schema
  becomes visible in the workflow.

### Approach D: Pure Inference From Node Outputs

Try to infer all schemas only from node output declarations, extraction rules,
and connected edges. Do not add explicit state schema declarations.

Pros:

* Maximum authoring smoothness when inference works.
* Avoids a separate schema editing surface.

Cons:

* Unsafe for durable state: arbitrary AI/compute outputs do not reliably define
  required fields, versioning, relations, indexes, or renderer expectations.
* Hard to provide fail-loud validation and migration behavior.
* Likely to become heuristic and surprising.

## Expansion Sweep

### Future Evolution

* Workflow presets may eventually publish their carried state schemas as
  reusable resources, and renderer adapters may choose UI panels based on schema
  metadata.
* Mod packages may ship schema resources for keyword/fragment memory, map graph
  state, relationship networks, or style-rule systems.

### Related Scenarios

* Resource deletion needs reference checks once workflows can depend on external
  schema resources; that can be deferred if MVP carries schema inline.
* Runtime `memory-query` could later use schema/index metadata for better
  filtering, but current MVP can leave query behavior unchanged.

### Failure And Edge Cases

* Invalid carried/materialized schemas should fail loudly on save/seed rather
  than poisoning runtime execution.
* If expected default AIRP schema metadata is missing or invalid during
  `memory-write`, default AIRP should fail visibly rather than silently skipping
  validation.
* If no schema registry entry covers a custom namespace/collection target, writes
  should keep the current storage-only behavior.

## Open Questions

* None. The user selected Approach A: persistence node-carried durable state
  contracts. The public durable write node should be renamed from
  `memory-write` to `state-write`; `memory-query` should not be renamed in the
  same slice. Old `memory-write` workflow node syntax should fail loudly rather
  than remain as a validator/runtime alias.

## Requirements (Evolving)

* Use "state schema" as the product concept; continue reusing
  `MemorySchemaDefinition` internally where that keeps the implementation
  bounded.
* Use the durable write/persistence node as the place where persistent state
  contracts become visible in workflow authoring.
* Keep runtime data in platform-owned storage. Workflow nodes store state
  contracts and write mappings, not live database contents.
* Evolve the existing durable write node into `state-write` rather than adding a
  second overlapping node.
* Rename the public durable write workflow node from `memory-write` to
  `state-write`.
* Do not keep `memory-write` as a validator/runtime alias; old workflow
  definitions using it should fail loudly as unknown node types.
* Keep `memory-query` unchanged in this slice; query naming can be revisited in
  a later task.
* Keep default AIRP schema behavior available through the selected organization.
* Keep contracts type-only: no runtime schema constants in `packages/contracts`.
* Keep `packages/memory-core` storage-agnostic and framework-neutral.
* Preserve default AIRP workflow behavior.
* Preserve storage-only writes for custom namespace/collection targets without a
  schema resource.
* Avoid building specialized schema form UI, renderer adapters, block/subgraph,
  or mod import/export in this slice unless explicitly selected.

## Acceptance Criteria (Evolving)

* [x] The selected schema organization is recorded in an ADR-lite decision.
* [x] The generic persistence node name is selected and recorded:
  `state-write`.
* [x] `memory-write` is replaced by `state-write` as the public durable write
  workflow node type.
* [x] Old workflow definitions containing node type `memory-write` fail loudly
  as unknown node types.
* [x] `memory-query` remains unchanged in this slice.
* [x] Default AIRP schema for `airp/events`, `airp/archives`, and `airp/globals`
  is available through the selected organization.
* [x] Platform execution can resolve schema coverage for `state-write` without
  hard-coding `defaultAirpMemorySchema` as the policy source.
* [x] Invalid schema metadata fails through memory-core validation before
  save/seed/execution at the chosen boundary.
* [x] Custom namespace/collection writes without matching schema coverage
  remain storage-only.
* [x] Default AIRP workflow still validates and writes through `state-write`.
* [x] Tests/static proofs cover resource seeding, schema validation, default
  AIRP write behavior, and custom storage-only behavior.
* [x] Touched `.trellis/spec/` and active docs reflect the selected state-schema
  boundary.
* [x] Required builds/tests pass.

## Decision (ADR-lite)

**Context**: Tsian's current durable-state schema boundary is too
memory-specific. `defaultAirpMemorySchema` is a code-only runtime constant, and
`memory-write` hard-codes it as policy. The workflow-as-system direction needs
a generic durable state persistence primitive: AIRP events/archives, keyword
fragments, maps, relationship graphs, and style rules should all be expressible
as platform-owned state, not as memory-only semantics.

**Decision**: Use the persistence node as the canonical MVP location for
durable state contracts. Rename the public durable write node from
`memory-write` to `state-write` and migrate the contracts, validator, executor
registry, editor surface, default AIRP workflow, tests, specs, and active docs
to the new node type. Do not keep `memory-write` as a runtime or validator
alias; old workflow definitions should fail loudly with `UNKNOWN_NODE_TYPE`.

**Consequences**: The workflow node vocabulary becomes more generic and better
aligned with configurable AIRP systems. Existing internal names such as
`MemoryWriteOperation`, `MemorySchemaDefinition`, and storage `memoryRecords`
may remain temporarily to keep this slice bounded, but public workflow
authoring moves to state/persistence language. `memory-query` remains unchanged
in this task to avoid widening the blast radius; query naming and richer
dataflow schemas can be handled later.

## Implementation Plan

1. Contracts and engine:
   * replace `"memory-write"` with `"state-write"` in `WorkflowNodeType`;
   * introduce or rename the durable write node config type for public workflow
     authoring;
   * update validator known-node set so old `"memory-write"` fails as
     `UNKNOWN_NODE_TYPE`;
   * update workflow-engine tests/static proofs.
2. Platform workflow host and editor:
   * rename/register the executor as `state-write`;
   * update editor palette, default node config, slot metadata, inspector form,
     node summary, validation copy, and DebugView maintenance write filtering;
   * update default AIRP workflow to write through `state-write`.
3. Durable state contract boundary:
   * preserve current AIRP schema validation behavior under `state-write`;
   * avoid adding a second overlapping persistence node;
   * keep custom namespace/collection writes storage-only when no schema
     coverage exists;
   * keep runtime data in platform storage, not workflow definitions.
4. Docs/specs/checks:
   * update `.trellis/spec/` and active docs to describe `state-write`;
   * run required contracts, workflow-engine, memory-core if touched, and web
     checks.

## Definition Of Done

* PRD records selected MVP scope, trade-offs, out-of-scope items, and
  acceptance criteria.
* Relevant Trellis specs are loaded before implementation.
* Tests/static proofs are updated for changed behavior.
* Required package builds/tests pass.
* Work is committed and task is archived when complete.

## Out Of Scope (Until Selected)

* Rich schema form/editor UX.
* Renderer adapters or schema-driven frontend panels.
* Workflow blocks/subgraphs.
* Mod import/export/package schema dependency resolution.
* Hard rejection of every custom memory collection that lacks a schema.
* Replacing legacy event/archive/storage compatibility projections.
* Maintaining or validating `openspec/`.

## Technical Notes

* Direction doc: `docs/active/airp-workflow-platform-direction.md`.
* Current handoff: `docs/active/current-state-handoff.md`.
* Existing schema contracts:
  * `packages/contracts/src/memory.ts`
  * `packages/memory-core/src/default-airp-schema.ts`
  * `packages/memory-core/src/validation.ts`
  * `.trellis/spec/memory-core/backend/memory-schema.md`
* Existing resource library/storage:
  * `packages/contracts/src/workflow.ts`
  * `apps/platform-web/src/storage/db.ts`
  * `apps/platform-web/src/storage/resources.ts`
  * `apps/platform-web/src/views/ResourceLibraryView.vue`
* Current execution boundary:
  * `apps/platform-web/src/workflow-host/executors/state-write.ts`
  * `apps/platform-web/src/storage/memory.ts`
  * `builtin/mods/default-airp-workflow.ts`
  * `builtin/mods/workflow-presets.ts`

## Completion Notes

* Public durable write workflow node migrated to `state-write`.
* Old public node type `memory-write` is not registered or accepted by the
  workflow validator; static tests prove it fails as `UNKNOWN_NODE_TYPE`.
* Default AIRP workflow now uses `stateWrite` and carries
  `defaultAirpMemorySchema` in the node config.
* `state-write` executor validates only operations covered by the node-carried
  schema; uncovered custom namespace/collection writes remain storage-only.
* Required checks run:
  * `npm run build:contracts`
  * `npm run build:workflow-engine`
  * `npm run test --workspace @tsian/workflow-engine`
  * `npm run build:memory-core`
  * `npm run build:web`
