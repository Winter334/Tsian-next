# Spatial Rendering and Input Foundation Design

## 1. Deliverable

Build a development-only interaction laboratory and reusable framework-neutral engine modules that prove four contracts before any product shell work:

1. real direct-child HTML can be uploaded into WebGL textures;
2. the resulting scene can present a shallow continuous curved screen with layered parallax;
3. every visible pointer position can be mapped back to the correct source DOM target;
4. the engine can idle, resize, lose/restore context, and dispose resources without leaking or polling continuously.
5. the full-screen background can remain independent from the curved desktop, animate lightweight particles, and later accept image/animated-image/video media without changing the HTML texture or input architecture.

The lab is the deliverable. It is not a mockup and not a partial Spatial Desktop product entry.

## 2. Source Shape

Recommended files:

```text
apps/platform-web/
  spatial-lab.html                         # Vite dev entry, not a production input
  src/spatial/
    engine/
      html-in-canvas-types.d.ts            # narrow experimental declarations
      capabilities.ts                      # context/API acquisition and variant
      gl-program.ts                        # compile/link/buffer helpers
      element-textures.ts                  # direct-child texture upload/dirty/dispose
      projection.ts                        # curve and inverse curve math
      scene.ts                             # window quads and three visual layers
      renderer.ts                          # framebuffer + scene + final pass
      frame-scheduler.ts                   # dirty/animation/event-driven rAF
      resources.ts                         # context-bound registry and teardown
      metrics.ts                           # dev counters/timings
      input/
        coordinates.ts                     # viewport -> curved -> planar mapping
        target-resolver.ts                 # elementsFromPoint ownership resolution
        pointer-router.ts                  # hover/click/capture/context sequences
        native-controls.ts                 # focus, picker, scroll, caret escapes
      shaders/
        scene.ts
        curve.ts
        environment.ts
      *.test.ts                            # pure math/state/resource tests
    lab/
      main.ts
      SpatialInteractionLab.vue
      LabSurface.vue
      lab.css
```

One file owns one responsibility. `SpatialInteractionLab.vue` wires the engine and renders test surfaces; it does not contain shader source, matrix math, event dispatch, or resource management.

## 3. Development-Only Entry

Use `apps/platform-web/spatial-lab.html` as a standalone Vite development entry pointing to `src/spatial/lab/main.ts`.

- Do not add an ordinary platform route or condition inside `App.vue`.
- The default production build continues to use only `apps/platform-web/index.html`.
- Validation must inspect `apps/platform-web/dist` and fail if `spatial-lab.html` or a lab-only entry chunk is emitted.
- Engine modules are production-capable and may be included later by the Shell child; lab modules remain local tooling.

This keeps the proof environment isolated from RetroOS boot, platform initialization, user data, and route state.

## 4. Experimental API Adapter

All nonstandard APIs live behind `capabilities.ts` and `element-textures.ts`.

```ts
interface HtmlInCanvasCapabilities {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  apiVariant: "unresolved" | "current" | "legacy"
  requestPaint(): void
  setPaintHandler(handler: (payload: {
    changed: readonly Element[]
    removed: readonly Element[]
  }) => void): () => void
  uploadElement(
    texture: WebGLTexture,
    element: Element,
    size: { width: number; height: number },
  ): void
}
```

Rules:

- Require a WebGL2 context with alpha and antialiasing. WebGL1 is not a current official path.
- Validate `layoutSubtree`, `requestPaint`, paint events, and `texElementImage2D` at the adapter boundary.
- Use the current official call `(TEXTURE_2D, RGBA8, element, { width, height })`. Keep the old six-argument call only as a temporary private legacy fallback; do not probe or declare the unsupported two-argument compact form.
- Do not rely on `UNPACK_FLIP_Y_WEBGL` for element orientation. The current WebGL draft allows element uploads to ignore unpack pixel-store state; orientation is verified through the source UV convention in the flagged browser.
- Normalize `changedElements` and feature-detected `removedElements` into one adapter payload. Explicit source synchronization remains the fallback while upstream removal IDL differs across drafts.
- Report `apiVariant="unresolved"` until an upload has actually selected current or legacy behavior.
- Missing capability returns a structured unsupported result rendered by the lab; it does not throw from arbitrary Vue lifecycle code.
- No `any` leaves the adapter. The declaration file augments only the exact experimental members consumed here.
- WebGPU and worker capture are outside this child.

## 5. DOM and Canvas Structure

```html
<div class="spatial-lab-root">
  <canvas class="spatial-canvas" layoutsubtree>
    <section data-spatial-source="left">...</section>
    <section data-spatial-source="center">...</section>
    <section data-spatial-source="right">...</section>
  </canvas>
  <div class="spatial-input-plane"></div>
  <aside class="spatial-lab-diagnostics"></aside>
</div>
```

- Each `section` is a direct canvas child and owns real controls.
- Source sections are CSS-positioned in the pre-distortion planar scene and participate in layout/hit testing/accessibility.
- The Canvas output is visually authoritative.
- Canvas and the transparent input plane cover the complete viewport. The curved desktop's safe margin is scene geometry, not a CSS gap around either element.
- The transparent input plane sits above Canvas/source hit regions and receives trusted pointer/wheel/contextmenu input across the full viewport.
- Diagnostics stay outside the visual scene and are explicitly lab-only. The drawer is inert and hidden by default; local development opens it through `Ctrl+Shift+D` or an explicit URL parameter instead of a permanent on-screen button.

The source elements are not `inert`. The input plane is skipped by mapped `elementsFromPoint` resolution.

## 6. Curve Projection

Use one analytic horizontal cylindrical projection in both GLSL and TypeScript. Avoid a generic barrel polynomial that requires unstable numerical inversion.

Normalized pre-curve coordinate `p = (x, y)` where both axes are `[-1, 1]`:

```text
theta = x * maxAngle
depth = (1 - cos(theta)) / (1 - cos(maxAngle))
curvedX = tan(theta) / tan(maxAngle)
verticalScale = mix(minCenterScale, 1, depth)
curvedY = y * verticalScale
```

Inverse:

```text
theta = atan(curvedX * tan(maxAngle))
x = theta / maxAngle
depth = (1 - cos(theta)) / (1 - cos(maxAngle))
verticalScale = mix(minCenterScale, 1, depth)
y = curvedY / verticalScale
```

The exact visual signs/edge scaling may be tuned in the lab, but the TypeScript and GLSL functions must share one parameter object and match within declared tolerance.

- Central distortion remains low.
- Tangent horizontal projection plus a center-recessed vertical scale creates the inward-concave panorama: the center is visually farther/smaller and the side wings approach the viewer.
- Out-of-domain inverse coordinates resolve to no hit.
- Pointer-driven parallax is applied before the final curve and is inverted in reverse order.

## 7. Rendering Pipeline

### 7.1 Source textures

`ElementTextureRegistry` maps one direct child element to one WebGL texture and state:

```ts
interface ElementTextureRecord {
  element: Element
  texture: WebGLTexture | null
  width: number
  height: number
  released: boolean
  dirty: boolean
  generation: number
}
```

- `paint.changedElements` marks matching records dirty.
- Feature-detected removed entries and explicit source synchronization delete matching textures immediately. Disconnected, non-direct-child, `display:none`, or zero-box sources are diagnosed rather than retried as forced 1×1 textures.
- Newly registered/restored records start dirty.
- Upload happens once per dirty generation before scene draw.
- Removing a source deletes its texture immediately.
- A minimize-style lab action deletes only the texture, retains DOM, and keeps the record explicitly released so later paint events or context restoration cannot silently recreate it; explicit restore recreates and recaptures it.

### 7.2 Full-screen environment pass

Render the environment directly to the default framebuffer before the curved desktop. It never passes through the cylindrical projection.

- A stable base provider supplies the wallpaper/media plane. The foundation implementation uses a static procedural color field; a texture frame carries the standard WebGL texture plus intrinsic media size so cover UVs preserve aspect ratio. The boundary later accepts image, animated-image, or video providers without importing wallpaper selection/storage concerns.
- The media plane uses cover sizing plus a small overscan margin so tiny parallax UV offsets never reveal an edge.
- A procedural GPU particle overlay provides two or three sparse depth bands. Particles drift passively, twinkle slowly, and apply different parallax weights; they do not chase, repel from, or trail the pointer.
- Remove the current high-density floor grid, framing rails, and fixed architectural scene. The media base remains the visual subject and particles remain replaceable decoration.
- Static media is uploaded once. A future dynamic provider advertises its own frame demand instead of marking HTML textures dirty.

### 7.3 Curved surface pass

Render only source window quads and surface-local accents to a transparent RGBA framebuffer:

- source windows use normal parallax weight and stable z order;
- the framebuffer clears transparent outside the desktop surface;
- straight-alpha source outputs use separate RGB/alpha blend factors so the intermediate stores premultiplied RGB with mathematically correct alpha;
- text remains sharp: no steady-state multisample bloom over the source texture;
- cyan, blue, white, and limited orange color blocks supply hierarchy without heavy borders.

### 7.4 Composite pass

The final curve shader samples the transparent surface framebuffer, applies the analytic curve, and alpha-composites it over the already-rendered environment.

- Pixels outside the curved desktop output transparent alpha instead of an opaque ambient color.
- The curve pass converts the premultiplied intermediate back to straight color for treatment, then alpha-composites once; it must not multiply source or edge alpha a second time.
- Very light RGB separation is allowed only during a triggered transition; no continuous glitch or glow is applied to form text.
- Future wallpaper replacement changes only the environment base provider. It does not alter the curve shader, source registry, projection math, or input routing.

## 8. Frame Scheduler

`FrameScheduler` tracks independent reasons:

```ts
type FrameReason =
  | "dirty"
  | "camera"
  | "parallax"
  | "transition"
  | "particles"
  | "animated-background"
  | "animated-source"
  | "restore"
```

- `request(reason)` schedules one frame if stopped.
- A frame returns whether each reason remains active.
- The loop stops when no reason remains and no texture is dirty.
- Pointer parallax eases to a target and releases its reason at epsilon.
- Passive particles keep only the `particles` reason active while the document is visible. Page hiding pauses their frames; reduced motion freezes them at a stable composition.
- A static background never owns `animated-background`. Future animated image/video providers may own that reason without dirtying source HTML textures.
- Reduced motion snaps camera/parallax state and never starts long easing loops.
- Metrics expose frame count, active reasons, CPU frame time, upload count/bytes estimate, texture count, and disposal count.

Idle acceptance distinguishes meaningful visual animation from resource churn: with particles enabled, frame count may advance while upload count remains fixed; with particles frozen/disabled, both counters stop after state settles.

## 9. Projected Input Architecture

### 9.1 Coordinate mapping

`coordinates.ts` converts trusted input-plane `clientX/clientY` through:

1. viewport/client coordinate to Canvas CSS coordinate;
2. Canvas CSS coordinate to normalized curved coordinate;
3. inverse curve;
4. inverse parallax/camera transform;
5. pre-distortion planar client coordinate.

Every transformation has a pure forward/inverse test.

The input plane covers the full viewport. Leaving the curved desktop's visual domain clears the routed DOM hover target but preserves the current parallax target. Parallax returns to center only on window blur, document hiding, or an explicit reset; reduced motion performs that reset without easing. Blur and document hiding also dispatch logical pointer cancellation, release capture, and clear routed hover/active state.

### 9.2 Target resolution

`target-resolver.ts` calls `document.elementsFromPoint(mappedClientX, mappedClientY)` and selects the first element that:

- is not the input plane, Canvas, diagnostics, or an ignored helper;
- is inside a registered source root;
- is geometrically rendered/visible and not behind effective `pointer-events:none`;
- belongs to the topmost visually hit source window.

The visual window hit and DOM-source ownership must agree. A mismatch is a lab error, not an arbitrary fallback to another window.

Target resolution separates geometry from policy:

- `aria-hidden` changes accessibility exposure, not pointer geometry;
- `aria-disabled` is application semantics, not native disabled behavior;
- natively disabled controls may remain hover/geometric targets, but activation is suppressed after resolution;
- hidden/display-none/visibility-none/pointer-events-none candidates remain excluded.

### 9.3 Hover and activation

`PointerRouter` stores the current hover chain and dispatches leave/out then over/enter/move as the mapped target changes.

Activation sequence is application-owned synthetic routing:

- mapped pointerover/mouseover/enter/move;
- pointerdown/mousedown;
- focus if not canceled;
- pointerup/mouseup;
- target `.click()` or mapped click event when appropriate.

Delivery of a synthetic event is not proof that a trusted browser default action occurred. Diagnostics record routed delivery separately from verified state mutation, focus, caret, picker opening, or other native outcome.

Before extracting any common helper, compare this sequence to `frontend-inspector-dom.ts`. If both consumers can use the same low-level constructor/dispatch helper without importing domain errors or center-point assumptions, extract it to a neutral `lib/` module and update inspector tests in the same child. Otherwise keep the implementations distinct and document why they are not the same abstraction.

### 9.4 Pointer capture and drags

The input plane owns real browser pointer capture. The router maps each pointer id to its logical source target and operation until up/cancel. Subsequent motion remains routed even if projected coordinates leave the target.

The lab includes:

- a draggable element;
- eight resize handles;
- a range control;
- nested scroll region.

### 9.5 Wheel and scrolling

Resolve the nearest scrollable ancestor in the selected source. Apply clamped scroll delta directly, then emit a bubbling/composed `scroll` signal as required by existing Vue handlers. Do not assume synthetic WheelEvent default action scrolls.

## 10. Native-Control Escapes

The source DOM remains focused; keyboard/IME is never re-emitted through synthetic keyboard events.

- Text input/textarea: mapped pointer activates and focuses; selection/caret placement is verified in browser. Do not report proportional character-width approximations as native caret success; use a browser-proven narrow adapter or expose unsupported.
- Contenteditable: use mapped caret APIs/Selection when needed.
- The themed desktop select is a captured custom listbox. A separate development probe may test native select/picker behavior.
- Native select and picker-backed inputs: call `showPicker()` synchronously from the original trusted input-plane handler when supported; otherwise use the narrowest user-activation-safe fallback. The browser popup is intentionally flat/native and must expose `NotAllowedError`/unsupported outcomes.
- File input: the picker is a native escape; selected file metadata is shown in the captured source after change.
- Range behavior is verified as explicit state mutation; orientation, RTL, and vertical writing are not inferred from a horizontal approximation.
- IME: focus a real input/textarea and let the browser/OS own composition events. IME popup UI and distinctive IME formatting are intentionally excluded from captured pixels by the platform privacy model.
- Unsupported behavior is recorded as a blocking lab row with error details; it is never reported as success merely because focus changed.

## 11. Accessibility

- Source controls retain labels, roles, native semantics, and DOM focusability.
- Lab tab order is deterministic across left/center/right sources.
- A keyboard-only mode can focus every control without using the input plane.
- Focus-visible styles must appear in the uploaded texture after paint.
- Canvas has a concise accessible name but does not hide descendants.
- DOM semantics and keyboard focus remain real, but nonlinear curved visual geometry is not natively reflected in browser accessibility hit geometry; this limitation is documented rather than presented as upstream support.
- Reduced motion is sourced from `matchMedia("(prefers-reduced-motion: reduce)")` and can be overridden only by a lab control for testing.

## 12. Resize, DPR, and Resource Lifecycle

- Observe Canvas CSS size with `ResizeObserver`.
- Canvas backing size is derived from observed device pixels and clamped to `MAX_TEXTURE_SIZE`. Metrics distinguish the display DPR from the deliberate internal raster scale.
- The current lab may retain a 2× source/scene raster floor for text clarity on DPR1 displays; this is local supersampling policy, not an upstream HTML-in-Canvas DPR requirement.
- Each source texture preserves its border-box aspect ratio while fitting the chosen raster scale and `MAX_TEXTURE_SIZE`.
- Context loss prevents default destruction, stops the scheduler, and marks capabilities suspended.
- Context restore recreates shaders, buffers, framebuffer, textures, then marks all sources dirty.
- Component unmount removes listeners/observers/rAF, releases programs/buffers/framebuffers/textures, and clears registries.

## 13. Automated Tests

Vitest covers:

- curve/inverse round trips over a coordinate grid;
- center/edge tolerance and out-of-domain rejection;
- viewport/Canvas/NDC/planar mappings with CSS size vs device-pixel size;
- parallax inverse order;
- window/source ownership selection from projected candidates;
- hover-chain transitions;
- pointer capture state transitions and cancel;
- scroll clamping;
- dirty registry and generation handling;
- current WebGL2/RGBA8 upload selection, temporary legacy fallback, unresolved diagnostics, changed/removed paint normalization, and ineligible source handling;
- full-screen input behavior, no recenter at the curved-domain edge, blur/visibility reset, and reduced-motion reset;
- environment/surface/composite pass ordering, transparent curve exterior, stable static-background upload count, and particle frame-reason behavior;
- frame scheduler start/continue/stop/reduced-motion behavior;
- context resource registry release/recreate using a typed fake GL boundary.

Real browser verification remains mandatory for layoutsubtree, paint timing/snapshot latency, element orientation/upload, removed sources, elementsFromPoint, native pickers, IME, focus painting, full-screen edge input, and WebGL context lifecycle.

## 14. Failure and Rollback

- Unsupported/missing experimental APIs render a lab diagnostic with the missing capability.
- Shader compile/link/upload failures are recorded with stage and API variant.
- Projection disagreement or target ownership mismatch blocks the action and logs mapped coordinates/owners.
- No engine code is selected by `App.vue` in this child.
- Rollback is deletion of the isolated lab/engine modules; RetroOS and production build remain unchanged.
