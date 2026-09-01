# AIRP Default Retrieval Workflowization And Compatibility Boundary Cleanup

## Goal

Move the default AIRP retrieval path closer to editable workflow representation
while clarifying the temporary compatibility structures left by the generic AIRP
memory migration. The next slice should expose more of AIRP's core information
processing flow without forcing a broad rewrite of bridge, UI, debug, or legacy
storage consumers.

This is also a discovery slice for a practical base vocabulary of workflow
nodes. The goal is not to cover every imaginable workflow, but to find a compact
set of generic record/data-flow primitives that can express the AIRP default
path and remain useful for player/modder-authored workflows with different
memory structures.

## What I Already Know

* The broader product goal is a strong workflow system that can cover AIRP core
  information processing instead of leaving important behavior hardcoded in the
  platform host.
* The previous task moved the default maintenance write path to generic
  `MemoryWriteOperation[]` and made generic AIRP memory authoritative for the
  default read/write loop.
* `apps/platform-web/src/storage/airp-memory.ts` now projects built-in generic
  AIRP `memoryRecords` into runtime-compatible event/archive/global shapes.
* `syncAirpCompatibilityStateForSave()` mirrors generic AIRP memory back into
  legacy compatibility slices after a successful turn.
* New saves seed both generic AIRP memory and legacy event/archive rows; generic
  memory is the default authority, legacy rows are still compatibility data.
* The default workflow still represents retrieval as one high-level node:
  `memory-query { source: "event-archive" }`.
* `apps/platform-web/src/workflow-host/executors/memory-query.ts` calls
  `assembleRetrievalContext()` for `source: "event-archive"`.
* `assembleRetrievalContext()` still owns multiple hardcoded retrieval stages:
  recent message extraction, direct archive selection, present archive
  selection, catalog event selection, bridge archive selection, event graph
  ranking, event chain selection, optional semantic retrieval, merge logic,
  hint entity computation, prompt assembly, and debug assembly.
* `memory-query { source: "collection" }` already exists for custom save-scoped
  memory records and should remain useful for custom memory experimentation.
* Project convention allows prototype DB reseeding/version bumps instead of
  compatibility migrations.

## Assumptions (Temporary)

* This task should not remove `apply-patch`, legacy event/archive tables, bridge
  compatibility APIs, or existing UI/debug consumers.
* This task should clarify compatibility boundaries, not eliminate every
  temporary structure from the previous slice.
* Retrieval behavior should remain visibly stable enough for the built-in demo
  mod while the workflow representation improves.
* Strong id relation enrichment remains deferred; weak-name relations are still
  the MVP relation surface.
* Full player/modder-facing visual editing of every retrieval stage is not
  required in this slice, but the implementation should move toward that shape.
* Internal decomposition is useful only if the resulting stages have clear
  enough semantics to become public node candidates later.
* AIRP's current event/archive memory structure is not a universal memory model.
  Players may instead use structures such as keyword -> body snippet, keyword ->
  summary, topic -> note, relationship -> fact, or other collection shapes.
* `compute` is a necessary escape hatch, but it should not be the primary way to
  express common retrieval, filtering, ranking, relation, and context assembly
  behavior.

## Open Questions

* None.

## Requirements (Evolving)

* The default AIRP retrieval path should become more inspectable and closer to
  workflow representation than the current single black-box `event-archive`
  executor.
* Internal retrieval stages should be named and shaped as candidate workflow
  primitives with explicit inputs and outputs, not just private helper
  functions.
* Candidate primitives should be evaluated by whether they can express the AIRP
  default path and plausibly support custom workflows, not by whether they cover
  every possible workflow.
* Candidate primitives should avoid baking in AIRP-specific event/archive
  semantics. Prefer generic record/item concepts, field selectors, text
  extraction, relation extraction, filtering, ranking, merging, and context
  composition.
* AIRP event/archive retrieval should be treated as one preset composition over
  those generic primitives, not as the shape every memory workflow must follow.
* Current retrieval behavior should be abstracted into node-like candidate
  contracts rather than hidden behind `compute`. Each candidate should have a
  clear purpose, inputs, outputs, failure behavior, and debug payload.
* `compute` remains available for unusual logic and prototype experiments, but
  common information processing operations should graduate into dedicated
  workflow primitives.
* This slice should prioritize the deterministic structural retrieval chain:
  query/extract/filter/rank/relate/merge/compose. Semantic AI retrieval should
  get a clear boundary and trace/debug representation, but should not be
  generalized into a public primitive in this task.
* Core-path temporary structures from the previous task should be classified and
  tightened:
  * formal AIRP memory projection / retrieval inputs belong to the current core
    path;
  * legacy event/archive mirroring, `apply-patch`, and bridge/UI/debug
    compatibility remain temporary peripheral support.
* The default workflow should keep consuming generic AIRP memory as the
  authoritative source for events, archives, globals, and `currentTime`.
* The built-in default workflow and grey-salt-town workflow should continue to
  run through declared workflow nodes, not hidden platform-host retrieval bypass
  fields.
* This task does not need a new visual debug/trace surface for the internal
  stages. Internal code structure, tests, and specs are enough because the next
  phase is expected to publish or expose selected primitives more directly.
* Custom memory workflows using `memory-query { source: "collection" }` and
  `memory-write` must remain unblocked.

## Acceptance Criteria (Evolving)

* [ ] A concrete MVP decomposition depth is selected and recorded.
* [ ] Default AIRP retrieval remains backed by generic AIRP `memoryRecords`.
* [ ] Core compatibility/projection boundaries are named clearly in code or
  specs so future work knows what is official and what is transitional.
* [ ] Default retrieval is internally decomposed into named candidate stages
  with focused tests or static proof coverage, without requiring new visible
  trace/debug UI in this slice.
* [ ] Existing `memory-query { source: "collection" }` behavior remains valid.
* [ ] `apply-patch` and legacy event/archive compatibility paths remain
  available but are not broadened.
* [ ] Relevant static tests/builds pass for touched layers.
* [ ] Specs/docs are updated if this establishes a new workflow/retrieval
  convention.

## Definition Of Done

* Tests added/updated where behavior changes.
* `npm run build:contracts` if workflow contracts change.
* `npm run build:workflow-engine` and workflow-engine tests if workflow
  contracts or static proofs change.
* `npm run build:web` for platform-web changes.
* Specs/docs updated for any new retrieval/workflow convention.
* Rollout/rollback considered for default workflow execution changes.

## Expansion Sweep

### Future Evolution

* Retrieval stages can later become reusable workflow nodes that players and mod
  authors can reorder, disable, parameterize, or replace.
* Strong relation enrichment can later be inserted as an explicit deterministic
  stage after weak-name retrieval behavior is represented cleanly.

### Related Scenarios

* Resource workflow editor and mod workflow validation should eventually expose
  the same retrieval building blocks used by the built-in default workflow.
* Debug views should remain aligned with workflow trace output rather than a
  separate hidden platform-host retrieval cache.

### Failure And Edge Cases

* Failed retrieval should fail loudly before chat generation, preserving the
  current workflow rollback/checkpoint behavior.
* Partial decomposition must avoid changing selection/ranking behavior without
  regression coverage, because prompt context drift is hard to debug.
* Compatibility sync should not become a place where new retrieval semantics are
  hidden.

## Candidate MVP Approaches

### Approach A: Instrumented Strategy Node / Generic Node-Candidate Discovery (Recommended)

Keep `memory-query { source: "event-archive" }` as the default workflow node for
this slice, but split the executor/runtime retrieval implementation into named
internal stages with stage-level outputs/debug, clearer AIRP projection
boundaries, and tests. The graph is still compact, but the black box becomes
inspectable and the internal stages serve as candidate base-node semantics for a
later public workflow node vocabulary.

**Pros**

* Lowest behavior risk for the built-in demo loop.
* Lets us classify and tighten temporary structures without a large contract
  redesign.
* Creates stable stage names/debug records that can become public workflow nodes
  later.
* Lets the project explore a compact base-node vocabulary before committing it
  to contracts and editor UI.
* Avoids treating AIRP's event/archive model as the universal memory structure.

**Cons**

* The default workflow graph still contains one high-level retrieval node.
* Players/mod authors cannot yet freely rearrange individual retrieval stages.
* The implementation must avoid naming stages so narrowly that they cannot
  become useful workflow primitives later.

## Decision (ADR-lite)

**Context**: AIRP's default retrieval path still hides much of the core
information processing flow inside `memory-query { source: "event-archive" }`
and `assembleRetrievalContext()`. Publishing many node types immediately would
make the workflow/editor contract larger before the right primitive vocabulary
is proven.

**Decision**: Use Approach A as a node-candidate discovery slice. Internally
decompose the retrieval path into named stages with explicit data contracts and
debug outputs, while keeping the public default workflow graph compact for now.
The candidate vocabulary should favor generic record/data-flow primitives rather
than AIRP-specific event/archive node semantics. The extracted stages should be
designed as future node contracts, not as arbitrary helper code or `compute`
scripts.

**Consequences**: This should reveal which primitives deserve to become public
workflow node types later. It delays full player/modder rearrangement of every
retrieval stage, but reduces the risk of publishing immature AIRP-specific nodes
too early. AIRP's event/archive path remains an important built-in preset and
test case, not the universal memory model. `compute` stays useful as an escape
hatch, but the project should avoid making it the only way to express ordinary
retrieval behavior.

## Candidate Generic Primitive Vocabulary

These names are exploratory and not necessarily public node names for this task:

* Query records by namespace/collection/query/limit.
* Extract text, tags, ids, timestamps, and relation keys from records by
  configurable field selectors.
* Filter items by predicates such as status, recency, presence, tag match, or
  custom fields.
* Score/rank items by structural signals and optional semantic signals.
* Select related records through shared tags, names, keys, or explicit relation
  fields.
* Merge/dedupe selected item sets while preserving reason/debug metadata.
* Compose prompt/context sections from selected records through templates.

The AIRP default retrieval path should map onto these primitives, while other
memory structures such as keyword -> snippet/summary should also be plausible.

## Scope Decision: Structural Retrieval First

**Context**: Current retrieval includes both deterministic structural processing
and optional semantic/AI-enhanced retrieval. Pulling both into generic node
candidates at once would mix stable data-flow semantics with less stable
AI-assisted behavior.

**Decision**: Prioritize deterministic structural retrieval as the MVP node
candidate surface: record query, field/text extraction, filtering, ranking,
relation selection, merge/dedupe, and context composition. Semantic retrieval
should remain visible as a bounded stage with trace/debug output, but it is not
the first generic primitive to publish or fully generalize.

**Consequences**: This keeps the first candidate vocabulary easier to reason
about and test. It may leave AI-enhanced recall less editable in this slice, but
prevents semantic retrieval from dominating the base-node design too early.

## Scope Decision: No Temporary Visual Stage Trace

**Context**: Internal stage trace/debug would make this intermediate state more
inspectable, but this task is expected to be followed immediately by a phase
that starts exposing stable primitives more directly.

**Decision**: Do not build a temporary visual stage/debug surface in this slice.
Keep the work focused on internal decomposition, candidate contracts, tests, and
spec notes.

**Consequences**: This avoids investing in a transient presentation layer. The
main risk is that debugging during this slice relies on tests and code-level
structure rather than UI trace, which is acceptable for the short transition.

## Technical Approach

* Refactor the deterministic portion of `assembleRetrievalContext()` into named
  stage-like helpers that represent generic data-flow semantics where practical.
* Keep public workflow contracts stable in this slice; do not add public node
  types or editor controls yet.
* Keep `memory-query { source: "event-archive" }` as the default workflow entry
  point while its implementation becomes easier to map to future primitives.
* Keep semantic retrieval as a bounded stage, but do not generalize it into the
  first base-node vocabulary.
* Clarify in code/specs which AIRP memory projection structures are core-path
  projection contracts and which legacy structures are peripheral
  compatibility.
* Preserve current outputs consumed by chat and maintenance:
  `prompt`, `directEntities`, `archives`, and `debug`.

## Implementation Plan

* PR1: Extract deterministic retrieval stages and stage contracts from
  `assembleRetrievalContext()` without changing the public workflow graph.
* PR2: Add or update tests/static proofs that default retrieval still consumes
  generic AIRP memory and that the structural stage vocabulary is represented in
  code.
* PR3: Update specs to document generic retrieval primitive candidates,
  compatibility boundaries, and the decision to defer temporary visual trace.

### Approach B: Dedicated Retrieval Stage Nodes

Introduce several new workflow node types for AIRP retrieval stages, such as
direct archive selection, present archive selection, event ranking, semantic
retrieval, and prompt assembly. Update the default workflow graph to wire them
explicitly.

**Pros**

* Much closer to the final editable workflow vision.
* Forces clearer contracts between retrieval stages now.

**Cons**

* Larger contract/editor/test surface in one task.
* Higher risk of behavior drift while the current retrieval code is still
  tightly coupled.
* Could introduce AIRP-specific node types before generic workflow abstractions
  are ready.

### Approach C: Preset Subgraph Wrapper

Represent the default retrieval as a reusable preset/subgraph resource, with the
current implementation backing the subgraph until each internal stage is
replaced by generic nodes.

**Pros**

* Points directly at modder-editable workflow packaging.
* Gives a migration path from high-level strategy to editable internals.

**Cons**

* Requires subgraph/resource composition semantics that may be premature for
  this slice.
* Adds workflow product surface before retrieval stage contracts are proven.

## Technical Notes

* Current default workflow:
  `apps/platform-web/src/workflow-host/default-workflow.ts`.
* Built-in grey-salt-town workflow:
  `builtin/mods/grey-salt-town/src/index.ts`.
* Current memory-query executor:
  `apps/platform-web/src/workflow-host/executors/memory-query.ts`.
* Current retrieval implementation:
  `apps/platform-web/src/runtime-host/retrieval.ts`.
* Generic AIRP memory projection and compatibility sync:
  `apps/platform-web/src/storage/airp-memory.ts`.
* Workflow contracts:
  `packages/contracts/src/workflow.ts`.
* Platform state/workflow spec:
  `.trellis/spec/platform-web/frontend/state-management.md`.
* Previous task:
  `.trellis/tasks/archive/2026-06/06-05-generic-maintenance-write-migration/prd.md`.
