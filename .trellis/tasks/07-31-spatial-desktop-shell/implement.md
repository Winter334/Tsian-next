# Spatial Desktop Shell Implementation Plan

## Preconditions

- Parent requirements and the archived rendering/input foundation are authoritative.
- This task remains `planning` until the user approves the final summary and `task.py start` is run in a later turn.
- Preserve all unrelated worktree changes. The active task directories are currently untracked user/project planning work and must not be deleted or reset.
- Do not adapt domain panels or enable the production Spatial release gate in this child.

## Step 1 — Config, Mode Resolver, and Neutral Boot

- [ ] Add `PlatformConfigAppearance` and `appearance.uiMode` to defaults, normalization, section keys and deep clone.
- [ ] Add pure build/device/mode eligibility and save-then-reload helpers with injectable environment dependencies.
- [ ] Refactor `App.vue` to wait for host initialization plus config preheat before shell mount.
- [ ] Keep auth, update refresh and attachment cleanup non-blocking after readiness.
- [ ] Add typed runtime fallback from Spatial to RetroOS without mutating saved preference.
- [ ] Add focused config/mode tests, including pre-Spatial config files and malformed appearance fields.

Validation:

```powershell
npm test -- --run apps/platform-web/src/config
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
```

Review gate: no localStorage mode key, no RetroOS flash, and no production-selectable Spatial path.

## Step 2 — Shell-Neutral Registry Extraction

- [ ] Create one registry for route definitions, stable app metadata, instance identity and per-shell presentation defaults.
- [ ] Move parameterized route/query parsing into pure helpers.
- [ ] Derive router records, RetroOS launchers/window inputs and Spatial descriptors from the registry.
- [ ] Keep `desktop-apps.ts` compatibility exports and exact existing ids used by before-close guards.
- [ ] Register pending Spatial presentations without importing RetroOS views into Spatial sources.
- [ ] Add tests for every ordinary, singleton, detail, editor and media route plus invalid parameters.

Validation:

```powershell
npm test -- --run apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/composables/useDesktopWindows.test.ts
npm run build:web
```

Review gate: RetroOS route/deep-link behavior and public helper ids are unchanged.

## Step 3 — Shared Viewport Controller Extraction

- [ ] Extract capability/renderer/scheduler/input/lifecycle behavior from `SpatialLabController` into a framework-neutral product-capable controller.
- [ ] Keep lab diagnostics, probe matrix and test-only controls in the lab adapter.
- [ ] Add source enumerate/sync/release/restore/dirty APIs and a pre-render scene hook.
- [ ] Ensure parallax/dual-axis curve/input use the same last-applied projection configuration.
- [ ] Preserve context loss/restore, page visibility, reduced motion, native control and resource teardown behavior.
- [ ] Run the entire existing Spatial suite before shell integration.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
```

Browser gate: rerun the existing lab's center/edge click, text/IME, picker, drag/resize, scroll and context-restore probes after extraction.

## Step 4 — Pure Spatial Window Session and Layout

- [ ] Implement window open/focus/move/resize/minimize/restore/close/minimize-all/clamp commands.
- [ ] Implement stable world coordinates, z order, readable viewport-relative default sizing and texture state transitions.
- [ ] Remove focus-driven camera target/step behavior; focus must not change Source layout or world coordinates.
- [ ] Remove per-window wheel zoom and its policy/state/tests; keep wheel available for ordinary content scrolling and defer camera zoom.
- [ ] Implement world-to-planar Source layout and inverse drag delta using one immutable layout configuration.
- [ ] Implement smooth side-band depth/snap without slots or coordinate quantization.
- [ ] Reuse stable before-close ids and test veto/no-mutation behavior.
- [ ] Add dense pure tests for stationary repeated focus, default viewport sizing, center/four-direction edges, overlap and viewport resize.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial/shell
```

Review gate: focusing changes only active state/z-order/route; no Source geometry moves. Wheel does not mutate window geometry.

## Step 5 — Spatial Shell Source DOM and Visual Primitives

- [ ] Add `SpatialDesktopShell.vue`, direct-child launcher/status/window sources, input plane and dedicated styles/tokens.
- [ ] Wire the shared viewport controller to the shell's Source enumeration and layout hook.
- [ ] Replace the single-axis cylindrical projection with a shallow invertible horizontal+vertical spherical/lens projection that keeps the complete Source domain visible.
- [ ] Add `SpatialWindowSurface` titlebar, controls and eight projected resize handles.
- [ ] Add native Spatial pending-app content for all not-yet-adapted routes.
- [ ] Keep every non-closed Source mounted; implement texture release/restoring-before-visible for minimize/restore.
- [ ] Add local diagnostics toggle without a permanent debug overlay.

Review gate:

- every drawable root is a direct Canvas child;
- no `retro-*` content surface or RetroOS view is rendered inside Spatial;
- shell/window/style responsibilities remain split by module seam.

## Step 6 — Route, Keyboard, and Session Integration

- [ ] Watch routes idempotently and open/focus the registry descriptor.
- [ ] Sync launcher/task/window focus actions back to the active URL without loops.
- [ ] Run before-close guard before route/focus/session mutation.
- [ ] Add keyboard launcher activation, open-window traversal, minimize and close commands with visible focus.
- [ ] Preserve state across focus, side movement, occlusion and minimize; only close unmounts.
- [ ] Verify direct loads rebuild only the deep-linked window.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial/shell apps/platform-web/src/platform-apps.test.ts
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
```

## Step 7 — Development Mode Entry and Fallback

- [ ] Add a build-gated Appearance screen/command to RetroOS Settings.
- [ ] Add a local Spatial “return to RetroOS” command using the same save/reload helper.
- [ ] Dynamically import the Spatial shell only when the resolver permits it.
- [ ] Enforce fine-pointer, minimum viewport and runtime capability fallback without preference mutation.
- [ ] Keep `releaseReady=false`; do not add a production route or public partial registry switch.
- [ ] Inspect production output for lab/shell/experimental markers.

Validation:

```powershell
npm run build:web
Get-ChildItem apps/platform-web/dist -Recurse -File | Select-String -Pattern "spatial-lab|SpatialDesktopShell|data-spatial-source|texElementImage2D"
git diff --check
```

Expected: no local-only lab/shell marker in production output while the compile-time release gate is false.

## Step 8 — Full Quality and Browser Acceptance

- [ ] Run complete Spatial tests, platform-web Vue type-check, production build and whitespace checks.
- [ ] Verify RetroOS startup, launchers, deep links, window commands, Play fullscreen and before-close guards.
- [ ] In the Flag-enabled browser verify mode reload, launcher/status sources, stationary focus, readable default window size, shallow hemispherical curvature with no top/bottom dead bands, projected drag/resize at center and all four edges, minimize/restore state, route sync, DPR/viewport resize, reduced motion and context restore.
- [ ] Disable the Flag or capability and verify clean RetroOS fallback without changing saved `uiMode`.
- [ ] Record exact automated and browser evidence in `verification.md`.
- [ ] Update specs only for contracts proven by the implementation.

Commands:

```powershell
npm test -- --run apps/platform-web/src/spatial apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/config
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
npm run build:web
git diff --check
```

## Rollback Points

- Steps 1–2: default remains RetroOS; revert boot/registry adapters while preserving existing config data.
- Step 3: lab adapter remains the reference; controller extraction can be reverted before any shell imports it.
- Steps 4–6: remove isolated `spatial/shell` modules; RetroOS remains complete.
- Step 7: keep the release gate false. If target-browser shell interaction cannot preserve foundation alignment, do not expose or continue panel adaptation; return to design with browser evidence.
