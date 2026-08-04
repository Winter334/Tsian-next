# Current Workspace Surfaces Evidence

Date: 2026-08-04

## Scope of Inspection

This note records the code and spec evidence used to plan `spatial-workspace-surfaces`. It intentionally describes the current implementation before controller extraction.

Primary files:

- `apps/platform-web/src/views/WorkspaceExplorerView.vue`
- `apps/platform-web/src/views/WorkspaceEditorView.vue`
- `apps/platform-web/src/views/WorkspaceMediaView.vue`
- `apps/platform-web/src/components/workspace/WorkspaceCodeEditor.vue`
- `apps/platform-web/src/platform-apps.ts`
- `apps/platform-web/src/lib/workspace-readonly.ts`
- `apps/platform-web/src/lib/workspace-events.ts`
- `apps/platform-web/src/composables/window-close-guards.ts`
- `apps/platform-web/src/spatial/engine/{capabilities,element-textures,frame-scheduler,viewport-controller,renderer,scene}.ts`
- `.trellis/spec/platform-web/frontend/{component-guidelines,spatial-ui}.md`
- parent task `07-31-html-in-canvas-platform-ui`

## Registry and Window Identity

- `platform-apps.ts:167-184` registers Explorer, Editor and Media, but each call to `presentation(...)` omits a Spatial component, so all three are pending.
- `platform-apps.ts:279-306` already converts editor/media routes to cross-shell descriptors.
- Editor identity is `workspace-editor:<scope>:<editorId>` when an editor id exists and otherwise falls back to scope/mode/path (`platform-apps.ts:336-344`).
- Media identity is `workspace-media:<scope>:<path>` (`platform-apps.ts:295-306`).
- Existing tests cover card/local editor ids, media ids, and invalid route rejection (`platform-apps.test.ts:63-77`).
- The Explorer is a singleton. Multiple Editor instances and one Media instance per file can remain mounted at the same time.

Planning consequence: use `platform-apps.ts` as the sole identity authority. The current Editor's import from `desktop-apps.ts` is legacy and must not be copied into shared controllers.

## Explorer Behavior Inventory

`WorkspaceExplorerView.vue` is about 1,350 lines. Its script starts around line 381 and owns both business state and Retro presentation behavior.

### Data and request state

- Root/card/local selection, current path, directory/search entries, read-only state, selection, rename, feedback, context menu and clipboard are local refs (`457-480`).
- Separate root/directory/search request ids prevent stale asynchronous results from winning (`478-480`, `665-735`, `1021-1056`).
- Route query state is read/written in the view (`529-562`) and workspace change events trigger authoritative refresh (`1289-1319`).

### File operations

- Root/local `.tsian` navigation and breadcrumbs are view-owned (`482-510`, `748-797`).
- New files are written immediately and enter inline rename (`879-901`).
- New folders are represented by `<dir>/.keep`; the comment at `903-930` documents that the UI hides `.keep` while storage and Agent operations retain it.
- Rename validates blank/path separators and confirms extension changes before platform move (`931-1007`).
- Copy/cut retain source card id and directory flag; paste passes source and target scope for cross-root copy/move (`1140-1221`).
- Copy keeps the clipboard for repeat paste; cut clears it after success. Conflict names are incremented with a pure helper (`635-654`).
- File media classification routes images/audio/video to media except SVG, which remains editable text (`1065-1108`). Each editor open generates a fresh id.

### Guard and input state

- `workspace-readonly.ts` blocks mutation of generic read-only entries, protected `save` / `save-N`, and create under `save`.
- Explorer keyboard commands F2/Delete/Ctrl+C/X/V use the same view commands and skip editable targets (`1223-1287`).
- The current shortcut guard only checks the optional `minimized` prop. Spatial components currently receive descriptor props rather than live minimized state, so the shared design also requires active-route ownership.
- Context menu coordinates are already translated against `explorerRef`, not directly stored as screen coordinates (`808-842`). The Spatial view must preserve this source-local pattern.

Planning consequence: extract request/mutation/capability state but keep DOM focus, route-root menu geometry and shortcut listeners in each presentation.

## Editor Behavior Inventory

`WorkspaceEditorView.vue` is about 524 lines and already implements several important safety contracts.

### Load, validation, and save

- Editor state includes draft/original paths, content/expected baseline, read-only, request flags, feedback and validation (`98-110`).
- Dirty state is delegated to `hasWorkspaceEditorDraftChanges`; read-only files are never dirty (`112-120`, `workspace-readonly.ts`).
- `.json` uses local JSON parsing and `SKILL.md` uses frontmatter presence validation before write (`185-262`).
- Create mode checks parent listing to reject an existing target (`264-279`).
- `requireTextFile` rejects any `WorkspaceFile.binary` before applying loaded or written content (`281-286`).
- Edit writes include `expectedContent`, then apply the authoritative returned file, emit the workspace event, retain editor id in route replacement, and validate the saved file (`301-393`).
- Load applies server read-only state (`395-426`).

### Shortcut and close guard

- Ctrl/Cmd+S intentionally works inside CodeMirror and checks route name plus minimized/read-only state (`455-468`).
- Because all mounted editor instances see the same route name, route-name-only gating is insufficient for multiple Spatial editors; full active descriptor identity is required.
- The before-close handler implements save/discard/cancel and keeps the window open after failed save (`470-495`).
- It captures one window id at mount so later path route replacement cannot unregister the wrong guard (`497-523`).
- The current imports come through `useDesktopWindows.ts` and `desktop-apps.ts`, although the actual guard map is already shell-neutral in `window-close-guards.ts` and the cross-shell id now lives in `platform-apps.ts`.

Planning consequence: the whole safety sequence belongs in a shared per-instance controller, while the toolbar/status markup remains presentation-owned.

## CodeMirror Evidence

`WorkspaceCodeEditor.vue` already owns:

- one long-lived `EditorView` and cleanup;
- JSON, Markdown, JS/TS, CSS, HTML-family and YAML language selection;
- editable/read-only reconfiguration through compartments;
- external model synchronization without feedback loops;
- line wrapping and update emission.

The only presentation-specific coupling is `editorTheme`: it hard-codes Retro dark colors and `&.cm-focused { outline: ... }`. Forking the component would duplicate language and lifecycle behavior. A default-Retro theme variant/compartment is the minimal reuse seam.

## Media Viewer Evidence

`WorkspaceMediaView.vue` currently:

- infers media type from path;
- reads the binary workspace file;
- creates one object URL and revokes it before replacement/unmount;
- shows image, native audio controls or native video controls;
- watches card/path and route reuse.

It has no stale-request id, so a slower old read could replace a newer route. It also relies on native media control hit behavior. The loading/object-URL behavior is presentation-neutral and should be shared; Spatial playback controls are presentation-specific.

## HTML-in-Canvas and Video Frame Evidence

### API surface

- `capabilities.ts` exposes only `requestPaint`, a paint callback with changed/removed elements, and `texElementImage2D` upload for a Source element.
- `html-in-canvas-types.d.ts` contains no media/video-frame callback.
- `element-textures.ts` uploads only records that are both `dirty` and `paintReady`. `requestPaint()` is one-shot according to `spatial-ui.md`.
- `frame-scheduler.ts` has `dirty`, parallax/transition/particles/background, bounded `animated-source`, and restore reasons. There is no animated media reason.
- `viewport-controller.ts` requests Source paint for input/focus/scroll/CSS-transition/lifecycle changes. It has no video event or decoded-frame integration.

### Established contract

`spatial-ui.md` states:

- paint is demand-driven and upload timing is generation-sensitive;
- stable Source presentation animation must not repeatedly dirty HTML textures;
- static media bases do not own continuous frames;
- future animated media must have an independent frame reason and not dirty HTML textures while animating.

Parent Phase 4 nevertheless requires image/audio/video viewing, projected playback controls and fullscreen/native-surface validation.

### Decision

Native `<video controls>` plus ordinary Source capture is not a complete implementation:

1. projected synthetic events do not guarantee native media-control default actions;
2. no repository/API contract marks a Source upload-ready for each decoded video frame;
3. forcing full-window Source recapture per frame contradicts the existing animated-media contract and would upload far more pixels than the media region.

The planned path is an opt-in renderer-owned video texture:

- the same Blob-backed video element decodes and owns fullscreen;
- actual decoded frames request an independent `animated-media` draw;
- standard WebGL video upload updates only the media texture;
- a sub-surface draw uses the owning Source's full curve/pose and measured media rectangle;
- Source controls repaint only when their own state changes;
- all callbacks/resources stop on pause/end/hidden/release/remove/context loss/dispose.

This is the minimum discovered engine exception needed for reliable parent-scope parity. Full Source recapture and a flat overlay are explicitly rejected.

## Existing Shared Contracts to Preserve

- `.trellis/spec/platform-web/frontend/component-guidelines.md:74-85`: Explorer create/rename/clipboard/`.keep`/read-only semantics.
- `component-guidelines.md:137-150`: text-only Editor, media routing, Ctrl+S, close guard, binary rejection, object URL cleanup.
- `.trellis/spec/platform-web/frontend/spatial-ui.md`: direct Source eligibility, projected input, Source-local menus, native escape limits, mounted lifecycle, demand-driven texture generations and animated-media frame ownership.
- `.trellis/spec/platform-web/frontend/hook-guidelines.md`: composables expose explicit commands and clean up subscriptions/timers.
- `.trellis/spec/guides/code-reuse-thinking-guide.md`: shared behavior belongs in one controller rather than copied presentation scripts.

## Verification Gaps Before Implementation Completion

- Target Flag Chromium must prove standard Blob video upload orientation and frame readiness.
- The target must prove whether fullscreen called synchronously inside the existing projected activation stack retains transient user activation. Only a failed probe authorizes the narrow trusted adapter.
- CodeMirror projected caret/selection/IME behavior cannot be established by jsdom unit tests and remains a browser product matrix item.
- The dynamic video sub-surface must be tested for contain geometry, z/source ownership, resize, context restore and no idle frame reason.
