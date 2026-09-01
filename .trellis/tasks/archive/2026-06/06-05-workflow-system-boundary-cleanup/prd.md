# Workflow System Boundary Cleanup

## Goal

Implement the next concrete cleanup slice from the refreshed
workflow-as-system direction: reduce compatibility surfaces that still make
legacy AIRP-specific behavior look like normal workflow primitives.

The goal is not to build new systems yet. The goal is to make the existing
workflow surface more honest: generic nodes should remain generic, default AIRP
event/archive behavior should live in schema/workflow preset configuration, and
legacy compatibility should be explicit, bounded, and easier to retire.

## What I Already Know

* The refreshed active direction document says Tsian is a workflow-as-system
  platform. Systems should be assembled from workflow presets, schemas,
  resources, platform capabilities, and renderers.
* The direction document identifies two immediate cleanup targets:
  * `apply-patch` workflow surface versus bridge/API/internal applier
    compatibility;
  * `memory-query(source: "event-archive")` as a historical compatibility
    branch rather than the long-term generic query model.
* The default AIRP workflow currently uses collection queries and generic
  record nodes:
  * `memory-query { source: "collection", namespace: "airp", collection:
    "events" | "archives" | "globals" }`
  * `record-filter`
  * `record-merge`
  * `record-format`
  * bounded `compute`
  * `memory-write`
* `builtin/mods/default-airp-workflow.ts` does not contain `event-archive` and
  does not use `apply-patch`.
* `packages/workflow-engine/test/mixed-airp-default-workflow.test.ts` already
  asserts the default workflow does not contain `"event-archive"` and wires
  maintenance output to `memory-write`.
* `apply-patch` remains in:
  * `WorkflowNodeType` and `ApplyPatchNodeConfig`
  * workflow-engine validator known-node set and apply-patch port validation
  * workflow-host executor registry
  * workflow editor node registry, default config, schema slots, inspector form
  * tests/specs asserting mod workflows may use explicit `apply-patch`
* Bridge/runtime compatibility is separate:
  * `bridge.runtime.applyPatch`
  * `bridge.runtime.updateGlobals`
  * `runtime-host/patch-applier.ts`
  * static tests that prove bridge patch APIs and apply-patch node share the
    applier
* `memory-query(source: "event-archive")` remains in:
  * `MemoryQueryNodeConfig`
  * `memory-query` executor validation and branch to `assembleRetrievalContext`
  * editor form source dropdown
  * node-schema output slots for `prompt`, `directEntities`, `archives`, `debug`
  * specs that classify it as a compatibility/high-level strategy node
* Direction docs and current-state handoff now frame these as cleanup targets,
  not desired end-state architecture.

## Assumptions (Temporary)

* This task should be a real code cleanup slice, not another direction document.
* It should preserve the current default AIRP workflow behavior.
* It should not remove bridge/runtime compatibility APIs unless explicitly
  selected; bridge APIs are a separate surface from workflow nodes.
* It should prefer a small, reviewable MVP over trying to delete every legacy
  reference in one pass.
* It should update `.trellis/spec/` and/or `openspec/specs/` if code behavior
  changes a documented contract.

## Open Questions

* None. The user accepted Approach B.

## Requirements (Evolving)

* Keep the default AIRP workflow valid and behaviorally unchanged.
* Remove or demote one legacy compatibility surface that conflicts with the new
  workflow-as-system direction.
* Preserve platform safety boundaries: storage, checkpoint, rollback, and
  schema validation remain platform-owned.
* Do not make `apply-patch` the generic memory operation model.
* Do not add event/archive-specific node types.
* Do not introduce a broad permission system or schema resource system in this
  slice.
* Update tests/static proofs for the selected compatibility cleanup.
* Update specs/docs that currently describe the selected compatibility surface
  as supported active behavior.

## Acceptance Criteria (Evolving)

* [x] MVP cleanup surface is selected and recorded.
* [x] Default AIRP workflow still validates.
* [x] Default AIRP workflow still uses collection memory queries and
  `memory-write`, not legacy patch or event-archive retrieval.
* [x] Selected compatibility surface is removed from public/editor workflow
  authoring where applicable.
* [x] If a legacy runtime/bridge compatibility path remains, it is clearly
  separated from workflow node authoring.
* [x] Relevant tests/static proofs are updated.
* [x] Relevant builds/tests pass for touched packages.
* [x] Specs reflect the new supported boundary.

## Definition Of Done

* Tests added/updated where behavior changes.
* `npm run build:contracts` if shared contracts change.
* `npm run build:workflow-engine` and workflow-engine tests if workflow
  contracts/validator/static proofs change.
* `npm run build:web` for platform-web editor/executor changes.
* Specs/docs updated for any changed contract.
* Work committed before task archive.

## Expansion Sweep

### Future Evolution

* `apply-patch` can later disappear from workflow contracts entirely while
  bridge/internal patch compatibility is evaluated separately.
* `memory-query` can become collection/schema-only, with AIRP-specific retrieval
  represented as a default workflow preset rather than a high-level source mode.
* Later tasks can introduce workflow blocks/subgraphs or schema resources after
  the base surface is clean.

### Related Scenarios

* Workflow editor node palette, inspector forms, validation errors, and trace UI
  need to agree on what a supported node/source is.
* Mod-provided workflows and save-level workflow overrides need predictable
  validation behavior.
* Legacy saves or old exported workflows may contain deprecated node/source
  shapes; this task must decide whether they fail loudly or remain loadable
  through an explicit compatibility path.

### Failure And Edge Cases

* Removing a contract-level node/source without handling old workflow resources
  can make existing saved workflows fail validation.
* Hiding a node in the editor while keeping runtime validation support may be a
  safer transitional step, but it leaves the contract surface larger.
* Removing a runtime branch may require updating specs/tests that currently
  assert compatibility behavior.

## Candidate MVP Approaches

### Approach A: Retire `apply-patch` From Workflow Authoring Surface

Hide or remove `apply-patch` from the workflow editor/node palette and stop
presenting it as a normal node. Keep bridge/runtime patch APIs and the applier
for compatibility. Decide whether engine contracts still accept old workflows
with `apply-patch` during a transition.

**Pros**

* Directly addresses the user's first concern.
* Makes the node palette semantically cleaner.
* Keeps bridge compatibility separate from author-facing workflow design.

**Cons**

* Full removal touches contracts, validator, tests, specs, editor, executor
  registry, and static bridge/node equivalence tests.
* Transitional hiding is easier but leaves `apply-patch` in the contract.

### Approach B: Remove `memory-query(source: "event-archive")` Compatibility Branch (Recommended)

Make `memory-query` collection-only in the public contract/editor/runtime path.
Remove or reject the `event-archive` source branch and its special output slots,
because the default AIRP workflow already uses collection queries and record
nodes.

**Pros**

* Smaller and cleaner first implementation slice.
* Aligns `memory-query` with the workflow-as-system principle: memory query is
  generic collection/schema access, not an AIRP retrieval black box.
* Default AIRP workflow and existing regression tests already support this
  direction.

**Cons**

* Old workflows using `event-archive` will fail unless a compatibility strategy
  is kept.
* Does not yet remove the more visible `apply-patch` node.

### Approach C: Do Both In One Cleanup Task

Remove/demote `apply-patch` workflow authoring and remove
`memory-query(source: "event-archive")` in the same task.

**Pros**

* Strongest alignment with the refreshed direction.
* Avoids another partial cleanup state.

**Cons**

* Larger blast radius across contracts, workflow-engine, platform-web, specs,
  and tests.
* Higher risk of mixing two compatibility policies and making review harder.

## Recommended Decision

Use Approach B first: make `memory-query` collection-only and retire the
`event-archive` source branch from the workflow surface. It is the cleanest
small slice because the default workflow has already moved away from the branch,
and it reinforces the generic memory-query boundary without immediately
unwinding the larger apply-patch bridge/node compatibility knot.

## Decision (ADR-lite)

**Context**: The refreshed workflow-as-system direction says generic workflow
nodes should stay generic, and AIRP event/archive behavior should be represented
through schema, workflow presets, resources, and renderers. The default AIRP
workflow already uses collection queries and record nodes, but
`memory-query(source: "event-archive")` still exposes an AIRP retrieval black-box
branch as part of the public node config.

**Decision**: This task will retire the `event-archive` source branch and make
`memory-query` collection-only in contracts, executor behavior, editor forms,
slot metadata, tests, and specs.

**Consequences**: Old workflows using `source: "event-archive"` should fail
loudly rather than continue as a hidden AIRP retrieval path. The default AIRP
workflow remains supported because it already uses `source: "collection"`.
`apply-patch` cleanup is deferred to a separate task.

## Out Of Scope

* Building new memory schemas or alternate systems.
* Adding map/text-post-processing systems.
* Introducing workflow blocks/subgraphs.
* Removing bridge `runtime.applyPatch` / `updateGlobals`.
* Replacing `runtime-host/patch-applier.ts`.
* Creating a broad workflow permission/capability model.

## Completion Notes

Implemented Approach B:

* `MemoryQueryNodeConfig.source` is now `"collection"` only.
* The platform `memory-query` executor no longer imports or calls
  `assembleRetrievalContext`; it queries save-scoped `memoryRecords` through
  `listMemoryRecordsForSave`.
* Runtime execution fails loudly when `source` is not `"collection"` or when
  `namespace` / `collection` is missing.
* The workflow editor inspector no longer exposes the source selector, and
  `memory-query` output slots are fixed to `records` / `count`.
* Static workflow-engine proof now checks the collection-only boundary across
  contracts, executor, inspector form, and node schema.
* `.trellis/spec/`, `openspec/specs/`, and active docs were updated to describe
  the new boundary.

Verification:

* `npm run build:contracts`
* `npm run build:workflow-engine`
* `npm run test --workspace @tsian/workflow-engine`
* `npm run build:web`
* `git diff --check`

OpenSpec note: `npx openspec validate --specs --strict --no-interactive` still
fails because existing spec files use the older numbered section format instead
of the CLI-required `## Purpose` / `## Requirements` structure. The same failure
appears when validating the touched `contracts` and `workflow-engine` specs
individually, so this task did not broaden into OpenSpec format migration.

## Technical Notes

* Direction doc: `docs/active/airp-workflow-platform-direction.md`.
* Workflow contracts: `packages/contracts/src/workflow.ts`.
* Workflow validator: `packages/workflow-engine/src/validator.ts`.
* Workflow host registry: `apps/platform-web/src/workflow-host/index.ts`.
* Memory query executor:
  `apps/platform-web/src/workflow-host/executors/memory-query.ts`.
* Workflow editor:
  * `apps/platform-web/src/components/workflow/node-registry.ts`
  * `apps/platform-web/src/components/workflow/node-schema.ts`
  * `apps/platform-web/src/components/workflow/inspector/MemoryQueryForm.vue`
  * `apps/platform-web/src/composables/useWorkflowEditor.ts`
* Default workflow: `builtin/mods/default-airp-workflow.ts`.
* Regression tests:
  * `packages/workflow-engine/test/mixed-airp-default-workflow.test.ts`
  * `packages/workflow-engine/test/generic-airp-maintenance.test.ts`
* Relevant specs:
  * `.trellis/spec/platform-web/frontend/state-management.md`
  * `.trellis/spec/workflow-engine/*`
  * `.trellis/spec/contracts/*`
  * `openspec/specs/workflow-engine/spec.md`
  * `openspec/specs/contracts/spec.md`
