# Workflow-As-System Next Phase

## Goal

Choose and define the next implementation slice after retiring
`memory-query(source: "event-archive")`, keeping Tsian aligned with the
workflow-as-system direction without broadening into a giant platform rewrite.

The likely shape is another bounded task that either removes a remaining
compatibility surface from workflow authoring or starts one small positive
platform capability needed for configurable systems.

## What I Already Know

* The active direction document says Tsian is a workflow-as-system platform:
  systems should be assembled from workflow presets, schemas/resources,
  platform capabilities, and frontend renderers.
* The previous cleanup retired `memory-query(source: "event-archive")`.
  `memory-query` is now collection-only in contracts, platform runtime/editor,
  tests, `.trellis/spec`, and active docs.
* `openspec/` belongs to the older Claude Code workflow and is not a current
  maintenance authority for Codex/Trellis work. It should not drive future
  planning; if it pollutes searches, deleting it is acceptable.
* The strongest remaining compatibility surface is `apply-patch` as a workflow
  node:
  * contract type: `WorkflowNodeType` and `ApplyPatchNodeConfig`;
  * workflow-engine known node set and `APPLY_PATCH_INPUT_INCOMPLETE`;
  * platform executor registry and `executors/apply-patch.ts`;
  * workflow editor palette, default config, slots, inspector form, validation
    message mapping, debug view labels/filtering;
  * specs and tests that currently assert mod workflows may contain explicit
    `apply-patch`.
* Bridge/runtime patch compatibility is separate:
  * `bridge.runtime.applyPatch`;
  * `bridge.runtime.updateGlobals`;
  * `runtime-host/patch-applier.ts`;
  * `applyMaintenancePatch()` syncs legacy writes back into generic AIRP memory.
* Default AIRP workflow does not use `apply-patch`; it writes through
  `memory-write`.
* `memory-core` already has a default AIRP runtime memory schema and validation
  helpers. Schema resources for arbitrary user/mod-defined systems are not yet
  implemented.

## Assumptions (Temporary)

* The next task should remain reviewable and not try to build every future
  workflow-as-system capability at once.
* We should not maintain `openspec/` further unless the task is explicitly
  about deleting it.
* Bridge/runtime APIs should not be removed merely because a workflow node is
  retired; those are different compatibility surfaces.
* Default AIRP behavior must remain valid.

## Candidate Directions

### Approach A: Retire `apply-patch` From Workflow Authoring Surface (Recommended)

Remove or hide `apply-patch` as a normal workflow node while preserving
bridge/internal patch compatibility. The default workflow already uses
`memory-write`, so this primarily cleans contracts/editor/runtime authoring
semantics.

Possible MVP variants:

* A1: Hide from editor only, keep contract/runtime support for old workflows.
* A2: Full workflow surface retirement: remove from contracts, validator,
  executor registry, editor, slots, forms, tests/specs; old workflows fail.
* A3: Transitional deprecation: keep contract/runtime but mark deprecated and
  remove from new authoring UI.

Pros:

* Directly addresses the remaining compatibility node concern.
* Keeps patch APIs as platform compatibility rather than workflow primitive.
* Makes the node set semantically cleaner before adding new primitives.

Cons:

* Full removal has a broad touch surface across contracts, engine, platform-web,
  docs/specs, and static tests.
* Transitional hiding is safer but leaves the contract surface larger.

### Approach B: Start Schema Resources For Configurable Memory Systems

Begin moving from built-in AIRP schema validation toward resource-backed memory
schemas that workflow presets can reference. Keep the MVP small, such as
registering schema resources and letting `memory-write` validate custom
namespace/collection targets when a schema exists.

Pros:

* Positive platform capability, not just cleanup.
* Directly supports keyword-fragment, map, and other non-AIRP systems.
* Builds on existing `memory-core`.

Cons:

* Larger design space: resource storage, editor UI, mod packaging, validation
  policy, fallback behavior.
* Easier to overbuild before the node surface is clean.

### Approach C: Clean Documentation/Search Noise

Delete or archive inactive Claude Code/OpenSpec workflow files and stale
agent-facing docs that are no longer authoritative for Codex/Trellis work.

Pros:

* Reduces search noise and future confusion.
* Low risk if limited to known inactive docs.

Cons:

* Mostly hygiene; does not advance runtime/editor architecture.
* Needs care not to delete useful historical context accidentally.

## Expansion Sweep

### Future Evolution

* If `apply-patch` leaves workflow authoring, future generic write semantics can
  center on `memory-write`, schema validation, and explicit platform capability
  nodes.
* If schema resources begin next, later workflow presets can declare or depend
  on schemas for keyword memory, map graphs, relationship networks, or style
  systems.

### Related Scenarios

* Workflow editor palette, inspector, validation messages, trace/debug UI, and
  tests need to agree on which nodes are public authoring primitives.
* Save-selected workflows and mod-provided workflow presets need predictable
  failure behavior when old node types appear.
* Bridge APIs may remain available to frontends even when equivalent workflow
  nodes are retired.

### Failure And Edge Cases

* Removing a node from contracts can break old exported workflows or old local
  workflow resources.
* Keeping runtime support while hiding UI can make the public surface ambiguous.
* Introducing schema resources too early may require decisions about migrations,
  mod import/export, and UI that are not yet mature.

## Open Questions

* None. The user selected Approach A2: full `apply-patch` workflow node
  retirement.

## Requirements (Evolving)

* Preserve default AIRP workflow behavior.
* Keep workflow nodes generic and avoid re-binding event/archive semantics to
  node types.
* Keep platform-owned safety boundaries for storage, checkpoint, rollback,
  validation, and bridge/runtime compatibility.
* Avoid maintaining `openspec/` as an active authority.
* Fully retire `apply-patch` from the workflow node surface:
  * remove it from shared workflow contracts;
  * remove workflow-engine validation logic dedicated to `apply-patch`;
  * unregister the platform workflow executor;
  * remove editor palette/default config/slot metadata/inspector support;
  * remove DebugView wording/filtering that treats `apply-patch` as a workflow
    maintenance node;
  * update tests/static proofs that currently assume workflow-level
    `apply-patch` support.
* Preserve bridge/runtime patch compatibility separately:
  * keep `bridge.runtime.applyPatch`;
  * keep `bridge.runtime.updateGlobals`;
  * keep `runtime-host/patch-applier.ts` and `applyMaintenancePatch()`;
  * keep generic AIRP memory sync inside the applier.
* Old workflow definitions that still contain node type `"apply-patch"` should
  fail loudly as unknown node types rather than silently running a legacy path.

## Acceptance Criteria (Evolving)

* [x] MVP direction is selected and recorded.
* [x] Scope explicitly separates workflow authoring surface from bridge/runtime
  compatibility surfaces.
* [x] `apply-patch` is no longer part of `WorkflowNodeType` or workflow node
  config contracts.
* [x] workflow-engine no longer treats `apply-patch` as a known node type or
  validates `APPLY_PATCH_INPUT_INCOMPLETE`.
* [x] platform-web no longer registers or exposes an `apply-patch` workflow
  executor, palette item, default config, inspector form, or slot metadata.
* [x] DebugView and workflow editor validation copy no longer present
  `apply-patch` as a normal workflow maintenance node.
* [x] Bridge/runtime patch APIs continue to use the shared applier.
* [x] Default AIRP workflow remains valid and continues to use `memory-write`.
* [x] Tests/static proofs are updated to cover the new boundary.
* [x] Touched `.trellis/spec/` and active docs match the selected boundary.
* [x] Required builds/tests for touched packages pass.

## Definition Of Done

* PRD records the selected direction, trade-offs, out-of-scope items, and
  acceptance criteria.
* If implementation follows, relevant Trellis specs are loaded before coding.
* Tests/static proofs are updated for changed behavior.
* Required package builds/tests pass.
* Work is committed and task is archived when complete.

## Out Of Scope (Until Selected)

* Removing bridge `runtime.applyPatch` / `updateGlobals`.
* Building map/text/style systems directly.
* Introducing workflow blocks/subgraphs in the same slice as compatibility
  cleanup.
* Maintaining or validating `openspec/` as part of future Codex/Trellis tasks.

## Decision (ADR-lite)

**Context**: The previous cleanup retired the `event-archive` branch from
`memory-query`, leaving `apply-patch` as the most visible legacy compatibility
node in the workflow surface. The default AIRP workflow already writes through
generic `memory-write`, while bridge/runtime patch APIs still serve as a
separate compatibility path for older frontend/runtime integrations.

**Decision**: Fully retire `apply-patch` as a workflow node. Remove it from
contracts, engine known-node validation, platform workflow executor
registration, editor authoring UI, workflow slot metadata, and workflow-node
tests/specs. Preserve bridge/runtime patch compatibility and the shared
`applyMaintenancePatch()` applier.

**Consequences**: Old workflow definitions containing `"apply-patch"` fail
loudly as unsupported workflow definitions. The workflow node vocabulary becomes
cleaner and centers maintenance writes on `memory-write`. Patch compatibility
remains available only through platform-owned bridge/runtime paths, which keeps
legacy state mutation separate from public workflow authoring.

## Implementation Plan

1. Contracts and engine:
   * remove `"apply-patch"` from `WorkflowNodeType`;
   * remove `ApplyPatchNodeConfig` from workflow contracts;
   * remove apply-patch validator branch and error code expectations;
   * update tests that currently assert mod workflows may contain
     `apply-patch`.
2. Platform workflow host and editor:
   * unregister `applyPatchExecutor`;
   * delete or orphan-check the workflow executor/form code;
   * remove palette/default config/slot metadata/inspector support;
   * update DebugView wording/filtering and editor validation messages.
3. Compatibility proof and docs:
   * keep bridge/runtime applier static proof focused on bridge APIs and
     `applyMaintenancePatch()`, not workflow node equivalence;
   * update `.trellis/spec/` and active docs;
   * do not update or validate `openspec/`.
4. Verification:
   * `npm run build:contracts`;
   * `npm run build:workflow-engine`;
   * `npm run test --workspace @tsian/workflow-engine`;
   * `npm run build:web`;
   * `git diff --check`.

## Completion Notes

* `apply-patch` was removed from the workflow authoring/runtime node surface:
  contracts, validator known-node set, executor registry, editor palette,
  default config, slot metadata, inspector form, validation copy, DebugView
  filtering, and workflow-node tests/static proofs.
* Bridge/runtime patch compatibility was preserved: `bridge.runtime.applyPatch`,
  `bridge.runtime.updateGlobals`, `runtime-host/patch-applier.ts`, and
  `applyMaintenancePatch()` remain the shared compatibility path.
* Repository searches confirm `apply-patch` remains only in tests that prove the
  retired boundary and docs/specs that describe compatibility.
* Verification passed:
  `git diff --check`, `npm run build:contracts`,
  `npm run build:workflow-engine`,
  `npm run test --workspace @tsian/workflow-engine`, and
  `npm run build:web`.

## Technical Notes

* Direction doc: `docs/active/airp-workflow-platform-direction.md`.
* Current handoff: `docs/active/current-state-handoff.md`.
* Previous cleanup task:
  `.trellis/tasks/archive/2026-06/06-05-workflow-system-boundary-cleanup/prd.md`.
* Key current `apply-patch` files surfaced by search:
  * `packages/contracts/src/workflow.ts`
  * `packages/workflow-engine/src/validator.ts`
  * `apps/platform-web/src/workflow-host/executors/apply-patch.ts`
  * `apps/platform-web/src/workflow-host/index.ts`
  * `apps/platform-web/src/components/workflow/node-registry.ts`
  * `apps/platform-web/src/components/workflow/node-schema.ts`
  * `apps/platform-web/src/components/workflow/NodeInspector.vue`
  * `apps/platform-web/src/composables/useWorkflowEditor.ts`
  * `apps/platform-web/src/views/DebugView.vue`
  * `packages/workflow-engine/test/p-i-1.test.ts`
  * `packages/workflow-engine/test/sc-crit.test.ts`
* Key current schema files surfaced by search:
  * `packages/contracts/src/memory.ts`
  * `packages/memory-core/src/default-airp-schema.ts`
  * `packages/memory-core/src/validation.ts`
  * `apps/platform-web/src/workflow-host/executors/memory-write.ts`
  * `.trellis/spec/memory-core/backend/memory-schema.md`
