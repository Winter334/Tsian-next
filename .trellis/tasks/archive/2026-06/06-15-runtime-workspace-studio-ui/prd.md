# Runtime Workspace Studio UI

## Goal

Provide a desktop Workspace Explorer app for Game Card content and Save Instance runtime data.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Current Alignment

Keep this task. The current UI has a thin Game Card detail `Workspace` tab that can browse real directories and aggregate save runtime data under virtual save-slot folders, but the product direction is now a standalone RetroOS desktop Workspace Explorer. The Workspace Explorer should feel like Windows File Explorer without drive letters: installed Game Cards act as top-level drive-like entries, and opening one shows that Game Card's full workspace including card-owned content and save runtime data.

## Requirements

- Add a desktop Workspace Explorer app/window that can be opened directly from the RetroOS desktop.
- The Workspace Explorer root lists installed Game Cards as drive-like entries.
- Opening a Game Card entry shows that card's ordinary workspace files and directories.
- When the Game Card has save slots, expose all ordinary Save Instance runtime data under distinct virtual save-slot folders such as `save/save-01/...`; the root `save/` directory should appear only when at least one save exists.
- Selecting or activating a save for play must not replace the Workspace Explorer browser with that one save's `save/` contents.
- Remove Workspace-related browsing/management UI from Game Card detail so card detail stays focused on launch, saves, and card metadata.
- Treat Agent definitions, Skill definitions, schemas, rules, author docs, and frontend-facing definitions as Game Card content.
- Treat generated NPCs, dialogue/history, maps, relationships, memory, frontend view state, and other evolving play data as Save Instance runtime data.
- Avoid presenting "template workspace vs runtime workspace copy" as the product model.
- Avoid presenting a selected save's effective workspace as the whole Game Card workspace.
- Use a familiar file/resource manager layout similar to Windows Explorer: path navigation, folder/file list, search/filter, and file actions.
- Read file content with media type and path metadata.
- Search workspace files using existing search behavior.
- Create, edit, and delete ordinary workspace files through platform/storage helpers.
- Double-clicking a file should open it in a separate editor window launched from Workspace Explorer.
- File context menus should expose edit and delete actions for ordinary files.
- Editing should feel like a built-in lightweight Notepad / minimal IDE window: readable content area, save/cancel affordances, validation feedback, and clear file identity.
- The editor should not appear as a separate desktop launcher app; it is opened from file interactions in Workspace Explorer.
- Use CodeMirror 6 for syntax highlighting and editing ergonomics in the lightweight editor window.
- Respect `.tsian/*` metadata hiding and write restrictions.
- Keep gameplay semantics generic; do not hardcode world/event/archive/task models into platform UI.
- Preserve checkpoint compatibility for save runtime data; card content changes need separate version/update semantics.

## Acceptance Criteria

- [ ] Workspace Explorer is available as a desktop app/window.
- [ ] Workspace Explorer root lists installed Game Cards as drive-like entries.
- [ ] Opening a Game Card entry browses that card's content files.
- [ ] Game Card detail no longer exposes Workspace browsing/management UI.
- [ ] All save runtime data for the selected Game Card can be browsed under distinct `save/<slot>/` directories when saves exist.
- [ ] Switching the selected/active save does not change the Workspace Explorer listing for a Game Card.
- [ ] Workspace Explorer uses a resource-manager layout scoped first to installed Game Cards, then to the selected Game Card workspace.
- [ ] UI copy and navigation present card content and save data as distinct concepts without using the old full-workspace-copy mental model.
- [ ] File content can be read without exposing `.tsian/*` through ordinary APIs.
- [ ] Search returns path/content snippets or useful result summaries.
- [ ] Users can write a new ordinary workspace file.
- [ ] Double-clicking a file opens a separate lightweight editor window without losing the current file-browser context.
- [ ] A file context menu exposes edit/delete actions.
- [ ] The editor provides code/text editing ergonomics and basic syntax highlighting for common workspace text formats.
- [ ] Users can edit and delete ordinary workspace files with validation errors shown clearly.
- [ ] Invalid paths, path traversal, empty paths, and `.tsian/*` writes are rejected.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke covers browse/read/search/write/delete.

## Dependencies

- Game Card/Save context UI recommended first.
- Desktop launcher/window registration should provide the primary entry into Workspace Explorer.
- Game Card detail Workspace-related UI should be removed in this task.
- Requires a resolved foundation design for card-owned content plus save-owned runtime data before implementation.
- Existing workspace storage and platform-host APIs currently assume save-scoped workspace files and will need adjustment.

## Out Of Scope

- Rich Monaco-style editor unless explicitly scoped.
- A separate desktop-launcher Notepad/IDE app.
- Gameplay-specific schema editors.
- Agent/Skill specialized views, except links into their files.
