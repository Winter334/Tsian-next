# Runtime Workspace Studio UI Implementation Plan

## Preconditions

- Task status is `planning` until this document and `design.md` are reviewed.
- Existing dirty UI changes must be preserved; do not revert unrelated files.
- Development target is `apps/platform-web`.

## Implementation Checklist

1. Replace placeholder JSONL context manifests with relevant platform-web frontend specs.
2. Register a Workspace Explorer desktop app/window and route in `apps/platform-web/src/desktop-apps.ts` and `apps/platform-web/src/router/index.ts`.
3. Add `WorkspaceExplorerView.vue` as the primary resource-manager surface.
4. Add Workspace Explorer root/card path mapping helpers in `apps/platform-web/src/platform-host/index.ts`.
5. Extend platform host with Game Card scoped Explorer APIs for roots, list, search, read, write/patch, delete, and validate.
6. Preserve bridge/runtime active-save workspace APIs unchanged.
7. Build Workspace Explorer UI:
   - root view with installed Game Cards as drive-like entries;
   - selected-card toolbar with refresh, search, new file, and breadcrumb navigation;
   - browse entries and search results;
   - double-click file open behavior;
   - file/directory context menu with edit/delete where valid;
   - window-like lightweight editor with path, media type, text content, save/cancel, validation, and error feedback;
   - delete action with confirmation.
8. Add CodeMirror 6 dependencies and wrap them in a small local editor component so the rest of the view is not coupled directly to editor packages.
9. Remove Workspace-related browse/manage UI from `GameCardDetailView.vue`, including the Workspace tab and related overview card copy/buttons.
10. Keep save-runtime authoring scoped to virtual `save/<slot>/...` paths and card-content authoring scoped to non-reserved card paths.
11. Refresh directory/search state after successful mutations.
12. Keep `.tsian/*` hidden and rejected from ordinary Explorer authoring.

## Validation Plan

- Run `npm run build:web`.
- Browser smoke on the running dev server when available:
  - open Workspace Explorer from the RetroOS desktop;
  - see installed Game Cards as root drive-like entries;
  - open one Game Card workspace;
  - browse card content from Workspace root;
  - browse `save/save-01/...` when a save exists;
  - double-click a card content file into a separate editor window;
  - open the file context menu and choose edit/delete;
  - search by path/content and open a result;
  - create, edit, validate, and delete a save-runtime file;
  - create/edit/delete a card-content file;
  - confirm invalid `.tsian/...` and invalid traversal paths show errors.

## Risky Files

- `apps/platform-web/src/platform-host/index.ts`: path mapping must not leak virtual save-slot paths into persisted save runtime files.
- `apps/platform-web/src/desktop-apps.ts` and `apps/platform-web/src/router/index.ts`: Workspace Explorer should become a first-class desktop app without breaking existing routes.
- `apps/platform-web/src/views/WorkspaceExplorerView.vue`: UI state can grow quickly; keep helper functions small and keep mutation calls explicit.
- CodeMirror dependencies and wrapper component: keep the editor dependency contained and avoid leaking editor-specific state into platform-host APIs.
- `apps/platform-web/src/views/GameCardDetailView.vue`: remove Workspace UI without breaking launch/save/card metadata workflows.
- `apps/platform-web/src/agent-runtime/workspace-operations.ts`: avoid changing shared operation semantics unless the host mapper cannot solve the problem locally.

## Rollback Points

- Host API additions can be reverted independently if UI work reveals a better mapping boundary.
- UI editor/search additions can be reverted while retaining the current browse-only Workspace tab and/or root Explorer shell.
- No database migration is involved, so rollback should not require local IndexedDB resets.

## Review Gate Before Start

- `prd.md`, `design.md`, and `implement.md` exist.
- The user accepts the standalone desktop Workspace Explorer surface for this slice.
- The user accepts removing Workspace browse/manage UI from Game Card detail.
- The user accepts a separate editor window opened by double-click/context menu, not a separate desktop-launcher editor app.
- The user accepts CodeMirror 6 as the editor/highlight dependency.
- The user accepts `save/save-01/...` as a UI alias rather than a persisted workspace path.
