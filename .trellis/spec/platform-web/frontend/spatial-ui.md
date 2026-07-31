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
  | { kind: "texture"; texture: WebGLTexture }

interface EnvironmentBaseProvider {
  frameDemand: "static" | "animated"
  frame(timestamp: number): EnvironmentBaseFrame
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
- Normalize `changedElements` and feature-detected `removedElements`. Explicit source synchronization remains required while upstream drafts/runtimes differ.
- Do not rely on `UNPACK_FLIP_Y_WEBGL`; element uploads may ignore unpack state. Own orientation once in the source-texture UV convention and verify it in the flagged browser.
- Upload during `paint` sees the current snapshot; a later upload may see the previous snapshot. `requestPaint()` is one-shot and an empty changed list only authorizes already-dirty initial/restore sources.
- Render order is fixed: uncurved environment to the default framebuffer, HTML/source accents to a transparent surface framebuffer, then curved alpha composite over the environment. Pixels outside the curved surface output transparent alpha.
- Static wallpaper/media bases do not own a continuous frame reason. Particle animation and future animated media have independent frame reasons and never dirty HTML textures.
- Canvas and the input plane cover the viewport. Leaving the curved hit domain clears DOM hover but does not recenter parallax; blur, document hiding, or explicit reset may recenter it.
- Forward and inverse curve math share one immutable configuration. Any visual curve change must update CPU projection, GLSL, and round-trip tests together.
- Target resolution separates geometry from policy. `aria-hidden`, `aria-disabled`, and native disabled state do not erase hit geometry; activation policy suppresses disabled actions after resolution. Effective visibility and `pointer-events:none` remain geometric exclusions.
- Routed pointer/mouse events are synthetic. Report event delivery separately from verified native state changes, caret placement, picker opening, or IME behavior.
- Keep real source DOM semantics and keyboard focus. Native select/file/context-menu/IME top-layer UI is a flat browser escape; themed curved selects use captured custom listboxes.
- Diagnostics remain development-only, hidden/inert by default, and must not make the production build include the lab entry.

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
| Window blur or document hidden | Release capture/hover and recenter according to reduced-motion policy |
| Native/ARIA disabled target hit | Preserve hover/geometry; suppress activation and report why |
| Synthetic event dispatched | Record delivery/cancellation; do not infer trusted native success |
| Reduced motion | Freeze particles and snap/reset movement without changing final hierarchy |
| Context restore | Recreate programs/framebuffers/textures, then mark eligible sources dirty |

### 5. Good / Base / Bad Cases

- Good: a direct Canvas child changes, only its texture uploads, the environment continues animating particles, and curved edge input maps back to the same source control.
- Base: a static wallpaper base and frozen particles settle without further frames or uploads.
- Bad: drawing the environment into the curved surface framebuffer makes the wallpaper bend with the desktop.
- Bad: filtering `aria-hidden` or disabled controls out of geometry causes clicks to fall through to an element underneath.
- Bad: focus or synthetic `.click()` alone is reported as proof that a caret, picker, or native default action succeeded.

### 6. Tests Required

- Unit: WebGL2/current/legacy negotiation, unresolved state, paint changed/removed normalization, source eligibility/removal, and context restore.
- Unit: curve/inverse round trips, viewport/CSS/device-pixel mapping, full-screen parallax reset policy, target geometry/activation policy, pointer capture, and native outcome reporting.
- Unit: environment → transparent surface → curve-composite pass order, transparent exterior, media cover math, particle/reduced-motion scheduling, and static upload counts.
- Package: complete Spatial Vitest suite, platform-web Vue type-check, `npm run build:web`, and `git diff --check`.
- Production isolation: output contains no `spatial-lab.html`, lab-named chunk, Spatial lab marker, or experimental API marker.
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
drawEnvironmentToScreen()
drawHtmlIntoTransparentSurfaceFramebuffer()
drawCurvedAlphaCompositeToScreen()
```

## Upstream Status

- Primary source: [WICG/html-in-canvas](https://github.com/WICG/html-in-canvas).
- The API is not standardized and Chromium implementations may lag or lead the explainer. Keep exact calls and compatibility handling inside `capabilities.ts`.
- Proposed descendant drawables, native nonlinear hit testing, sub-element texture updates, and WebGPU support are future work, not current contracts.
