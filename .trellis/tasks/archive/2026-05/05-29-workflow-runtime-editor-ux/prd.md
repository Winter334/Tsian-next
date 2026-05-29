# Workflow Preset Runtime Closure and Editor UX

## Goal

Close the loop between workflow presets edited in the resource library and the AIRP runtime path, then improve the workflow editor enough that users can configure the existing workflow capabilities without hand-copying hidden IDs or losing supported output extraction options.

## What I Already Know

* The workflow engine runs a DAG where edges copy `outputs[outputName ?? "raw"]` into downstream `inputs[varName]`.
* The runtime currently chooses only `mod.manifest.workflow` or `defaultWorkflow`; `ModManifest.workflowPresetId` exists in contracts but is not resolved by `platform-host`.
* Resource library can create and save workflow preset resources, prompt preset resources, and world book resources.
* The editor exposes all five built-in node types but currently asks users to type prompt preset IDs, world book keys, edge `varName`, and incomplete output extraction rules.
* Retrieval still runs in `platform-host` and enters the workflow through `__retrieval.raw`; fully lowering retrieval into a node is valuable but larger than this MVP.

## Requirements

* Resolve `manifest.workflowPresetId` from the platform resource library during `sendMessage`.
* Preserve current fallback behavior: if no `workflowPresetId` is present, use legacy `manifest.workflow`; otherwise use `defaultWorkflow`.
* Fail loud when a mod references a missing workflow preset.
* Keep the mod workflow `apply-patch` guard behavior for both inline manifest workflows and resource workflow presets.
* Add workflow editor resource selectors for AI call nodes:
  * prompt preset selector for `config.presetId`
  * world book multi-select or checkbox list for `config.worldBookKeys`
* Preserve manual entry capability where useful for advanced IDs, but make the common path selectable.
* Complete output extraction editing for supported contract fields:
  * raw/tag/regex extract type
  * `parse` as none/json/number
  * tag name
  * regex pattern, flags, and capture group
* Keep editor changes compatible with existing saved workflow JSON.

## Acceptance Criteria

* [ ] A mod manifest with `workflowPresetId` runs the referenced resource workflow preset.
* [ ] Missing `workflowPresetId` produces a clear error instead of silently falling back.
* [ ] Legacy `manifest.workflow` and `defaultWorkflow` behavior still works.
* [ ] Mod-sourced resource workflow presets containing `apply-patch` are rejected by validation.
* [ ] AI call node configuration can select prompt presets and world books from saved resources.
* [ ] Output declarations round-trip all supported extraction fields.
* [ ] Existing build/typecheck commands pass for touched packages.

## Definition of Done

* Tests added or updated for workflow preset resolution and editor serialization behavior where practical.
* `npm run build:web` passes.
* `npm run build:contracts` passes if contracts are touched.
* `npm run test:prompt-engine` is not required unless prompt-engine behavior changes.
* Specs are reviewed for update need before wrap-up.

## Technical Approach

* Add workflow preset resource loading in `platform-host` and make workflow resolution async.
* Resolve precedence as `workflowPresetId` first, then legacy `manifest.workflow`, then `defaultWorkflow`.
* Treat any workflow coming from a mod reference as a mod workflow for validation, so `apply-patch` remains blocked for mod-controlled workflows.
* Pass resource lists into `WorkflowEditorCanvas` and `NodeInspector` so `AiCallForm` can render selectors without direct storage access.
* Expand `OutputsEditor` to edit the exact `NodeOutputExtractRule` shape from contracts.

## Decision (ADR-lite)

**Context**: The editor already stores workflow presets, and contracts already include `workflowPresetId`, but runtime ignores it. Users can create workflows that cannot be selected for play.

**Decision**: Prioritize the resource workflow runtime closure plus low-risk editor affordances. Do not lower retrieval into a first-class workflow node in this task.

**Consequences**: The main AIRP loop becomes configurable through resource presets. Some deeper workflow expressiveness gaps remain for later work, especially retrieval strategy composition and richer conditional routing.

## Out of Scope

* Lowering retrieval into a dedicated workflow node.
* Adding new node types.
* Adding typed input schemas or a full expression language.
* Building a full workflow dry-run/debugger.
* Redesigning the editor visual style.

## Technical Notes

* Runtime workflow selection: `apps/platform-web/src/platform-host/index.ts`
* Workflow contracts: `packages/contracts/src/workflow.ts`, `packages/contracts/src/mod.ts`
* Resource persistence: `apps/platform-web/src/storage/resources.ts`
* Editor canvas/composable: `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`, `apps/platform-web/src/composables/useWorkflowEditor.ts`
* Inspector forms: `apps/platform-web/src/components/workflow/inspector/*.vue`
