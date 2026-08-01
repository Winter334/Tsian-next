# Spatial Desktop Shell Verification

## Revised window scale and bi-axial curve pass (2026-08-01)

- Per-window wheel resizing is fully removed: the session has no zoom state or command, the shell has no wheel interception policy, and Source layout scale now reflects side depth only. Wheel events continue through the existing projected Source-DOM scrolling path; background camera zoom remains deferred.
- New windows resolve a viewport-relative readable default while retaining app minimums and recovery margins. A 1920×1080 viewport opens at 1114×778, approximately 58%×72%; eight edge handles remain the only way to change dimensions.
- The former horizontal-only projection and center vertical compression are replaced by independent shallow horizontal and vertical tangent maps. Both CPU directions and GLSL consume the same two axis angles, round trip exactly within tolerance, and map the complete normalized Source domain so the projection no longer creates top/bottom dead bands.
- Opening, focusing, minimizing, and restoring continue to preserve world geometry; focus changes only active state, z-order, texture restore state, and route synchronization.
- Per user direction, only focused projection/curve/input/layout/session tests and platform-web Vue type-check are run for this pass. The complete Spatial suite, build, production scan, independent check, commit, and archive are intentionally skipped.

## Final Phase 2.2 review fixes

- `SpatialWindowSession.close()` now re-resolves a window after an asynchronous guard, preventing repeated close requests from splicing a stale index and removing a sibling window.
- The shared viewport controller excludes released/restoring sources from projected hit ownership until a valid recapture is uploaded, so minimized windows cannot leave invisible input dead zones.
- Released-source intent now survives source-registration timing and source synchronization; restore keeps input disabled until `onSourceReady` confirms a valid upload.
- Spatial shell sizing no longer forces a 1024×640 border box that could mask a real viewport shrinking below the eligibility threshold.
- Settled ambient frames no longer rewrite identical Source layout styles, preserving the foundation's dirty-upload boundary while particle animation continues.
- Neutral boot catches host/config/shell-selection failures and enters RetroOS with an explicit error instead of remaining indefinitely on the boot surface.
- Regression coverage now includes repeated asynchronous close, released-source input isolation, all eight projected resize handles, the exact RetroOS launcher ID set, and the closed production selection gate.

## Automated evidence (2026-08-01)

- `npm test -- --run apps/platform-web/src/spatial`
  - PASS: 20 test files, 94 tests.
- `npm test -- --run apps/platform-web/src/config apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/composables/useDesktopWindows.test.ts`
  - PASS: 5 test files, 23 tests.
- `npm test -- --run apps/platform-web/src/spatial apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/config apps/platform-web/src/composables/useDesktopWindows.test.ts`
  - PASS: 25 test files, 117 tests.
- `npm run lint --if-present`
  - PASS/N/A: exit code 0; this repository defines no lint script or linter configuration.
- `npm exec vue-tsc -- -b apps/platform-web/tsconfig.json`
  - PASS: exit code 0, no diagnostics.
- `npm run build:web`
  - PASS: 3140 modules transformed; production build completed in 22.72s.
  - Rollup reported the repository's existing large-chunk, mixed static/dynamic import, and `@vueuse/core` annotation warnings; no build error.
- Production scan over emitted `.js`, `.css`, and `.html` plus emitted filenames for `spatial-lab|SpatialInteractionLab|SpatialDesktopShell|data-spatial-source|texElementImage2D|Spatial Foundation|SPATIAL WORKSPACE|spatial-desktop-shell`
  - PASS: `NO_PRODUCTION_SPATIAL_SHELL_OR_LAB_MARKERS`.
- `git diff --check`
  - PASS: exit code 0. Git printed LF-to-CRLF working-copy notices only.
- `git diff --no-index --check` over the 31 untracked files in the active task and affected platform-web source surface
  - PASS: no whitespace errors; LF-to-CRLF working-copy notices only.

## Browser-only gates still required

No browser automation was used in this review. The archived foundation's Flag-enabled browser acceptance remains valid evidence for the engine baseline, but the product shell and extracted shared controller still require a target Chromium pass covering:

- Development mode save-then-reload in both directions, hash preservation, fresh session creation, and clean fallback without rewriting the saved preference when the Flag/API, WebGL2, fine pointer, or minimum viewport is unavailable.
- Direct Canvas-child launcher/status/window capture, source orientation, stationary multi-window focus, ordinary content scrolling without window resizing, and projected controls/drag/eight-way resize at the center and horizontal/vertical curve edges.
- Default 1114×778 opening scale at 1920×1080, shallow bi-axial curvature, complete top/bottom Source coverage without projection-created transparent bands, and visual/input alignment at all four edges.
- Keyed DOM-state preservation through focus and minimize, texture release, restore-before-visible recapture, route synchronization, and before-close veto behavior.
- Keyboard launcher entry, F6 traversal, minimize/close commands, visible focus, text input/caret/Chinese IME, reduced-motion invariance, DPR/viewport resize, and context loss/restore.
- The existing Spatial interaction lab matrix after controller extraction: center/edge click, text/IME, picker, drag/resize, scroll, dirty upload/resource cleanup, and context restore.

Production Spatial exposure remains compile-time closed.
