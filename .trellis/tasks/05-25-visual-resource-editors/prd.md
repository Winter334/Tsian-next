# Visual Resource Editors for Prompt Presets and World Books

## Goal

Improve the resource library editing experience for prompt presets and world books by replacing JSON-first editing with visual, entry-based editors. The UX should reference SillyTavern's entry management model and reuse the current workflow preset pattern: the resource page keeps an outer preview, while detailed editing opens in a full-screen editor.

## Requirements

* Provide a visual prompt preset editor that manages PresetInfo.prompts as ordered entries.
* Provide a visual world book editor that manages WorldBook.entries as ordered entries.
* Support drag and reorder for entries.
* Support enable and disable per entry.
* Support opening or selecting an entry for detailed editing.
* Use the existing workflow editor interaction pattern: resource page preview outside, full-screen detailed editor for complex editing.
* Keep existing resource tabs, create/select/save/delete flows, and workflow preset editing behavior.
* Preserve unknown or advanced fields where the current structures allow them; do not silently discard fields not visualized by the MVP.
* Preserve advanced/raw fields through visual edits where the current structures allow them; a dedicated JSON/raw-data editor is deferred to a later task.
* Treat SillyTavern as UX inspiration and compatibility context, not as a requirement to implement every upstream field.

## MVP Field Scope

Prompt preset fields to visualize first: identifier, name, enabled, role, content, depth, order, position.

Prompt preset fields to preserve but not fully visualize in MVP: utilityPrompts, regexScripts, other, apiSetting, trigger, and unknown prompt fields.

World book fields to visualize first: name, content, enabled, activationMode, key, secondaryKey, selectiveLogic, order, depth, position, role, caseSensitive, excludeRecursion, preventRecursion, probability.

World book fields to preserve but not fully visualize in MVP: other and unknown or compatibility fields retained by imported data.

## Acceptance Criteria

* [ ] A prompt preset can be created, edited visually, saved, reselected, and still contain its prompt entries.
* [ ] Prompt entries can be reordered by drag interaction, and the saved resource reflects the new order.
* [ ] A prompt entry can be enabled/disabled and edited in detail without editing raw JSON as the primary path.
* [ ] A world book can be created, edited visually, saved, reselected, and still contain its entries.
* [ ] World book entries can be reordered by drag interaction, and the saved resource reflects the new order.
* [ ] A world book entry can be enabled/disabled and edited in detail without editing raw JSON as the primary path.
* [ ] Unknown or advanced fields in imported prompt presets/world books are preserved through visual edits where possible.
* [ ] Workflow preset preview and full-screen editor behavior does not regress.
* [ ] Existing deletion protection for prompt preset/world book references from workflow presets still works.

## Definition of Done

* apps/platform-web build passes.
* Prompt-engine tests are run if shared prompt/world-book normalization or conversion code changes.
* UI behavior is manually verified for create, edit, reorder, save, reload, and delete-block flows.
* The implementation follows existing resource library storage APIs and Vue component patterns.

## Technical Approach

* Keep resource persistence in storage/resources.ts; avoid backend/API work.
* Keep the stored resource payload shape compatible with existing preset and worldBook fields.
* Split the current JSON textarea branch into focused visual editor components for prompt presets and world books.
* Reuse the workflow preset full-screen overlay pattern for detailed editing.
* Use current prompt-engine types as the supported field contract.
* Reorder operations should keep array order and visible ordering fields consistent enough that UI order and engine order do not diverge.

## Decision

Context: The user wants an editor like SillyTavern, but this project uses a prompt engine derived from SillyTavern with a trimmed compatibility surface.

Decision: Build a SillyTavern-inspired entry management UI, but constrain editable fields to the current prompt-engine structures. Preserve advanced fields during visual edits and defer a dedicated raw-data editor instead of attempting full upstream SillyTavern parity.

Consequences: The MVP remains compatible with the repository's actual engine and avoids overbuilding. Some imported SillyTavern fields will remain preserved-but-not-directly-editable rather than receiving bespoke controls in the first task.

## Out of Scope

* Full SillyTavern UI parity.
* Full visualization of every imported or upstream SillyTavern field.
* Backend API changes.
* Auth or permission systems.
* Database migration unless a code-level compatibility issue makes it unavoidable.
* Prompt-engine behavior changes unless required to preserve existing resource data safely.
* Dedicated raw JSON / advanced data editing for prompt presets and world books; this will be opened in a later task.

## Technical Notes

* Existing route pattern: apps/platform-web/src/router/index.ts uses hash history and lazy-loaded views.
* Existing resource page: apps/platform-web/src/views/ResourceLibraryView.vue.
* Existing resource storage: apps/platform-web/src/storage/resources.ts and apps/platform-web/src/storage/db.ts.
* Existing full-screen editor reference: apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue.
* Existing inspector/form reference: apps/platform-web/src/components/workflow/NodeInspector.vue and apps/platform-web/src/components/workflow/inspector/*.vue.
* Prompt/world-book type reference: packages/prompt-engine/src/core/types.ts.
* Existing SillyTavern conversion test reference: packages/prompt-engine/test/round-trip.test.ts.

## Open Questions

* Should entry details open as an inspector panel inside the full-screen editor, or as per-entry expanded rows? Recommended: inspector panel, matching the workflow editor pattern and handling long content better.
