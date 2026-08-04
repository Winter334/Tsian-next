# Current Play and Global Surfaces Evidence

## Global host topology

- `apps/platform-web/src/App.vue:27-39` mounts `ToastHost`, `ConfirmHost`, and form-mode `FloatingWindow` after either shell, so all three remain flat RetroOS overlays in Spatial mode.
- `apps/platform-web/src/components/feedback/ConfirmHost.vue:1-72` renders all confirm/prompt/choice UI through Retro `FloatingWindow`; `:75-132` owns only presentation state, validation and resolution calls.
- `apps/platform-web/src/components/feedback/FloatingWindow.vue:1-144` Teleports a fixed overlay/window to `body`; form mode consumes `useDialogForm`, while slot mode is embedded by several Retro route components.
- `apps/platform-web/src/components/feedback/ToastHost.vue:1-66` reads the singleton toast store and renders a fixed top-right Retro stack.
- `apps/platform-web/src/composables/useConfirm.ts:1-143` defines the authoritative single-pending request, normalized defaults, resolve types and concurrent auto-reject behavior.
- `apps/platform-web/src/composables/useDialogForm.ts:1-125` defines the authoritative form request, values, validation/test options and result snapshot.
- `apps/platform-web/src/composables/useToast.ts` owns toast identity, timeout and dismiss state; presentation replacement does not require caller changes.

## Spatial source constraints

- `apps/platform-web/src/spatial/shell/SpatialDesktopShell.vue:1-24` places shell and window Sources directly under the `layoutsubtree` canvas and keeps the trusted full-screen input plane above it.
- `apps/platform-web/src/spatial/engine/viewport-controller.ts:365-407` synchronizes only `:scope > [data-spatial-source]`; dynamically inserted global surfaces therefore require explicit `syncSources()` and one dirty paint request.
- `apps/platform-web/src/spatial/engine/viewport-controller.ts:1255-1273` resolves projected input from the same direct Source set and honors `data-spatial-input="none"`.
- `apps/platform-web/src/spatial/engine/scene.ts:61-91` reads z, parallax and pose from Source data attributes; a modal shield and panel can therefore participate in normal painter and hit order without a flat overlay.
- `.trellis/spec/platform-web/frontend/spatial-ui.md` requires Source-local dialogs/selects, bounded capture-aware transition, inherited Spatial tokens, no `retro-*` chrome, and no ordinary flat overlay.

## Confirm behavior to preserve

- `ConfirmHost.vue:93-105` focuses prompt input or the cancel button when a request opens.
- `ConfirmHost.vue:108-131` maps cancel to false/null, validates prompt before resolving, and maps confirm to true/string.
- `ConfirmHost.vue:27-37` supports prompt default/placeholder/error and Enter/Escape.
- `ConfirmHost.vue:49-59` supports arbitrary choice labels and per-option danger severity.
- `FloatingWindow.vue:174-185` documents that confirm uses a dim overlay and closes on backdrop, while generic form dialogs block outside input without closing.

## Play ownership seams

- `apps/platform-web/src/views/PlayView.vue:179-207` owns the full Play phase state and frontend resource handles.
- `PlayView.vue:218-378` owns remote/packaged frontend mount, bridge target and stale/dispose protection; `:382-545` owns launcher transitions, save refresh, platform events, ESC and teardown.
- `apps/platform-web/src/components/play/GameLauncherPanel.vue:264-294` owns view state; `:313-618` directly performs version confirmation, create/rename/import/export/cloud/delete mutations and toast/confirm feedback.
- `apps/platform-web/src/platform-apps.ts:201-211` registers `game-launcher`/`play`, but their Spatial presentations remain pending.
- The parent design forbids rewriting game-card iframe content and ordinary flat overlays; iframe capture/input must be proven in the target browser before selecting the Spatial Play rendering path.

## Migration conclusion

The correct first seam is presentation selection at the shell boundary: Retro global hosts stay in `App.vue` only for Retro, while Spatial global hosts become direct children of `SpatialDesktopShell`'s canvas and continue reading the existing composable stores. Play requires controller extraction before a second presentation.
