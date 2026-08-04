# Spatial Library and Market Verification

## Current Status

Implementation and automated quality gates are complete. The task remains `in_progress` pending user-owned Flag Chromium product/visual acceptance. No commit/archive has been performed.

## Delivered Scope

- Shared per-instance controllers for My Apps, Game Card detail and App Market, consumed by both RetroOS and Spatial presentations.
- Dedicated Spatial presentations for `market`, `my-apps` and `game-launcher`; all other registrations remain pending and the production Spatial release gate remains false.
- Shared Spatial image resolver for same-origin, Blob/File, CORS-readable and unavailable image states with owned object-URL cleanup.
- Shared `SpatialActionButton` and Source-local `SpatialSelect` primitives.
- No outer focus rectangles/box-shadows; geometry-stable keyboard feedback only.
- Curvature-safe immediate Source-texture replacement for Market screens and Detail tabs; bounded/reduced-motion-aware local Select/menu/dialog/card/list transitions retain opt-in recapture of computed intermediate frames.
- Spatial presentation primitive and test-maintenance contracts recorded in `.trellis/spec/platform-web/frontend/spatial-ui.md`.

## Final Automated Evidence (2026-08-02)

### Task-owned tests

```powershell
npm test -- --run apps/platform-web/src/controllers apps/platform-web/src/spatial/apps apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/config/platform-ui-mode.test.ts
```

- PASS: 9 files, 48 tests.

### Type-check

```powershell
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
```

- PASS: exit code 0.

### Production build

```powershell
npm run build:web
```

- PASS: 3,176 modules transformed; build completed in 28.83s.
- Existing Rollup warnings remain for large chunks, mixed static/dynamic `@babel/parser`, and `@vueuse/core` pure annotations; no build error.

### Lint and whitespace

- `npm run lint --if-present`: PASS/N/A; repository has no lint script.
- `git diff --check`: PASS; Git emitted existing LF→CRLF working-copy notices only.
- Trailing-whitespace scan over task-owned new code/artifacts: PASS, no matches.

### Static presentation audit

- No native `<select>` remains under `src/spatial/apps/**`.
- No `box-shadow`, infinite application animation, hard-coded hex/RGB palette, RetroOS view import, or `useDesktopWindows` dependency exists in the Spatial application tree.
- All icon-bearing owned actions use `SpatialActionButton`; remaining native buttons are semantic tabs, menus, resource cards or listbox targets.
- `SpatialSelect` tests cover unknown/no selection, disabled options, both arrow directions, enabled boundaries, Home/End, Enter/Space, Escape focus return, Tab closure and all-disabled behavior.

## Transition Continuity Follow-up (2026-08-02)

Manual feedback identified visible flashing: CSS transition classes were present, but `MutationObserver` only observed their start/end DOM changes and did not continuously upload computed intermediate frames.

- Added opt-in `data-spatial-source-animation` capture for the three application Sources.
- `transitionrun` starts the existing `animated-source` frame reason; matching end/cancel events or a 900 ms hard bound stop it.
- Capture is serialized per Source: an outstanding dirty/paint-ready generation is uploaded before the next snapshot is requested. Ending first drains that generation, then captures one final frame, preventing stale/final texture alternation.
- `animated-source` is a motion reason and is suppressed by `prefers-reduced-motion`; release/removal/context loss/disposal clear tracking.
- Market list/detail/upload and Detail tab replacement use staged out/in motion with stronger but restrained translation/scale; popovers, dialogs and list entries use shorter subordinate timing. No blur, glow, focus frame or infinite animation was added.

Verification after the follow-up:

- `npm test -- --run apps/platform-web/src/spatial/engine/source-texture-animation.test.ts apps/platform-web/src/spatial/engine/frame-scheduler.test.ts apps/platform-web/src/spatial/apps/primitives/spatial-select.test.ts`: PASS, 3 files / 17 tests.
- `npm test -- --run apps/platform-web/src/spatial apps/platform-web/src/platform-apps.test.ts`: 24 files / 166 tests passed; the same five documented baseline failures remained.
- `npm exec vue-tsc -- -b apps/platform-web/tsconfig.json`: PASS.
- `npm run build:web`: PASS; existing `@vueuse/core` pure-annotation warnings only.
- `git diff --check`: PASS; LF→CRLF working-copy notices only.
- Browser automation was not run; visual/curved-surface validation remains user-owned.

## Final Full-scope Review (2026-08-02)

The final Trellis review re-read the complete PRD/design/implementation plan and applicable frontend/Spatial specs, then traced the controller, registry, media, presentation and Source-texture paths together.

- Fixed one hard-bound defect in `SourceTextureAnimationTracker`: later `transitionrun` events for additional properties increment the active transition count but no longer slide the deadline of an already-active Source batch. A continuously active batch therefore expires at the original 900 ms bound instead of being extendable indefinitely by repeated runs.
- Added a regression test proving two simultaneously counted properties remain active while the first batch is in range and still expire at its original deadline.
- Reconfirmed per-Source serialization: dirty or paint-ready generations are preserved; settlement waits for the outstanding upload, requests one final generation, and completes only after that generation becomes clean. Release/removal, context loss, disposal, reduced motion and hidden-page suspension do not retain a continuous `animated-source` reason.
- Reconfirmed Market list/detail/upload and Detail overview/frontend replacement use bounded Source-local transitions with leave-time pointer suppression. Spatial app code contains no native product `<select>`, focus box-shadow, blur/glow, infinite animation, RetroOS view import, `retro-*` chrome, or `useDesktopWindows` dependency.
- Browser automation was intentionally not run. The five documented unrelated legacy failures were not rerun or modified.

Final review verification:

- `npm test -- --run apps/platform-web/src/controllers apps/platform-web/src/spatial/apps apps/platform-web/src/spatial/engine/source-texture-animation.test.ts apps/platform-web/src/spatial/engine/frame-scheduler.test.ts apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/config/platform-ui-mode.test.ts`: PASS, 11 files / 60 tests.
- `npm exec vue-tsc -- -b apps/platform-web/tsconfig.json`: PASS.
- `npm run build:web`: PASS, 3,177 modules transformed; existing annotation, mixed static/dynamic import and large-chunk warnings only.
- `npm run lint --if-present`: PASS/N/A; repository has no lint script.
- `git diff --check`: PASS; LF→CRLF working-copy notices only.

## Superseded Simplified Coverage Experiment (2026-08-03)

Flag Chromium/HMR observation showed that the experimental two-phase readiness handshake and temporary app-level double mounting increased visible instability. That experiment was fully removed: no content-capture event bridge, readiness retry state, or `SpatialContentTransition` wrapper remains.

The next experiment reduced the transition to ordinary stacked Vue layers:

- Market uses one keyed `<Transition name="spatial-content">` for list/detail/upload; Detail uses one keyed v-if/v-else Transition for overview/frontend. Neither uses `mode="out-in"`.
- The transition stack has an opaque `--spatial-app-surface` base. Incoming content is z=2 and fades/translates in; outgoing content is z=1, stays at `opacity:1`, disables pointer input, and runs an equal 250 ms transform so Vue removes it only after incoming content is fully opaque.
- Existing bounded, serialized `animated-source` repaint remains unchanged. Reduced motion still resolves immediately, and Vue owns fast retarget cancellation/removal.
- Popover/menu/dialog/list transitions remain localized over a continuously painted owning screen and were not expanded.
- HMR component remount/reconstruction is not a product transition acceptance signal. Final acceptance uses normal in-app Market screen and Detail tab changes in Flag Chromium.

This experiment was subsequently removed after normal Flag Chromium product navigation provided decisive curvature evidence below.

Verification after removing the experiment:

- Focused controller/app/animation/registry tests: PASS, 11 files / 60 tests.
- Vue type-check: PASS.
- `npm run build:web`: PASS.
- `git diff --check` and task-owned trailing-whitespace scan: PASS; LF→CRLF working-copy notices only.
- Static audit: exactly the Market and Detail keyed content transitions remain, and no Spatial app contains `mode="out-in"`, readiness bridge import, or temporary transition wrapper.
- Browser automation was not run. User-owned acceptance excludes HMR remounts and covers normal product navigation only.

## Curvature-safe Dominant Content (2026-08-03)

Normal Flag Chromium navigation showed that entering Market/Detail content temporarily lost curvature and rendered as a flat plane, then snapped back onto the curved window exactly when the CSS transition ended. This identifies Chromium descendant compositor promotion outside the HTML-in-Canvas Source, not missing texture repaint frames, as the dominant-content flicker mechanism.

- Removed every `spatial-content` CSS enter/leave rule and both dominant Vue `<Transition>` wrappers.
- Market list/detail/upload and Detail overview/frontend now replace immediately inside the existing Source texture, so the WebGL window mesh remains the only presentation path.
- Retained `source-texture-animation` only for currently allowed local popover/select/dialog/list transitions. These remain provisional and must also be disabled if manual Flag Chromium testing shows planar escape.
- The current renderer owns one texture per Source. It has no low-risk reusable intra-Source old/new texture seam; a true curved dominant-content transition is recorded as future renderer-owned dual-texture/GPU platform work, not implemented in this application task.
- HMR remount/reconstruction remains excluded from product transition acceptance; verification uses normal in-app navigation.

Verification after the curvature-safe downgrade:

- Focused controller/app/local-animation/paint/viewport/registry tests: PASS, 13 files / 71 tests.
- Vue type-check: PASS.
- `npm run build:web`: PASS, 3,177 modules transformed.
- `git diff --check` and task-owned trailing-whitespace scan: PASS; LF→CRLF working-copy notices only.
- Static audit: no production or test reference to `spatial-content` remains under `apps/platform-web/src`; Market and Detail contain no dominant Vue Transition wrapper.
- Element-texture and viewport regressions confirm a changed Source is uploaded through the existing paint path; the immediate keyed root replacements are observed as ordinary child-list mutations and require no readiness bridge or repeated dominant animation capture.
- PRD/design/spec/verification consistently defer a curved animated handoff to future renderer-owned dual-texture/GPU platform work. The obsolete spec example that described Market list-to-detail animation sampling was removed.
- Browser automation was not run; final curvature acceptance remains user-owned in Flag Chromium through ordinary in-app navigation.

## Legacy Test Cleanup

The five reproducible legacy failures were audited after the user clarified that the suite should retain only durable contract coverage:

- Deleted `spatial/shell/spatial-window-style.test.ts`: all 11 tests inspected raw Vue/TypeScript/CSS/shader strings or tunable visual values. Their durable lifecycle, presentation, scene, input and texture contracts already have behavioral coverage.
- Rewrote three stale `spatial/shell/window-layout.test.ts` expectations around strict calibrated progress, symmetry, positive inward curvature and four-corner viewport intersection instead of historical pixel thresholds.
- Removed the exact draw-count vector from `spatial/engine/renderer.test.ts` while retaining pass order, transparent clear/blending, relative draw ownership and context restoration.

No production module changed during this cleanup. Focused tests passed 32/32, related behavioral coverage passed 85/85, the broad Spatial/config/RetroOS regression suite passed 192/192, Vue type-check and `build:web` passed, and `git diff --check` passed with working-copy line-ending notices only.

## Projected Select And Scrollbar Input Fix

- Root cause for Select: `SpatialSelect` intentionally cancels compatibility `mousedown` to preserve trigger focus, but the projected pointer router incorrectly treated that cancellation as suppressing the later click. Activation now remains gated by `pointerdown` and disabled policy; canceled `mousedown` remains diagnostic and suppresses focus only.
- Root cause for scrollbars: routed pointer events are synthetic and cannot execute the browser's trusted native scrollbar default action. The input adapter now reconstructs real vertical/horizontal layout-gutter thumb geometry in Source-local coordinates, captures a valid thumb gesture, maps thumb travel to the clamped scroll range, emits scroll on change and repaints only the owning Source.
- Chromium Spatial app scrollbars use a fixed 10 px gutter with native arrow buttons removed so visible and reconstructed track geometry agree. Overlay/no-gutter, non-overflowing, overflow-disabled, invalid, track-only and RTL-horizontal cases remain explicit non-drag states.
- Pointer/source/controller teardown clears drag and captured-projection state before routed cancellation, and router cancellation is re-entrant with exactly-once logical/browser capture release. Scrollbar release never activates the underlying element.

Independent review verification passed focused tests 30/30, broad Spatial regressions 180/180, Vue type-check, `build:web` with 3,179 modules and `git diff --check`. Browser acceptance remains user-owned for Select pointer selection, rapid vertical/horizontal thumb drag, out-of-thumb capture, final position repaint and minimize/close during drag.

## User-owned Manual Gates

- Market Select visual alignment, open/close animation, pointer and keyboard behavior on curved center/edges.
- Icon/text button baseline and spacing in My Apps, Market and Detail.
- No visible focus rectangle on mouse or keyboard traversal; retained keyboard state remains visually acceptable.
- Market list/detail/upload and Detail overview/frontend replace immediately with continuous Source curvature: no temporary flat descendant layer, stale texture, retained old subtree or orphaned input during normal and fast repeated switching.
- Dialog/menu focus restoration and Escape behavior.
- `prefers-reduced-motion` immediate final state.
- Local/remote/CORS-failed image states, native file picker and IME.
- Minimum/default window sizes and simultaneous-window focus/minimize/restore state retention.
- Critical RetroOS My Apps/Market/Detail workflow regression.

## Final Select Acceptance And Task Closeout (2026-08-04)

- The final Flag Chromium probe confirmed that Market `SpatialSelect` options now receive projected input and update the model; the user explicitly accepted the fix and authorized task closeout.
- Final root cause: the document-capture outside-pointer handler treated the trusted full-screen input plane as the Source target and hid the listbox before inverse projection. Source-local outside-close now ignores trusted plane events and acts only on routed synthetic inside/outside targets.
- The listbox/options remain mounted with stable geometry, and compatibility `mousedown` cancellation preserves trigger focus without suppressing click activation.
- Removed the temporary `SpatialProjectedInputDiagnostics` component, DEV async mount, probe marker, and all diagnostic references after acceptance.
- Static audits found no native product `<select>`, temporary probe/debug logging, RetroOS view import, `retro-*` chrome, or `useDesktopWindows` dependency under `spatial/apps/**`.

Final closeout verification:

- Focused controller/Spatial app/registry/config tests: PASS, 9 files / 53 tests.
- Broad Spatial/config/desktop regression suite: PASS, 29 files / 171 tests.
- `npm exec vue-tsc -- -b apps/platform-web/tsconfig.json`: PASS.
- `npm run build:web`: PASS, 3,179 modules transformed; existing annotation, mixed import and large-chunk warnings only.
- `npm run lint --if-present`: PASS/N/A; repository has no lint script.
- `git diff --check`: PASS; LF→CRLF working-copy notices only.
