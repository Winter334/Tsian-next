# Workflow Editor State Contract UX

## Goal

Improve the workflow editor so workflow presets feel like authorable systems rather than hard-coded JSON artifacts. The near-term focus is to upgrade the fullscreen workflow editor UX/workbench first, so richer node forms, workflow state-contract visibility, and JSON fallback can fit into a coherent authoring surface instead of being squeezed into the current narrow three-column layout.

## What I Already Know

- Direction docs define Tsian as a workflow-as-system platform: systems should be composed from workflow, schema/state, resources, platform capabilities, and renderer.
- The default AIRP event/archive system is a reference preset, not platform core semantics.
- The current public workflow node surface includes `ai-call`, `result`, `switch`, `compute`, `state-query`, `state-write`, `template-compose`, `record-filter`, `record-merge`, and `record-format`.
- Retired workflow node types `apply-patch`, `memory-query`, and `memory-write` should continue to fail loudly rather than return as aliases.
- Default AIRP workflow currently writes through a `state-write` node carrying `defaultAirpMemorySchema`.
- Users should be able to replace world books and prompt presets and reuse the generic default workflow shape as a true default workflow/mod foundation.
- The editor should handle most workflows through UI; JSON editing should mainly be needed for heavy custom `compute` scripts or unusual advanced cases.

## Current Code Findings

- `apps/platform-web/src/components/workflow/NodeInspector.vue` has specialized forms for `ai-call`, `result`, `switch`, `compute`, `state-query`, `state-write`, and `template-compose`.
- `record-filter`, `record-merge`, and `record-format` currently have default configs and runtime executors, but no inspector forms, so selected nodes fall through to a read-only JSON `pre`.
- `StateWriteForm.vue` exposes operations var, default namespace, default collection, and checkpoint, but does not show or edit the node-carried `schema`.
- `state-write.schema` is used by `apps/platform-web/src/workflow-host/executors/state-write.ts` as the validation boundary.
- Workflow preview/fullscreen editor already exists inside `ResourceLibraryView.vue`, but the UI is a narrow palette + canvas + fixed inspector layout and likely strains under richer node forms and state contract summaries.
- Palette icon wiring appears incomplete for newer record nodes: `node-registry.ts` declares `Filter`, `Combine`, and `Rows3`, while `WorkflowEditorCanvas.vue` imports/maps only the earlier icon set.

## Assumptions

- This task should improve authoring for the existing node set, not introduce new workflow primitives.
- Schema resources should remain out of scope until workflow-carried state contracts are visible and understandable.
- Renderer adapters should remain out of scope until the state model/resource boundary is clearer.
- Full visual editing of every arbitrary JSON detail is not required for the first pass; a good raw JSON fallback can remain for advanced escapes.

## Requirements (Evolving)

- Prioritize a fullscreen workflow editor UX upgrade over immediately adding every missing node-specific form.
- Replace the current always-visible multi-column editor with a canvas-first authoring surface.
- Use low-misclick interactions:
  - right-click / context menu on the canvas to add nodes near the pointer,
  - double-click or right-click on a node to open a large node configuration dialog,
  - right-click or explicit selection action for edge configuration,
  - avoid long-press as the primary desktop interaction because it conflicts with frequent node dragging.
- Move existing node inspector content into the large node configuration dialog.
- Add a JSON/raw fallback tab in the node configuration dialog so nodes without complete form coverage remain editable.
- Scope the JSON/raw fallback to the selected node's authoring payload:
  `label`, `config`, `inputs`, `outputs`, and `retry`.
  It must not edit `id`, `type`, or `position`, because those fields can break graph identity, edge references, or layout.
- Rework the editor surface so it can comfortably host:
  - graph canvas as the primary workspace,
  - contextual node creation,
  - large node/edge configuration surfaces,
  - workflow diagnostics in a collapsible bottom drawer,
  - future state-contract summary in the same drawer area,
  - JSON import/export or raw fallback.
- Preserve existing workflow editing behavior, JSON import/export, and fail-loud validation behavior during the UX upgrade.
- Leave clear extension points for later durable state contract visibility and full public-node authoring forms.
- Keep `compute` code-first; the upgraded UX should make code editing less cramped, not turn compute into a visual language.

## Acceptance Criteria (Evolving)

- [ ] The fullscreen workflow editor uses the graph canvas as the dominant workspace without a permanent node palette + right inspector consuming large horizontal space.
- [ ] A user can add a node from a canvas context menu at the intended location.
- [ ] A user can open a large node configuration dialog from an existing node with a low-misclick interaction.
- [ ] The node configuration dialog includes the existing form-based inspector content and a JSON/raw fallback tab.
- [ ] The node JSON/raw fallback can edit `label/config/inputs/outputs/retry` and validates JSON before applying changes.
- [ ] The node JSON/raw fallback cannot change node `id/type/position`.
- [ ] A user can edit edge varName/condition without relying on a permanent right sidebar.
- [ ] The upgraded editor has a bottom drawer controlled by an arrow/toggle.
- [ ] Collapsed drawer state preserves canvas space while still showing key summary status.
- [ ] Expanded drawer state shows detailed workflow diagnostics and reserves a tab/section for future state-contract summary.
- [ ] Existing node editing behavior continues to work after the layout change.
- [ ] JSON import/export remains available.
- [ ] The default AIRP workflow can be opened and navigated comfortably in the upgraded editor.
- [ ] `npm run build:web` passes.
- [ ] Relevant contract/workflow-engine checks are run if shared types or validation behavior change.

## Definition Of Done

- Tests added or updated where appropriate.
- Lint/typecheck/build commands pass for touched packages.
- Active docs or Trellis specs updated if new workflow editor conventions emerge.
- Out-of-scope items are recorded in `docs/active/deferred-work.md` if a known gap is intentionally left.

## Deferred From This Task Unless Reconfirmed

- Full editable inspector UI for `record-filter`, `record-merge`, and `record-format`.
- Full workflow-level durable state contract summary.
- Detailed `state-write.schema` collection/field viewer.

## Out Of Scope

- Reintroducing retired `apply-patch`, `memory-query`, or `memory-write` workflow syntax.
- Building reusable schema resource storage.
- Building a full visual schema form editor.
- Building renderer adapters for map/relationship/keyword systems.
- Replacing JSON import/export.
- Making arbitrary `compute` internals fully visual; compute may remain code-first.

## Decisions

- Prefer approach 2 from the initial scope discussion: upgrade the fullscreen editor UX/workbench first. The state-contract visibility and missing public-node forms can be layered on once the editor surface is ready to carry them.
- Refine the workbench direction toward a canvas-first editor rather than a permanent multi-column layout. The current side inspector is too cramped for complex nodes such as `compute`, and future schema/state-contract views would make it worse.
- The first-pass node editing surface should include both form editing and a JSON/raw fallback tab. This keeps currently under-served nodes editable while more specialized forms are deferred.
- The raw fallback edits only the node authoring payload (`label/config/inputs/outputs/retry`), not graph identity/layout fields (`id/type/position`).
- Workflow diagnostics and future state-contract summary should live in a collapsible bottom drawer. The collapsed state keeps the canvas dominant; the expanded state provides detailed system-level information.

## Requirements

- Build a canvas-first fullscreen workflow editor.
- Remove the permanent node palette and right inspector from the editable fullscreen workflow surface.
- Keep the graph canvas as the dominant workspace.
- Add a canvas context menu for node creation at the pointer location.
- Add low-misclick node editing:
  - double-click node opens a large node configuration dialog,
  - right-click node opens a context menu with edit/delete actions.
- Add edge editing through double-click or context menu, without relying on a permanent right sidebar.
- Move existing node inspector/form content into the large node configuration dialog.
- Add a node JSON/raw fallback tab scoped to `label`, `config`, `inputs`, `outputs`, and `retry`.
- Do not allow raw fallback to edit node `id`, `type`, or `position`.
- Add a bottom drawer controlled by an arrow/toggle:
  - collapsed state preserves canvas space and shows summary status,
  - expanded state shows detailed diagnostics and reserves space for future workflow summary/state-contract information.
- Preserve existing workflow behavior, JSON import/export, auto layout, save, reset, and fail-loud validation.
- Leave full record-node forms and detailed state-contract visualization for later tasks.

## Acceptance Criteria

- [ ] The fullscreen workflow editor uses the graph canvas as the dominant workspace without a permanent node palette + right inspector consuming large horizontal space.
- [ ] A user can add a node from a canvas context menu at the intended location.
- [ ] A user can open a large node configuration dialog from an existing node with double-click or node context menu.
- [ ] The node configuration dialog includes the existing form-based inspector content and a JSON/raw fallback tab.
- [ ] The node JSON/raw fallback can edit `label/config/inputs/outputs/retry` and validates JSON before applying changes.
- [ ] The node JSON/raw fallback cannot change node `id/type/position`.
- [ ] A user can edit edge varName/condition without relying on a permanent right sidebar.
- [ ] The upgraded editor has a bottom drawer controlled by an arrow/toggle.
- [ ] Collapsed drawer state preserves canvas space while still showing key summary status.
- [ ] Expanded drawer state shows detailed workflow diagnostics and reserves a tab/section for future state-contract summary.
- [ ] Existing node editing behavior continues to work after the layout change.
- [ ] JSON import/export remains available.
- [ ] The default AIRP workflow can be opened and navigated comfortably in the upgraded editor.
- [ ] `npm run build:web` passes.
- [ ] Relevant contract/workflow-engine checks are run if shared types or validation behavior change.

## Open Questions

- None. User approved the MVP scope on 2026-06-06.

## Technical Notes

- Direction source: `docs/active/airp-workflow-platform-direction.md`.
- Current handoff: `docs/active/current-state-handoff.md`.
- Deferred context: `docs/active/deferred-work.md` entries DW-003, DW-004, DW-005.
- Platform state spec: `.trellis/spec/platform-web/frontend/state-management.md`.
- Memory schema spec: `.trellis/spec/memory-core/backend/memory-schema.md`.
- Likely touched areas:
  - `apps/platform-web/src/components/workflow/NodeInspector.vue`
  - `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
  - `apps/platform-web/src/components/workflow/node-schema.ts`
  - `apps/platform-web/src/components/workflow/node-registry.ts`
  - `apps/platform-web/src/components/workflow/inspector/*`
  - `apps/platform-web/src/views/ResourceLibraryView.vue`
  - Possibly workflow editor composable/tests if UI behavior needs normalized configs.
- Vue Flow `@vue-flow/core` 1.48.2 supports `nodeDoubleClick`, `nodeContextMenu`, `paneContextMenu`, `edgeDoubleClick`, and `edgeContextMenu`, so the preferred interactions fit the existing graph library.
