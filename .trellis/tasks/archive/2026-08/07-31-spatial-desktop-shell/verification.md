# Spatial Desktop Shell Verification

## Per-window 2.5D compositor redirection (planning, 2026-08-01)

- Manual reference reconstruction showed that the continuous radial pass still made every window read as part of one transparent rubber sheet. The reference obtains suspension from independent panel curvature, depth, yaw/pitch, scale, occlusion, shadow and active/inactive treatment over a stable environment.
- The user approved replacing the global spherical target with per-Source shallow curved meshes and derived 2.5D poses. This is a planning redirection; the current radial implementation is retained only as rejected evidence until the revised plan receives final implementation approval.
- Full 3D camera navigation, depth physics, manual Z dragging and depth-of-field remain deferred. The MVP must reuse the existing independent Source textures, draw them separately, and provide exact per-surface input inversion.

## Rejected global spherical radial pass (2026-08-01)

- Per-window wheel resizing is fully removed: the session has no zoom state or command, the shell has no wheel interception policy, and Source layout scale now reflects side depth only. Wheel events continue through the existing projected Source-DOM scrolling path; background camera zoom remains deferred.
- New windows resolve a viewport-relative readable default while retaining app minimums and recovery margins. A 1920×1080 viewport opens at 1114×778, approximately 58%×72%; eight edge handles remain the only way to change dimensions.
- Live browser feedback rejected four intermediate shapes: the separable tangent map left every grid/window line straight, the first strong coupled profile produced an exaggerated pincushion/hourglass silhouette, the unequal signed-axis profile read as a concave/convex saddle, and the edge-reset radial profile produced wave-like borders as curvature reversed before the viewport perimeter. The supplied markup instead calls for one uninterrupted spherical arc.
- The current visual experiment uses `curvatureStrength=0.25` and the continuous sphere-root law `planar = curved * sqrt(1 - curvatureStrength * radiusSquared)`. CPU and GLSL apply the exact same scale to both coordinates from the center tangent through the screen edge; there is no central planar blend, square-edge reset, or inflection.
- The complete screen domain maps inward to Source coordinates, so the shader no longer creates projection-transparent top/bottom bands. The tradeoff is intentional bounded crop of the outermost Source perimeter/corners. CPU forward projection retains the bounded Newton solve with the exact sphere-root Jacobian, while focused tests cover visible-region round trips, quarter-turn symmetry, same-sign radial displacement, immediate monotonic convex curvature, positive Jacobian and full-screen inverse coverage at the renderer's parallax extrema.
- Opening, focusing, minimizing, and restoring continue to preserve world geometry; focus changes only active state, z-order, texture restore state, and route synchronization.
- Focused automated evidence:
  - `npm test -- --run apps/platform-web/src/spatial/engine/projection.test.ts apps/platform-web/src/spatial/engine/input/coordinates.test.ts apps/platform-web/src/spatial/engine/shaders/curve.test.ts apps/platform-web/src/spatial/engine/renderer.test.ts`
    - PASS: 4 files, 19 tests.
  - `npm exec vue-tsc -- -b apps/platform-web/tsconfig.json`
    - PASS: exit code 0, no diagnostics.
- Per user direction, only focused projection/coordinate/shader/renderer tests and platform-web Vue type-check are run for this pass. The complete Spatial suite, build, production scan, independent check, commit, and archive are intentionally skipped.

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
- Direct Canvas-child launcher/status/window capture, source orientation, stationary multi-window focus, ordinary content scrolling without window resizing, and projected controls/drag/eight-way resize across independently posed window surfaces.
- Default 1114×778 Source opening scale at 1920×1080 plus a reference reconstruction containing a central large window, side/rear window and lower overlapping window; verify independent local arcs, side recession/orientation, foreground occlusion, backing/shadow/rim depth, no global rubber-sheet deformation, and visual/input alignment at visible curved edges.
- Keyed DOM-state preservation through focus and minimize, texture release, restore-before-visible recapture, route synchronization, and before-close veto behavior.
- Keyboard launcher entry, F6 traversal, minimize/close commands, visible focus, text input/caret/Chinese IME, reduced-motion invariance, DPR/viewport resize, and context loss/restore.
- The existing Spatial interaction lab matrix after controller extraction: center/edge click, text/IME, picker, drag/resize, scroll, dirty upload/resource cleanup, and context restore.

Production Spatial exposure remains compile-time closed.
