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

function routedMouseEventDetail(
  type: RoutedPointerEventType,
  pointerDetail: number | undefined,
): number

interface SpatialShellMenuLayout {
  readonly width: number
  readonly height: number
  readonly x: number
  readonly y: number
}

function spatialShellMenuAnchorFromSourceClient(
  sourceRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  client: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number }

function spatialShellMenuLayout(
  viewport: { readonly width: number; readonly height: number },
  anchor: { readonly x: number; readonly y: number },
  itemCount: number,
): SpatialShellMenuLayout
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
- Mutation observation distinguishes registry changes from texture changes. Direct Canvas Source topology/eligibility and `data-spatial-dynamic-media` discovery/removal run full Source synchronization; descendant attributes, child/text changes and ordinary Vue updates dirty only their owning Source and request one paint batch. Do not run `syncSources()` for every subtree mutation: broad synchronization/paint requests can recapture unrelated changing Sources and produce visible flashes.
- Do not rely on `UNPACK_FLIP_Y_WEBGL`; element uploads may ignore unpack state. Own orientation once in the source-texture UV convention and verify it in the flagged browser.
- Upload during `paint` sees the current snapshot; a later upload may see the previous snapshot. `requestPaint()` is one-shot and an empty changed list only authorizes already-dirty initial/restore sources.
- Product render order is fixed: WebGL-owned wallpaper + particles into the bounded environment target; environment-only Bloom/composite to the default framebuffer; GPU decoration ring; sharp low-z clock Source; Dock Sources; independent window Sources back to front; foreground markers. No Source texture may enter an environment target or global post-process.
- Source input order is the reverse of painter order by the same scene z contract: highest-z windows resolve first, then lower-z shell background Sources. A Source that is visually occluded by a window must not steal the projected hit. Keep pointer capture bound to the selected Source/pose after pointer-down.
- Whenever modal input ownership changes, cancel any capture held by the previously active background or modal before accepting further routed events. A newly opened higher modal or newly revealed lower modal must not inherit an in-progress gesture merely because pointer capture normally stays bound to its original Source.
- A direct Canvas Source marked `data-spatial-render="none"` is input-only: keep it in Source geometry, projected hit resolution and z-order, but filter it out before dynamic-media discovery and `ElementTextureRegistry.synchronize()`. It must allocate, upload and draw no texture. Use this narrow escape for invisible modal input sinks; CSS transparency alone is insufficient because a full-screen transparent element snapshot can transiently upload or composite as black in the target Chromium implementation. `data-spatial-input="none"` is the inverse contract (drawable but not interactive) and must not be substituted. Input exclusion applies to both new hit resolution and a gesture captured before the attribute changed; the next routed event must cancel that capture instead of dispatching into the now-inert Source.
- Blank Spatial desktop interaction uses one full-viewport, low-z input-only Source. It catches background context-menu input behind every window/Dock without allocating a transparent texture; higher-z shell and window Sources remain authoritative for overlap hits.
- A shell context menu is a temporary direct Canvas Source owned by its desktop/launcher/status presentation, not an overflowing descendant of a narrow Dock Source and not a global menu service. Derive its anchor from routed Source-local `clientX`/`clientY`, clamp explicit pixel geometry to the real shell viewport, synchronize on mount/removal, and restore the connected opener on Escape. Document-capture outside-pointer handling defers the trusted input-plane `pointerdown` through one microtask: a later synthetic hit inside the menu Source cancels dismissal, a hit on the owner or any other Source closes immediately, and no projected target closes at the deferred fallback. This preserves menu-option targeting while still dismissing on blank desktop.
- Projected activation follows browser cancellation boundaries: canceling routed `pointerdown` suppresses activation; canceling only compatibility `mousedown` suppresses its focus default but still permits the later click and remains visible in delivery diagnostics. Routed cancellation must be re-entrant and release logical/browser capture exactly once.
- Compatibility mouse events normalize event-family semantics instead of copying every `PointerEvent` field verbatim. Browser `PointerEvent.detail` is normally `0`, while first-click `mousedown` / `mouseup` / `click` must expose `detail=1`; otherwise CodeMirror treats zero as a triple-click, selects the whole line, and the next typed character replaces it. Preserve positive click counts, use `2` for routed `dblclick`, and keep move/hover/context/wheel detail at `0`.
- Projected native scrollbar dragging is limited to real layout gutters and the reconstructed thumb. Derive track geometry from the element border/client boxes in Source-local client coordinates, reject overlay/no-gutter, disabled/non-overflowing, invalid, track-only, and RTL-horizontal cases explicitly, and keep Chromium scrollbar width plus arrow-button removal aligned with that geometry. A captured thumb drag clamps and emits scroll only on change, dirties only its owning Source, requests a fresh paint, never clicks on release, and is canceled by pointer/source/controller teardown.
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
- Trusted browser pointer events target the full-screen input plane, not the Source-local element selected by inverse projection. A Source component's document-level outside-pointer handler must ignore those trusted plane events and decide inside/outside only from the router-generated synthetic event (`isTrusted === false`). Closing a listbox during the trusted capture phase removes it from geometry before projected target resolution can hit its option.
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
| A captured Source changes to `data-spatial-input="none"` | Cancel capture on the next routed event; dispatch nothing further to that Source |
| Source stale-parent, `display:none`, or zero-box | Diagnose ineligibility; do not retry as forced 1×1 |
| Pointer outside curved domain | No DOM hit; retain viewport parallax target |
| Captured projection receives browser `DOMRect` instances | Explicitly copy `left`, `top`, `width`, and `height`; captured inverse/differential must not observe missing or non-finite geometry |
| Window blur or document hidden | Release capture/hover and recenter according to reduced-motion policy |
| Native/ARIA disabled target hit | Preserve hover/geometry; suppress activation and report why |
| Synthetic event dispatched | Record delivery/cancellation; do not infer trusted native success |
| Routed compatibility `mousedown` is derived from `PointerEvent.detail=0` | Normalize first-click mouse detail to `1`; do not expose zero to click-count consumers |
| Trusted input-plane `pointerdown` arrives while a Source-local popup is open | Do not run Source outside-close logic before inverse projection; the later routed synthetic event decides inside/outside |
| Reduced motion | Freeze particles and snap/reset movement without changing final hierarchy |
| Reduced motion with environment effects | Freeze particle/ring/grain/refraction time; keep the static final composition |
| Environment particle flow reaches a cell boundary | Keep the point core and halo inside the cell using radius-aware center bounds; no hard clipping/popping |
| Context restore | Recreate programs/buffers/environment targets/image texture, then mark eligible Sources dirty |
| Transparent environment frame | Clear RGBA to `0,0,0,0`, skip the environment-base draw, and retain particle/shell-background/window/foreground passes |
| Wallpaper image load/upload failure | Keep the renderer usable and transparent so the CSS fallback remains visible |
| Effect shader or framebuffer failure | Disable optional post-processing and use the direct environment path |
| Source omits pose metadata | Use `DEFAULT_SURFACE_POSE`; omitted attributes never become numeric zero |
| Window overlaps a lower-z shell Source | Draw and resolve input for the window first visually/front-to-back; the shell Source neither overlays nor steals the hit |
| Input-only Source is added or removed | Preserve its projected geometry and z-order while texture count, uploads and renderer surfaces remain unchanged |
| Pointer targets blank Spatial desktop | Resolve the low-z input-only desktop Source; no texture exists and an overlapping higher-z Source still wins |
| Shell menu opens from pointer or `Shift+F10` / Context Menu key | Mount one bounded direct menu Source, focus its first item, support arrow/Home/End/Escape, and restore the connected opener on Escape |
| Shell viewport changes while a menu is open | Remove the stale menu Source; do not retain coordinates derived from the old Source/viewport geometry |
| Trusted input-plane click produces no projected target while a shell menu is open | Close at the deferred post-projection fallback; do not leave the menu stuck on blank desktop |
| Initial window Source upload fails transiently | Keep `capturing-open`, request a fresh paint snapshot, and retry without drawing a full or empty window |
| Close guard vetoes | Restore `visible`; no animation, session/route/focus/DOM/texture mutation |
| Reduced motion or optional presentation program unavailable | Reach the same final open/close state immediately through the normal completion path |
| Context loss during presentation | Snap opening to visible and finish approved closing exactly once before/while resources rebuild |
| Minimize/restore presentation unavailable | Complete minimize immediately after retaining semantic state; restore still waits for a valid texture, then becomes visible immediately |

### 5. Good / Base / Bad Cases

- Good: a direct Canvas child changes, only its texture uploads, the environment continues animating deterministic non-rigid particles, and curved edge input maps back to the same source control.
- Good: a full-viewport modal sink marked `data-spatial-render="none"` blocks projected pointer/wheel/contextmenu behind the modal while creating no texture or draw surface.
- Good: a z=0 input-only desktop Source catches blank-area contextmenu while windows and Docks continue to win front-to-back hit resolution.
- Good: a narrow Dock opens a separately captured menu Source at a clamped Source-local anchor, then removes it and restores keyboard focus without leaving a frame reason.
- Good: pointer-down snapshots browser Source/viewport rectangles into plain four-field geometry, and later captured moves continue producing non-zero Source-local deltas after the live DOM changes.
- Good: a shell Dock has lower scene z than every window, renders before windows, and is visited after windows during projected hit resolution.
- Good: a Select ignores the trusted input-plane `pointerdown`, then keeps open for a routed option event or closes for a routed Source-local outside target.
- Good: a first projected pointer press emits `pointerdown.detail=0` and compatibility `mousedown.detail=1`, so CodeMirror creates a cursor instead of a whole-line selection.
- Good: a product image base is processed in bounded environment targets, then clock/Dock/window Source textures are drawn sharply afterward.
- Base: a static wallpaper base and frozen particles/ring settle without further frames or Source uploads; generic renderer consumers retain procedural rendering.
- Base: a failed wallpaper upload exposes the identical CSS fallback while the shell and Source compositor remain usable.
- Bad: applying one global curve composite to the environment and all Sources makes the wallpaper bend with the desktop.
- Bad: tuning curve/edge uniforms only in GLSL makes the rendered window diverge from CPU projection and projected input.
- Bad: preserving a hidden Lab page or local diagnostics overlay after product-shell adoption leaves an obsolete second UI/runtime contract.
- Bad: uploading the clock/ring every animation frame or placing any Source texture in the Bloom/composite chain softens text and breaks demand-driven uploads.
- Bad: capturing and drawing a CSS-transparent full-viewport modal Source; the browser may expose a transient black texture even though its final CSS color is transparent.
- Bad: render a 184px context menu outside a 78px Dock Source's border box; the visible child can be clipped or absent from both captured geometry and projected hit testing.
- Bad: use trusted input-plane screen coordinates or a document-global menu singleton as though they were routed Source-local coordinates and ownership.
- Bad: filtering `aria-hidden` or disabled controls out of geometry causes clicks to fall through to an element underneath.
- Bad: focus or synthetic `.click()` alone is reported as proof that a caret, picker, or native default action succeeded.
- Bad: a document-capture outside-click handler treats the trusted input plane as the Source target and hides a popup before the router resolves its option geometry.
- Bad: copying `PointerEvent.detail=0` into `mousedown` silently changes CodeMirror's click mode from single-click to whole-line selection.
- Bad: `{ ...element.getBoundingClientRect() }` appears valid with plain-object test fixtures but can produce an empty/partial runtime snapshot, forcing captured input into zero-delta extrapolation.

### 6. Tests Required

- Unit: WebGL2/current/legacy negotiation, unresolved state, paint changed/removed normalization, source eligibility/removal, context restore, and proof that input-only Sources remain projected-input candidates while being excluded from texture capture.
- Unit: curve/inverse round trips, viewport/CSS/device-pixel mapping, full-screen parallax reset policy, target geometry/activation policy, pointer capture, native scrollbar geometry/drag cleanup, and native outcome reporting. Captured projection coverage must include a DOMRect-shaped fixture whose geometry is exposed through non-enumerable prototype accessors; assert both rect snapshots retain all four fields and a moved captured screen point changes Source-local coordinates. Source-availability coverage must assert `data-spatial-input="none"` excludes both new candidates and captured-input continuation.
- Unit: Source-local popup outside-pointer behavior distinguishes trusted input-plane events from routed synthetic inside/outside targets; a trusted plane event cannot close the popup before option hit resolution.
- Unit: shell context-menu placement clamps to the shell viewport; desktop/launcher/status menus cover pointer and keyboard opening, roving focus, action parity, Escape restoration, viewport-change removal, input-only desktop texture exclusion, and trusted-pointer deferral for inside/outside/no-target projection outcomes.
- Unit: routed event initialization asserts compatibility `mousedown` / `mouseup` / `click` normalize pointer detail zero to one, `dblclick` preserves two, and move/hover events remain zero.
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
// Wrong: CSS transparency still creates a full-screen texture candidate.
element.style.background = "transparent"
elementTextures.synchronize(allSources)

// Correct: retain the Source for input, but exclude its explicit render-none marker from capture.
const drawableSources = allSources.filter((source) => (
  source.getAttribute("data-spatial-render") !== "none"
))
elementTextures.synchronize(drawableSources)
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

```ts
// Wrong: the trusted event target is the full-screen input plane.
if (!root.contains(event.target as Node)) closePopup()

// Correct: Source-local outside behavior consumes only the routed event.
if (!event.isTrusted && !root.contains(event.target as Node)) closePopup()
```

```vue
<!-- Wrong: a child outside this narrow Source is not a separate captured surface. -->
<nav data-spatial-source="shell:launcher"><Menu class="outside-dock-box" /></nav>

<!-- Correct: both fragment roots are direct Canvas Sources with explicit geometry. -->
<nav data-spatial-source="shell:launcher">...</nav>
<Menu v-if="open" data-spatial-source="shell:launcher-menu" :style="layout" />
```

```ts
// Wrong: PointerEvent detail is zero, which rich editors may read as a
// non-single-click selection mode.
const mouseDetail = pointerEvent.detail

// Correct: compatibility mouse events own their click-count semantics.
const mouseDetail = routedMouseEventDetail("mousedown", pointerEvent.detail) // 1
```

## Scenario: Renderer-Owned Dynamic Video

### 1. Scope / Trigger

Use this contract when a Spatial Source must display a playing workspace video. Ordinary HTML Source capture remains demand-driven; decoded video pixels use an opt-in renderer texture rather than repainting and uploading the whole window for every frame.

### 2. Signatures

```ts
type FrameReason = /* existing reasons */ | "animated-media"

interface SpatialDynamicMediaRecord {
  readonly sourceId: string
  readonly source: Element
  readonly video: HTMLVideoElement
  frameGeneration: number
  released: boolean
  fullscreen: boolean
}

interface SpatialDynamicMediaSurface {
  readonly texture: WebGLTexture
  readonly rect: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  }
}
```

The product marker is:

```html
<video data-spatial-dynamic-media="video"></video>
```

The marked video remains inside the owning direct Canvas Source. It is the decoder, playback-state, Blob URL, and browser-fullscreen authority.

### 3. Contracts

- Discovery maps each marked video to exactly one ancestor Source id. The tracker owns media-event, `fullscreenchange`, decoded-frame, fallback-rAF, Source-release, visibility, context-loss, removal, and disposal cleanup.
- A ready current frame increments `frameGeneration` and requests one `animated-media` scheduler frame. `requestVideoFrameCallback` is authoritative when available; fallback rAF runs only while the video is connected, playing, visible, not fullscreen, and Source-eligible.
- `animated-media` is not reduced-motion suppressed because playback is user-controlled. It is one-shot per decoded frame: the viewport does not return it as a continuous scheduler reason.
- Video frames never call `ElementTextureRegistry.markDirty()` or `requestPaint()`. Control text/progress remains ordinary Source DOM and follows normal demand-driven Source capture.
- The GL registry allocates one `LINEAR`/`CLAMP_TO_EDGE` texture per live video, uploads only a newer generation with standard `texImage2D(video)`, and deletes or abandons it exactly once on removal/release/dispose/context loss.
- The surface mesh uses a top-left Source convention: Source top maps to `v=0`. Standard video upload therefore sets `UNPACK_FLIP_Y_WEBGL=false`; forcing `true` inverts the video relative to its Source-local rectangle.
- Contain geometry starts from explicit plain `left/top/width/height` snapshots, rejects non-finite/zero boxes or intrinsic sizes, normalizes the result against the owning Source, and draws immediately after that Source with the same pose, curve, parallax, and painter order.
- Optional dynamic-media shader failure disables decoded-frame tracking and uploads for that renderer while leaving the shell and Source-local controls usable. A single video upload failure skips that generation and must not fail the shell.
- Normal Spatial display keeps the decoder video transparent. Browser fullscreen calls the actual video's `requestFullscreen()` from the activation chain, makes that same element visible under `:fullscreen`, suspends renderer-owned frames, and resumes one current-frame upload after exit.
- Page hiding, pause, end, empty source, Source release/minimize, fullscreen, context loss, element removal, and controller disposal cancel pending callbacks/rAF. A callback racing after cancellation must re-check playing and eligibility before requesting a frame.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Video lacks current decoded data | No generation, upload, draw, or continuous reason |
| `requestVideoFrameCallback` exists | Schedule at most one pending callback per video |
| Callback races after pause/end/release | Drop it without advancing generation |
| API is unavailable | Use one bounded playing/visible rAF fallback; stop exactly on lifecycle exit |
| Source is hidden/released/minimized or page is hidden | Cancel callback/rAF and suppress its surface |
| Browser owns the video in fullscreen | Show the real video, suppress dynamic texture work, resume after exit |
| Dynamic shader initialization fails | Keep shell/controls alive; perform no invisible per-frame upload loop |
| `texImage2D(video)` throws | Record the failure, skip that generation, keep other Sources rendering |
| Context is lost/restored | Stop callbacks, abandon context textures, recreate and upload the next/current generation after restore |
| Video/Source is removed | Remove listeners and texture ownership exactly once |
| Box or intrinsic geometry is zero/non-finite | Return no media surface |

### 5. Good / Base / Bad Cases

- Good: one decoded frame requests one renderer frame, uploads one video texture generation, and draws one contained sub-surface immediately after its Source.
- Good: pause or fullscreen cancels the pending decoded-frame callback; a stale callback cannot revive `animated-media`.
- Base: a paused video with a valid current frame displays its last uploaded frame and owns no scheduler reason.
- Base: audio uses Source-local controls and browser media events but owns no renderer texture or frame reason.
- Bad: a video `timeupdate`/rAF loop dirties the full HTML Source on every frame.
- Bad: a flat DOM/video overlay sits above the Canvas and escapes curve, z-order, occlusion, and projected input.
- Bad: the renderer keeps uploading video frames after its optional media shader failed or the Source was released.

### 6. Tests Required

- Tracker unit tests: discovery, current-frame generation, one pending callback, pause/end/hidden/release/removal/fullscreen/dispose cancellation, stale-callback rejection, and bounded fallback behavior.
- Registry unit tests: generation dedupe, top-left upload orientation, contain math, Source ownership, zero/invalid geometry, upload failure isolation, exact deletion, and context restore.
- Renderer tests: upload remains separate from Element Source textures; normalized media rect reaches the dynamic shader after its owner; optional-program failure does not fail the renderer.
- Scheduler tests: `animated-media` remains allowed under reduced motion but does not persist without a new decoded frame.
- Product tests: normal decoder opacity, `:fullscreen` visibility, Source-local play/seek/volume controls, direct fullscreen success/refusal, resize/curve-edge mapping, minimize/restore, simultaneous media windows, page visibility, and context loss/restore.

### 7. Wrong vs Correct

#### Wrong

```ts
video.requestVideoFrameCallback(() => {
  elementTextures.markDirty(owningSource)
  capabilities.requestPaint()
  scheduler.request("animated-source")
})
```

```ts
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
```

#### Correct

```ts
video.requestVideoFrameCallback(() => {
  if (video.paused || video.ended || !sourceEligible()) return
  record.frameGeneration += 1
  scheduler.request("animated-media")
})
```

```ts
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
drawContainedVideoAfterOwningSource(record)
```

## Scenario: Spatial Application Presentation Primitives

### 1. Scope / Trigger

Use this contract when adding or changing a route presentation under `apps/platform-web/src/spatial/apps/**`, especially buttons with icons, themed selectors, focus treatment, Source-local overlays, or content transitions.

The completed Spatial shell is the visual authority. Route presentations may change layout for readability and workflow density, but they do not invent a second palette, material system, focus language, or control family.

### 2. Signatures

```ts
interface SpatialActionButtonProps {
  variant?: "default" | "primary" | "danger"
  iconOnly?: boolean
  type?: "button" | "submit" | "reset"
  disabled?: boolean
}

interface SpatialSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SpatialSelectProps {
  modelValue: string
  options: readonly SpatialSelectOption[]
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
}

type SpatialSelectEmit =
  | { event: "update:modelValue"; value: string }
  | { event: "change"; value: string }

interface SpatialAssistantConfigSurfaceRequest {
  readonly onChange?: () => void
}

function openSpatialAssistantConfig(request?: SpatialAssistantConfigSurfaceRequest): boolean
function closeSpatialAssistantConfig(): void

interface SpatialRoutedDragState {
  readonly pointerId: number
  screenX: number
  screenY: number
}

function beginRoutedSpatialDrag(event: PointerEvent): SpatialRoutedDragState | null
function moveRoutedSpatialDrag(
  state: SpatialRoutedDragState,
  event: PointerEvent,
): { x: number; y: number } | null

function gestureCaptureTargetForElement(target: Element, button: number): Element

class SpatialGlobalSurfacePositionController {
  setOpen(open: boolean): void
  moveBy(delta: { x: number; y: number }): boolean
  place(
    viewport: { width: number; height: number },
    centeredLayout: SpatialGlobalSurfaceLayout,
    measuredHeight: number,
  ): SpatialGlobalSurfaceLayout
}
```

Shared local transition names are `spatial-pop`, `spatial-dialog`, and `spatial-list`. Dominant screen/tab content has no CSS transition name.

Application Sources that use those CSS transitions opt into intermediate texture capture with `data-spatial-source-animation`. The engine tracks the existing `FrameReason` value `"animated-source"`; `SOURCE_TEXTURE_ANIMATION_MAX_MS` is the hard liveness bound for a missing transition completion event.

```ts
interface SourceTextureAnimationFrame {
  readonly activeSourceIds: readonly string[]
  readonly expiredSourceIds: readonly string[]
}

function shouldQueueNextSourceTexturePaint(
  record: Pick<ElementTextureRecord, "dirty" | "released">,
): boolean
```

### 3. Contracts

- Text+icon and icon-only application actions use `SpatialActionButton`. The primitive owns one horizontal icon/text row, a fixed non-shrinking icon box, SVG size, gap, variant colors and disabled state. Callers do not size or position action icons themselves.
- Icon-only actions require an accessible name and keep a square semantic hit box. Text-only semantic tabs, list/menu items and selection cards may remain native buttons when they are not action-button variants.
- Themed Spatial selectors use `SpatialSelect`; product route presentations do not use native `<select>`. The listbox remains inside the owning Source so curvature, styling and projected input stay consistent.
- A feature configuration surface that must behave as a desktop modal is a direct global Canvas Source, not an absolute descendant inside its application window Source. The shell owns its input-only shield, explicit viewport layout, z-order, aperture presentation and terminal close; the feature store remains active until the closing frame completes. Higher global Dialog/Confirm Sources disable its projected input and restore its exact focus chain after they close.
- Feature views open a global configuration Source through a small in-memory request boundary and may supply a change callback, but they do not mount the panel themselves. Minimize/focus/occlusion therefore keep the application controller mounted, while shell disposal clears any outstanding feature-modal request.
- A movable direct Source marks its root `data-spatial-gesture-owner` and only its title drag region `data-spatial-gesture-start`. Routed pointer capture then delivers move/up/cancel to the Source root. Drag deltas come from the router-provided `spatialScreenClientX/Y`, never from Source-local `clientX/Y`; reuse `spatial-routed-drag.ts` so windows and feature modals cannot diverge.
- The shell, not the feature component, owns movable global-Source position. It applies deltas only while that modal is top/interactive, preserves the position across dirty/layout passes, clamps the full measured panel to the real viewport after content or viewport changes, and resets the transient position on close/reopen.
- Gesture capture preserves the original target for actionable descendants inside `data-spatial-gesture-start` (native controls, links/contenteditable and semantic action roles), including an SVG/icon hit inside a button. Only non-action primary-button chrome promotes to `data-spatial-gesture-owner`; non-primary input retains its target. This is required because `PointerRouter` activates only when pressed target and captured release target are identical. DOM `stopPropagation()` runs after capture-target selection and is not a substitute for this boundary.
- Shared modal-header controls must beat `SpatialActionButton` base/hover/focus declarations by selector specificity while retaining the fixed 28px geometry. A close icon on the dark header uses the header foreground and translucent dark fill; page-load order must not turn it into a light content button.
- Spatial application, modal and Toast scrollbars use the single skin in `spatial-apps.css`: inherited `--spatial-*` colors, a visible 10px Chromium gutter, rounded inset thumb, hover/active states, themed track/corner and no native arrow buttons. Do not add page-local `scrollbar-color` overrides. A compact auto-growing composer may intentionally hide only its own scrollbar while retaining keyboard/wheel scrolling after its maximum height.
- `SpatialSelect` owns open/highlight/selected state and supports click, outside-pointer close, Escape, Tab, ArrowUp/Down, Home/End, Enter/Space, disabled options and all-disabled lists. Opening with an unknown/empty model value highlights the first enabled option. Escape closes and restores trigger focus; Tab closes without trapping focus.
- Source-local listboxes, menus and dialogs disable pointer input during leave transitions and restore the appropriate invoker/trigger focus after close.
- Spatial application controls do not draw outer focus rectangles, focus box-shadows or focus-only border-width changes. Keyboard feedback may change existing fill, text, underline or a fixed-width inner/bottom accent without changing geometry.
- Market screen and Detail tab replacement is an immediate keyed DOM swap inside the existing Source texture. Do not wrap dominant content in Vue `Transition`, and do not apply `transform`, `opacity`, `filter`, `clip-path`, mask or related compositor-promoting animation properties to its entering/leaving subtree.
- Flag Chromium may promote an animated descendant into a planar compositor layer outside HTML-in-Canvas capture. The symptom is decisive: content temporarily loses curvature, then snaps onto the curved Source when the CSS transition ends. Extra `requestPaint()` calls or Source texture uploads cannot repair a layer that escaped Source composition.
- A true curved dominant-content transition requires renderer-owned old/new textures composed on the same WebGL mesh. The current renderer owns one texture per Source and has no reusable intra-Source dual-texture seam; do not add that capability from an application task.
- Popovers, dialogs and useful list/card entry may use the shared bounded local transitions. They are event-driven, interruptible, use no infinite iteration and settle without a continuous Source dirty reason; disable them too if Flag Chromium shows planar escape.
- Popovers, dialogs and list/card entries may still locally animate to/from zero opacity because the stable owning screen remains painted underneath; they do not use dominant replacement composition.
- A standalone global Source whose entire visible body enters/leaves, such as Toast, has no stable owning screen behind its descendant. If Flag Chromium does not capture `opacity`/`transform` intermediates, use contained layout/paint transitions instead (measured height, bounded margin/padding/border), keep the Source eligible through the first frame and mounted through the final leave frame, and hide horizontal overflow. Reduced motion reaches the same terminal DOM immediately.
- A Source containing shared application transitions must opt in with `data-spatial-source-animation`. CSS computed intermediate frames do not trigger `MutationObserver`, so the viewport listens for bubbling `transitionrun`, `transitionend`, and `transitioncancel` only under opted-in Sources and sustains the `animated-source` reason while at least one transition remains active.
- The hard deadline is anchored to the first `transitionrun` in one continuously active Source batch. Later properties increment the active-transition count but must not extend that deadline; otherwise repeated transition starts can turn the bounded recapture contract into an unbounded loop.
- Source animation capture is serialized per Source. If its texture record is already dirty (whether waiting for paint or paint-ready), do not call `markDirty()` again: that clears `paintReady` and can produce stale/final-frame flicker. After the current generation uploads and becomes clean, mark it dirty once and request the next paint snapshot.
- The last matching end/cancel event requests one final capture. A missing completion event expires at `SOURCE_TEXTURE_ANIMATION_MAX_MS` and also requests a final capture. Source removal, release, context loss, disposal, document hiding and reduced-motion changes release or suspend the animation reason; no path may leave idle Source uploads running.
- `prefers-reduced-motion: reduce` makes application transitions immediate, removes transition delay and preserves the same final DOM, focus and business state.
- Application colors and surfaces derive from inherited `--spatial-*` shell variables. Route components do not hard-code a near-match palette or import `retro-*` chrome.
- Spatial-only presentation work does not duplicate controller, platform-host, storage or event logic. RetroOS and Spatial presentations consume the same per-instance domain controllers.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Select model matches an enabled option | Opening highlights that option |
| Select model is empty/unknown | Opening highlights the first enabled option |
| Active option is disabled or disappears | Normalize to the selected/first enabled option |
| All options are disabled | Trigger remains closed; no value emits |
| Arrow navigation crosses a disabled option | Skip it and stop at the enabled boundary |
| Escape while open | Close, emit no value, restore trigger focus |
| Tab while open | Close without preventing normal focus traversal |
| Select/menu/dialog begins leaving | It cannot receive pointer input |
| Reduced motion is active | Transition duration/delay is effectively zero; final state is identical |
| Market screen or Detail tab changes | Replace immediately within the Source texture; no descendant CSS compositor animation or temporary planar layer |
| Dominant content needs animated handoff | Defer to a renderer-owned dual-texture/GPU design; do not simulate it with Source DOM CSS |
| Popover/dialog/list item fades to zero | The owning screen remains painted underneath; no full-screen brightness valley |
| Opted-in CSS transition is running | One paint generation at a time uploads computed intermediate frames under `animated-source` |
| Another property starts while that Source batch is active | Increment its completion count without moving the batch's original hard deadline |
| Texture record is already dirty or paint-ready | Preserve it; do not re-mark it or overwrite the pending snapshot |
| Last transition ends or is canceled | Request one final texture capture, then stop `animated-source` |
| Transition completion event is lost | Hard-expire below one second, request the final texture, and stop |
| Source is removed/released or context is lost | Drop its animation tracking; do not retain a frame reason for it |
| Icon-only action lacks visible text | Caller supplies `aria-label` |
| Route layout changes | Every prior command, status and error remains discoverable |
| Ordinary descendant/text mutation inside one Source | Dirty and repaint only that Source; do not synchronize or recapture unrelated Sources |
| Direct Source or dynamic-media topology changes | Synchronize the registry, then capture the affected Source generation |
| Standalone Toast enters/leaves in target Flag Chromium | Visible bounded Source-local motion, no planar escape, horizontal scrollbar or unrelated Source flash |
| Feature configuration opens from an application window | Mount one independently captured global Source above the shield; no panel/backdrop descendant exists inside the application Source |
| Confirm opens from the feature configuration surface | Disable the configuration Source, route input only to Confirm, then restore the invoking configuration control after Confirm closes |
| Feature configuration starts closing | Keep request, DOM and texture through the terminal close frame; clear them exactly once afterward |
| Spatial content overflows | Use the shared track/thumb/hover/active skin while retaining the real gutter required by projected thumb geometry |
| Assistant composer grows beyond its maximum height | Content remains wheel/keyboard scrollable, but its local scrollbar stays hidden |
| Routed drag begins on a movable modal header | Capture the Source root and accumulate screen-coordinate deltas for the same pointer id |
| Pointer starts on the modal close button or its SVG | Preserve that exact pressed/capture target; close activates once and no drag state or move event is created |
| Non-primary pointer starts on a drag handle | Preserve the original target; do not promote it to the gesture owner |
| Drag reaches or passes a viewport edge | Clamp the full measured panel inside the real shell viewport on the next layout pass |
| Modal content repaints or shell layout runs while open | Preserve the moved position; do not recenter the Source |
| Modal closes and a new request opens | Discard the prior transient position and start from the current centered layout |

### 5. Good / Base / Bad Cases

- Good: a Market sort selector opens a captured warm-gray listbox, skips disabled options with ArrowDown, closes on Escape and returns focus to its trigger.
- Good: upload/export/delete actions share the same horizontal icon box and label baseline across My Apps, Market and Detail.
- Good: Detail tabs replace immediately inside one curved Source texture and never appear as flat planar content.
- Good: an opted-in Market Source serially uploads bounded Select/dialog computed frames, preserves an outstanding paint-ready generation, and becomes idle after the local transition settles.
- Good: a card-version update dirties My Apps and Detail exactly once each while the independent Toast Source animates with contained layout properties; other Sources retain their current textures.
- Good: Assistant settings open as their own curved global Source; an update confirmation opens above it and returns focus to the settings control after resolution.
- Good: Studio, Assistant, global forms and Toast stacks share one Spatial scrollbar skin, while the compact Assistant composer alone hides its chrome.
- Good: dragging Assistant configuration by its dark header follows the projected pointer in screen space, survives repaint, stays recoverable at every edge, and reopens centered.
- Good: a routed press on the close icon retains the icon through pointerup, bubbles one click to its button, and closes the modal without starting drag.
- Base: a text-only tab or menu item remains a semantic native button and uses shared Spatial app styles without being wrapped in `SpatialActionButton`.
- Bad: native `<select>` opens a white/blue browser popup above the curved Source.
- Bad: each page adds its own SVG margins, icon sizes, button grid, focus outline or animation timing.
- Bad: an infinite pulse or long ambient animation keeps the HTML Source repainting while idle.
- Bad: an animation-frame loop calls `requestSourcePaint()` every frame; repeated `markDirty()` clears `paintReady`, so old and new content appear as discrete flashes.
- Bad: one descendant class/text mutation calls full `syncSources()`, causing every concurrently changing Source to be reconsidered and repainted.
- Bad: a dominant Market screen uses CSS opacity/transform; Chromium promotes it to a flat descendant layer that snaps back onto the curved Source only after transition completion.
- Bad: a settings panel uses `position:absolute; inset:0` inside the Assistant Source, so it inherits the parent window curvature/geometry and reads as embedded content instead of a desktop modal.
- Bad: one page restores browser-default gray scrollbars or changes gutter width independently from projected scrollbar hit-testing.
- Bad: a modal computes movement from Source-local `clientX/Y`, writes its own transform, or lets its close button bubble into the drag handle; curvature makes local deltas unstable and the shell's next layout overwrites component-owned geometry.
- Bad: capture promotion relies only on `@pointerdown.stop`; capture was already assigned to the gesture owner, so PointerRouter sees `pressed target !== release target` and correctly suppresses the click.

### 6. Tests Required

- Unit-test durable behavior: Select state transitions and disabled-option navigation; bounded Source-animation counting/expiry, including proof that later properties cannot slide the first-event deadline; preservation of an already-dirty paint generation; reduced-motion suppression of `animated-source`; mutation routing that separates Source topology/dynamic-media sync from owning-Source descendant repaint; controller request sequencing/mutation guards; close guards; media object-URL ownership; registry readiness and the production release gate.
- Unit-test feature-modal request ownership, view-to-global opening, modal input-priority changes and delayed terminal close. Component assertions verify the feature panel is a direct Source and absent from the invoking application subtree; scrollbar colors and radii remain manual visual tokens rather than source-string snapshots.
- Unit-test routed screen-delta accumulation, pointer-id filtering, header-only start, close-control exclusion, position persistence, finite-delta rejection, viewport clamp and close/reopen reset. Re-run existing Spatial window tests because the shared helper also owns product-window move semantics.
- Unit-test gesture capture with a plain title descendant, a button, an SVG inside that button and non-primary input. Route down/up through `PointerRouter` and assert the nested action activates exactly once while title chrome remains drag-owned.
- Run task-owned controller/Spatial-app tests, platform-web Vue type-check, `npm run build:web`, and `git diff --check`.
- Manual Flag Chromium acceptance owns visual alignment, curved-edge input, transition quality, focus appearance, native file/IME escapes, minimum-size layouts and reduced motion.
- Do not add exact CSS-value snapshots, animation-frame snapshots, screenshot unit tests or source-format substring tests for tunable presentation details. If a broad run exposes legacy shell/engine failures, audit their live contract: delete obsolete source/visual assertions, rewrite tunable numeric or draw-count checks as semantic invariants, and keep or repair only tests that still protect runtime behavior. Do not carry a permanently red baseline.

### 7. Wrong vs Correct

#### Wrong

```vue
<button class="upload"><Upload class="mt-[-4px]" />上传资源</button>
<select v-model="sortMode"><option value="newest">最新</option></select>
```

```css
.route-control:focus-visible {
  outline: 2px solid red;
  box-shadow: 0 0 8px red;
}
```

#### Correct

```vue
<SpatialActionButton variant="primary" @click="openUpload">
  <template #icon><Upload /></template>
  上传资源
</SpatialActionButton>

<SpatialSelect
  v-model="sortMode"
  :options="sortOptions"
  aria-label="排序"
/>
```

```css
.spatial-action-button:focus-visible .spatial-action-button__label {
  color: var(--spatial-window-accent);
  text-decoration: underline;
}
```

```vue
<!-- Wrong: dominant CSS animation may escape as a flat compositor layer. -->
<Transition name="spatial-content">
  <Screen :key="screen.kind" />
</Transition>

<!-- Correct: one immediate replacement remains inside the curved Source. -->
<Screen :key="screen.kind" />
```

```ts
// Wrong: every scheduler frame invalidates the pending paint generation.
elementTextures.markDirty(source)
capabilities.requestPaint()
return { continueReasons: ["animated-source"] }

// Correct: keep one snapshot outstanding and queue the next after upload.
if (!record.dirty) {
  elementTextures.markDirty(source)
  capabilities.requestPaint()
}
return transitionTracker.has(sourceId)
  ? { continueReasons: ["animated-source"] }
  : { continueReasons: [] }
```

```ts
// Wrong: every local Vue update becomes a global registry/paint operation.
new MutationObserver(() => syncSources())

// Correct: topology/media changes synchronize; local content dirties its owner.
const plan = planSpatialSourceMutations(canvas, records)
if (plan.synchronize) syncSources()
markOwningSourcesDirty(plan.dirtySourceIds)
```

```vue
<!-- Wrong: configuration is captured as a descendant of the Assistant window. -->
<div class="assistant-modal-backdrop">
  <AssistantConfigPanel />
</div>

<!-- Correct: the view opens state; the shell hosts an independent direct Source. -->
<SpatialActionButton @click="openSpatialAssistantConfig()">配置</SpatialActionButton>
<!-- SpatialGlobalSurfaceHost -->
<SpatialAssistantConfigPanel data-spatial-source="global:assistant-config" />
```

```ts
// Wrong: Source-local coordinates change as the curved Source moves, and the
// feature component fights the shell's authoritative layout pass.
panel.style.transform = `translate(${event.clientX - startX}px, ${event.clientY - startY}px)`

// Correct: the component emits routed screen deltas; the shell owns placement.
const drag = beginRoutedSpatialDrag(event)
const delta = drag && moveRoutedSpatialDrag(drag, nextEvent)
if (delta) assistantConfigPosition.moveBy(delta)
applyGlobalSurfaceLayout(panel, assistantConfigPosition.place(viewport, centered, height))
```

```ts
// Wrong: DOM propagation is too late to change the router's capture target.
closeButton.addEventListener("pointerdown", (event) => event.stopPropagation())
captureTarget = gestureStart.closest("[data-spatial-gesture-owner]")

// Correct: actionable descendants retain the same target from down to up.
captureTarget = gestureCaptureTargetForElement(pressedTarget, sample.button)
```

## Scenario: Spatial Window Maximize and Play Fullscreen

### 1. Scope / Trigger

Use this contract when adding maximize/restore to Spatial window chrome or letting a captured Play iframe enter browser fullscreen. Window layout remains shell/session state; the browser Fullscreen API remains a presentation boundary.

### 2. Signatures

```ts
interface SpatialWindowState extends SpatialWindowGeometry {
  maximized: boolean
  minimized: boolean
}

function effectiveSpatialWindowGeometry(
  geometry: SpatialWindowGeometry,
  maximized: boolean,
  viewport: SpatialViewportSize,
): SpatialWindowGeometry

class BrowserWindowFullscreenController {
  setWindowFullscreen(
    id: string,
    fullscreen: boolean,
    nativeElement?: BrowserFullscreenRequestElement | null,
  ): Promise<"native" | "window">
}
```

A ready Spatial Play iframe carries `data-spatial-play-ready="true"`. The shell may request native fullscreen only from an iframe with that marker inside the matching window Source.

### 3. Contracts

- Expose maximize/restore only for descriptors whose shared Spatial registration is `fullscreenable`.
- Store `maximized` separately from ordinary `worldX/worldY/width/height/sideDepth`. Effective maximized geometry fills the current viewport without overwriting restore geometry; viewport changes clamp only the retained ordinary geometry for a later restore.
- Maximized windows remain mounted but cannot start or continue drag/resize gestures. Minimize clears maximized state while retaining ordinary geometry.
- Retro and Spatial shells share one vendor-compatible browser fullscreen controller. Shells own window lookup and state application; domain controllers do not call Fullscreen APIs.
- A Play maximize click may request fullscreen only on the same already-ready iframe in that window. Success marks the window maximized; unsupported/rejected/not-ready requests fall back to Spatial window maximize.
- Browser fullscreen exit clears the window maximized state. Entry, exit, focus, occlusion, and restore never clone, reparent, or remount the iframe and never reset runtime/bridge/save identity.
- Curved Play is a compatibility preview for capture/display/basic projected click. Primary gameplay uses native iframe fullscreen for real pointer, keyboard, focus, resize, and reload.
- Do not add automatic fullscreen, a second content-area fullscreen command, a flat DOM-over-Canvas iframe, or implicit Retro fallback. Keep the production Spatial release gate independent.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Descriptor is not `fullscreenable` | No maximize control; session rejects the state change |
| Generic Spatial window maximizes | Effective geometry fills viewport; ordinary geometry is unchanged |
| Move/resize arrives while maximized | Reject without geometry mutation |
| Play iframe is absent or not ready | Skip Fullscreen API and maximize the Spatial window |
| Fullscreen request is unsupported or rejects | Maximize the Spatial window; keep the iframe/runtime alive |
| Fullscreen request succeeds | Browser owns the exact iframe; window/button state is maximized |
| Browser Escape exits fullscreen | Clear maximized state and reveal the same iframe in its Source |
| Minimize occurs from maximized fallback | Clear maximized state, release texture as usual, retain restore geometry |
| Fullscreen listeners/controller dispose | Remove every listener exactly once and retain no tracked window id |

### 5. Good / Base / Bad Cases

- Good: the Play titlebar command enters fullscreen on the ready iframe; Escape returns that exact element to the curved Source with its runtime and save unchanged.
- Good: a rejected fullscreen request produces ordinary Spatial maximize and can restore to the retained geometry.
- Base: a non-Play `fullscreenable` window uses only effective viewport geometry and never touches browser fullscreen.
- Bad: maximizing overwrites ordinary geometry, leaves resize handles active, or rebuilds Play into a second iframe.
- Bad: a flat iframe is placed above the Canvas to bypass capture/input limitations.

### 6. Tests Required

- Unit: effective maximized geometry, restore-geometry immutability, viewport clamp, move/resize rejection, minimize clearing, and non-fullscreenable rejection.
- Unit: standard/vendor request/current/exit behavior, rejected fallback, native-exit synchronization, idempotent start/dispose, and exact listener cleanup.
- Component/integration: accessible maximize/restore control, resize-handle removal, Play minimized propagation, ready-marker lifecycle, shared controller consumption, native file selection, and no Retro classes/imports in Spatial Play.
- Package: focused Play/controller/registry tests, complete Spatial suite, Vue type-check, `npm run build:web`, and `git diff --check`.
- Flag Chromium: remote and packaged curved center/edge display plus basic click; native fullscreen pointer/keyboard/focus/resize/reload/Escape; same-instance retention after exit.

### 7. Wrong vs Correct

#### Wrong

```ts
// Overwrites restore geometry and requests fullscreen before Play is ready.
Object.assign(window, viewport)
await windowRoot.querySelector("iframe")?.requestFullscreen()
```

#### Correct

```ts
const effective = effectiveSpatialWindowGeometry(window, window.maximized, viewport)
const iframe = windowRoot.querySelector<HTMLIFrameElement>(
  "iframe[data-spatial-play-ready='true']",
)
await browserFullscreen.setWindowFullscreen(window.id, true, iframe)
```

## Upstream Status

- Primary source: [WICG/html-in-canvas](https://github.com/WICG/html-in-canvas).
- The API is not standardized and Chromium implementations may lag or lead the explainer. Keep exact calls and compatibility handling inside `capabilities.ts`.
- Proposed descendant drawables, native nonlinear hit testing, sub-element texture updates, and WebGPU support are future work, not current contracts.
