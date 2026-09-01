# Spatial Foundation Evidence

## Parent Contracts

Source artifacts:

- `.trellis/tasks/07-31-html-in-canvas-platform-ui/prd.md`
- `.trellis/tasks/07-31-html-in-canvas-platform-ui/design.md`
- `.trellis/tasks/07-31-html-in-canvas-platform-ui/research/current-architecture-and-api.md`

This child proves the rendering/input substrate only. It must not add the UI-mode selector, production shell, platform app registry, or formal panel implementations.

## Repository Evidence

- `apps/platform-web` has no existing GPU renderer or dev-only route convention.
- `App.vue` always mounts RetroOS `DesktopShell`, so putting the lab behind an ordinary Vue route would still execute shell code and risk production coupling.
- Vite uses a single default `index.html` build entry. A separate `spatial-lab.html` can be served by Vite during development without being included in the default production build; the child must verify `dist/` contains no lab entry/chunk.
- `apps/play-frontend-dev/src/lib/shader.ts` demonstrates raw WebGL shader compilation, texture upload, DPR handling, alpha blending, and resource lifecycle patterns, but is coupled to the play frontend and must not become a platform dependency.
- `apps/platform-web/src/platform-host/frontend-inspector-dom.ts` contains proven pointer/mouse event ordering, focus/default activation, wheel/scroll handling, and state verification patterns. It is an inspector module, not a shared UI module.
- Current project tests use Vitest/Happy DOM. Projection math can be unit tested there; HTML-in-Canvas, native picker, IME, layout hit testing, and WebGL behavior require a real browser lab.

## API Boundary

The current explainer defines:

- `HTMLCanvasElement.layoutSubtree`, `onpaint`, `requestPaint`, `captureElementImage`, and `getElementTransform`;
- `CanvasRenderingContext2D.drawElementImage`;
- `WebGLRenderingContext.texElementImage2D`;
- `GPUQueue.copyElementImageToTexture`;
- `PaintEvent.changedElements` and transferable `ElementImage`.

Updated foundation decision after auditing `WICG/html-in-canvas` at commit `d4433e329697`:

- require WebGL2 and use `RGBA8`; the official WebGL example does not provide a current WebGL1 path;
- use `(TEXTURE_2D, RGBA8, element, optionalConfig)` as the current call and retain the old six-argument shape only as a temporary private fallback;
- remove the unsupported two-argument compact probe and do not rely on `UNPACK_FLIP_Y_WEBGL` for element orientation;
- isolate all experimental fields/methods in a narrow local adapter and declaration file;
- do not spread `any` casts through renderer/input/Vue code;
- do not add WebGPU or a third-party 3D engine in this child.

Detailed evidence and upstream caveats live in `research/official-repo-audit.md`.

## Hit-Plane Strategy

One nonlinear curved visual cannot be represented by a single CSS DOMMatrix. The foundation therefore separates:

1. **Source/hit plane** — the direct child DOM elements laid out and CSS-positioned in the pre-distortion planar scene.
2. **Visual scene** — element textures rendered as WebGL quads and then passed through the curved/lens shader.
3. **Input capture plane** — a transparent top-level pointer receiver.

Pointer resolution:

1. Convert viewport pointer coordinates to normalized device coordinates.
2. Apply the analytic inverse of the final curved/lens function.
3. Resolve the pre-distortion scene/window coordinate.
4. Use `document.elementsFromPoint(mappedX, mappedY)` and skip the input capture plane/non-owning surfaces.
5. Verify the chosen element belongs to the intended source window.
6. Dispatch the correct pointer/mouse sequence with mapped client coordinates.
7. Keep pointer capture in the input router so drag/resize/slider sequences remain bound after leaving the target.

This preserves browser layout, stacking, clipping, and descendant hit order instead of rebuilding them in a geometry index.

## Native-Control Policy

- Keyboard events are not synthesized. Once a source control is focused, ordinary browser keyboard/IME behavior owns input.
- `select` and file/color/date-like inputs use browser-native pickers through `showPicker()` or the narrowest user-activation-safe fallback from the original trusted pointer handler. The picker is an intentional native/flat surface.
- Pointer caret placement is tested through the mapped hit plane. `caretPositionFromPoint`/Selection may be used for contenteditable; input/textarea behavior requires a focused browser probe.
- Synthetic `wheel` does not reliably perform browser default scrolling, so the router owns scroll target selection, applies scroll deltas, and emits `scroll`, matching existing inspector precedent.
- Context menu behavior is application-owned in current platform surfaces; the router forwards `contextmenu` with mapped coordinates.
- Any unsupported native control must fail visibly in the lab and be documented as a native escape or blocker; no silent no-op is allowed.

## Rendering and Scheduling Policy

- `paint.changedElements` marks only owning element textures dirty.
- A frame uploads dirty textures before drawing.
- rAF runs while dirty, during camera/parallax/effect animation, or for a short idle-tail needed to settle transitions.
- When none of those conditions apply, the scheduler stops.
- DPR and maximum texture size are one engine policy. Initial probe matrix uses DPR 1 and 2.
- `webglcontextlost` cancels drawing without disposing browser-owned context state; restore recreates buffers/programs/textures and marks every source dirty.
- Closing/removing a source deletes its texture and registry entry. A minimize-style test releases texture while retaining source DOM, then recaptures on restore.

## Verification Shape

Automated:

- curve/inverse-curve round trips;
- screen/NDC/scene/window coordinate round trips;
- ray/quad intersection and UV bounds;
- center/edge error tolerance;
- pointer capture state machine;
- dirty scheduler start/stop;
- resource registry create/release/restore.

Real browser lab:

- all control types from child PRD;
- center and edge placements;
- nested clipping/z-order/overlap;
- text selection and Chinese IME;
- native select/file picker;
- scroll/pointer capture/context menu;
- DPR/resize/reduced motion/context loss;
- texture upload and frame metrics.
