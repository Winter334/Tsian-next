# Runtime Workspace Studio UI Design

## Context

The current Game Card detail `Workspace` tab is a thin browser for ordinary Runtime Workspace directories. It already lists real card-owned content paths and aggregates save runtime files under virtual save-slot paths such as `save/save-01/...`.

This task turns workspace management into a standalone RetroOS desktop application: Workspace Explorer. It should work like a simplified Windows File Explorer: the root view shows installed Game Cards as drive-like entries, and opening one card reveals that card's complete ordinary workspace.

## Product Surface

- Add a new Workspace Explorer desktop application registered in `desktop-apps.ts`.
- Add a Workspace Explorer route/view, for example `WorkspaceExplorerView.vue`, with a root route such as `/workspace` and a card-scoped route or query state for a selected Game Card.
- Treat the Workspace Explorer window as the full Studio work area for this slice: toolbar, breadcrumb navigation, root Game Card drive list, file list/grid, search, file actions, context menu, and editor-window launching.
- Keep Game Card detail focused on launch/save/card metadata. Remove Workspace browse/manage UI from Game Card detail in this task.
- Continue using the restrained RetroOS content chrome: compact toolbar controls, bordered panes, stable file tiles/list rows, and modal editing instead of nested cards.

## Workspace Model

Workspace Explorer has a root layer, a display-path layer, and a storage-path layer.

- Root layer: installed Game Cards are presented as drive-like entries. They are not workspace folders and cannot be renamed/deleted from this task.
- Card content display paths are their real card content paths, for example `agents/master/AGENT.md`, `skills/...`, `docs/...`, and `rules/...`.
- Save runtime display paths are virtualized under `save/<slot>/...`, for example `save/save-01/history/turns/turn-000001.json`.
- Save slot names are UI aliases derived from the selected Game Card's save list order. They are not persisted workspace paths.
- `.tsian/*` remains hidden from ordinary Studio browse/read/search results and cannot be edited from this surface.

Mapping rules:

- `save/<slot>/<relative>` maps to the corresponding save id and real runtime path `save/<relative>`.
- `save/<slot>` itself is a virtual directory and cannot be opened as a file or deleted as a file.
- Paths outside `save/...` map to card-owned content for the displayed Game Card.
- Paths under `.tsian/...` are rejected for ordinary Studio operations.
- `save/...` without a valid slot segment is rejected for read/write/delete operations, because the Studio must know which save slot owns the mutation.

## Platform Host Boundary

Add Game Card scoped Workspace Explorer APIs beside `listPlatformWorkspaceDirectory()` in `platform-host/index.ts`.

Recommended API shape:

```ts
interface PlatformWorkspaceStudioInput {
  cardId: string
  path?: string
  query?: string
  content?: string
  mediaType?: string
  expectedContent?: string
  validator?: "json" | "frontmatter"
}
```

Expected host functions:

- `listPlatformWorkspaceRoots()`
- `listPlatformWorkspaceDirectory({ cardId, path })`
- `searchPlatformWorkspace({ cardId, query, path?, limit? })`
- `readPlatformWorkspaceFile({ cardId, path })`
- `writePlatformWorkspaceFile({ cardId, path, content, mediaType })`
- `patchPlatformWorkspaceFile({ cardId, path, content, expectedContent, mediaType })`
- `deletePlatformWorkspacePath({ cardId, path })`
- `validatePlatformWorkspaceFile({ cardId, path, validator })`

Implementation details:

- Keep shared path normalization and mutation policy in platform host / workspace operation helpers, not inside Vue templates.
- Reuse `executeWorkspaceOperation()` for list/read/search/diff/patch/write/delete/validate behavior where possible.
- Add a small Studio path mapper in `platform-host/index.ts` that translates virtual save-slot paths to real save ids and real `save/...` paths.
- Add card-id based card content write/delete helpers. Existing active-card helpers can remain for bridge/runtime behavior.
- Return display paths back to the UI for save-slot files after read/write/delete so the user never sees the underlying save id.

## Vue State And Flow

`WorkspaceExplorerView.vue` owns the Explorer UI state for this slice.

Core state:

- selected Game Card id, or root mode when no card is selected
- current directory path
- directory entries
- search query and results
- selected/open file
- editor window open/closed
- editor draft content, media type, expected content
- operation status and error feedback

Flow:

1. Opening Workspace Explorer at `/workspace` shows installed Game Cards as drive-like tiles/list rows.
2. Clicking a Game Card enters that card's workspace and updates route/deep-link state.
3. Clicking a directory updates the breadcrumb path and refreshes entries.
4. Double-clicking a file reads it through the Explorer read API and opens a separate editor window.
5. Saving an existing file patches with `expectedContent` to catch stale edits.
6. Creating a file opens the same dialog with an editable path, defaulting to the current directory.
7. Delete asks for confirmation and refreshes the current directory after success.
8. Search within a selected Game Card shows path/preview results; clicking a result opens that file without losing the directory context.
9. Validation runs for JSON/frontmatter-capable files and reports bounded errors in the dialog.

Context menu behavior:

- Right-clicking an ordinary file opens a compact Explorer context menu with edit and delete.
- Right-clicking a directory may expose open/delete where deletion is valid.
- Root Game Card drive entries do not expose workspace edit/delete actions in this task.

Editor behavior:

- The editor is launched by Workspace Explorer file interactions, not registered as a separate desktop launcher app.
- The first editor should be a large window-like dialog/child window so it has enough space and matches Windows-style "open file in editor" UX.
- The editor should feel like a lightweight Notepad/minimal IDE: prominent path title, monospace content area, media type/path metadata, save/cancel, and validation feedback.
- The editor opens from double-click and from the context menu edit action.
- The editor must preserve the current Explorer location and search context when closed.

Editor dependency:

- Current dependencies do not include an editor/highlight library.
- Use CodeMirror 6 for this task. It provides real editing behavior, syntax highlighting, keyboard handling, and a lighter integration profile than Monaco.
- Avoid Monaco in this slice unless CodeMirror proves insufficient; Monaco is closer to VS Code and heavier than the current lightweight editor goal.
- Avoid Shiki/Prism as the primary solution because they provide highlighting, not editing behavior.

## Error Handling

- Invalid paths, path traversal, empty paths, `.tsian/*`, and save paths without valid `save/<slot>/` are shown as clear UI errors.
- Save runtime writes require an existing save slot. If a Game Card has no saves, save-runtime creation is unavailable until a save exists.
- Stale edits use `expectedContent` mismatch feedback instead of overwriting silently.
- Deleting a virtual save slot root is rejected. Deleting nested directories/files under a slot is allowed through the real save-runtime delete operation.

## Compatibility

- No IndexedDB schema changes.
- No migration.
- No change to play frontend bridge contracts.
- No change to Agent Runtime staged workspace semantics.
- Checkpoints continue to snapshot save runtime files only.
- Card content edits affect existing saves through the effective workspace layer, as the current model already requires.

## Tradeoffs

- Making Workspace Explorer a desktop app adds route/window registration work, but it matches the long-term RetroOS mental model and keeps Game Card detail from becoming a catch-all management surface.
- `save-01` style aliases are readable and match the current product direction, but they are UI aliases. Future work can expose richer save labels or stable aliases if users need durable external references.
- The first editor is a CodeMirror-backed Notepad/minimal-IDE window, not Monaco and not a separate desktop launcher app. This keeps the slice shippable and matches the out-of-scope constraint.
