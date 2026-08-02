# Research: Spatial compositor effects, frosted glass, and window transitions

- Query: Investigate the current Spatial HTML-in-Canvas renderer and shell architecture for stronger atmosphere/post-processing, true frosted-glass windows, and Canvas-native open/close/minimize animations without regressing text clarity, projected input, DOM state, close guards, reduced motion, or GPU lifecycle.
- Scope: mixed
- Date: 2026-08-01

## Findings

### Executive recommendation

The renderer is not currently a compositing graph. It uploads one texture per direct-child DOM Source, binds the default framebuffer, draws the environment and particles, then draws shell Sources and windows directly back-to-front (`apps/platform-web/src/spatial/engine/renderer.ts:191-272`). The product wallpaper is not in WebGL at all: it is a CSS pseudo-element below a transparent Canvas (`apps/platform-web/src/spatial/shell/spatial-shell.css:27-38`, `apps/platform-web/src/spatial/shell/SpatialDesktopShell.vue:387-393`). Consequently, a window shader can currently sample only its own `texElementImage2D` texture; it cannot sample the CSS wallpaper, the default framebuffer, or already drawn windows.

Recommended sequence:

1. Amend the PRD/design/spec visual constraints before implementation. Keep the no-global-curve, sharp-text, z/input-order, DOM-authority, reduced-motion, and close-guard contracts, but permit a WebGL-owned wallpaper, scoped background post-processing, a glass backdrop pass, and transient per-window transition geometry.
2. Move the bundled wallpaper into a renderer-owned WebGL texture and add a low-resolution, background-only effect chain. Start with thresholded lunar/environment bloom plus a slow low-frequency atmospheric distortion or light field; composite Sources afterward so text and hit geometry remain untouched. Retire the CSS SVG RGB split.
3. Add a per-window presentation state machine and shader/mesh transitions. For the MVP, make opening/minimizing/closing Sources unavailable to projected input rather than trying to invert a near-singular animated fold. Keep the DOM and Source texture alive until the terminal transition callback.
4. Add true glass only after the render-target lifecycle is stable: render to a scene color target; before each window, downsample the already-composited scene into a separate low-resolution backdrop pair, blur it, draw a glass-underlay mesh from that snapshot, and then draw the current Source texture sharply. This lets each window see environment, Docks, and lower windows without ever blurring itself.

Do not begin with a global full-scene post-process or full-resolution ping-pong per window. Both spend the most bandwidth and create the largest text/readability and input-perception risks.

### Files found

- `apps/platform-web/src/spatial/engine/renderer.ts` — raw WebGL2 pass orchestration; all current drawing targets the default framebuffer.
- `apps/platform-web/src/spatial/engine/shaders/scene.ts` — per-Source mesh transform and the sole Source fragment shader.
- `apps/platform-web/src/spatial/engine/shaders/environment.ts` — procedural/media base and three-band particle shaders.
- `apps/platform-web/src/spatial/engine/element-textures.ts` — one HTML texture per Source, dirty upload, release/restore, and disposal.
- `apps/platform-web/src/spatial/engine/environment-base.ts` — static procedural, transparent, and nominal texture environment-frame boundary.
- `apps/platform-web/src/spatial/engine/resources.ts` — context resource registry already supports textures and framebuffers, though the renderer creates no framebuffer today.
- `apps/platform-web/src/spatial/engine/frame-scheduler.ts` — demand-driven frame reasons and reduced-motion suppression.
- `apps/platform-web/src/spatial/engine/viewport-controller.ts` — renderer/scheduler/input/context lifecycle plus the current global diagnostic transition scalar.
- `apps/platform-web/src/spatial/engine/scene.ts` — Source metadata, z sorting, front-to-back projected hit resolution, and pointer-down projection capture.
- `apps/platform-web/src/spatial/engine/projection.ts` — CPU projection/inversion kept in lockstep with the Source vertex shader.
- `apps/platform-web/src/spatial/shell/SpatialDesktopShell.vue` — Source mounting, route/session commands, texture release/restore, and product renderer setup.
- `apps/platform-web/src/spatial/shell/window-session.ts` — logical window state, close guard ordering, and current immediate minimize/close mutations.
- `apps/platform-web/src/spatial/shell/SpatialWindowSurface.vue` — keyed DOM Source that owns live application content and projected gestures.
- `apps/platform-web/src/spatial/shell/spatial-shell.css` — CSS wallpaper, flat translucent body, hidden/minimized styling, and reduced-motion rules.
- `.trellis/tasks/07-31-spatial-desktop-shell/prd.md` — accepted shell, readability, lifecycle, and flat-neutral visual constraints.
- `.trellis/tasks/07-31-spatial-desktop-shell/design.md` — direct-default-framebuffer compositor and no-blur/no-underlay design.
- `.trellis/spec/platform-web/frontend/spatial-ui.md` — executable Spatial pass, input, resource, and reduced-motion contract.

### Current framebuffer and Source flow

1. Source DOM roots must be direct Canvas children and keep non-zero boxes (`element-textures.ts:52-65`). Each eligible root owns one RGBA texture (`element-textures.ts:85-103`, `element-textures.ts:343-352`).
2. Dirty Sources are uploaded with `texElementImage2D` at the renderer's effective raster scale (`element-textures.ts:240-289`). Minimize can delete only the GPU texture while keeping the record/DOM; restore recreates and dirties it (`element-textures.ts:146-168`).
3. Every frame explicitly binds `FRAMEBUFFER` to `null`, clears it, draws base/particles, then shell Sources, windows, and foreground (`renderer.ts:191-272`). No render target is allocated even though `ContextResourceRegistry` can track one (`resources.ts:47-55`).
4. A Source draw binds only `surface.texture` to `u_texture` (`renderer.ts:415-440`). The product `flat-neutral` branch immediately returns that texel (`shaders/scene.ts:70-98`), so the diagnostic transition/tint path is bypassed for product windows.
5. The only product RGB split is an SVG filter on the CSS wallpaper (`SpatialDesktopShell.vue:3-52`, `spatial-shell.css:27-38`). The controller's `triggerTransition()` is used by the Interaction Lab, not the product shell, and is one global 520 ms scalar (`viewport-controller.ts:331-334`, `viewport-controller.ts:450-460`).

### Goal 1 — atmosphere and post-processing

Effects can be meaningful without touching Source text or Source geometry. The safe boundary is: process the WebGL-owned environment before Source composition, then draw Source meshes sharply with their existing pose. Color, bloom, low-frequency refraction, vignette, and grain in that background layer do not alter projected input because input is derived from Source rect/pose, not environment pixels (`scene.ts:91-107`, `projection.ts:99-129`).

The current CSS wallpaper blocks true image post-processing and glass. A transparent WebGL canvas can add particles over it but cannot read or color-process pixels belonging to the DOM layer below. Although `EnvironmentBaseFrame` already has a texture variant (`environment-base.ts:4-18`), no product provider creates/owns that texture, and a raw `WebGLTexture` is context-specific. A real media provider therefore needs explicit initialize/restore/dispose hooks or, preferably, a CPU-side image descriptor whose upload texture is owned and tracked by the renderer.

Suggested first effect stack:

- high-luminance threshold/downsample/separable blur for restrained moon/particle bloom;
- a slow, low-amplitude noise/light-field distortion confined to the environment;
- optional vignette and fine temporal grain after the background effect, still before Sources;
- no displacement, RGB separation, blur, or bloom on Source text.

This is more visibly WebGL-native than the current 0.75 px CSS RGB split while preserving exact Source projection. Reduced motion should freeze temporal distortion/grain phase just as particles freeze; a static bloom may remain. Static wallpaper ownership must not itself create a continuous frame reason (`frame-scheduler.ts:61-75`; `.trellis/spec/platform-web/frontend/spatial-ui.md:67`).

#### Atmosphere option matrix

| Option | Feasibility | Architectural cost | Performance risk | Recommendation |
|---|---:|---:|---:|---|
| Keep CSS wallpaper; add transparent additive WebGL overlays | High | Low | Low | Useful prototype, but cannot grade/distort/bloom wallpaper pixels and does not unlock glass. |
| WebGL-owned wallpaper + background-only low-res post chain | High | Medium | Low–medium | **MVP 1.** Strong visual return; Sources remain sharp and projection is unchanged. |
| Render complete scene to texture and globally post-process it | High | High | High | Defer/reject as default; Source text is exposed to blur/aberration and visual edges can diverge from hit expectations. |
| Apply per-Source chromatic/blur effects in the existing Source shader | High | Low–medium | Medium | Reserve for short transitions only; product `flat-neutral` currently bypasses this path and continuous use harms text. |

### Goal 2 — convincing frosted glass

#### Can a current Source sample already-composited layers?

No. The current Source pass has only its own HTML texture, and the draw target is the default framebuffer (`renderer.ts:202-203`, `renderer.ts:415-440`). The CSS wallpaper is outside WebGL. Sampling a color attachment while simultaneously rendering into the same texture would also create a framebuffer feedback loop; a separate snapshot/texture is required.

CSS `backdrop-filter` inside a Source is not an architectural substitute. `texElementImage2D` snapshots the Source DOM before this renderer later composites environment and other Source textures. The Source snapshot therefore has no access to the later WebGL scene behind it. It may filter content within its own DOM painting context, but not the renderer's already-composited pixels.

#### Required compositor shape

For true inter-window glass, use this order for each window back-to-front:

```text
sceneColor FBO already contains:
  wallpaper + atmosphere + particles + Docks + lower windows
      |
      +-- blit/downsample to backdrop A (separate texture)
      +-- horizontal/vertical blur A <-> B at reduced resolution
      +-- draw current window glass underlay into sceneColor, sampling B
      +-- draw current HTML Source texture sharply into sceneColor
      v
next window sees the newly composited result
```

The backdrop snapshot must occur before the current window. The blur shaders must never sample the current Source texture. A glass underlay can use Source alpha as a coverage mask, or a dedicated pane mask if tabs/body need different material. The existing exact Source pass can then remain sharp and authored-color preserving on top. However, the current 84% body fill (`spatial-shell.css:7`, `spatial-shell.css:527-535`) leaves only 16% backdrop visibility, so convincing glass also requires lowering/rebalancing the body tint alpha and adding glass contrast/saturation in the underlay.

The recommended design uses one full-resolution scene color attachment plus two reduced-resolution backdrop textures. Before each window, bind scene color as `READ_FRAMEBUFFER`, a separate low-resolution target as `DRAW_FRAMEBUFFER`, and downsample with `blitFramebuffer`; blur only that copy. The current window then writes to scene color while sampling the distinct blurred texture, so no feedback occurs. Resolve/composite scene color to the default framebuffer after foreground drawing.

An implementation may instead call `copyTexSubImage2D` from the default framebuffer before each window. That is technically feasible after moving the wallpaper into WebGL, but repeated copies can serialize the pipeline and make clipped-coordinate handling harder. A scene FBO gives clearer ownership, resize, restore, and final-composite semantics.

#### Glass option matrix

| Option | Samples wallpaper | Samples lower windows | Architectural cost | Performance risk | Recommendation |
|---|---:|---:|---:|---:|---|
| CSS `backdrop-filter` in Source | No WebGL scene | No | Low | Low | Not viable for renderer glass. |
| Shared blurred environment texture | Yes, after wallpaper migration | No | Medium | Low–medium | Acceptable interim material, but overlapping windows reveal the approximation. |
| Per-window `copyTexSubImage2D` from default framebuffer | Yes | Yes | Medium–high | High/stall-prone | Prototype only; measure in target Chromium. |
| Scene color FBO + per-window low-res backdrop snapshot/blur | Yes | Yes | High | Medium–high | **Recommended true-glass architecture.** |
| Full-resolution scene ping-pong and blur per window | Yes | Yes | Very high | Very high | Avoid. |

#### Memory and antialiasing risk

The renderer enforces an internal raster scale of at least 2 (`renderer.ts:92-94`, `renderer.ts:172-189`). At a 1920×1080 CSS viewport, one RGBA8 full-scene texture is therefore approximately 3840×2160 = 31.64 MiB. A blur pair at CSS resolution adds about 15.82 MiB; at 960×540 it adds about 3.96 MiB. A default 58%×72% window texture at the same minimum scale is approximately 2228×1556 = 13.22 MiB before multiple windows (`design.md:149-150`).

Keep blur targets at half or quarter backing resolution, cap blur taps/radius, reuse one pair for all windows, and expose target allocation in metrics. Also note that context antialiasing is requested for the default framebuffer (`capabilities.ts:92-106`), but a texture-backed user framebuffer is not automatically multisampled. Moving all Sources into a scene FBO may require a multisample renderbuffer plus resolve/blit, or explicit edge AA; this adds memory and lifecycle cost.

All new programs, textures, framebuffers, and optional renderbuffers must participate in initialize, resize replacement, context-loss abandonment, context restore, failed-restore cleanup, and disposal alongside current resources (`renderer.ts:275-322`, `viewport-controller.ts:664-693`).

### Goal 3 — Canvas-native open/close/minimize animation

The current state model cannot stage an exit animation. `minimize()` immediately marks the window minimized/released (`window-session.ts:81-96`), the shell immediately deletes its Source texture (`SpatialDesktopShell.vue:260-275`), and successful close immediately splices the keyed Source DOM (`window-session.ts:98-113`, `SpatialDesktopShell.vue:277-285`). The DOM is retained correctly while merely minimized, but there is no presentation phase between command and terminal state.

Add a presentation lifecycle independent of logical geometry and texture ownership, for example:

```text
capturing-open -> opening -> visible
visible -> minimizing -> minimized/released
minimized/released -> capturing-restore -> restoring -> visible
visible -> guard-pending -> closing -> removed
```

Important sequencing:

- **Open:** mount the keyed Source, request capture, and start the visual open only after `onSourceReady`; input remains unavailable until the first valid upload and transition completion. The current restore callback already proves a valid uploaded generation (`viewport-controller.ts:478-487`).
- **Minimize:** mark `minimizing`, remove it from projected input, retain DOM and texture, animate toward the projected task-icon anchor, then mark minimized and release the texture. Do not let the current CSS `minimized` predicate hide it before the animation (`SpatialWindowSurface.vue:3-7`).
- **Restore:** keep the DOM state, recreate/upload the Source texture, then animate from the task-icon anchor; expose input only when visible.
- **Close:** run the async guard before any close visual/state mutation. A veto remains a strict no-op (`window-close-guards.ts:13-15`; `window-session.ts:98-112`). On approval, mark `closing`, retain DOM/texture until animation completion, then splice/unmount and forget the guard. Ignore or coalesce repeated close requests while guard/close is pending.
- **Reduced motion:** use duration zero and run the same completion path immediately; do not leave a Source in an intermediate phase. The scheduler already treats `transition` as a motion reason (`frame-scheduler.ts:30-35`) and suppresses continuing it in reduced motion (`frame-scheduler.ts:116-129`).
- **Context loss/unmount:** MVP behavior should snap active transitions to their terminal state before/while resource recreation, rather than retaining stale GPU-only progress. Shell disposal must cancel completion callbacks before renderer disposal (`SpatialDesktopShell.vue:423-428`, `viewport-controller.ts:365-392`).

Distinctive but tractable effects are a curved-mesh fold/unfold for open/close and a nonlinear fold-to-task-anchor for minimize/restore. The task anchor is inside the posed status Source, so its planar DOM center should be projected through that Source's pose before becoming the animation target; using its raw DOM rect would miss visually at curved/posed Dock edges.

For the MVP, transitioning Sources should be unavailable to projected input. A shader-only fold changes visual geometry without changing the CPU inverse, and scale near zero makes inversion unstable. Disabling hit participation preserves honest visual/input agreement and is appropriate while a window is opening, minimizing, or closing. If product requirements later demand interaction during transition, every animated translation/scale/bow term must be added to both `SURFACE_VERTEX_SHADER` and `projection.ts`; those files are explicitly lockstep today (`shaders/scene.ts:16-20`, `projection.ts:439-453`).

The current `beforeRender` hook can advance product transitions and return the existing `transition` reason (`viewport-controller.ts:74-89`, `viewport-controller.ts:433-475`), but the renderer needs per-window kind/progress/anchor rather than the current one global `transitionStrength`. Prefer typed scene/presentation data over a shell-wide scalar. DOM paint/upload should remain dirty-driven; transition frames should reuse the latest Source texture rather than recapturing HTML every frame.

#### Animation option matrix

| Option | DOM state | Input agreement | Architectural cost | Performance risk | Recommendation |
|---|---:|---:|---:|---:|---|
| CSS transform/opacity on Source DOM | Retained | Fragile; upstream drawing ignores Source CSS transforms and capture timing differs | Low | Low | Not Canvas-native and not reliable here. |
| Per-Source mesh transition with input gated | Retained | Strong: no false hit during divergent geometry | Medium | Low–medium | **MVP 2.** Best value/risk ratio. |
| Per-Source transition with live CPU/GPU inverse | Retained | Strong if perfectly lockstep | High | Medium | Only if interaction during transition becomes required. |
| Remove DOM immediately and animate a copied proxy texture | Lost on close; awkward on minimize | N/A | High | Medium | Avoid; complicates guards, state, capture, and disposal. |

### Constraints that must change

| Existing constraint | Required change |
|---|---|
| PRD forbids background blur and glow for Docks/windows (`prd.md:68`) | Continue forbidding selection glow, text bloom, and Dock blur; explicitly allow scoped environment bloom and a window backdrop/glass pass. |
| Wallpaper must remain CSS `cover` with no blur, grading, or overlay (`prd.md:70`; `design.md:234`) | Transfer the bundled image to a WebGL-owned texture with equivalent centered-cover sampling; permit environment-only post-processing. |
| Window body is an 82–86% flat plane and flat-neutral shader returns exact texels (`prd.md:75`, `prd.md:91`; `design.md:232`) | Lower/rebalance pane tint alpha; preserve the sharp Source pass, but allow a separate glass underlay sampling a pre-window backdrop. |
| Product windows receive no GPU underlay (`design.md:206`) | Permit a material underlay whose sole purpose is scoped backdrop sampling; continue forbidding diagnostic shadow/rim/active-glow decoration. |
| Render order is fixed on the default framebuffer and must not use a Source framebuffer (`spatial-ui.md:63`) | Permit scene/background render targets and final resolve while preserving independent per-Source meshes, painter order, and reverse-z input. Continue forbidding one global curved composite. |
| Transparent provider leaves product wallpaper in CSS (`spatial-ui.md:65`) | Replace product use with a context-restorable static image provider; retain transparent/procedural providers for consumers that need them. |
| Particles/effects must not create fog (`spatial-ui.md:68`) | Keep the no-screen-filling-fog/readability rule; allow restrained background atmosphere/bloom. |
| Depth-of-field blur is out of scope (`prd.md:116`) | Keep it out of scope; clarify that pane-local backdrop blur is a material effect, not camera/scene depth-of-field. |

Constraints that should **not** change:

- Source DOM remains layout, semantics, focus, form, and state authority (`prd.md:22`, `prd.md:52`).
- Per-Source visual geometry and projected input derive from the same pose, with no global curve (`prd.md:57-64`).
- Painter order remains environment -> Docks -> windows back-to-front -> foreground, with input in reverse (`spatial-ui.md:63-64`).
- Close guards run before mutation and veto is a no-op (`prd.md:53`).
- Reduced motion preserves final focus, size, z, route, and lifecycle results (`prd.md:64`).
- Source text is never included in a blur/bloom/distortion pass; only its transient mesh position may animate.

### External references

- [WICG HTML-in-Canvas living explainer](https://github.com/WICG/html-in-canvas), accessed 2026-08-01. It remains a flag-gated Chromium proposal (`chrome://flags/#canvas-draw-element`), not a versioned standard. It documents direct Canvas children, snapshot/paint timing, `texElementImage2D`, and that CSS transforms on Source elements are ignored for drawing while still affecting hit testing/accessibility.
- [WebGL 2.0 Specification](https://registry.khronos.org/webgl/specs/latest/2.0/), latest living specification accessed 2026-08-01. Relevant boundaries are user framebuffer attachments, read/draw framebuffer binding, and the prohibition on texture/framebuffer feedback.
- [MDN `framebufferTexture2D`](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/framebufferTexture2D), accessed 2026-08-01 — attaches a texture to a user framebuffer.
- [MDN `blitFramebuffer`](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/blitFramebuffer), accessed 2026-08-01 — transfers pixels between separately bound read and draw framebuffers.
- [MDN `copyTexSubImage2D`](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/copyTexSubImage2D), accessed 2026-08-01 — copies pixels from the current framebuffer into a texture sub-image; viable for a prototype backdrop capture but potentially synchronization-heavy.

### Related specs

- `.trellis/spec/platform-web/frontend/spatial-ui.md:57-68` — WebGL2/Source/pass/environment contracts that need scoped revision for render targets and glass.
- `.trellis/spec/platform-web/frontend/spatial-ui.md:80-94` — capability, reduced-motion, context-restore, transparent-frame, and overlap behavior that must remain testable.
- `.trellis/spec/platform-web/frontend/spatial-ui.md:108-113` — required unit/package/browser verification surface for later implementation.
- `.trellis/spec/platform-web/frontend/state-management.md:13` — closing unmounts desktop content; merely open/minimized windows retain component state.
- `.trellis/tasks/07-31-spatial-desktop-shell/design.md:191-206` — current per-source compositor and deterministic z order to preserve while changing framebuffer ownership.
- `.trellis/tasks/07-31-spatial-desktop-shell/design.md:217-226` — projected input and reduced-motion invariants.

## Caveats / Not Found

- No tests were run, per request.
- The target Chromium HTML-in-Canvas implementation is experimental. The exact alpha convention of `texElementImage2D`, CSS filter/backdrop behavior inside captured Sources, paint timing during transitions, and framebuffer-copy performance require Flag-enabled browser validation.
- The WICG source is a living explainer with no stable release version; GitHub's unauthenticated API rate limit prevented pinning the current commit SHA during this research. The document was read directly from `main` on 2026-08-01.
- No existing render-to-texture, blur, backdrop-capture, multisample resolve, or per-window transition-state implementation was found in product code. `ContextResourceRegistry` has framebuffer bookkeeping only.
- No target GPU memory/time budget is recorded. The numerical estimates above are allocation sizes, not measured residency or frame cost; validate on the minimum supported desktop hardware before allowing an unbounded visible-window count with glass.
- A glass mask derived from Source alpha is feasible but may couple material strength to text/control antialiasing. A dedicated pane mask or separate material metadata may be needed after visual prototyping.
