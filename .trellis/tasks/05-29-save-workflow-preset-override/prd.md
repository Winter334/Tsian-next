# Save-level Workflow Preset Override

## Goal

Allow each local save to explicitly choose the workflow preset used for AIRP runtime execution, with clear precedence over the mod default and loud failures for missing references.

## Why This Matters

Workflow presets are now editable resources and mod manifests can point at a preset, but a player still cannot choose a different workflow for a specific save. That leaves the workflow system too mod-centric and prevents the AIRP platform model from becoming truly user-composable.

Save-level override is the next small infrastructure step that makes workflow selection a runtime play choice rather than only a mod author choice.

## Requirements

* Add optional `workflowPresetId` to the local save record or equivalent save metadata.
* Resolve runtime workflow with this precedence:
  1. save-level `workflowPresetId`
  2. `ModManifest.workflowPresetId`
  3. deprecated `ModManifest.workflow`
  4. platform `defaultWorkflow`
* Fail loudly when a save references a missing workflow preset.
* Preserve the existing loud failure when a mod references a missing workflow preset.
* Preserve existing legacy mod workflow and default workflow behavior.
* Add a UI path to apply a workflow preset to the current save from the resource library or save/play surface.
* Make the current workflow source visible enough for the user to distinguish:
  * save override
  * mod preset
  * legacy mod workflow
  * platform default
* Keep platform-owned `apply-patch` safety behavior:
  * mod-controlled workflows remain unable to use `apply-patch`
  * save-selected resource workflows should be treated as user-selected runtime workflows and reviewed explicitly during implementation before assigning the same policy as mod workflows or platform workflows

## Acceptance Criteria

* [ ] A save with `workflowPresetId` runs that workflow instead of the mod manifest workflow.
* [ ] Removing the save override returns resolution to the mod/default chain.
* [ ] Missing save-level workflow preset produces a clear error and does not silently fall back.
* [ ] Existing `ModManifest.workflowPresetId` behavior still works.
* [ ] Existing legacy `ModManifest.workflow` behavior still works when no preset IDs are present.
* [ ] Existing default workflow behavior still works when neither save nor mod supplies a workflow.
* [ ] UI can apply a workflow preset to the current save.
* [ ] UI shows where the current workflow came from.
* [ ] Tests cover precedence and missing-reference behavior.

## Definition of Done

* Relevant Trellis specs are read before implementation.
* Contracts are updated if save metadata shape crosses package boundaries.
* Runtime workflow resolution has focused test coverage.
* `npm run build:web` passes.
* `npm run build:contracts` passes if contracts are touched.
* Any new cross-layer workflow contract is captured in `.trellis/spec`.

## Technical Notes

Likely areas to inspect:

* `apps/platform-web/src/platform-host/index.ts`
* `apps/platform-web/src/storage/`
* `apps/platform-web/src/components/resource-library/`
* `apps/platform-web/src/components/workflow/`
* `packages/contracts/src/workflow.ts`
* `packages/contracts/src/mod.ts`

The implementation should first locate the save record type and the existing workflow resolution helper from the prior workflow runtime task, then extend the same path rather than creating a parallel resolver.

## Out of Scope

* Node input/output schema design.
* Workflow run trace UI.
* Memory chain node-ization.
* New memory architecture.
* Full workflow permission model beyond the minimum needed to resolve save-selected presets safely.

