# Research: Official HTML-in-Canvas Captured Pointer Routing

- Query: What does the current official `WICG/html-in-canvas` repository imply for the confirmed post-`beginResize` Spatial resize failure, especially pointer capture, move/up continuity, event targeting, and nonlinear routing?
- Scope: mixed
- Date: 2026-08-02

## Findings

### Concise conclusion

Upstream does not supply or demonstrate the captured-pointer routing used by Spatial. Current HTML-in-Canvas interaction relies on ordinary browser DOM hit testing after synchronizing an element's DOM/CSS transform with its canvas drawing. The WebGL example explicitly disables hit testing, and nonlinear WebGL/WebGPU hit testing remains an open design problem. There is no upstream example or contract for `setPointerCapture`, synthetic `pointermove`/`pointerup`, capture promotion, or continuing a custom gesture after manually remapping coordinates.

The user's visible diagnostic highlight proves the local path through projected Scene hit selection, DOM target resolution, `PointerRouter.down`, synthetic `pointerdown`, and `SpatialWindowSurface.beginResize`. No official upstream change alters that breakpoint. The next useful breakpoint is the first native `pointermove` received by the full-screen input plane at `viewport-controller.ts:714`, not another hit-test or pointerdown change.

### Current upstream state

- Current `main` HEAD remains [`d4433e329697c4341a9f915f75dbd9608f3939fa`](https://github.com/WICG/html-in-canvas/commit/d4433e329697c4341a9f915f75dbd9608f3939fa), committed 2026-07-14 12:31:29 -07:00. It is unchanged from the prior audit baseline; there are no post-baseline repository commits or merged changes to this area.
- The explainer opts canvas descendants into browser hit testing and says source CSS transforms continue to affect hit testing/accessibility even though capture ignores them: [`README.md` lines 27-39](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L27-L39).
- Its synchronization model is DOM-owned: update the real element's transform so its DOM location matches its drawn location, allowing ordinary hit testing, intersection observation, and accessibility geometry to work: [`README.md` lines 52-72](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L52-L72).
- The only official interactive example draws with Canvas 2D and applies the returned transform to `draw_element.style.transform`; it contains no custom router or pointer-capture code: [`Examples/text-input.html` lines 51-67](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/text-input.html#L51-L67).
- The official WebGL example marks its source `inert` specifically to prevent hit testing, so it proves nothing about WebGL pointer continuity: [`Examples/webGL.html` lines 25-42](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L25-L42).

### Issues and proposals

- [Issue #135](https://github.com/WICG/html-in-canvas/issues/135) rejects CSS transforms as sufficient for nonlinear mapping. The Chrome implementation direction discussed there is for the canvas/browser to track element boxes and forward events, not for authors to synthesize a pointer stream ([comment](https://github.com/WICG/html-in-canvas/issues/135#issuecomment-4847858842)).
- Post-baseline #135 discussion says a 3D scene may eventually use one canvas-global coordinate remapping function, after which normal browser hit testing would continue in CSS-box space ([2026-07-17 comment](https://github.com/WICG/html-in-canvas/issues/135#issuecomment-5007514034)). Debate continued over global versus per-element remapping and the amount of hit testing authors would otherwise need to reimplement ([2026-07-20 comment](https://github.com/WICG/html-in-canvas/issues/135#issuecomment-5024875338)). The thread moved precise custom hit testing into #148 on July 28 ([comment](https://github.com/WICG/html-in-canvas/issues/135#issuecomment-5110797615)). None of this is merged into the explainer.
- [Issue #140](https://github.com/WICG/html-in-canvas/issues/140) asks for a callback mapping canvas `(x, y)` to element-local `(x', y')`; it remains open with no comments or concrete pointer-capture semantics.
- [Issue #148](https://github.com/WICG/html-in-canvas/issues/148), opened 2026-07-28, explicitly says affine transforms cannot provide pixel-perfect nonlinear WebGL/WebGPU hit testing. Its rough `setHitTestHandler` design would return element ids and element-local coordinates, then let the browser's internal hit testing select the event target. It does not specify capture, move/up continuity, or synthetic dispatch.
- Earlier discussion likewise describes the current WebGL model as author-applied CSS transforms with ordinary browser event delivery, limited to one hit region ([issue #49 comment](https://github.com/WICG/html-in-canvas/issues/49#issuecomment-4099409706), [confirmation](https://github.com/WICG/html-in-canvas/issues/49#issuecomment-4099943566)). Issue #94 says current hit testing follows regular DOM ordering and that authors manage correspondence with canvas draw order ([comment](https://github.com/WICG/html-in-canvas/issues/94#issuecomment-4091776790)).
- No inspected official explainer, current example, or relevant issue discussion defines `setPointerCapture`, `gotpointercapture`/`lostpointercapture`, capture promotion, or synthetic `pointermove`/`pointerup` continuity. Spatial's router remains application-owned.

### Exact local pipeline after the confirmed breakpoint

1. `PointerRouter.down` dispatches synthetic down events, then promotes logical capture and asks the adapter for native capture (`pointer-router.ts:93-108`). The capture target is promoted from a `[data-spatial-gesture-start]` descendant to its `[data-spatial-gesture-owner]`, the window `<article>` (`viewport-controller.ts:673-677`; `SpatialWindowSurface.vue:11,75,90`).
2. Native capture is requested on the full-screen input plane, but any exception is swallowed and only logical capture remains (`viewport-controller.ts:678-683`). Logical capture cannot itself generate native move/up callbacks.
3. The first downstream native continuation point is the input-plane `pointermove` listener (`viewport-controller.ts:714-721`). It resolves against the captured target and immutable captured Scene projection (`viewport-controller.ts:896-989`), then `PointerRouter.move` dispatches synthetic move events to the promoted window owner (`pointer-router.ts:85-90`).
4. `dispatchDomEvent` preserves Source-local `clientX/clientY`, adds trusted screen coordinates as `spatialScreenClientX/Y`, and creates a synthetic `PointerEvent` with the original pointer id (`viewport-controller.ts:1117-1177`).
5. The window root owns `@pointermove="continueInteraction"` (`SpatialWindowSurface.vue:13-16`). `continueInteraction` requires an untrusted event with the same pointer id, computes incremental Source-local resize delta, and emits `resize` (`SpatialWindowSurface.vue:151-160,180-189,224-228`).
6. The shell forwards that delta through `session.resize` and refreshes Source layout/paint (`SpatialDesktopShell.vue:376-395`). The session passes it to `resizeSpatialGeometry` (`window-session.ts:151-166`).

This chain is internally plausible, but existing tests stop at isolated boundaries: `pointer-router.test.ts:65-92` proves a fake promoted owner receives move/up, while `spatial-window-style.test.ts:63-81` only checks Vue source strings. Neither proves native input-plane move delivery -> promoted DOM dispatch -> Vue `continueInteraction` -> session mutation.

### Narrowest next diagnostic

Set a debugger breakpoint at `apps/platform-web/src/spatial/engine/viewport-controller.ts:714`, the first native `pointermove` after the already-proven pointerdown. On the first drag movement inspect only:

- `pointer.pointerId` equals the id stored by `beginResize`;
- `inputPlane.hasPointerCapture(pointer.pointerId)`;
- `router.capturedTarget(pointer.pointerId)` is the window `[data-spatial-gesture-owner]`;
- `capturedSceneProjections` contains that pointer id.

Then step through `resolveInput` to `router.move` at line 719. This single breakpoint divides the remaining fault cleanly:

- not reached: native move/capture continuity is broken; the swallowed `setPointerCapture` failure at lines 678-683 is the first suspect;
- reached but no synthetic owner move: inspect capture promotion or `dispatchDomEvent` at lines 1155-1175;
- owner move reaches `SpatialWindowSurface.vue:151` but emits no nonzero delta: inspect pointer-id equality and Source-local `clientX/clientY` at lines 152 and 182-185;
- nonzero `resize` reaches `SpatialDesktopShell.vue:376`: the defect is below routing, in command availability/session geometry/layout refresh.

Do not change hit testing, target resolution, or pointerdown handling before this trace; the diagnostic target already falsifies those branches.

### Files found

- `.trellis/tasks/archive/2026-08/07-31-spatial-rendering-input-foundation/research/official-repo-audit.md` — prior full official-repository audit and baseline.
- `apps/platform-web/src/spatial/engine/viewport-controller.ts` — native input plane, capture adapter, captured projection, synthetic DOM dispatch.
- `apps/platform-web/src/spatial/engine/input/pointer-router.ts` — logical capture and synthetic pointer stream.
- `apps/platform-web/src/spatial/shell/SpatialWindowSurface.vue` — confirmed resize start and Source-local continuation/delta emission.
- `apps/platform-web/src/spatial/shell/SpatialDesktopShell.vue` — Vue event forwarding, session update, layout/paint refresh.
- `apps/platform-web/src/spatial/shell/window-session.ts` — resize session propagation.
- `apps/platform-web/src/spatial/shell/window-layout.ts` — final Source-local-delta geometry mutation.
- `.trellis/spec/platform-web/frontend/spatial-ui.md` — local contract that capture remains bound to one Source/pose and routed pointer events are synthetic.

### Related specs

- `.trellis/spec/platform-web/frontend/spatial-ui.md` — projected input order, stable capture, lifecycle cancellation, synthetic-event limits, and resize validation contract.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — isolate the first broken boundary in a multi-layer data flow.

## Caveats / Not Found

- GitHub REST API access was rate-limited, but the GitHub web commit history check succeeded and the parent independently verified current HEAD as `d4433e329697c4341a9f915f75dbd9608f3939fa`.
- No project tests, build, type-check, lint, or browser verification were run, per request.
- No product code or task artifacts other than this research file were modified.
- Upstream has no settled nonlinear hit-test API and no documented custom pointer-capture continuity contract to copy into Spatial.
