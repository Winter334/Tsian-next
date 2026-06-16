# Runtime Workspace Studio UI

## Goal

Provide a full-screen, resource-manager style UI for Game Card content and Save Instance runtime data.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Browse ordinary files and directories for the selected Game Card content workspace.
- When a Save Instance is selected, expose its runtime data as a distinct save-data area rather than treating the whole workspace as save-owned content.
- Present Workspace Studio as a full-screen work area reached from Game Card detail navigation.
- Treat Agent definitions, Skill definitions, schemas, rules, author docs, and frontend-facing definitions as Game Card content.
- Treat generated NPCs, dialogue/history, maps, relationships, memory, frontend view state, and other evolving play data as Save Instance runtime data.
- Avoid presenting "template workspace vs runtime workspace copy" as the product model.
- Use a familiar file/resource manager layout similar to Windows Explorer: path navigation, folder/file list, search/filter, and file actions.
- Read file content with media type and path metadata.
- Search workspace files using existing search behavior.
- Create, edit, and delete ordinary workspace files through platform/storage helpers.
- Opening a file should launch an editing modal/dialog rather than navigating away from the resource manager.
- The editing modal should feel like document editing: readable content area, save/cancel affordances, validation feedback, and clear file identity.
- Respect `.tsian/*` metadata hiding and write restrictions.
- Keep gameplay semantics generic; do not hardcode world/event/archive/task models into platform UI.
- Preserve checkpoint compatibility for save runtime data; card content changes need separate version/update semantics.

## Acceptance Criteria

- [ ] Selected Game Card content files can be browsed.
- [ ] Selected Save Instance runtime data can be browsed when a save is selected.
- [ ] Workspace Studio uses a full-screen resource-manager layout scoped to the selected Game Card / Save Instance context.
- [ ] UI copy and navigation present card content and save data as distinct concepts without using the old full-workspace-copy mental model.
- [ ] File content can be read without exposing `.tsian/*` through ordinary APIs.
- [ ] Search returns path/content snippets or useful result summaries.
- [ ] Users can write a new ordinary workspace file.
- [ ] Opening a file shows an editing modal/dialog without losing the current file-browser context.
- [ ] Users can edit and delete ordinary workspace files with validation errors shown clearly.
- [ ] Invalid paths, path traversal, empty paths, and `.tsian/*` writes are rejected.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke covers browse/read/search/write/delete.

## Dependencies

- Game Card/Save context UI recommended first.
- Game Card detail navigation should provide the primary entry into Workspace Studio.
- Requires a resolved foundation design for card-owned content plus save-owned runtime data before implementation.
- Existing workspace storage and platform-host APIs currently assume save-scoped workspace files and will need adjustment.

## Out Of Scope

- Rich Monaco-style editor unless explicitly scoped.
- Gameplay-specific schema editors.
- Agent/Skill specialized views, except links into their files.
