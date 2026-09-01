# Spatial Rendering and Input Foundation Implementation Plan

## Preconditions

- Parent `07-31-html-in-canvas-platform-ui` planning is approved.
- This child is already `in_progress`; Steps 1–10 describe the existing foundation and the remaining hardening/visual iteration.
- The revised background/API plan requires a fresh user approval before the next implementation turn.
- Implementation uses the curated context and official-repository audit. During visual iteration, do not automate browser inspection; the user performs visual acceptance.
- Run only focused Spatial tests and platform-web type-check while iterating. Broader build/integration checks wait until visual acceptance and final handoff.

## Step 1 — Dev Lab Isolation and Experimental Types

- [ ] Add `spatial-lab.html` and `src/spatial/lab/main.ts` as a standalone Vite development entry.
- [ ] Add a minimal lab Vue root and diagnostics panel without importing platform boot, router, storage, or RetroOS shell.
- [ ] Narrow experimental declarations to the current WebGL2 optional-config shape; keep six-argument legacy as a private adapter type.
- [ ] Implement WebGL2 + RGBA8 capability acquisition with structured supported/unsupported result and `unresolved/current/legacy` diagnostics; remove WebGL1 and compact negotiation.
- [ ] Remove `UNPACK_FLIP_Y_WEBGL` reliance and verify texture orientation through UVs in the flagged browser.
- [ ] Verify ordinary production build does not emit lab HTML or a lab-only entry chunk before proceeding.

Validation:

```powershell
npm run build:web
Get-ChildItem apps/platform-web/dist -Recurse | Select-String -Pattern "spatial-lab"
git diff --check
```

Review gate:

- no experimental member cast appears outside the adapter;
- no production route/App branch exists;
- RetroOS build output remains unchanged except shared engine chunks only if imported (it should not be yet).

## Step 2 — Projection Math and Tests

- [ ] Define one immutable `CurveProjectionConfig` shared by CPU math and shader uniform setup.
- [ ] Implement forward/inverse cylindrical functions.
- [ ] Implement viewport/Canvas CSS/NDC/pre-distortion conversions.
- [ ] Implement parallax forward/inverse order.
- [ ] Define numerical tolerance and out-of-domain results as discriminated unions, not NaN propagation.
- [ ] Add dense center/edge/grid round-trip tests at DPR 1/2 and multiple aspect ratios.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial/engine/projection.test.ts apps/platform-web/src/spatial/engine/input/coordinates.test.ts
```

Review gate: no rendering implementation proceeds until inverse tests prove the same curve parameters round-trip across the full intended visible domain.

## Step 3 — WebGL Resource and Program Core

- [ ] Implement focused shader compile/link helpers with typed failures and complete cleanup.
- [ ] Implement a context-bound resource registry for shaders/programs/buffers/textures/framebuffers.
- [ ] Implement scene framebuffer creation/resizing and final output quad.
- [ ] Add context-lost/restored lifecycle and typed fake-GL unit coverage.
- [ ] Reuse concepts from play-frontend WebGL code only through clean platform-local implementation; do not import across apps.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial/engine/resources.test.ts apps/platform-web/src/spatial/engine/gl-program.test.ts
npm run build:web
```

## Step 4 — HTML Element Texture Registry

- [ ] Build the `layoutsubtree` Canvas with three direct-child source surfaces.
- [ ] Implement element registration, texture allocation/configuration, current/temporary-legacy upload adapter, dirty generations, and deletion.
- [ ] Normalize paint `changedElements` plus feature-detected `removedElements`; retain explicit source synchronization while draft/runtime surfaces differ.
- [ ] Reject and diagnose disconnected, no-longer-direct-child, `display:none`, and zero-box sources instead of retrying them as forced 1×1 textures.
- [ ] Implement add/remove and texture-release/recapture lab controls.
- [ ] Display upload count, active texture count, selected API variant, and last failure.
- [ ] Verify a source text/form change appears in the next valid frame and does not trigger unrelated uploads.

Browser gate:

- one source changes -> one texture upload;
- source removal deletes texture;
- release/restore retains DOM form value and recaptures visual state;
- no upload happens before a valid snapshot without a visible diagnostic.

## Step 5 — Independent Environment and Curved Desktop Composite

- [ ] Make Canvas and input plane cover the complete viewport; keep desktop safe margins in scene geometry.
- [ ] Render the static wallpaper-ready base and procedural particle field directly to the default framebuffer, without cylindrical distortion.
- [ ] Use a simple base-provider boundary that currently supplies a static procedural field and can later supply image/animated-image/video textures without coupling to wallpaper storage/UI.
- [ ] Implement two or three sparse procedural particle bands with passive drift, twinkle, and distinct parallax weights; no cursor attraction, repulsion, or trails.
- [ ] Render only HTML source quads and surface-local accents to a transparent framebuffer.
- [ ] Curve and alpha-composite that surface over the environment; output transparent alpha outside the curved desktop.
- [ ] Remove the old fixed grid/room treatment and keep steady-state text free of multisample bloom.
- [ ] Verify extreme edges remain visible and inside the inverse domain while the background remains uncurved.

Browser gate:

- reference-like shallow cylindrical silhouette;
- center low distortion and edges clearly recede;
- media base/particle bands/curved desktop parallax are separately perceptible without visual noise;
- replacing the static base provider would not require changes to projection or input modules;
- reduced motion snaps/shortens motion without changing final geometry.

## Step 6 — Event-Driven Frame Scheduler and Metrics

- [ ] Implement independent frame reasons and one queued rAF.
- [ ] Integrate dirty uploads, parallax easing, short transitions, resize, and restore reasons.
- [ ] Add a `particles` reason that runs only while visible; reduced motion freezes it. Reserve `animated-background` for future media without dirtying HTML textures.
- [ ] Stop scheduling when settled.
- [ ] Add CPU frame timing, frame count, upload count, texture count, and disposal metrics.
- [ ] Add unit tests for dedupe, continuation, stop, reduced-motion snap, and unmount cancellation.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial/engine/frame-scheduler.test.ts apps/platform-web/src/spatial/engine/metrics.test.ts
```

Browser gate: particle frames may continue while visible, but source/background upload counters remain unchanged; when particles freeze or the page hides, frame counters also settle.

## Step 7 — Input Capture, Target Resolution, and Hover

- [ ] Expand the trusted transparent input plane to the full viewport.
- [ ] Map pointer coordinates through inverse curve/parallax to planar client coordinates.
- [ ] Resolve `elementsFromPoint` candidates while excluding the capture plane/helpers and enforcing source ownership.
- [ ] Implement hover chain transitions with mapped client coordinates.
- [ ] Show trusted, curved, planar, source, and target diagnostics in the lab.
- [ ] Add overlapping/clipped/nested target scenarios on left/center/right surfaces.
- [ ] Stop recentering when the pointer leaves the curved desktop domain; reset only on window blur, document hiding, or explicit reset.
- [ ] Separate geometric hit eligibility from activation/accessibility policy: `aria-hidden`, `aria-disabled`, and native disabled do not erase geometry; hidden/visibility/pointer-events exclusions still do.
- [ ] Add tests for ownership mismatch, no-hit, disabled activation suppression, aria state, pointer-events/visibility exclusion, z order, full-screen edge movement, and blur/visibility reset.

Browser gate: visible targets at center and both extreme edge bands resolve to their own DOM ids with no systematic offset.

## Step 8 — Activation, Pointer Capture, Drag/Resize, and Scroll

- [ ] Implement pointer/mouse activation sequence and focus behavior while reporting synthetic delivery separately from verified native state mutation.
- [ ] Implement per-pointer logical capture on the real capture plane.
- [ ] Add draggable and eight-handle resizable lab elements.
- [ ] Implement contextmenu and double-click.
- [ ] Implement scroll-target resolution, clamped scroll mutation, and event emission.
- [ ] Compare dispatch helpers with inspector code. Extract only a neutral shared helper if both callers can use it without domain leakage; otherwise document the distinct contracts.
- [ ] Add router state-machine and scroll-clamp tests.

Browser gate:

- drag/resize continues after leaving target bounds;
- cancel releases operation;
- right-click opens the mapped source menu;
- nested scroll changes only intended container;
- curved edges behave the same as center.

## Step 9 — Native Controls and Keyboard/Accessibility

- [ ] Add all PRD control types to each edge/center test surface.
- [ ] Verify click/change/input events and visible state projection.
- [ ] Focus native text fields and verify keyboard editing and Chinese IME composition.
- [ ] Verify checkbox/radio/range behavior and implement the narrowest control adapter only where browser default activation fails.
- [ ] Use the captured custom listbox as the themed select; keep native select/file picker as explicit development escape probes through synchronous trusted-handler `showPicker()`/fallback.
- [ ] Verify contenteditable caret/selection and text input caret placement; remove proportional-character approximation or report unsupported.
- [ ] Verify range state rather than assuming horizontal LTR behavior covers every orientation.
- [ ] Verify Tab/Shift+Tab/Enter/Space/Esc and focus-visible capture.
- [ ] Verify semantic labels/roles remain visible to accessibility inspection.
- [ ] Add explicit lab result rows for every control; unsupported is failure, not skip.

Browser gate: the full native-control matrix passes in the selected Chromium/Flag environment before this child can finish.

## Step 10 — Resize, Context Restore, and Teardown

- [ ] Add ResizeObserver and DPR/texture limit policy.
- [ ] Distinguish display DPR/device-pixel backing from the local 2× supersampling floor in metrics and tests.
- [ ] Test CSS size/device-pixel/internal-raster transitions without projection drift or aspect-ratio distortion.
- [ ] Add a development context-loss trigger using the available debug extension when present.
- [ ] Recreate programs/buffers/framebuffer/textures and dirty all sources on restore.
- [ ] Ensure Vue unmount disconnects observers/listeners, stops rAF, clears pointer capture, and deletes resources.
- [ ] Add/remove sources repeatedly while checking metrics for stable texture/resource counts.

Browser gate:

- DPR 1/2 and viewport resize preserve hit accuracy;
- context restore recovers current DOM state;
- repeated create/remove/release/restore does not grow live resource counts.

## Step 11 — Focused Acceptance and Final Quality Gate

- [ ] During visual iteration, run only affected Spatial unit tests and platform-web `vue-tsc`; do not automate browser visuals.
- [ ] Obtain user manual acceptance for the background, full-screen parallax, curve/input alignment, and hidden diagnostics behavior.
- [ ] After manual acceptance, run the focused complete Spatial suite, platform-web type-check, `git diff --check`, and the smallest production-build check needed to prove no lab artifact is emitted.
- [ ] Execute and record the user-driven real-browser matrix from PRD.
- [ ] Verify existing RetroOS startup/routes still work.
- [ ] Update platform-web specs only after implementation proves stable contracts; do not document speculative APIs.
- [ ] Commit and archive the child only after all acceptance criteria pass.

Commands:

```powershell
npm test -- --run apps/platform-web/src/spatial
npm run build:web
git diff --check
```

## Rollback Points

- Steps 1–2: remove isolated dev entry/types/math.
- Steps 3–6: remove engine modules; no product import exists.
- Steps 7–10: remove lab/input modules; production shell remains untouched.
- If HTML-in-Canvas cannot satisfy native-control or edge-input requirements, mark the child blocked with browser evidence and return to parent design. Do not proceed to a visually convincing but noninteractive Shell.
