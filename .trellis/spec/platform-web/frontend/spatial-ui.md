# Spatial HTML-in-Canvas UI

## Scenario: Curved Interactive HTML Surface

### 1. Scope / Trigger

Use this contract when changing `apps/platform-web/src/spatial/**`, adding a Spatial desktop consumer, uploading DOM elements into WebGL, mapping pointer input through a nonlinear visual transform, or extending the wallpaper/environment pipeline.

HTML-in-Canvas is experimental and flag-gated. Keep its unstable API local to the adapter; product components consume framework-neutral engine contracts instead of calling browser extensions directly.

### 2. Signatures

```ts
type HtmlInCanvasApiVariant = "unresolved" | "current" | "legacy"

interface HtmlInCanvasPaintPayload {
  changed: readonly Element[]
  removed: readonly Element[]
}

interface HtmlInCanvasCapabilities {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  apiVariant: HtmlInCanvasApiVariant
  contextVariant: "webgl2"
  maxTextureSize: number
  requestPaint(): void
  setPaintHandler(handler: (payload: HtmlInCanvasPaintPayload) => void): () => void
  uploadElement(
    texture: WebGLTexture,
    element: Element,
    size: { width: number; height: number },
  ): void
}

type EnvironmentBaseFrame =
  | { kind: "procedural" }
  | { kind: "transparent" }
  | { kind: "texture"; texture: WebGLTexture; size: CssSize; coverOverscan?: number; flipY?: boolean }
  | { kind: "image"; source: TexImageSource; size: CssSize; version: number; coverOverscan?: number }

interface EnvironmentBaseProvider {
  frameDemand: "static" | "animated"
  frame(timestamp: number): EnvironmentBaseFrame
  subscribe?(listener: () => void): () => void
}

interface EnvironmentPostProcessingOptions {
  enabled: boolean
  maxDimension: number
  bloomScale: number
  bloomThreshold: number
  bloomSoftKnee: number
  bloomStrength: number
  bloomRadius: number
  chromaticSeparationPx: number
  vignetteStrength: number
  grainStrength: number
  atmosphericRefraction: { strengthPx: number; frequency: number; speed: number }
  decorationEnabled: boolean
}
```

Current upload call:

```ts
gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, element, { width, height })
```

The old six-argument call may exist only as a private temporary adapter fallback. Do not declare or probe the unsupported two-argument compact form.

### 3. Contracts

- Require WebGL2 and `RGBA8`. Do not fall back to WebGL1.
- `layoutSubtree` sources are direct Canvas children with a connected, non-zero rendered border box. A stale parent, `display:none`, disconnection, or zero box makes the source ineligible and releases its texture.
- Direct Canvas Source placement must use explicit pixel geometry derived from the real shell/canvas viewport and the Source's rendered size, then write an authoritative `translate3d`. Do not rely on percentage positioning, `right`/`bottom`, or `vh`/`vw` for shell Sources: the experimental layout subtree's CSS containing block is not reliable in the target Chromium implementation.
- Normalize `changedElements` and feature-detected `removedElements`. Explicit source synchronization remains required while upstream drafts/runtimes differ.
- Do not rely on `UNPACK_FLIP_Y_WEBGL`; element uploads may ignore unpack state. Own orientation once in the source-texture UV convention and verify it in the flagged browser.
- Upload during `paint` sees the current snapshot; a later upload may see the previous snapshot. `requestPaint()` is one-shot and an empty changed list only authorizes already-dirty initial/restore sources.
- Product render order is fixed: WebGL-owned wallpaper + particles into the bounded environment target; environment-only Bloom/composite to the default framebuffer; GPU decoration ring; sharp low-z clock Source; Dock Sources; independent window Sources back to front; foreground markers. No Source texture may enter an environment target or global post-process.
- Source input order is the reverse of painter order by the same scene z contract: highest-z windows resolve first, then lower-z shell background Sources. A Source that is visually occluded by a window must not steal the projected hit. Keep pointer capture bound to the selected Source/pose after pointer-down.
- Product window presentation is transient state separate from session geometry and mounted application state: `capturing-open -> opening -> visible`, `visible -> guard-pending -> closing -> removed`, `visible -> minimizing -> minimized`, and `minimized -> capturing-restore -> restoring -> visible`. Mount a new Source at final geometry but omit it from drawing until its first successful upload. Reopening or focusing an existing visible id never replays presentation. Minimize retains DOM/texture until its exact-once completion; restore waits for a valid replacement upload before animation.
- Every non-`visible` presentation phase is unavailable before projected candidate resolution. This exclusion also cancels a gesture captured before the phase changed; do not let pointer capture bypass lifecycle availability or add animated inverse math.
- Close requests coalesce while the async guard is pending. A veto restores `visible` without changing session, route, focus, DOM lifetime, or texture ownership. Approval retains DOM and the current Source texture through the final closing render; only its exact-once completion removes the window, forgets the guard, selects the next eligible focus, synchronizes the route, and releases the texture.
- Presentation snapshots cross the controller/renderer boundary as immutable per-Source data. Transition frames advance uniforms/mesh/particle draws only and do not encode progress in Source DOM, mark HTML textures dirty, or request repeated uploads. Aperture and particle-ripple entries progress independently under the existing `transition` frame reason.
- Curved-aperture and texture-sampled particle-ripple programs are optional and product-window-only. Stable windows, Docks, and the clock keep their prior shaders; the stable flat-neutral fragment output remains the captured texel exactly. Optional presentation-program failure uses immediate terminal semantics without failing the renderer or falling back the shell.
- Reduced motion uses duration zero and the same terminal callbacks. Context loss, optional-program loss, and motion cancellation snap opening windows visible and approved closing windows removed. Resize changes final geometry without restarting progress, and disposal cancels pending frames/callbacks before renderer teardown.
- A product static-image provider retains decoded CPU image data while the renderer owns the context-specific texture. Upload with explicit `LINEAR` filtering and `CLAMP_TO_EDGE`, preserve centered `cover` sampling, and recreate the texture after context restore. Load/upload failure remains transparent so the identical CSS image can serve only as startup/failure fallback; it must not force shell fallback by itself.
- Environment targets are independent of Source capture DPR, capped by both `maxDimension` and `MAX_TEXTURE_SIZE`, and consist of one environment color target plus one reusable reduced-resolution Bloom ping-pong pair. Check every framebuffer for completeness. Shader/target failure disables the optional effect chain and draws the base directly; never leave a half-initialized blank shell.
- Product effect options are opt-in at `SpatialDesktopShell`; generic renderer defaults remain procedural with effects and decoration disabled. Chromatic separation, Bloom, vignette, grain, and default-zero refraction sample environment textures only. Do not add backdrop/glass/global Source blur or a full-scene post-process.
- The wallpaper clock is a direct Canvas child Source at z=1 with `data-spatial-input="none"`. It repaints once per second and renders sharply after the GPU decoration and before z=10/11 Docks. The ring is a renderer-owned GPU pass, never a Source texture; reduced motion freezes ring, particles, grain, and refraction time while preserving their static frame.
- Missing or blank numeric Source pose metadata uses `DEFAULT_SURFACE_POSE`; never parse `getAttribute()` directly with `Number(...)`, because `Number(null) === 0` can turn an omitted `scale` into an invalid zero-scale pose and fail the renderer.
- Static wallpaper/media bases do not own a continuous frame reason. Particle animation and future animated media have independent frame reasons and never dirty HTML textures.
- Environment particles remain an independent straight-alpha pass with clamped output. Use discrete depth bands with mostly compact point cores and restrained halos. Product motion combines broad band drift with deterministic low-frequency flow and stable per-cell speed (`0.68–1.42×`), size (`0.78–1.24×`), phase and wobble variation; it must not read as a rigid translating grid. Bound each generated center by its effective halo radius so motion cannot be clipped at cell boundaries. Density, velocity and color may follow the active visual shell, but must not create a screen-filling fog layer or alter scheduler/reduced-motion/HTML-texture dirty contracts.
- Canvas and the input plane cover the viewport. Leaving the curved hit domain clears DOM hover but does not recenter parallax; blur, document hiding, or explicit reset may recenter it.
- Forward and inverse curve math share one immutable configuration. Any visual curve change must update CPU projection, GLSL, and round-trip tests together.
- Captured projection state owns plain `ClientRectLike` snapshots. Browser `DOMRect` / `DOMRectReadOnly` geometry may live on non-enumerable prototype accessors, so snapshot `left`, `top`, `width`, and `height` by explicit field reads; never freeze a browser rect with object spread. The pointer-down Source rect and viewport rect must remain valid for captured inverse mapping and screen-to-local differential construction.
- Product window pose comes only from `windowGeometryToPose()`. The accepted baseline is `curveBow = 0.032` (about 24.9 CSS px at the default 778px height) and one-sided horizontal/vertical edge gains of `0.17`: the viewport-facing inner edge remains 1.00 while only the outer edge reaches about 1.17. Do not tune renderer uniforms independently from CPU projection/inversion.
- Target resolution separates geometry from policy. `aria-hidden`, `aria-disabled`, and native disabled state do not erase hit geometry; activation policy suppresses disabled actions after resolution. Effective visibility and `pointer-events:none` remain geometric exclusions.
- Routed pointer/mouse events are synthetic. Report event delivery separately from verified native state changes, caret placement, picker opening, or IME behavior.
- Keep real source DOM semantics and keyboard focus. Native select/file/context-menu/IME top-layer UI is a flat browser escape; themed curved selects use captured custom listboxes.
- The obsolete `spatial-lab.html` and `src/spatial/lab/` surface do not exist. Product Spatial UI must not add a local diagnostics toggle/overlay to the right Dock; status text and typed fallback snapshots remain the engine observability boundary. Do not retain hidden Lab adapters, probe surfaces, dead Dock slots, or lab-specific capability messages.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| WebGL2, `RGBA8`, or `texElementImage2D` missing | Structured unsupported result; no WebGL1 fallback |
| Current upload succeeds | `apiVariant="current"` |
| Current call fails with a negotiable signature error and six-argument call succeeds | `apiVariant="legacy"` |
| Both upload shapes fail | Preserve/report the current-call failure; texture remains dirty |
| Source removed or disconnected | Delete texture and registry record deterministically |
| Source stale-parent, `display:none`, or zero-box | Diagnose ineligibility; do not retry as forced 1×1 |
| Pointer outside curved domain | No DOM hit; retain viewport parallax target |
| Captured projection receives browser `DOMRect` instances | Explicitly copy `left`, `top`, `width`, and `height`; captured inverse/differential must not observe missing or non-finite geometry |
| Window blur or document hidden | Release capture/hover and recenter according to reduced-motion policy |
| Native/ARIA disabled target hit | Preserve hover/geometry; suppress activation and report why |
| Synthetic event dispatched | Record delivery/cancellation; do not infer trusted native success |
| Reduced motion | Freeze particles and snap/reset movement without changing final hierarchy |
| Reduced motion with environment effects | Freeze particle/ring/grain/refraction time; keep the static final composition |
| Environment particle flow reaches a cell boundary | Keep the point core and halo inside the cell using radius-aware center bounds; no hard clipping/popping |
| Context restore | Recreate programs/buffers/environment targets/image texture, then mark eligible Sources dirty |
| Transparent environment frame | Clear RGBA to `0,0,0,0`, skip the environment-base draw, and retain particle/shell-background/window/foreground passes |
| Wallpaper image load/upload failure | Keep the renderer usable and transparent so the CSS fallback remains visible |
| Effect shader or framebuffer failure | Disable optional post-processing and use the direct environment path |
| Source omits pose metadata | Use `DEFAULT_SURFACE_POSE`; omitted attributes never become numeric zero |
| Window overlaps a lower-z shell Source | Draw and resolve input for the window first visually/front-to-back; the shell Source neither overlays nor steals the hit |
| Initial window Source upload fails transiently | Keep `capturing-open`, request a fresh paint snapshot, and retry without drawing a full or empty window |
| Close guard vetoes | Restore `visible`; no animation, session/route/focus/DOM/texture mutation |
| Reduced motion or optional presentation program unavailable | Reach the same final open/close state immediately through the normal completion path |
| Context loss during presentation | Snap opening to visible and finish approved closing exactly once before/while resources rebuild |
| Minimize/restore presentation unavailable | Complete minimize immediately after retaining semantic state; restore still waits for a valid texture, then becomes visible immediately |

### 5. Good / Base / Bad Cases

- Good: a direct Canvas child changes, only its texture uploads, the environment continues animating deterministic non-rigid particles, and curved edge input maps back to the same source control.
- Good: pointer-down snapshots browser Source/viewport rectangles into plain four-field geometry, and later captured moves continue producing non-zero Source-local deltas after the live DOM changes.
- Good: a shell Dock has lower scene z than every window, renders before windows, and is visited after windows during projected hit resolution.
- Good: a product image base is processed in bounded environment targets, then clock/Dock/window Source textures are drawn sharply afterward.
- Base: a static wallpaper base and frozen particles/ring settle without further frames or Source uploads; generic renderer consumers retain procedural rendering.
- Base: a failed wallpaper upload exposes the identical CSS fallback while the shell and Source compositor remain usable.
- Bad: applying one global curve composite to the environment and all Sources makes the wallpaper bend with the desktop.
- Bad: tuning curve/edge uniforms only in GLSL makes the rendered window diverge from CPU projection and projected input.
- Bad: preserving a hidden Lab page or local diagnostics overlay after product-shell adoption leaves an obsolete second UI/runtime contract.
- Bad: uploading the clock/ring every animation frame or placing any Source texture in the Bloom/composite chain softens text and breaks demand-driven uploads.
- Bad: filtering `aria-hidden` or disabled controls out of geometry causes clicks to fall through to an element underneath.
- Bad: focus or synthetic `.click()` alone is reported as proof that a caret, picker, or native default action succeeded.
- Bad: `{ ...element.getBoundingClientRect() }` appears valid with plain-object test fixtures but can produce an empty/partial runtime snapshot, forcing captured input into zero-delta extrapolation.

### 6. Tests Required

- Unit: WebGL2/current/legacy negotiation, unresolved state, paint changed/removed normalization, source eligibility/removal, and context restore.
- Unit: curve/inverse round trips, viewport/CSS/device-pixel mapping, full-screen parallax reset policy, target geometry/activation policy, pointer capture, and native outcome reporting. Captured projection coverage must include a DOMRect-shaped fixture whose geometry is exposed through non-enumerable prototype accessors; assert both rect snapshots retain all four fields and a moved captured screen point changes Source-local coordinates.
- Unit: environment/effects/decoration/clock/Dock/window/foreground pass order, reverse-z projected input order, default-pose parsing, transparent/image failure fallback, framebuffer lifecycle, media cover math, particle/reduced-motion scheduling, deterministic flow/size ranges, radius-bounded centers, and static Source upload counts.
- Unit: per-window presentation phase progression, first-upload gating/retry, concurrent progress, duration-zero completion, guard veto/coalescing, exact-once close/minimize/restore completion, captured-input exclusion, transition-only uniforms/draws, optional-program fallback, and context-loss/dispose settlement.
- Package: complete Spatial Vitest suite, platform-web Vue type-check, `npm run build:web`, and `git diff --check`.
- Production/source isolation: repository and output contain no `spatial-lab.html`, `src/spatial/lab/`, lab-named chunk, Spatial lab marker, local diagnostics overlay, or experimental API marker.
- Flagged browser: source orientation, center/edge hit alignment, native pickers, caret/IME, DPR/resize, paint/removal timing, context loss/restore, and manual visual acceptance.

### 7. Wrong vs Correct

#### Wrong

```ts
const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl")
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
gl.texElementImage2D(gl.TEXTURE_2D, element)
```

```ts
drawEnvironmentIntoSurfaceFramebuffer()
drawHtmlIntoSurfaceFramebuffer()
drawCurvedSurfaceToScreen()
```

#### Correct

```ts
const gl = canvas.getContext("webgl2")
if (!gl || typeof gl.texElementImage2D !== "function") return unsupported()
gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, element, { width, height })
```

```ts
drawWallpaperAndParticlesToBoundedEnvironmentTarget()
drawBloomPingPongFromEnvironmentOnly()
compositeEnvironmentToDefaultFramebuffer()
drawGpuDecorationRing()
drawClockAndDockSourcesBackToFront()
drawWindowsBackToFrontWithTheirOwnPoses()
drawForegroundToScreen()
```

```ts
// Wrong: Number(null) is 0, so an omitted scale becomes invalid.
const scale = Number(element.getAttribute("data-spatial-scale"))

// Correct: absent metadata retains the renderer's valid default pose.
const rawScale = element.getAttribute("data-spatial-scale")
const scale = rawScale === null || rawScale.trim() === ""
  ? DEFAULT_SURFACE_POSE.scale
  : Number(rawScale)
```

```ts
// Wrong: optional shader failure exposes an uncaptured Source immediately.
if (supportsWindowPresentation() && presentation.phase === "capturing-open") continue

// Correct: first-upload gating is unconditional; only animation is optional.
if (presentation.phase === "capturing-open") continue
if (supportsWindowPresentation() && sourcePresentationIsAnimated(presentation)) {
  drawPresentedSurface(presentation)
} else {
  drawStableFlatNeutralSurface()
}
```

```ts
// Wrong: pointer capture bypasses a later guard/closing exclusion.
const routedTarget = capturedTarget ?? resolveProjectedTarget()

// Correct: cancel an unavailable captured Source before projection/dispatch.
if (capturedTarget && sourceInputUnavailable(capturedSourceId)) {
  cancelCapturedInput()
  return noProjectedTarget()
}
```

```ts
// Wrong: DOMRect geometry is not guaranteed to be enumerable own data.
const capturedRect = { ...element.getBoundingClientRect() }

// Correct: cross the browser-host boundary through explicit plain data.
const rect = element.getBoundingClientRect()
const capturedRect: ClientRectLike = {
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
}
```

## Upstream Status

- Primary source: [WICG/html-in-canvas](https://github.com/WICG/html-in-canvas).
- The API is not standardized and Chromium implementations may lag or lead the explainer. Keep exact calls and compatibility handling inside `capabilities.ts`.
- Proposed descendant drawables, native nonlinear hit testing, sub-element texture updates, and WebGPU support are future work, not current contracts.
