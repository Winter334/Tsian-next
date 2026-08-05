# Spatial Play and Global Surfaces Implementation Plan

## Execution rules

- Implement the user-approved Spatial Confirm slice first and pause for product validation before continuing to the remaining global/Play phases.
- Keep Retro global hosts and business composables unchanged unless a shared presentation-only helper is required.
- Global Spatial surfaces must be Canvas direct Sources; do not Teleport ordinary overlays above the Canvas.
- No independent intermediate review agent is required. Run one consolidated Trellis quality check after the assembled implementation/fix slice.
- Preserve unrelated parent/sibling task directories and the parallel active task pointer until this child is explicitly started.

## Phase 1 — Spatial Confirm first slice

- [x] Conditionally mount the Retro Confirm host only in Retro mode; keep Toast/Dialog Form mounted until their Spatial replacements land in Phase 2.
- [x] Add `SpatialConfirmHost.vue` as direct canvas children: modal shield plus compact panel Source.
- [x] Add Source z/pose/layout and shared Spatial modal styles without `retro-*` imports.
- [x] Preserve confirm/prompt/choice defaults, result types, danger variants, validation and concurrent rejection.
- [x] Add initial focus, Tab trap, Escape/backdrop cancel and connected-invoker focus restore.
- [x] Integrate dynamic Source sync/dirty paint into `SpatialDesktopShell` without exposing the viewport controller to the host.
- [x] Prove modal shield blocks pointer/wheel/contextmenu to Dock/windows and releases cleanly.
- [x] Add renderer-owned horizontal panel open/close presentation; retain the panel texture until close completion before resolving the request.
- [x] Keep the full-viewport modal sink input-only (`data-spatial-render="none"`) so it blocks projected input without texture upload, overlay drawing or black-frame flashes.
- [x] Add focused tests for presentation state and shell host ownership/source lifecycle.
- [x] Run focused tests, Vue type-check, web build and whitespace check.
- [x] Pause for user Flag Chromium validation of the editor close-confirm flow (accepted 2026-08-04, including projected editing, z-order, horizontal presentation and no black flash).

Rollback: remove Spatial Confirm roots and restore Retro Confirm mount for Spatial; no caller or draft behavior changes.

## Phase 2 — Toast and Dialog Form

- [x] Add Spatial Toast Source over `useToasts`, including dismiss/live region/bounded transitions.
- [x] Add Spatial Dialog Form Source over `useDialogForm`, built-in fields, SpatialSelect, validate/test/busy/result/error.
- [x] Share shield/panel/focus machinery without merging request stores or changing caller APIs.
- [x] Verify simultaneous request z-order, modal isolation, source removal and reduced motion.
- [x] Remove Retro Toast/form hosts from Spatial mode only.
- [x] Complete user Flag Chromium validation (accepted 2026-08-05): Dialog/Toast projected interaction works; Toast enter/leave animation is visible; final leave has no horizontal scrollbar; card version updates no longer flash My Apps or Game Card Detail.
- [x] Route ordinary Source-local DOM mutations to the owning texture while preserving full synchronization for direct Source and dynamic-media topology changes; complete Spatial regression, type-check and web build.

Rollback: switch Spatial mode back to Retro hosts; singleton state remains authoritative.

## Phase 3 — Shell context menu

- [x] Keep the pre-renderer neutral boot gate and Retro Nyan Splash unchanged; do not add a Spatial-specific splash or seen state.
- [x] Implement launcher/desktop context actions inside shell Sources with Source-local coordinates and keyboard path.
- [x] Verify pointer/keyboard dismissal, focus restoration and no idle Source animation.

User correction (2026-08-05): removed the theme-specific Spatial splash; the neutral boot gate and existing Retro Nyan splash remain authoritative. Flag Chromium accepted desktop/launcher/status context-menu interaction, blank-desktop dismissal and focus behavior on 2026-08-05.

## Phase 4 — Shared Play/save controllers

- [ ] Extract `use-play-controller` from `PlayView.vue`, preserving mount generations, bridge registration, events, ESC and cleanup.
- [ ] Extract `use-game-launcher-controller` from `GameLauncherPanel.vue`, preserving save/cloud/import/export/confirm/toast semantics.
- [ ] Migrate Retro presentations first and run their regressions before Spatial components.
- [ ] Keep iframe mount refs, native file activation and downloads at presentation boundaries.

Rollback: Retro views can temporarily return to local scripts; no Spatial registration becomes ready.

## Phase 5 — Iframe probe and Spatial Play

- [ ] Record target-browser remote/packaged iframe capture, input, focus, resize, reload and fullscreen evidence.
- [ ] If any required path fails, return to design; do not add a flat iframe overlay.
- [ ] Implement Spatial save launcher over the shared controller.
- [ ] Implement Spatial Play host states/chrome over the shared controller and proven iframe path.
- [ ] Verify minimize/restore/occlusion state retention, ESC, fullscreen and exact cleanup.
- [ ] Mark `game-launcher` and `play` ready only after the complete matrix passes.

## Phase 6 — Consolidated verification

- [ ] Confirm exact global host ownership by mode and no Retro imports/classes in Spatial global/Play presentations.
- [ ] Run focused global/Play/controller/registry tests and the complete Spatial suite.
- [ ] Run Vue type-check, `npm run build:web`, and `git diff --check`.
- [ ] Run the Flag Chromium matrix for Confirm, Toast/Dialog/global context menus and Play center/edge input.
- [ ] Keep production release gate false and unrelated registry readiness unchanged.

Planned commands:

```powershell
npm test -- --run apps/platform-web/src/components/feedback apps/platform-web/src/spatial/shell apps/platform-web/src/controllers/play apps/platform-web/src/platform-apps.test.ts
npm test -- --run apps/platform-web/src/spatial
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
npm run build:web
git diff --check
```

Adjust focused paths to final module names without omitting the full Spatial run after Source lifecycle changes.
