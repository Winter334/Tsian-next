# Workflow As System Direction Document Refresh

## Goal

Refresh the active platform direction documentation around the principle that
Tsian should become a workflow-as-system platform: AIRP systems should be
assembled from configurable workflows, schemas, resources, platform-controlled
capabilities, and renderers, rather than hardcoded as one fixed event/archive
roleplay application.

The immediate output is documentation, not runtime behavior. The refreshed
direction should constrain follow-up implementation work so compatibility nodes,
event/archive-specific semantics, and ad hoc hardcoded platform paths do not
continue pulling the project away from the target architecture.

## What I Already Know

* The user approves the framing that "workflow is system" should become the
  guiding product/architecture direction.
* The active direction document is
  `docs/active/airp-workflow-platform-direction.md`.
* `docs/active/README.md` says `docs/active` should only contain documents
  that are still maintained, but the current active set includes several older
  skeleton/plan documents.
* The active direction document still says the near-term target is to polish the
  current event/archive memory system first and later evaluate other memory
  architectures. That stance is now too narrow for the current platform goal.
* The active implementation plan is stale relative to recent workflow/memory
  work and still recommends older next steps such as save-level workflow preset
  override.
* Recent archived tasks already moved the project toward generic workflow
  primitives:
  * schema-aware `memory-write`;
  * generic AIRP memory records as the default read/write authority;
  * default maintenance output as `MemoryWriteOperation[]`;
  * collection-based memory queries and generic record nodes in the default
    workflow;
  * explicit recognition that `event-query` / `archive-query` node types are
    the wrong direction.
* `apply-patch` remains a compatibility node in contracts/validator/UI/executor
  registration, even though the mature default workflow no longer uses it.
* The user wants AIRP event/archive memory to be only one configurable memory
  architecture. Other possible systems include keyword -> fragment/summary
  memory, text post-processing workflows, and map systems backed by coordinate
  or graph data that a frontend can render.
* The user prefers rewriting the direction document and archiving other stale
  active documents to reduce documentation maintenance pressure.
* The user confirmed the strict active-doc scope: keep only
  `README.md`, `current-state-handoff.md`, and
  `airp-workflow-platform-direction.md` in `docs/active`; archive
  `implementation-plan.md`, `memory-system-decisions.md`,
  `narrative-entity-archive-skeleton.md`, and `patch-contract-skeleton.md`.

## Assumptions (Temporary)

* This task should update active docs only. It should not remove nodes, change
  workflow contracts, rewrite prompts, or alter runtime behavior.
* The direction document should replace outdated near-term guidance rather than
  add another parallel roadmap that can drift.
* The active docs set should shrink to documents that are truly current.
* The existing memory-system decision document can remain as a record of the
  default AIRP event/archive reference system, but it should be framed as one
  default system, not the platform's universal memory model.
* The direction document should be opinionated enough to guide future task
  scoping, especially around node taxonomy and compatibility cleanup.

## Open Questions

* None.

## Requirements (Evolving)

* Document the core thesis: systems are assembled from workflow presets, memory
  or state schemas, platform capability boundaries, resources, and frontend
  renderers.
* Distinguish the platform architecture from the default AIRP event/archive
  reference system.
* State that workflow nodes should be generic primitives where possible:
  control flow, AI calls, template composition, generic memory query/write,
  record transforms, and bounded compute.
* State that event/archive semantics belong in memory schema, workflow preset
  configuration, prompt/resources, and UI renderers, not in workflow node types.
* Include examples showing how the same platform direction can express:
  event/archive memory, keyword-fragment or summary memory, text post-processing,
  and map/graph state systems.
* Capture guardrails:
  * storage, checkpoint, rollback, validation, and dangerous side effects remain
    platform-controlled;
  * workflows may configure and orchestrate capabilities but should not own raw
    unsafe writes;
  * compatibility layers should be explicit, temporary, and not broadened into
    new generic models.
* Include a decision checklist for future work:
  * Is this feature a generic primitive, a preset, a schema, a renderer, or a
    compatibility bridge?
  * Does it hardcode AIRP event/archive semantics into node types?
  * Can another memory/system architecture use the same primitive?
  * Is this preserving a temporary bridge or accidentally making it permanent?
* Record current implications:
  * `apply-patch` should retire as a workflow node surface when compatibility
    policy allows, while bridge/applier compatibility can be considered
    separately;
  * `memory-query(source: "event-archive")` is a temporary compatibility shape,
    not the long-term generic memory query model;
  * event/archive memory remains a strong default preset/reference
    architecture, not the platform boundary.
* Archive or otherwise move stale active documents out of `docs/active` so the
  directory no longer implies they are current guidance.
* Keep the strict active set:
  * `docs/active/README.md`
  * `docs/active/current-state-handoff.md`
  * `docs/active/airp-workflow-platform-direction.md`
* Archive:
  * `docs/active/implementation-plan.md`
  * `docs/active/memory-system-decisions.md`
  * `docs/active/narrative-entity-archive-skeleton.md`
  * `docs/active/patch-contract-skeleton.md`
* Update `docs/active/README.md` to reflect the reduced active-doc set and the
  new maintenance rule.
* Update `docs/README.md` and active handoff references so documentation entry
  points do not point readers back to archived guidance.

## Acceptance Criteria (Evolving)

* [x] `docs/active/airp-workflow-platform-direction.md` is refreshed around the
  workflow-as-system thesis.
* [x] The refreshed direction removes or revises outdated guidance that frames
  current work as only polishing the event/archive memory system before future
  architectures.
* [x] The document includes node taxonomy guidance and explicitly separates
  generic workflow primitives from AIRP/default-system semantics.
* [x] The document includes concrete examples beyond event/archive memory:
  keyword-fragment/summary memory, text post-processing, and map/graph systems.
* [x] The document includes a future-work decision checklist that can be used
  during task planning and code review.
* [x] Stale active docs are moved out of `docs/active` or clearly reclassified
  so they no longer compete with the refreshed direction.
* [x] `docs/active` contains only `README.md`,
  `current-state-handoff.md`, and `airp-workflow-platform-direction.md`.
* [x] `docs/active/README.md` reflects the new active-doc policy.
* [x] `docs/README.md` and `docs/active/current-state-handoff.md` no longer
  present archived files as active guidance.
* [x] No runtime code changes are made in this task.

## Definition Of Done

* Direction docs updated.
* Stale active docs archived/reclassified.
* No package build/test required unless code changes unexpectedly happen.
* `git diff` reviewed to confirm this is documentation-only.
* User confirms the refreshed direction matches the intended product/architecture
  target.

## Expansion Sweep

### Future Evolution

* Workflow blocks/subgraphs can later package low-level primitives into reusable
  high-level systems.
* Memory schemas can later become first-class editable resources with generated
  forms and renderer hooks.
* Renderer adapters can let frontends project workflow-maintained state into
  specialized UI such as maps, relationship graphs, dashboards, or prose
  processors.

### Related Scenarios

* Future cleanup of `apply-patch`, `memory-query(source: "event-archive")`, and
  event/archive-specific UI assumptions should use the refreshed direction as a
  scoping reference.
* Existing memory-system decisions should remain useful as the default AIRP
  event/archive preset documentation.
* Workflow editor UX, node registry, schema metadata, and debug trace should
  converge on the same taxonomy.

### Failure And Edge Cases

* The document should avoid promising that arbitrary user code can do anything;
  platform safety boundaries still matter.
* The document should avoid turning "everything is workflow" into a mega-node or
  all-powerful compute-node design.
* The document should avoid dismissing the current event/archive system; it is a
  valuable reference preset, just not the universal architecture.

## Candidate Approaches

### Approach A: Rewrite Direction Document Only (Minimal)

Update `docs/active/airp-workflow-platform-direction.md` to replace the outdated
near-term direction with workflow-as-system principles, examples, guardrails,
and a decision checklist.

**Pros**

* Smallest change.
* Keeps the task sharply focused.
* Avoids turning this documentation refresh into roadmap maintenance.

**Cons**

* `docs/active/implementation-plan.md` may continue pointing at stale next
  steps.

### Approach B: Rewrite Direction Document And Lightly Patch Implementation Plan

Rewrite the direction document, then make a small update to
`docs/active/implementation-plan.md` so its recommended next-step section points
at workflow-as-system cleanup and no longer contradicts the direction.

**Pros**

* Keeps active docs aligned.
* Reduces risk that future sessions follow stale roadmap text.
* Still documentation-only.

**Cons**

* Slightly larger doc diff.

### Approach C: Add A New Separate Architecture Constitution

Create a new active doc such as `docs/active/workflow-as-system-direction.md`
and leave the old direction document mostly intact.

**Pros**

* Preserves old context untouched.
* Makes the new thesis very explicit.

**Cons**

* Creates parallel direction documents.
* Increases chance of future drift.

### Approach D: Rewrite Direction Document And Archive Stale Active Docs (Selected)

Rewrite `docs/active/airp-workflow-platform-direction.md` as the single current
direction document, then move stale active documents out of `docs/active` so
future sessions do not treat old plans/skeletons as maintained guidance.

**Pros**

* Matches the user's preference.
* Reduces documentation maintenance pressure.
* Makes the active docs directory more trustworthy.
* Avoids keeping a stale implementation plan alive with small patches.

**Cons**

* Requires choosing which active docs are still current versus historical.
* Slightly larger file-move diff than a single-doc rewrite.

## Recommended Decision

Use Approach D. The existing direction document should remain the primary place
for platform direction. Other stale active docs should be archived or
reclassified so the active docs set is small and trustworthy.

## Decision (ADR-lite)

**Context**: The active documentation set has accumulated old plans and
skeletons. Future sessions can mistake them for current guidance, which
increases maintenance pressure and causes direction drift.

**Decision**: Keep a strict active documentation set:
`README.md`, `current-state-handoff.md`, and
`airp-workflow-platform-direction.md`. Archive the older implementation plan,
memory decision record, narrative entity/archive skeleton, and patch contract
skeleton.

**Consequences**: The direction document must summarize the durable principles
that remain relevant from the old documents. Historical details remain
available in the archive, but future work should treat the refreshed direction
document as the current architectural guide.

## Out Of Scope

* Removing `apply-patch` from contracts, validator, UI, tests, or executors.
* Refactoring `memory-query(source: "event-archive")`.
* Changing default workflow behavior.
* Editing memory schema contracts or runtime storage behavior.
* Building schema/resource editor features.
* Building map, text post-processing, or alternate memory systems now.

## Technical Notes

* Existing direction doc: `docs/active/airp-workflow-platform-direction.md`.
* Archived roadmap doc:
  `docs/archive/2026-06-05-workflow-as-system/implementation-plan.md`.
* Archived default memory decision record:
  `docs/archive/2026-06-05-workflow-as-system/memory-system-decisions.md`.
* Recent workflow-core roadmap:
  `.trellis/tasks/archive/2026-06/06-05-airp-workflow-core-coverage/prd.md`.
* Recent generic maintenance migration:
  `.trellis/tasks/archive/2026-06/06-05-generic-maintenance-write-migration/prd.md`.
* Recent retrieval workflow boundary cleanup:
  `.trellis/tasks/archive/2026-06/06-05-airp-retrieval-workflow-boundary/prd.md`.
