# AIRP Workflow Core Coverage

## Goal

Build a strong enough workflow system for AIRP's core information-processing flow so that currently hardcoded platform behavior, especially memory query/write/composition and related AI orchestration, can be represented, edited, traced, and safely extended through workflows. Players and mod authors should be able to create workflows that fit their own AIRP designs without taking over unsafe storage, checkpoint, rollback, or migration responsibilities.

## What I Already Know

* User goal: AIRP core information processing should be covered by the workflow system, not scattered through hardcoded platform paths.
* The product direction is an AIRP workflow editing and runtime platform, not a fixed roleplay content app.
* Yesterday's completed work already added workflow node schema slots, workflow run trace/debug UI, `memory-query`, `memory-write`, `template-compose`, save-scoped `memoryRecords`, explicit `apply-patch`, and `packages/memory-core`.
* `packages/contracts/src/workflow.ts` currently declares built-in node types: `ai-call`, `result`, `switch`, `apply-patch`, `compute`, `memory-query`, `memory-write`, and `template-compose`.
* `apps/platform-web/src/workflow-host/index.ts` registers built-in executors for those node types.
* `memory-write` currently writes generic custom memory records through `applyMemoryWriteOperationsForSave()` but does not yet consume `packages/memory-core` schema validation.
* `memory-query(source: "event-archive")` still calls `assembleRetrievalContext()` and therefore still packages default AIRP retrieval as a hardcoded algorithm boundary.
* `apply-patch` / `MaintenancePatchDocument` is now explicit in workflows but remains a compatibility layer for default event/archive/globals writes.
* `packages/memory-core` owns the default AIRP runtime memory schema and validation helpers while staying storage-agnostic.

## Assumptions (Temporary)

* This is an architectural roadmap and task-family planning effort, not one single implementation PR.
* The platform should expose powerful workflow primitives first, then optionally package common chains as presets/subgraphs later.
* Storage, checkpoint/rollback, migrations, and fail-loud safety remain platform-owned boundaries.
* `apply-patch` should be retired from the default path over time, but not expanded into the generic memory operation model.
* The first implementation slice should connect a recently completed foundation to real runtime behavior rather than attempting the whole end-state at once.

## Open Questions

* None.

## Requirements (Evolving)

* AIRP core information-processing stages should be representable as workflow nodes or workflow resources.
* Hardcoded default memory behavior should gradually move behind generic, schema-aware workflow primitives.
* Players and mod authors should be able to inspect and edit the workflow path that handles query, prompt composition, AI calls, output extraction, maintenance, and state writes.
* Workflows must remain traceable at node input/output/error level.
* Workflow write capabilities must use platform-controlled APIs for consistency, checkpointing, rollback, and validation.
* The system should avoid adding event/archive-specific node types such as `event-query` or `archive-query`.
* The next roadmap should identify what is still missing after the 2026-06-04 workflow/memory tasks, then choose a small implementation slice that advances the larger workflow-core-coverage goal.

## Acceptance Criteria (Evolving)

* [ ] The next implementation slice moves the generic `memory-write` runtime boundary behind schema-aware validation.
* [ ] `memory-write` rejects invalid operations before storage writes when validation is enabled by the selected MVP schema policy.
* [ ] Validation failures are fail-loud and visible through workflow failure trace/debug surfaces.
* [ ] MVP uses the built-in default AIRP runtime memory schema as the first validation source; schema resource selection is deferred.
* [ ] Built-in AIRP schema validation applies only to operations targeting collections covered by the built-in schema policy.
* [ ] Custom namespace/collection writes outside the built-in schema remain storage-only in this slice, preserving custom memory experimentation until schema resources exist.
* [ ] Workflow failures remain fail-loud and visible in trace/debug UI.
* [ ] Platform storage and rollback consistency are preserved.
* [ ] Relevant package builds/tests pass for touched layers.

## Definition of Done

* Tests added/updated where behavior changes.
* Lint, typecheck, and relevant package builds pass.
* Specs/docs updated if workflow or memory behavior conventions change.
* Rollout/rollback considered for changes touching default workflow execution.

## Expansion Sweep

### Future Evolution

* Workflow blocks/subgraphs may later package advanced low-level primitives into reusable high-level AIRP chains.
* Memory schema resources may later be selectable per mod/save/workflow, with editor forms derived from schema metadata.

### Related Scenarios

* Resource-library workflow preset editing should stay aligned with runtime execution and debug trace.
* Mod-provided workflows and save-level workflow overrides should use the same validation and execution semantics.

### Failure and Edge Cases

* Invalid schema, invalid memory operations, missing presets, and unsafe writes should fail loudly rather than silently falling back.
* Workflow edits that remove memory query/write stages should produce explicit behavior, not hidden host-side recovery.
* Long-running or aborted runs should preserve useful failure traces without corrupting storage.

## Candidate Next Slices

### Slice A: Schema-Validated `memory-write` Runtime Boundary

Connect `packages/memory-core` validation to the `memory-write` executor/storage path. This turns the new schema model into real runtime protection while keeping `apply-patch` compatibility unchanged.

**Decision**: Selected as the next MVP slice after user confirmation.

### Slice B: Default Maintenance Writes as Generic Memory Operations

Migrate default AIRP maintenance output from `MaintenancePatchDocument` / `apply-patch` toward schema-validated `MemoryWriteOperation`, likely through an adapter or updated maintenance prompt.

### Slice C: Retrieval Chain Editability

Break down `memory-query(source: "event-archive")` and `runtime-host/retrieval.ts` into more workflow-visible query, ranking, relation expansion, and template composition boundaries.

### Slice D: Workflow Composition Ergonomics

Add subgraph/block/preset composition so powerful low-level primitives can be packaged into reusable AIRP building blocks for players and mod authors.

## Missing Capability Map

### Runtime Safety / Schema Boundary

* `memory-write` does not yet consume `packages/memory-core` validators.
* There is no runtime schema resolver for default schema vs mod/save/workflow-provided schema.
* Generic custom memory writes exist, but default AIRP event/archive/globals writes still use the compatibility `apply-patch` path.

### Default AIRP Memory Flow Coverage

* `memory-query(source: "event-archive")` still hides default retrieval in a special source branch.
* `runtime-host/retrieval.ts` still owns entity pool construction, seed event scoring, event-chain expansion, catalog event handling, prompt assembly, and debug shaping as hardcoded logic.
* Maintenance AI output still targets `MaintenancePatchDocument`, not generic schema-aware memory operations.

### Workflow Expressiveness / Composition

* Built-in node primitives exist, but there is no subgraph/block abstraction for packaging common AIRP chains.
* Node input/output schema metadata is present, but runtime/editor compatibility enforcement is still limited.
* `compute` remains an escape hatch, but there is no richer library of safe transformation/ranking/filtering primitives.

### Player / Mod Author Ergonomics

* Players can edit workflow presets, but memory schemas are not yet first-class editable resources.
* Node inspector forms are mostly node-specific, not generated from schema metadata.
* There is not yet a guided way to build "my own memory model" without understanding low-level operation shapes.

### Permissions / Capability Model

* The platform owns storage/checkpoint/rollback, but workflow write capability is not yet described as an explicit capability contract.
* Mod workflows and save-level overrides share execution semantics, but future high-risk writes may need clearer capability declarations and debug surfacing.

### Observability / Regression Confidence

* Workflow trace is current/latest-run oriented; no persisted trace history or workflow comparison exists yet.
* Functional-equivalence tests for the default AIRP chain exist in parts, but larger scenario-level regression coverage will matter as hardcoded retrieval/write paths are decomposed.

### Documentation / Roadmap Sync

* `docs/active/implementation-plan.md` is stale relative to the 2026-06-04 completed work.
* The roadmap should be rewritten around workflow-core coverage rather than the older "next step: save-level workflow preset override" sequence.

## Out of Scope (For This Planning Task)

* Implementing code before the MVP slice is chosen.
* Building a full marketplace/plugin permission system.
* Moving platform-owned storage, checkpoint, rollback, or migration logic into arbitrary user code.
* Adding event/archive-specific workflow node types as a shortcut.

## Decision Log

### Next Slice: Runtime Schema Safety First

**Context**: The 2026-06-04 work moved AIRP memory behavior toward workflow-visible nodes and introduced `packages/memory-core`, but the generic memory write executor still writes operations without consuming the schema validator.

**Decision**: The next implementation slice should connect schema validation to the `memory-write` runtime boundary before migrating default maintenance writes or decomposing retrieval.

**Consequences**: This creates a safety and correctness foundation for player/mod-authored workflows. It deliberately postpones larger default-chain migration work so the first slice stays small and verifiable.

### MVP Schema Source: Built-in Default First

**Context**: `MemoryWriteNodeConfig` currently has `namespace`, `collection`, `operationsVarName`, and checkpoint settings, but no `schemaId`. Adding full schema resources would turn the MVP into a larger resource-system task.

**Decision**: Use `defaultAirpMemorySchema` as the MVP validation source. Do not add schema resource resolution or schema picker UI in this slice.

**Consequences**: The MVP can connect validation to runtime writes with low integration cost. Custom mod/save schemas remain a future slice; this task still needs a policy for operations targeting collections outside the built-in default schema.

### Unknown Custom Collections: Storage-Only For Now

**Context**: `defaultAirpMemorySchema` covers runtime `events`, `archives`, and `globals`, while current generic `memory-write` also supports arbitrary save-scoped custom collections. Failing every unknown collection would contradict the broader goal of letting authors experiment with alternative memory structures before schema resources exist.

**Decision**: Validate operations that target built-in AIRP schema collections. Custom namespace/collection writes not covered by the built-in schema remain storage-only for this slice.

**Consequences**: Default AIRP memory-shaped writes become stricter without blocking custom memory experiments. Full strictness for custom schemas is deferred until memory schemas are first-class resources or workflow config can reference a schema.

## Technical Approach

Use a small executor-bound validation layer rather than moving schema semantics into Dexie storage:

* Import `defaultAirpMemorySchema` and `normalizeMemoryWriteOperation` / validation errors from `@tsian/memory-core` in the `memory-write` executor path.
* Resolve each operation's target using operation fields plus node defaults.
* If the resolved target is covered by the built-in AIRP schema, validate and normalize before calling `applyMemoryWriteOperationsForSave()`.
* If the target is outside the built-in schema, keep existing storage-only behavior.
* Keep `apps/platform-web/src/storage/memory.ts` responsible for storage invariants and operation application, not schema ownership.
* Surface validation failures by throwing a clear workflow node error message that includes issue code/path/message details.

## Implementation Plan

* PR1: Add a focused validation helper in the `memory-write` executor area and cover target-resolution behavior.
* PR2: Wire schema-covered operations through `memory-core` normalization before storage writes; preserve storage-only custom collection behavior.
* PR3: Add/adjust tests for valid built-in operations, invalid built-in operations, custom collection pass-through, and workflow trace failure visibility.
* PR4: Run relevant checks and update specs/docs if this establishes a reusable workflow memory validation convention.

## Technical Notes

* Direction docs: `docs/active/airp-workflow-platform-direction.md`, `docs/active/implementation-plan.md`, `docs/active/memory-system-decisions.md`.
* Current workflow type owner: `packages/contracts/src/workflow.ts`.
* Current workflow engine validator/scheduler: `packages/workflow-engine/src/validator.ts`, `packages/workflow-engine/src/scheduler.ts`.
* Current executor registry: `apps/platform-web/src/workflow-host/index.ts`.
* Current generic memory write executor: `apps/platform-web/src/workflow-host/executors/memory-write.ts`.
* Current custom memory storage: `apps/platform-web/src/storage/memory.ts`.
* Current hardcoded default AIRP retrieval: `apps/platform-web/src/runtime-host/retrieval.ts`.
* Current explicit compatibility write node: `apps/platform-web/src/workflow-host/executors/apply-patch.ts`.
* Current memory schema package: `packages/memory-core/src/default-airp-schema.ts`, `packages/memory-core/src/validation.ts`.
