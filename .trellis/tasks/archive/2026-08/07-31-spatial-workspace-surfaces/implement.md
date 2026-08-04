# Spatial Workspace Surfaces Implementation Plan

## Execution Rules

- Implement only after the planning summary receives fresh user approval and `task.py start .trellis/tasks/07-31-spatial-workspace-surfaces` activates this child.
- Preserve unrelated untracked Spatial planning directories and the currently active unrelated task pointer until activation explicitly switches this child.
- Migrate each RetroOS view to its shared controller before adding the matching Spatial consumer. Keep a green type/test seam between extractions.
- Do not change workspace backend/contracts/storage schema, projection math, window pose/lifecycle, global overlay presentation, other app readiness, or the production release gate.
- The only approved engine scope is opt-in dynamic video texture discovery/upload/curved sub-surface drawing, actual-frame scheduling, lifecycle cleanup, and a minimal fullscreen trusted-activation adapter only if the target-browser probe proves it necessary.
- Never use per-video-frame full Source recapture as fallback.

## Phase 1 — Shared Explorer Controller and Retro Migration

- [ ] Add focused workspace path/naming helpers only where the controller or tests need a stable seam.
- [ ] Extract root/path/search/request state, selection, rename and view-local clipboard into `use-workspace-explorer-controller`.
- [ ] Move refresh, create file/folder, rename, copy/cut/paste, delete and workspace-event reconciliation into explicit controller commands.
- [ ] Preserve `.keep`, conflict naming, extension-change confirmation, source/target scope, save/save-N and generic read-only guards.
- [ ] Keep context-menu coordinates, route-root refs and DOM focus/selection at the presentation boundary.
- [ ] Switch `WorkspaceExplorerView.vue` to the controller without changing RetroOS markup, route, command labels or behavior.
- [ ] Add focused tests for request races, `.keep`, cross-root clipboard, cut/copy retention, read-only/save guards and event refresh.
- [ ] Add active-route/minimized/editable-target shortcut gating and verify the Retro Explorer no longer handles background global keys.

Rollback point: Retro Explorer can return to its previous local script; no Spatial registration is ready.

## Phase 2 — Shared Editor Controller, CodeMirror Variant, and Retro Migration

- [ ] Extract load/create/edit baseline, validation, save, binary guard, expected-content conflict, route sync and feedback into `use-workspace-editor-controller`.
- [ ] Import close guards directly from `window-close-guards.ts` and ids from `platform-apps.ts`; remove the view's `useDesktopWindows`/legacy `desktop-apps` dependency.
- [ ] Capture one stable editor window id for guard registration and compare the active route's complete descriptor id for Ctrl/Cmd+S ownership.
- [ ] Preserve create target-exists checks, JSON/frontmatter validation, server validation and workspace event emission.
- [ ] Switch `WorkspaceEditorView.vue` to the controller and verify read-only, save failure veto and save/discard/cancel behavior.
- [ ] Add `retro | spatial` theme selection to `WorkspaceCodeEditor.vue`, defaulting to Retro and reconfiguring only a theme compartment.
- [ ] Add focused tests for active multi-editor shortcut ownership, stable guard id, binary rejection, validation, expected content, read-only and failed-save close veto.
- [ ] Run Vue type-check and the existing close-guard/window tests before Spatial editor work.

Rollback point: Spatial theme remains unused and Retro Editor stays on shared behavior.

## Phase 3 — Shared Media Loading Controller and Dynamic Video Foundation

- [ ] Extract media request sequencing, type/kind, binary validation, loading/error and owned object URL lifecycle into `use-workspace-media-controller`.
- [ ] Switch `WorkspaceMediaView.vue` to the controller while retaining native Retro image/audio/video presentation.
- [ ] Add URL replacement, stale request, missing binary and unmount cleanup tests.
- [ ] In target Flag Chromium, probe standard Blob-backed video WebGL upload, orientation, `requestVideoFrameCallback`, and fullscreen activation through the current projected click stack. Record the result in task research/notes before choosing the fullscreen adapter branch.
- [ ] Add the declarative `data-spatial-dynamic-media="video"` discovery contract under eligible Sources.
- [ ] Add pure contain/sub-rect geometry helpers that map a media box into its owning Source without new curve math.
- [ ] Add dynamic video GL resource records with exact create/delete, upload generation, source ownership and context-loss/restore behavior.
- [ ] Add `animated-media` as a decoder-requested one-shot frame reason that is not reduced-motion suppressed.
- [ ] Use `requestVideoFrameCallback` when available; add only a playing/visible bounded fallback for the target browser when unavailable.
- [ ] Draw each ready video texture immediately after its owning Source using the full Source pose/curve/parallax and remapped local sub-rect.
- [ ] Suppress media planes for ineligible/released/minimized/non-visible presentation Sources and while browser fullscreen owns the element.
- [ ] Prove decoded frames do not call `elementTextures.markDirty` or request continuous Source paint.
- [ ] Add focused tests for discovery, actual-frame scheduling, pause/end/hidden/release cleanup, zero/invalid geometry, contain math, source ordering, upload failure and context restore.

Rollback point: the opt-in marker is unused and all existing Sources render through the unchanged path.

## Phase 4 — Spatial Explorer

- [ ] Implement `SpatialWorkspaceExplorerView.vue` over the shared Explorer controller and existing Spatial primitives/tokens.
- [ ] Implement roots, breadcrumb, directory/search list, selection and loading/empty/error/feedback states at default/minimum sizes.
- [ ] Implement create file/folder, inline rename, copy/cut/paste, delete, refresh and file routing.
- [ ] Implement row/blank Source-local context menus with route-root coordinate translation and keyboard anchoring.
- [ ] Implement F2, Delete, Ctrl/Cmd+C/X/V and Escape with active-window/editable-target guards.
- [ ] Verify `.keep`, read-only/save restrictions, cross-root clipboard and workspace-event refresh against the Retro presentation.
- [ ] Register only `workspace-explorer` as ready for local validation while production release remains closed.
- [ ] Verify long lists, search results, menu clamping, scrollbar dragging and state retention through focus/minimize/restore.

Rollback point: set `workspace-explorer` back to pending; the shared controller remains in Retro use.

## Phase 5 — Spatial Editor

- [ ] Implement `SpatialWorkspaceEditorView.vue` over the shared Editor controller and Spatial CodeMirror variant.
- [ ] Implement compact file/status/save chrome, dirty title, loading/error/readonly/validation/feedback states and character count.
- [ ] Preserve create/edit, route sync, expected-content writes, binary rejection and JSON/frontmatter validation.
- [ ] Register `workspace-editor` as ready.
- [ ] Open several editor ids across card and `.tsian` scopes; verify independent content, undo history, active Ctrl/Cmd+S and close guards.
- [ ] Verify close veto does not disturb route/focus/DOM and that save failure keeps the target editor open.
- [ ] Verify CodeMirror click/caret/drag selection/wheel/scrollbar/keyboard/clipboard/undo/IME at center and visible curved edges.

Rollback point: set `workspace-editor` back to pending; Retro remains on the same controller/theme default.

## Phase 6 — Spatial Media Viewer

- [ ] Implement `SpatialWorkspaceMediaView.vue` over the shared loading controller.
- [ ] Implement image contain display and stable loading/error/unsupported/missing-binary states.
- [ ] Add a Spatial media playback composable that reconciles real media events, play promise, seek, duration, volume/mute, ended/error and fullscreen state.
- [ ] Implement Source-local accessible play/pause, time/duration, progress seek, mute and volume controls; add fullscreen for video.
- [ ] Mark only the Spatial video decoder for dynamic media composition and keep its normal Source pixels transparent without transitions.
- [ ] Make the actual video visible under `:fullscreen`; suspend dynamic texture frames during fullscreen and resume one current-frame upload after exit.
- [ ] If the probe proved direct projected fullscreen activation fails, add the narrow same-Source marker adapter and verify keyboard activation still follows the component command.
- [ ] Register `workspace-media` as ready.
- [ ] Verify image/audio/video route reuse, URL replacement, decode failure, seek, pause/end, volume, fullscreen refusal and close cleanup.
- [ ] Verify resize, curve edge, minimize/restore, context loss/restore and simultaneous media windows preserve source ownership and do not leak frames/resources.

Rollback point: set `workspace-media` back to pending; Retro native viewer remains available.

## Phase 7 — Automated Verification

- [ ] Assert the exact newly ready set includes `workspace-explorer`, `workspace-editor`, `workspace-media` alongside previously completed Spatial apps; all other registrations remain pending and production gate remains false.
- [ ] Assert Spatial workspace components do not import Retro route views, `useDesktopWindows`, legacy `desktop-apps`, or `retro-*` chrome.
- [ ] Run focused workspace controller, readonly, close-guard, CodeMirror variant, media lifecycle, dynamic media engine and registry tests.
- [ ] Run the full Spatial engine/shell/app suite and existing Retro workspace/window registry regressions.
- [ ] Run Vue type-check, web build and whitespace check.

Planned commands:

```powershell
npm test -- --run apps/platform-web/src/controllers/workspace apps/platform-web/src/lib/workspace-readonly.test.ts apps/platform-web/src/platform-apps.test.ts
npm test -- --run apps/platform-web/src/spatial apps/platform-web/src/composables/useDesktopWindows.test.ts
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
npm run build:web
git diff --check
```

Adjust focused paths to the final module names; do not omit the full Spatial suite after engine changes.

## Phase 8 — Flag Chromium Product Matrix

- [ ] Explorer roots: card/local roots, empty/loading/error, root selection and route restore.
- [ ] Explorer file flow: create file/folder, `.keep`, inline rename/name-stem selection, extension warning, copy/cut/repeat paste/cross-root paste/delete and read-only/save guards.
- [ ] Explorer input: selection, double click/open, row/blank context menu, keyboard menu, F2/Delete/Ctrl+C/X/V/Escape, search, long-list wheel and thumb drag at center/edge.
- [ ] Editor: create/edit, JSON/frontmatter valid/invalid, read-only, unknown binary, expected-content conflict, save route replacement and status.
- [ ] Multi-editor: several ids/scopes, independent selection/undo/drafts, active-only Ctrl+S and save/discard/cancel close matrix.
- [ ] CodeMirror: center/edge caret, drag selection, scroll, clipboard, Ctrl+Z, composition/IME and focus/minimize/restore persistence.
- [ ] Image: load/contain, route replacement, missing binary, unsupported type, failure and close cleanup.
- [ ] Audio: play promise, pause/end, seek, volume/mute, unknown duration/error, minimize/restore and no continuous renderer frame demand.
- [ ] Video: decoded-frame continuity, contain mapping, pause/seek/end, resize, curve edge, occlusion, minimize/restore, multi-window ordering and no full Source recapture.
- [ ] Fullscreen: projected pointer and keyboard entry, browser fullscreen pixels/controls policy, exit/resume, rejection feedback and no duplicate request.
- [ ] Lifecycle: page hide/show, Source release/restore, context loss/restore, route reuse, close and object URL/frame/texture cleanup.
- [ ] RetroOS regression: repeat critical Explorer/Editor/native Media workflows after controller extraction.
- [ ] Visual/accessibility: default/minimum window sizes, shared Spatial tokens/primitives, no Retro chrome/native product select/focus rectangle/ordinary flat overlay, semantic names and keyboard path.

## Completion Gate

- [ ] Every PRD acceptance criterion has explicit automated or manual evidence.
- [ ] RetroOS parity and Spatial product matrices both pass.
- [ ] Dynamic video proves one decoded-frame-driven curved media path, no per-frame Source dirtying, and exact cleanup while idle/hidden/closed.
- [ ] No code outside the approved ownership boundary changed without returning to planning.
- [ ] Production Spatial release gate remains disabled.
- [ ] Final review occurs after the complete fix/feature set is assembled, followed by Trellis check, spec capture, commit and archive.
