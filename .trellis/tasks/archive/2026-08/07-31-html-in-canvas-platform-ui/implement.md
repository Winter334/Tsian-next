# Spatial Desktop Parent Implementation Plan

## Execution Model

This is a parent orchestration plan. Do not run `task.py start` on the parent. After the parent planning summary is approved, create and plan the child tasks from `design.md` §13, then start only the child that owns the next independently verifiable deliverable.

Every child must have its own converged `prd.md`; complex children also require `design.md`, `implement.md`, real `implement.jsonl`/`check.jsonl` entries, and a fresh review approval before implementation.

## Phase 0 — Parent Planning Gate

- [ ] Re-read `prd.md` top to bottom and confirm no blocking open question remains.
- [ ] Review `design.md` boundaries, especially input projection, source-DOM ownership, UI-mode persistence, media policy, and no-RetroOS-embedding rule.
- [ ] Review the child map and dependency order with the user.
- [ ] Obtain explicit approval of the latest parent planning summary.
- [ ] Create children with `task.py create --parent 07-31-html-in-canvas-platform-ui`; do not start the parent.

## Phase 1 — Spatial Rendering and Input Foundation

Deliverable: a local-only interaction laboratory proving that real HTML can be captured, curved, visually composited, and interacted with accurately.

- [ ] Add a focused `spatial/engine/` module tree with capability, renderer, texture, scene, projection, shader, scheduler, and metrics responsibilities separated.
- [ ] Build a `layoutsubtree` source host with direct-child HTML surfaces and dirty-element paint scheduling.
- [ ] Upload element snapshots into a raw WebGL pipeline through one nonstandard API adapter.
- [ ] Prove invertible per-Source curved projection, accurate source-local input and three parallax layers; do not make one global curve the product compositor contract.
- [ ] Implement pure coordinate transforms and ray/window intersection.
- [ ] Implement source-DOM target resolution and pointer/mouse/wheel/focus forwarding.
- [ ] Cover click, double-click, hover, drag, resize, context menu, scroll, checkbox/radio, range, text input, textarea, select, contenteditable, IME, file input, and pointer-cancel behavior in the interaction lab.
- [ ] Implement reduced-motion and event-driven frame scheduling.
- [ ] Add texture/frame counters and resource-disposal checks.
- [ ] Do not start panel migration until the edge-hit and native-control browser matrix passes.

Foundation validation:

```powershell
npm run build:web
npm test -- --run <foundation-unit-tests>
git diff --check
```

Browser checks with the required Chromium Flag:

- center and extreme-edge target hit accuracy;
- curved drag/resize without jumps;
- keyboard focus/Tab/IME/native form behavior;
- scroll and pointer capture;
- DPR 1 and DPR 2;
- 1920×1080 and the minimum supported desktop viewport;
- reduced motion;
- context loss/resource cleanup;
- idle scene does not upload textures continuously.

Rollback point: foundation modules and local lab are isolated and not selected by production UI mode.

## Phase 2 — Spatial Shell and Window Session

Deliverable: a local-only Spatial Desktop shell with route-backed multi-window behavior over the proven engine.

- [ ] Add `appearance.uiMode` to `.tsian/local/platform-config.json` normalization/default/clone/save flow.
- [ ] Resolve platform config before shell mount and prevent RetroOS-to-Spatial startup flash.
- [ ] Add a full-reload UI-mode command while retaining the hash route.
- [ ] Extract a shell-neutral platform application registry; preserve RetroOS exports and behavior.
- [ ] Implement `SpatialWindowState` and window commands: open/focus/move/resize/snap/minimize/restore/close/clamp.
- [ ] Keep focus stationary: update active state/z-order/route without camera rotation or automatic desktop movement.
- [ ] Open Spatial windows at a readable viewport-relative default size (about 58% width, 72% height at 1920×1080) while retaining edge resize and recoverable clamping.
- [ ] Do not resize windows from wheel input; defer background-wheel camera zoom to a separate interaction pass.
- [ ] Implement launchers, task/status surfaces, keyboard window controls, and route/deep-link sync.
- [ ] Keep every non-closed source mounted; verify scroll/draft preservation across focus/minimize/occlusion.
- [ ] Add Spatial FUI tokens and structural primitives in dedicated files, not the monolithic RetroOS stylesheet.
- [ ] Establish the first window-style baseline: gray-white borderless body, permanent left title/drag tab, permanent right controls, no window grid/gradient/texture/selection shadow/rim/glow, and 28–34px default local bow.
- [ ] Keep the production Spatial release gate disabled.

Shell validation:

```powershell
npm run build:web
npm test -- --run <spatial-window-and-registry-tests>
git diff --check
```

Manual/browser matrix:

- direct load of every registered route creates/focuses the matching spatial window;
- multiple windows overlap, focus, rotate to center, drag, resize, snap, minimize, restore, and close;
- switching UI mode reloads and restores only the current route/business data;
- RetroOS behavior is unchanged;
- minimum desktop viewport stays recoverable;
- narrow/mobile never enters Spatial Desktop.

Rollback point: disable shell selection/release gate; RetroOS remains default.

## Phase 3 — Library and Market Surfaces

Deliverable: the first real vertical slice and all Game Card library/market/property workflows in Spatial FUI.

- [ ] Extract shared controllers/helpers from `GameCardLibraryView`, `AppMarketView`, and `GameCardDetailView` where presentation currently owns reusable business behavior.
- [ ] Implement Spatial My Apps first: card grid, cover states, quick actions, context menu, keyboard operation, change-event refresh, and launch/detail routing.
- [ ] Implement Spatial App Market: filters, package grid/detail, install/upload flows, update state, and account entry.
- [ ] Implement Spatial Game Card detail/property workflows, drafts, cover upload/url/clear, save, delete, launch, and close guard.
- [ ] Introduce one spatial media resolver for same-origin/Blob/CORS-readable images and designed fallback states.
- [ ] Verify no mutation/storage/event logic was copied into parallel presentation modules.

Focused validation:

- install/copy/load/delete/update flows;
- card property draft/save/discard-close behavior;
- cover Blob, same-origin URL, failed external URL, and placeholder;
- keyboard and context-menu parity;
- simultaneous My Apps/Market/detail windows retain state.

## Phase 4 — Workspace Surfaces

Deliverable: Spatial Explorer, editor, and media viewer with all current file-management semantics.

- [ ] Extract shared workspace controllers without moving persistence into composables.
- [ ] Implement root/card browsing, list/tile layouts, selection, context menus, inline create/rename, clipboard, copy/cut/paste, delete, F2, and read-only guards.
- [ ] Implement multiple editor windows, CodeMirror integration, Ctrl+S, dirty state, before-close confirmation, and route identity.
- [ ] Implement image/audio/video media viewing with Blob lifecycle cleanup.
- [ ] Preserve `.keep`, cross-root clipboard, save-slot guards, event refresh, and current path semantics.
- [ ] Verify window focus/rotation/minimize does not reset scroll, selection, draft, or editor state.

Focused validation:

- existing workspace interaction matrix from specs;
- multiple editor ids and close guards;
- long list scrolling at curved edges;
- text selection, IME, and CodeMirror input through projected input;
- media playback controls and fullscreen/native surfaces.

## Phase 5 — Agent Surfaces

Deliverable: Spatial Studio and Desktop Assistant with long-running, streaming, and dialog-heavy behavior.

- [ ] Extract shared Studio and Assistant state/controllers only along real reuse seams.
- [ ] Implement Agent selection, file previews, Skill/config controls, provider selection, and workspace navigation in Spatial Studio.
- [ ] Implement session list, message timeline, streaming, attachments, ask-user deformation, configuration surfaces, rename/delete, and persisted scroll in Spatial Assistant.
- [ ] Preserve event subscriptions, provider/runtime calls, attachment Blob lifecycle, tool timeline behavior, and ask-user single-input-region contract.
- [ ] Verify focus rotation/minimize does not interrupt streaming or active runtime requests.

Focused validation:

- multi-session switching and persisted scroll;
- streaming while the Assistant window is side-positioned, occluded, and minimized;
- ask-user answer/cancel flow;
- attachment paste/drop/pick and previews;
- Studio mutations refresh other open surfaces.

## Phase 6 — System Surfaces

Deliverable: Spatial Control Panel, Account, Announcements, and System Monitor.

- [ ] Implement the Spatial Control Panel hub and all current provider/model, semantic search, cloud backup, tunable, and UI-mode sections.
- [ ] Implement Account identity states and login/logout behavior.
- [ ] Implement announcement list/read state and task/status integration.
- [ ] Implement System Monitor overview, trace list/detail, JSON trees, filters, export, and checkpoint restore.
- [ ] Preserve secrets, full-write platform-config semantics, diagnostics contracts, and structured JSON display behavior.

Focused validation:

- provider/model add/edit/test/delete and auto-save;
- UI-mode save then full reload;
- account avatar fallback and auth actions;
- unread announcement count;
- large diagnostic JSON, filtering, copying, export, and restore.

## Phase 7 — Play and Global Surfaces

Deliverable: Spatial Play host plus all global platform-owned overlays.

- [ ] Implement Spatial launch/save selection and Play host chrome while leaving the Game Card iframe frontend unchanged.
- [ ] Preserve Play singleton semantics, bridge/runtime ownership, ESC return, reload/build states, and browser fullscreen.
- [ ] Implement Spatial splash/boot, toast, confirm, context-menu, and general floating/dialog surfaces.
- [ ] Keep browser-owned file/color/select/fullscreen surfaces native when required; document each intentional flat/native escape.
- [ ] Verify global overlays resolve to the active spatial plane and remain keyboard accessible.

Focused validation:

- save selection/create/rename/delete/continue;
- remote and packaged frontend loading;
- Play fullscreen enter/exit and focus restoration;
- toast/confirm while multiple windows are open;
- modal click isolation and before-close flows;
- splash once/seen behavior under both UI modes.

## Phase 8 — Release Integration and Parity

Deliverable: all parent acceptance criteria pass and Spatial Desktop becomes selectable in production.

- [ ] Remove every local-only placeholder and confirm the spatial application registry is complete.
- [ ] Run a route/action parity audit against all platform applications and global hosts listed in the parent PRD.
- [ ] Run accessibility: keyboard-only, focus visibility/order, screen-reader semantics spot checks, reduced motion.
- [ ] Run visual consistency review: Spatial FUI tokens, gray-white borderless windows/tabs, independent curves/poses, overlap depth without window shadow/rim/glow, readable content, transition-only glitch, no global rubber-sheet deformation or accidental RetroOS chrome.
- [ ] Run performance/resource review with multiple simultaneous windows, dirty/idle states, minimize/restore, and context/resource disposal.
- [ ] Run supported Chromium/Flag matrix and unsupported/narrow fallback behavior.
- [ ] Verify RetroOS regression matrix and build/tests.
- [ ] Choose the current capability/Flag guidance mechanism and document it in release-facing copy.
- [ ] Enable the production Spatial release-ready gate only after every child and parent criterion passes.
- [ ] Update `.trellis/spec/platform-web/frontend/` with the final dual-shell, source-DOM, projection-input, and panel-adaptation contracts.
- [ ] Run parent final quality review, commit, and archive all children then parent.

Final validation commands:

```powershell
npm run build:web
npm test
git diff --check
```

Browser product matrix must cover:

- both UI modes and mode reload;
- every registered route/deep link;
- all multi-window commands;
- center/edge pointer and keyboard behavior;
- every first-release application workflow;
- unsupported API/WebGL and narrow/mobile fallback;
- reduced motion;
- external/same-origin/Blob media states;
- long-running Assistant and Play behavior;
- resource cleanup and idle rendering.

## Cross-Child Review Rules

- Each child owns disjoint presentation/module write scopes listed in its child design.
- Shared engine, registry, config, and primitive changes return to the owning foundation/shell child or receive explicit coordination; panel children do not patch them opportunistically.
- Panel children may extract shared domain controllers from their owned existing views, but must keep old RetroOS behavior green.
- A panel child is not complete merely because it looks correct; it must pass its domain mutation, focus, scroll, close-guard, and multi-window state matrix.
- Child completion does not enable production Spatial mode. Only Phase 8 owns that gate.

## Completion Record (2026-08-07)

- All eight child tasks completed their independently verifiable scopes; the release-integration child performed the parent-level parity review.
- The user-confirmed Flag Chromium matrix passed for rendering, projected input, multi-window behavior, reduced motion, lifecycle/resource behavior and unsupported-environment fallback.
- Spatial registry completeness is structural for all 13 platform applications, the production release gate is open, and RetroOS remains the default and immediate rollback path.
- Final quality gate passed: 46 focused Spatial/release files (258 tests), 23 controller/component/view files (79 tests), full 120-file/899-test suite, production web build, source/output isolation and `git diff --check`.
