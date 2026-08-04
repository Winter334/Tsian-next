# Spatial Workspace Surfaces Technical Design

## 1. Boundary

This child owns three application presentations and the smallest shared/runtime seams required to make them reliable in Spatial:

- Workspace Explorer (`workspace-explorer` / `/workspace`)
- Workspace Editor (`workspace-editor` / `/workspace/editor`)
- Workspace Media Viewer (`workspace-media` / `/workspace/media`)
- shared Explorer/Editor/Media controllers used by both RetroOS and Spatial;
- a Spatial theme variant for the existing CodeMirror wrapper;
- a renderer-owned dynamic video texture path, actual-video-frame scheduling, and a narrowly scoped fullscreen activation escape if the target browser requires it.

It does not own workspace persistence/contracts, general projection math, window geometry/lifecycle, global Toast/Confirm presentation, other app groups, or the production Spatial release gate.

## 2. Evidence and Constraints

- The current Explorer, Editor, and Media views are about 1,350, 524, and 141 lines. Explorer and Editor mix presentation with platform operations, request sequencing, event listeners, route synchronization, and capability rules.
- `platform-apps.ts` already owns the cross-shell identities. Explorer is a singleton; Editor prefers a supplied `editorId`; Media uses scope + path. New code must import these identities instead of the legacy `desktop-apps.ts` helper.
- `window-close-guards.ts` is already consumed by both shells. The Editor controller can register directly against it without importing `useDesktopWindows`.
- Workspace storage is file-based. `.keep` is a real stored file and only a presentation filter. Cross-root copy/move needs both source and target scope. Read-only/save-slot decisions already live in `workspace-readonly.ts`.
- The active route follows the active window, but route name alone is insufficient for multiple mounted editors. Shortcut ownership must compare the full editor identity/`editorId`.
- `WorkspaceCodeEditor.vue` contains reusable CodeMirror behavior but one hard-coded Retro theme and a focused outer outline. Theme is presentation state, not a reason to fork editor behavior.
- Existing native media controls are not a reliable projected-input contract. The HTML-in-Canvas adapter exposes no decoded-video-frame notification and Source capture is one-shot/demand-driven.
- `spatial-ui.md` requires animated media to own an independent frame reason without continuously dirtying HTML Source textures. Full-window Source recapture on every video frame is therefore rejected.

## 3. Target Topology

```text
platform app registry
  -> Retro Explorer/Editor/Media -----------┐
  -> Spatial Explorer/Editor/Media ---------┤
                                             v
                            shared workspace controllers
                              -> platform-host workspace API
                              -> workspace events/validation
                              -> shell-neutral close guards
                              -> platform-app identities/router

Spatial Media presentation
  -> shared media loading controller -> Blob/object URL
  -> Source-local controls + hidden decoder video
  -> declarative dynamic-media marker
       -> viewport media tracker
       -> renderer dynamic video texture
       -> curved sub-surface draw after owning Source
```

Controllers own domain state and commands. Presentations own layout, focus, Source-local menu placement, Spatial styling, and the choice between native Retro media controls and Spatial custom controls.

## 4. Shared Controller Extraction

### 4.1 Explorer controller

Create `controllers/workspace/use-workspace-explorer-controller.ts` with per-instance state for:

- root selection, card/local scope, current path and breadcrumbs;
- directory/search entries, request ids, loading/error/feedback;
- selected entry, inline rename state and view-local clipboard;
- root/directory/search refresh and workspace-event reconciliation;
- create file/folder, rename, copy/cut/paste and delete commands;
- centralized capability predicates and file route classification.

The controller receives or exposes shell-neutral route inputs/commands. It must not know menu pixel coordinates, root-card markup, table layout, or Retro/Spatial classes. Menu coordinates and keyboard anchoring remain presentation-owned because they depend on the rendered route root.

Move pure naming/path helpers (`splitNameExt`, conflict naming, sibling path, display normalization) into a focused helper only when they are shared or directly testable. Preserve existing request-id guards so a stale read never overwrites a later root/path/search.

Shortcut handling calls controller commands but stays at the view boundary. Both views must gate it by editable target and active identity. The controller remains usable without `window` listeners in tests.

### 4.2 Editor controller

Create `controllers/workspace/use-workspace-editor-controller.ts` with reactive inputs for card id, path, mode, editor id, and active route identity. It owns:

- load/create/edit baselines and read-only state;
- content, expected content, validation, loading/saving/error/feedback;
- JSON/frontmatter validation and server-side post-save validation;
- target-exists check for create mode;
- binary guards before applying loaded or written files;
- expected-content write and workspace change emission;
- route synchronization that preserves `editorId`;
- draft detection, active-instance Ctrl/Cmd+S decision, and save/discard/cancel close guard;
- one stable `platform-apps.ts` window id captured for guard registration/cleanup.

The controller exposes explicit `load`, `save`, `handleSaveShortcut`, and `beforeClose` commands. Watchers may reset presentation state for changed inputs, but persistence only occurs through explicit save/close choices.

The active shortcut predicate must compare the descriptor/window identity derived from the active route with the controller's captured id. This prevents every mounted `workspace-editor` instance from reacting to the same Ctrl+S.

### 4.3 Media loading controller

Create `controllers/workspace/use-workspace-media-controller.ts` for:

- card/path route input and request sequencing;
- centralized media type/kind inference;
- workspace binary read and missing-binary rejection;
- loading/error/unsupported state;
- owned object URL replacement and cleanup.

The loading controller does not own native playback UI. Retro keeps native controls; Spatial composes a small `use-spatial-media-playback.ts` around its actual `HTMLMediaElement` for play promise, duration/currentTime, seeking, volume/mute, ended/error, and fullscreen state.

## 5. Presentation Design

### 5.1 Spatial Explorer

Use a dedicated `spatial/apps/workspace/SpatialWorkspaceExplorerView.vue` built from existing Spatial app primitives and tokens. A practical layout is:

- compact command/search header;
- root navigator/identity rail when browsing;
- breadcrumb and status row;
- root tiles or directory/search list in the primary scroll region;
- Source-local menu and inline rename input;
- low-height feedback/status strip.

The exact columns may collapse at minimum width, but command mapping remains complete. Directory rows use semantic buttons/list items and keep large projected targets. Inline rename focuses and selects the same name range as Retro. The context menu is absolutely positioned under the route root and clamps to that root, never to `window.innerWidth/Height`.

### 5.2 Spatial Editor and CodeMirror

Use `SpatialWorkspaceEditorView.vue` over the shared controller. Keep the product toolbar intentionally small: file identity/status plus Save. Do not reintroduce media type, restore, or manual validation controls removed by the established editor contract.

Extend `WorkspaceCodeEditor.vue` with a typed `variant?: "retro" | "spatial"` (default `retro`). Put language, editable, update-listener and lifecycle extensions outside theme selection. A theme compartment allows variant changes without recreating the editor, although each route normally keeps one variant for its lifetime.

The Spatial theme derives colors from computed CSS variables on the host or from shared constants that map directly to `--spatial-*` tokens. It removes the outer `cm-focused` outline and uses geometry-stable caret/selection/active-line states. Do not destroy/recreate CodeMirror on focus, route activation, minimize, or resize; doing so would lose selection and undo history.

### 5.3 Spatial Media Viewer

Use `SpatialWorkspaceMediaView.vue` over the shared loading controller.

- Image: ordinary Source-captured `<img>` with contain sizing.
- Audio: actual `<audio>` without native controls plus Source-local custom controls.
- Video: actual `<video>` without native controls, marked for renderer-owned Spatial composition, plus Source-local custom controls below/outside the media rectangle.

The same video element remains the decoder and fullscreen authority. In ordinary Spatial mode it occupies the measured layout box but its DOM pixels are transparent to Source capture. In `:fullscreen` it becomes visible and uses browser-owned contain rendering. There is no opacity transition or compositor animation.

The custom control model listens to `loadedmetadata`, `durationchange`, `timeupdate`, `progress`, `play`, `pause`, `ended`, `volumechange`, `seeking`, `seeked`, `error`, `fullscreenchange`, and `fullscreenerror`. UI state is always reconciled from the element after a command. A short bounded sampling timer is allowed for smooth audio progress, but it stops on pause/end/hidden/unmount and does not request renderer animation frames.

## 6. Dynamic Video Texture Contract

### 6.1 Declarative discovery

Spatial video elements opt in with a narrow marker such as:

```html
<video data-spatial-dynamic-media="video" />
```

The marker only has meaning beneath a direct `[data-spatial-source]` child. `SpatialViewportController.syncSources()` also synchronizes marked video descendants. App components do not import the renderer or hold WebGL resources.

### 6.2 Resource ownership

Add a focused engine module for dynamic media records. Each record owns:

- the `HTMLVideoElement` and owning Source id/root;
- one WebGL texture and uploaded-frame generation;
- decoded intrinsic size and the current contain target rectangle;
- `requestVideoFrameCallback`/fallback handle and event cleanup;
- released/context-lost/fullscreen state.

The renderer owns GL creation/deletion and context restoration. The viewport/tracker owns DOM listeners and frame callbacks. Source release/minimize cancels callbacks and releases or suspends the media texture without pausing the actual element; restore re-registers if it is still playing and uploads the current frame. Element/source removal and controller disposal perform exact-once cleanup.

### 6.3 Frame scheduling

Add `"animated-media"` to `FrameReason`, but not to the reduced-motion-suppressed motion set. A user-controlled video is content, not decorative motion.

- With `requestVideoFrameCallback`, each decoded frame marks only that video record upload-ready and requests one `animated-media` frame. The next callback is registered only while the video is playing, visible, source-eligible, not fullscreen, and not released.
- Without it, a target-browser fallback uses rAF only while those conditions hold and skips upload/draw when the observable frame/time has not advanced.
- The render result does not blindly continue `animated-media`; the decoder callback requests the next frame. This prevents an idle scheduler loop when decode stalls.
- Pause/end/hidden/fullscreen/source release removes pending callbacks and active reason. Seek or metadata changes request one current-frame upload even while paused.

Source texture records are not marked dirty for decoded video frames. Source controls still repaint through ordinary DOM/input/media state updates.

### 6.4 Upload and curved composition

Upload the same-origin Blob video through standard WebGL video upload into the media texture. Keep pixel-store orientation local to this path and restore global state after upload. A not-ready/security/upload failure is attached to the media record and does not fail the renderer.

For each owning Source render:

1. Draw the ordinary Source texture.
2. Resolve the marked video's measured box relative to the full Source rect.
3. Compute a contained media rect from `videoWidth/videoHeight` without stretching.
4. Remap the normal surface mesh's local coordinates into that sub-rectangle while retaining the owning Source's full pose, curve, parallax and z order.
5. Sample the dynamic video texture over `[0,1]` UV and draw before the next Source.

The sub-surface vertex path must reuse the existing surface projection math/uniform authority; it must not invent a second curve. Invalid, clipped, zero-size, released, hidden, failed, or not-yet-ready media records are skipped. The dynamic plane obeys the owning Source's render/presentation visibility so it cannot escape a minimized, occluded, opening, or closing window.

If a presentation phase cannot safely apply the existing aperture/ripple program to a sub-surface, suppress dynamic media until the Source reaches `visible`; never draw it flat or above another window as a shortcut.

### 6.5 Fullscreen activation

First verify in the target Flag Chromium that `video.requestFullscreen()` called synchronously by the custom button's handler retains transient activation when the handler is invoked through the existing trusted input-plane activation stack. Keyboard activation uses the same command.

If the browser rejects projected pointer activation, add only a marker-based trusted native-action adapter in the viewport input path. It resolves the target video inside the same owning Source and calls fullscreen during the trusted plane event; the component observes `fullscreenchange/fullscreenerror` for state. Do not add a general arbitrary-method bridge or a Canvas overlay.

While the video is fullscreen, suspend the dynamic media frame tracker because the browser renders the real element. Resume and upload the current frame after exit if playback continues.

## 7. Route, Shortcut, and Lifecycle Rules

- Explorer route state remains card/path query state and only the active Explorer handles global file shortcuts.
- Every Explorer text open creates a new `editorId`; save route replacement preserves it.
- Editor close-guard id is captured once from `platform-apps.ts` identity. Later path changes do not change guard ownership.
- Media identity remains scope + path. A reused descriptor reloads through reactive controller inputs and revokes the prior URL after request identity changes.
- Source-local menus close from routed synthetic outside events, not trusted input-plane capture. Coordinate math is relative to the presentation root.
- Non-closed component instances remain mounted. Event listeners, controllers, CodeMirror and media state are released only on actual close/unmount; media frame work additionally suspends while its Source is unavailable.

## 8. Data and Error Flow

```text
user command
  -> presentation event
  -> shared controller guard/validation/confirm
  -> existing platform-host workspace operation
  -> workspace event or explicit authoritative refresh
  -> controller request-id reconciliation
  -> Retro or Spatial presentation
```

- Failed mutations preserve the previous authoritative directory/file baseline and expose error/feedback.
- Optimistic editor writes remain guarded by expected content.
- A stale load/search/media response cannot replace a newer route input.
- Dynamic media upload failure degrades only the video region. Controls and error reporting remain responsive, and the renderer/shell continue.
- Close veto and fullscreen rejection are terminal results, not partial state changes.

## 9. Verification Ownership

Automated tests own:

- controller request ordering, guards, `.keep`, clipboard scope, event reconciliation and cleanup;
- editor validation, binary rejection, active identity shortcut, stable close guard and save failure veto;
- media URL replacement/revocation and playback state helpers;
- dynamic media discovery, contain geometry, frame callback start/stop, no Source dirtying, GL resource/context cleanup, z/source ownership and fallback bounds;
- registry exact-ready set and production gate.

Flag Chromium owns:

- curved-edge menus, scrolling and inline rename;
- CodeMirror caret/selection/IME/undo in several simultaneous editors;
- visible video continuity/contain mapping during resize and curved presentation;
- seek/volume/play/fullscreen, fullscreen exit, minimize/restore, page visibility and context restore;
- visual unity with the accepted Spatial shell.

Avoid exact color/pixel/source-format snapshots. Engine unit tests should assert semantic invariants: one decoded frame produces at most one upload request, idle video has no frame reason, sub-rect projection shares Source ownership, and cleanup is exact once.

## 10. Compatibility and Rollback

- Controller extractions are landed one view at a time with RetroOS verification before Spatial registration.
- Each Spatial app can be returned to `pending` independently without reverting shared controllers.
- Dynamic media is opt-in by marker; Sources without the marker retain identical renderer behavior.
- If dynamic video composition fails its focused or browser gate, keep `workspace-media` pending while Explorer/Editor and Retro media remain operational. Do not fall back to per-frame full Source recapture.
- No storage migration or backend rollback exists because this child changes no persisted format.

## 11. Principal Risks

- **Controller extraction changes Retro behavior:** migrate Explorer, Editor, and Media separately and keep each seam green before presentation work.
- **Background editor shortcuts save the wrong files:** derive active full window identity, not only route name.
- **Clipboard or `.keep` semantics drift:** keep source scope and anchor behavior in the shared controller and cover cross-root cases directly.
- **CodeMirror recreation loses undo/IME state:** switch only theme compartments; never key/recreate the editor for focus/lifecycle changes.
- **Context menus use screen coordinates:** translate routed local client coordinates against the route root and clamp there.
- **Native media controls ignore projected input:** all ordinary controls are Source-local and explicit.
- **Video frames freeze or cause full-window bandwidth:** use an independent video texture and decoded-frame reason; never continuously dirty the Source.
- **Dynamic plane escapes window ordering/presentation:** associate every media record with one eligible Source and draw immediately after that Source with shared curve authority.
- **Fullscreen loses user activation:** probe the actual trusted input stack and add only the narrowly scoped native-action adapter if required.
- **Frame/resource leak after minimize or close:** cancellation is tied to visibility, Source release, element removal, context loss and dispose, with exact-once tests.
- **Scope expansion into a media framework:** support only the one-video-per-view contract needed here; subtitles, PiP, playlists and arbitrary renderer layers remain out of scope.
