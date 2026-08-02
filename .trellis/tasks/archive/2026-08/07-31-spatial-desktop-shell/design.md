# Spatial Desktop Shell Technical Design

## 1. Deliverable and Boundary

This child turns the accepted Spatial engine into a development-only platform shell. It owns mode selection, boot gating, a shell-neutral app registry, the reusable product viewport controller, the spatial window session, launch/status/window chrome, route synchronization, and placeholder surfaces for not-yet-adapted apps.

It does not implement domain panels. A route can prove identity and window behavior through a native Spatial placeholder, but no RetroOS route view may be mounted inside the canvas. Production remains RetroOS-only until release integration explicitly opens the gate.

## 2. Target Topology

```text
App boot
  -> initialize platform host + preheat platform config
  -> resolve requested uiMode against build gate + device hints
      -> RetroOS DesktopShell
      -> dev-only dynamic SpatialDesktopShell
            -> capability acquisition / fallback event
            -> shell-neutral PlatformAppRegistry
            -> SpatialWindowSession + per-window pose model
            -> layoutsubtree Canvas
                 -> launcher/status direct Sources
                 -> one direct Source per open window
            -> transparent projected input plane
            -> SpatialViewportController
                 -> capabilities / textures / renderer
                 -> scheduler / projected input / lifecycle
```

The HTML source tree remains authoritative. The renderer reads the same final Source border boxes that DOM target resolution uses.

## 3. Platform Configuration and Boot

Extend the config root:

```ts
type PlatformUiMode = "retro" | "spatial"

interface PlatformConfigAppearance {
  uiMode: PlatformUiMode
}
```

- `DEFAULT_PLATFORM_CONFIG.appearance.uiMode` is `retro`.
- `mergePlatformConfig()` normalizes only the mode field and adds the section when absent; malformed appearance data falls back field-locally rather than resetting provider/tunable sections.
- `cloneConfig()` and `PlatformConfigSectionKey` include appearance.
- A pure `platform-ui-mode.ts` owns mode eligibility and the save/reload command. Location/config dependencies are injectable in tests.

`App.vue` introduces a neutral `booting | retro | spatial` state. It awaits platform host initialization and config preheat before mounting a shell. Auth, update checks and orphan cleanup remain non-blocking after the host is ready.

One release resolver owns exposure:

```ts
resolveUiMode({ requested, dev, releaseReady, finePointer, viewport })
```

- `releaseReady` is false in this child.
- Development can resolve `spatial`; production resolves `retro` while the gate is false.
- The Spatial component is loaded through a development/release-gated dynamic import, not a top-level import.
- Actual WebGL2/HTML-in-Canvas acquisition happens inside Spatial shell startup. Failure emits a typed fallback to `App.vue`; App mounts RetroOS without saving a different preference.
- A viewport below the supported desktop minimum or loss of eligibility also falls back without mutating config.

The existing RetroOS Settings presentation gets an Appearance screen only when Spatial is selectable by the build gate. The same command is exposed by a small local-only Spatial status action so developers can always return to RetroOS. Later System-surface work reuses the command in the Spatial Control Panel.

## 4. Shell-Neutral Application Registry

Create a focused `platform-apps.ts` (exact name may vary) with pure route identity and shell-specific presentation metadata:

```ts
interface PlatformAppDefinition {
  appId: PlatformAppId
  route: PlatformRouteDefinition
  identity: PlatformWindowIdentityPolicy
  label: string
  shortLabel: string
  title: string
  caption: string
  icon: Component
  retro: PlatformWindowPresentation
  spatial: SpatialPresentationRegistration
}

interface SpatialPresentationRegistration {
  readiness: "pending" | "ready"
  component?: Component
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
}
```

Registry rules:

- Stable ids and query/param parsing live in pure helpers testable without Vue Router.
- Router records, RetroOS window inputs, launchers and Spatial descriptors derive from one definition set.
- `desktop-apps.ts` remains a compatibility barrel/adaptor so existing consumers and before-close id helpers do not break.
- Singleton Play and parameterized detail/editor/media identities stay unchanged.
- A missing Spatial component resolves to `SpatialPendingAppSurface`, never to the Retro component.
- Later panel children change only their Spatial registration plus owned presentation modules; they do not fork route identity or business actions.

## 5. Reusable Spatial Viewport Runtime

`SpatialViewportController` is the engine-level product runtime boundary. It owns:

- capability acquisition and typed unsupported results;
- renderer, element-texture registry and paint synchronization;
- frame scheduler, reduced motion, visibility, resize and context restore;
- parallax and product frame hooks;
- per-surface pose projection/inversion, projected target resolution, pointer routing, native controls and focus;
- source release/restore/dirty requests and deterministic disposal.

The controller accepts narrow callbacks for source enumeration, pre-render scene updates, status/metrics and product-specific activation reporting. The retired `spatial-lab.html` and `src/spatial/lab/` adapter/probe UI are deleted once the product shell supersedes their visual and interaction coverage; the engine must not retain lab-only branches or imports.

## 6. Window Layout and Default Size Model

Use a dedicated pure session core plus a thin Vue composable:

```ts
interface SpatialWindowGeometry {
  worldX: number
  worldY: number
  width: number
  height: number
  sideDepth: number
}

interface SpatialWindowState extends SpatialWindowGeometry {
  id: string
  descriptor: PlatformWindowDescriptor
  zIndex: number
  minimized: boolean
  textureState: "active" | "released" | "restoring"
}

interface SpatialWindowPose {
  centerX: number
  centerY: number
  depth: number
  /** Actual rigid rotation in radians. */
  yaw: number
  pitch: number
  scale: number
  /** Horizontal cylindrical half-arc in radians. */
  curveHalfAngle: number
}

```

- World coordinates are independent of the active route and remain stationary when focus changes.
- `focusWindow()` raises z-order and restores if needed; it does not set a camera target or rewrite window geometry.
- Source planar rects remain the semantic/layout authority. A pure `windowGeometryToPose()` derives the rendered 2.5D pose from the rect, viewport and smooth side depth; it never depends on active/focus state.
- Spatial registration/default placement uses a viewport-relative readable target: about 58% of width and 72% of height on a 1920×1080 viewport, clamped by per-app minimums and reserved launcher/status recovery space.
- Wheel does not mutate window geometry. Window dimensions change only through resize handles; background-wheel camera zoom is explicitly deferred.
- Drag uses screen/client deltas to update world position so a rotated window tracks the pointer naturally. Resize operates in inverse-projected Source-local CSS coordinates and updates world size with min constraints.
- On drag/resize completion, a smooth side-band function may update `sideDepth` and therefore derived `depth/yaw/pitch/scale`. It never snaps to slots, quantizes horizontal position, or reacts merely to focus.
- Viewport resize clamps enough title/chrome area to remain recoverable but preserves world order.

Window commands are pure/stateful functions with unit tests. Vue components only translate mapped pointer/keyboard events into commands.

## 7. Canvas and Source Structure

```html
<section class="spatial-desktop-shell">
  <SpatialWallpaperRing />
  <SpatialWallpaperClock :timestamp="clockTimestamp" />
  <canvas layoutsubtree class="spatial-desktop-canvas">
    <SpatialLauncherSurface data-spatial-source="shell:launcher" />
    <SpatialStatusSurface data-spatial-source="shell:status" />
    <SpatialWindowSurface
      v-for="window in orderedWindows"
      :key="window.id"
      :data-spatial-source="`window:${window.id}`"
    />
  </canvas>
  <div class="spatial-input-plane" aria-hidden="true" />
</section>
```

Each component renders exactly one direct Source root. No extra wrapper may appear between a Source and Canvas.

- `SpatialWallpaperClock` is deliberately not a Source component: it is an ordinary root-level DOM decoration between the shell's CSS wallpaper and the transparent WebGL Canvas. It has no panel/background or pointer participation, receives a once-per-second timestamp from the shell, formats hour/minute/seconds/date locally, and uses stable tabular geometry so digit changes do not shift its placement. Its `10.4vh` common-viewport bottom target moves it about 39 CSS px lower than the prior `14vh` baseline at 1080p; layered warm-white 22%, restrained red 8%, and dark 52% drop shadows provide halo/readability without a backing surface. Canvas-composited windows naturally occlude it.
- `SpatialWallpaperRing` is a separate ordinary-DOM SVG sibling behind the clock. It contains two dashed rings with 72s/96s opposite rotations and 72 deterministic radial bars whose normalized decorative amplitude is isolated at one data seam for later real analyzer replacement. It has no Source marker, input, audio API, or audio-responsive claim; reduced motion removes all ring/bar animation while retaining the static SVG.
- `SpatialLauncherSurface` and `SpatialStatusSurface` restore the original vertically centered continuous capsule silhouette at the same safe viewport inset (`clamp(48px, 4vw, 72px)`). Each direct Source root draws one flat, low-opacity gray-white capsule with a soft warm-white outline so it belongs to the same visual family as the decorative ring, window frame and clock. The left Source contains launcher controls only; opened-window tasks live only in the right Source, followed by minimize-all and return-Retro utilities. No connector rail or cut-corner marker remains.
- The right Dock status/readiness readout is deleted. Renderer state and window count remain available through the existing typed viewport snapshot for fallback/diagnostics logic but are not rendered as permanent desktop chrome. Time belongs exclusively to the wallpaper clock and is not passed into `SpatialStatusSurface`.
- Because these Sources are direct children of the experimental `layoutsubtree` Canvas, CSS owns only their size and appearance. `SpatialDesktopShell` reads the actual shell viewport plus each Dock's rendered dimensions and writes explicit pixel `translate3d` positions, following the same proven planar-layout authority as windows. Percentage positioning, `right`/`bottom`, and viewport units are not used for Source placement because the target implementation does not expose a reliable containing block for them.
- Each Dock list retains every semantic button and constrains only its scroll viewport to five 48px circular items with four 9px gaps (276px total). Projected wheel/trackpad input scrolls the inner list vertically, visual scrollbars stay hidden, keyboard focus can still reach every item, and minimized task icons remain mounted/muted until restored or closed.
- Dock colors reuse the window system's warm-white, charcoal, muted gray and restrained red tokens. Every control keeps a 48px semantic/projected hit box with a flat circular visual surface and centered coplanar icon. Idle controls use a slightly separated translucent gray-white surface with charcoal icon/outline contrast; active launcher/task controls become clearer charcoal with a restrained red accent; minimized tasks reduce opacity; return RetroOS is the only strong red utility.
- All Dock graphics remain strictly flat: no gradient, bevel, highlight, inner/outer shadow, backdrop blur, glow, scale expansion or simulated thickness. Idle/hover/active differences are color, opacity and outline changes only.
- The capsule Source root remains a connected non-zero direct Canvas child. Its explicit pixel layout, list capped at five visible items, hidden scrollbar, semantic button list, keyboard focus and projected wheel routing remain unchanged. The right task collection and utility cluster stay in one Source; the deleted readiness readout is not restored.
- Keyed reordering may put the active window first in logical keyboard order without remounting it.
- Minimized sources remain mounted and non-zero but visually hidden. A minimize request first retains the current texture through the transient particle-ripple presentation; only its completion marks the session minimized and releases the texture. Restore marks the source `restoring`, reacquires and requests paint, then starts center-origin particle reconstruction after a valid upload.
- Closing is the only normal unmount point.
- Dedicated Spatial tokens/styles live under `src/spatial/shell/` or `src/spatial/theme/`; RetroOS global classes are not reused for content chrome.

### Per-source physical 2.5D compositor

The renderer must not flatten all Source textures into one framebuffer and then curve that framebuffer. The environment and particles stay in viewport space; after the environment-only target resolves to the default framebuffer, each Source is rendered independently with its own mesh and pose.

Window Sources keep the two-axis tessellated grid but replace the retired screen-space bow/edge-scale model with a physical local surface. Normalized local X maps to a reference-calibrated, visibly pronounced horizontal cylindrical arc, producing local Z depth while local Y remains the authored Source height. The resulting XYZ vertices receive rigid yaw/pitch rotation about the window center, position-derived depth translation and perspective projection through one viewport focal length. Camera-space Z therefore changes apparent scale, creates genuine edge convergence and supplies clip W for perspective-correct Source UV interpolation. CPU projection evaluates the same vertices and keeps the existing two-triangle grid inverse, so controls follow the visual surface without a separate analytic inverse.

Render and projected-input order are explicit and deterministic:

1. CSS wallpaper, ordinary-DOM wallpaper ring, and ordinary-DOM wallpaper clock below Canvas, then the transparent WebGL environment and particles;
2. launcher/status Dock Sources back to front at scene z 10/11;
3. window Source meshes back to front at session z 101+;
4. shell foreground environment markers after all Sources.

Projected input traverses the same Source z hierarchy in reverse: windows from highest session z downward, then status Dock z 11, then launcher Dock z 10. Thus a projected window overlap occludes Dock visuals and captures the hit before the Dock without changing direct Source roots or pointer-capture behavior.

V1 remains sorted 2.5D composition rather than a navigable 3D world or physics depth buffer. Product windows use no independent projected shadow/rim layer. Their 2–3 CSS px warm gray-white frame is authored inside the Source DOM and captured into the same sharp texture, so focus changes z-order/route but not geometry, pose or frame color, and lifecycle masks cannot leave a detached material pass behind.

## 8. Route and Session Synchronization

- A route watcher resolves a `PlatformWindowDescriptor` and idempotently opens/focuses it.
- Launcher actions resolve the same descriptor, open/focus it, then push its route only when different.
- Focusing, minimizing or closing the active window synchronizes the URL to the next active window or `/` after state transition/guard completion.
- URL state does not encode the complete window list.
- Reload creates only the current deep-linked window with default world geometry.
- before-close handlers remain keyed by the stable registry window id and are called before any Spatial close mutation.

## 9. Input, Accessibility, and Motion

- The full-screen input plane receives trusted pointer/wheel/context events. Candidate Sources are visited front to back; each candidate applies its own inverse pose and local curve to obtain Source UV/CSS coordinates before DOM target resolution.
- `viewportParallaxTarget()` negates both normalized pointer axes before applying the existing limits, so environment and Sources move opposite the pointer while the viewport center remains the zero target. Reset/leave behavior is unchanged.
- Each Source mesh and its CPU inverse share one `SpatialSurfacePose`/curve configuration. Input may not use a global inverse curve or per-control correction.
- Pointer capture retains the chosen Source and inverse configuration for the gesture. Drag and eight-way resize consume Source-local deltas so overlap, yaw and depth do not introduce jumps. If the nonlinear inverse stops converging after the pointer leaves every Source, the captured gesture continuously extrapolates from its last valid local sample instead of stalling until the pointer re-enters the window.
- Window titlebars and resize handles use ordinary semantic buttons/regions in Source DOM. Pointer capture stays in the shared router.
- Launchers and task entries are keyboard-focusable. A small shell command layer supports launcher activation, next/previous open window, minimize and close without requiring a spatial pointer.
- Source roots are never inert. Launcher/status actions retain shell focus visibility. Window content, minimize/close controls and keyboard resize handles remain semantic/focusable but do not draw shell focus outlines or shadows; window controls use restrained charcoal/red hover feedback instead.
- Reduced motion does not change focus or final window state.

## 10. Local Placeholder and Visual Contract

`SpatialPendingAppSurface` displays shell-neutral icon/title/caption and an explicit local-development readiness state. It may contain stateful probe controls used to verify minimize/restore preservation, but it performs no domain mutation and imports no RetroOS view.

The shell reuses the foundation environment boundary while adopting a lighter window language. Window bodies are translucent gray-white at roughly 90–92% alpha with dark readable content and no grid, gradient or authored content texture. A permanent left top-edge tab contains icon/title; a permanent right tab contains minimize/close. Tabs use roughly 94–96% charcoal/red surfaces; placeholder notice/input fills remain visually subordinate. The Source root owns a 2–3 CSS px warm gray-white frame plus an optional 1 CSS px low-contrast inner separator. The outermost top 2–3 CSS px retains resize priority, while an 8–10 CSS px inner top strip provides a broad drag affordance outside the title/control tabs; left, right and bottom edges keep their resize priority. The captured Source texel remains sharp and color-faithful. Floating depth comes from physical pose, perspective, occlusion and the captured frame—not focus decoration, an independent shadow/rim pass or automatic movement. Continuous glitch, active glow, strong text Bloom, broad depth-of-field blur, debug grids and local diagnostics overlays are prohibited.

Revised visual baseline (2026-08-01): product `SpatialDesktopShell` transfers the bundled `src/spatial/shell/assets/spatial-desktop-background.jpg` from the CSS-only layer to a context-restorable WebGL environment texture while preserving identical centered `cover` sampling. The same CSS image remains only as a startup/failure fallback. The product renderer owns an environment-only post-processing chain; generic renderer consumers retain their procedural/default environment path. No Source texture enters the environment chain.

The environment chain uses a restrained cinematic-lens language: center-zero radial RGB separation increasing toward viewport edges, luminance-threshold Bloom localized to the moon and bright particles, a shallow vignette, and fine low-amplitude grain. Low-frequency atmospheric refraction has a typed parameter seam but is not required to be visibly enabled in this iteration. There is no backdrop, pane, depth-of-field, or scene blur. The flat-neutral Source shader remains exact and sharp.

The clock remains true semantic HTML but is promoted to a non-interactive low-z background Source drawn after the processed environment and before Docks/windows. It updates at one-second cadence and preserves the accepted size, position, halo, and dark readability shadows. The decorative ring becomes a renderer-owned GPU decoration pass after environment post-processing: two independently rotating dashed orbits plus deterministic radial bars and sparse pale-red accents. This avoids a continuously repainted large SVG Source texture. The environment particle shader keeps its three depth bands and scheduler contract; it contributes to the environment highlight input before Source composition. Reduced motion freezes ring rotation, particle motion, temporal grain, and future refraction phase without changing the static final composition.

## 11. Failure, Rollback, and Production Isolation

- Capability/shader/context startup failure returns a typed reason to the boot resolver and falls back to RetroOS.
- A context loss after readiness suspends rendering; successful restore recaptures mounted sources. Repeated restore failure presents a local Spatial error action that returns to RetroOS.
- Saved `uiMode` is not silently rewritten by runtime fallback, allowing the user to retry after enabling the Flag or restoring the viewport.
- Disabling the one release gate is the rollback. RetroOS registry presentation and default config remain complete.
- Production build inspection must prove the partial shell is not selectable while the gate is compile-time false; the retired lab page and markers must not exist in source or emitted output.

## 12. Validation Strategy

Automated tests cover config normalization, mode resolution, route/identity extraction, RetroOS compatibility adapters, stationary focus, viewport-relative default sizing, per-window curve/pose round trips, front-to-back overlap resolution, side pose, resize clamp, minimize texture states, before-close veto and reduced motion.

Per-window projection tests verify a monotonic local arc, pose/inverse agreement, visible-edge hit accuracy and stable gesture deltas. Scene tests verify that independent windows keep independent silhouettes and that the topmost projected surface wins overlap resolution. Renderer tests prohibit the old all-sources-to-one-surface/global-curve composition path.

Existing complete Spatial tests remain mandatory after controller extraction. The target Flag-enabled browser matrix verifies startup mode switch, multi-window source capture, stationary focus, readable default window size, a central large window plus side/rear and lower overlapping windows with independent reference-strength curvature/pose, clear occlusion without a detached shadow, no global rubber-sheet deformation, projected drag/resize throughout each visible surface, minimize state preservation, route sync, DPR/resize, reduced motion, unsupported fallback and context restore.

## 13. Environment Post-Processing Revision

### 13.1 Pass ownership and order

The environment foundation adds render targets without reintroducing the rejected all-Sources framebuffer or global curve. At a high level, each frame is:

1. Render the WebGL-owned wallpaper and environment particles into an environment-color target capped independently from the high-resolution HTML Source raster scale.
2. Extract high-luminance pixels into a reduced-resolution Bloom target and run a bounded two-axis blur/ping-pong pass.
3. Composite environment color plus Bloom to the default framebuffer while applying radial RGB separation, vignette, and grain.
4. Draw the renderer-owned decorative ring pass.
5. Draw the low-z semantic clock Source, Docks, and independent window Sources back-to-front with the existing per-Source mesh/pose shader.
6. Draw foreground environment markers last.

Only environment pixels are ever flattened into the environment target. Docks and windows remain independent meshes and preserve the existing reverse-z projected input order. The final environment composite is a color-only full-screen pass; it does not curve or displace Source geometry.

### 13.2 Resolution and resource budget

Environment targets use an effect scale independent of `effectiveRasterScale`: cap the environment color target near CSS-pixel resolution and allocate the reusable Bloom pair at half or quarter of that size. This avoids allocating a 3840×2160 RGBA8 environment target merely because HTML Sources use a minimum 2× capture scale. Bloom tap count/radius is bounded and no target is allocated per window.

Renderer-owned wallpaper image data survives context replacement independently from the context-specific texture. Programs, textures, framebuffers, and optional renderbuffers participate in initialize, resize replacement, context-loss abandonment, restore, failed-restore cleanup, and disposal through the existing resource lifecycle. Framebuffer incompleteness or shader failure falls back to a direct wallpaper draw rather than leaving a blank/half-ready shell.

### 13.3 Effect contracts

- Radial chromatic separation is exactly zero at the viewport center and grows continuously toward the corners; it samples only the environment texture and does not alter alpha.
- Bloom is thresholded from environment luminance, remains localized around the moon/bright particles, and cannot become a screen-filling haze.
- Vignette is shallow and color-preserving; grain is fine, low amplitude, and frozen to a stable sample under reduced motion.
- The existing fixed CSS/SVG RGB filter is removed once the WebGL environment path is ready.
- Static wallpaper and static Bloom do not create a frame reason. Existing particle animation can carry temporal grain; reduced motion removes that continuing reason and keeps a deterministic still frame.
- Low-frequency atmospheric refraction is represented in typed effect options and shader uniforms but defaults to zero until a later reviewed visual pass.

### 13.4 HTML-in-Canvas boundary

The clock demonstrates the intended hybrid boundary: semantic/live HTML remains the Source authority, while WebGL decides z order, occlusion, curvature/presentation, and environment composition. Window and Dock textures continue to use the exact flat-neutral path, so post-processing cannot soften text or create a mismatch between visible controls and projected hits.

The first presentation iteration owns the accepted curved-aperture opening/closing path. The following minimize/restore iteration extends the same typed per-Source boundary with a short-lived texture-sampled particle pass; it does not introduce Dock-anchor geometry or change the stable flat-neutral branch.

## 14. Curved-Aperture Window Lifecycle Motion

### 14.1 Presentation state boundary

Logical window geometry, route identity and mounted application state remain owned by `SpatialWindowSession`. A separate pure presentation controller owns transient state:

```text
capturing-open -> opening -> visible
visible -> guard-pending -> closing -> removed
```

Each entry records source id, phase, start timestamp, duration and normalized progress. The renderer receives an immutable per-source presentation snapshot; it never owns close guards, route mutation or Vue lifetime. Stable `visible` Sources use the existing exact flat-neutral path with no residual transition math.

Opening a new id mounts the Source at final world geometry in `capturing-open`. The Source remains layout-eligible for `texElementImage2D` but is omitted from drawing and projected input. `onSourceReady` starts `opening`; reopening/focusing an already visible id does not replay the animation. Opening completes at approximately 380–440 ms with a monotonic ease-out and then enables normal input.

Closing first awaits the existing async close guard and coalesces repeated requests for the same id. A veto performs no presentation, session, route, texture or focus mutation. Approval starts `closing` for approximately 260–340 ms, retains DOM and texture, and excludes that Source from projected input. Completion performs the existing remove/forget-guard/activate-next/route-sync operations exactly once.

### 14.2 Mesh and fragment treatment

The existing two-axis tessellated Source mesh receives per-draw uniforms for phase/progress. A presentation progress of zero collapses local Y toward a small non-zero center aperture while preserving enough width to read as a curved light slit; progress one restores the exact existing ruled-patch geometry. During expansion/contraction:

- local Y scale grows from a small epsilon to 1;
- shallow presentation-only depth/bow energy decays to the stable window pose;
- alpha ramps without changing the authored Source texture;
- top/bottom aperture boundaries carry a short-lived warm-white/pale-red edge and subpixel chromatic separation.

The stable product branch remains byte-for-byte equivalent in intent to the current `outColor = center` flat-neutral output. Transition fragment sampling is active only while phase is opening/closing. No blur, global post-process, DOM segmentation, per-frame Source upload or permanent glow is introduced.

### 14.3 Input, scheduler and lifecycle

Capturing/opening/closing Sources are excluded before target resolution, so the CPU inverse does not attempt to invert a near-singular animated aperture. Final Source pose and all drag/resize behavior remain unchanged. Keyboard/window commands ignore or coalesce commands that target a non-visible presentation phase.

The scheduler owns a `transition` frame reason only while at least one presentation is active. Frame advancement changes renderer uniforms, not Source dirty state. Multiple windows may animate independently from one scheduler tick.

Reduced motion sets duration to zero and runs the same completion callbacks synchronously. Context loss snaps opening Sources to visible and approved closing Sources to removed before/while resources rebuild. Shell disposal cancels scheduled callbacks and completes or discards them deterministically without calling into a disposed renderer. Resize updates final geometry but does not restart a transition.

### 14.4 Failure and rollback

If presentation shader/program support fails, the shell uses immediate open/close semantics rather than falling back to RetroOS. The rollback is to disable product window presentation options; session/route/guard contracts remain intact. Step 5C extends this same fail-open rule to minimize/restore without changing the accepted aperture implementation.

## 15. Texture-Sampled Particle Ripple Minimize/Restore

### 15.1 Presentation and session lifecycle

The pure presentation controller gains two independent transition paths while `SpatialWindowSession` remains the authority for durable minimized and texture state:

```text
visible -> minimizing -> minimized
minimized -> capturing-restore -> restoring -> visible
```

A minimize control activation computes the button center relative to its owning Source border box and clamps it to local UV. `startMinimizing(windowId, originUv, timestamp, animate)` records that immutable origin and blocks further window commands, but it does not immediately mutate `session.minimized`, hide the Source, release the texture or synchronize the active route. The existing valid texture and mounted DOM remain available through the animation. The `minimize-ready` completion event performs the durable session minimize, texture release, focus selection and route synchronization exactly once.

Minimize-all starts one entry per currently visible window. Every entry uses that window's own minimize-button UV, retains independent timing and finalizes independently; route navigation reaches `/` after the requested set has reached its minimized terminal state. No task-icon projection or cross-Surface trajectory is needed.

Restoring a minimized task first performs the existing session transition to `textureState: "restoring"`, sets presentation phase `capturing-restore`, requests Source restoration and remains renderer-hidden/input-excluded. The first valid upload starts `restoring` from fixed Source UV `{ x: 0.5, y: 0.5 }`; completion enters stable `visible` and enables projected input. The Dock task icon may pulse as ordinary state feedback but does not provide a geometric origin.

### 15.2 Two-pass Source disassembly

Animated minimize/restore windows remain in their normal sorted window layer and issue two adjacent draws so overlap ordering is unchanged:

1. A radial-mask Source draw samples the existing captured texture on the existing tessellated curved mesh. Aspect-correct distance from `originUv` and normalized progress define a narrow soft wavefront. Minimizing removes the intact surface behind the expanding front; restoring reveals the stable flat-neutral surface from the center outward.
2. A bounded GPU point-sprite draw uses a shared deterministic UV seed grid. Its vertex shader samples the same Source texture, projects each seed through the same per-window ruled-patch pose, and activates it when the radial front reaches that UV. The fragment shader renders a compact point carrying the sampled texel RGB/alpha, so text, icons and authored panel colors visibly become particles rather than generic noise.

Particle motion is deliberately local: deterministic UV hashing adds small tangential variation, while radial and shallow presentation-depth impulses move points only a short distance from the window before they fade. A narrow warm-white/pale-red energy band and restrained chromatic split accent the active front. Restore reverses the temporal treatment: sampled particles converge to their texture locations and hand off to the revealed exact flat-neutral surface. Point size, count, travel and trail width are typed product options with conservative defaults; particles never become a full-screen explosion, fog layer or replacement for the separate environment-particle system.

The particle UV/seed buffer is static and shared by all windows; each animated Source reuses its already uploaded HTML texture and adds no per-frame `texElementImage2D`, CPU particle simulation, DOM segmentation or per-window framebuffer. Presentation uniforms carry phase, progress, origin UV and a stable per-Source seed. Stable windows, Docks, clock Sources, and opening/closing aperture draws keep their current shader paths.

### 15.3 Input, scheduling and completion

`minimizing`, `capturing-restore` and `restoring` all block projected input before target resolution. The particle layer is visual-only and never enters hit testing; the normal CPU inverse remains responsible only for stable visible windows. The existing `transition` scheduler reason advances all active ripple entries, and multiple windows can animate without dirtying Source textures.

Reduced motion and unavailable particle-presentation support take the same zero-duration completion path: minimize immediately reaches durable `minimized` and releases its texture; restore still waits for a valid upload, then immediately reaches `visible`. Context loss finalizes active minimizes, keeps restores in capture-required state until resources return, and then reaches visible without replaying stale callbacks. Disposal clears presentation entries and shared particle resources without invoking session or renderer work afterward.

### 15.4 Failure and rollback

Particle program/buffer failure disables only minimize/restore presentation and preserves immediate session behavior; it does not fall back the desktop to RetroOS and does not disable the already accepted aperture open/close path. The rollback is to keep the new lifecycle split but set ripple durations to zero and skip the radial/particle draws, preserving texture-release timing, mounted DOM state and route semantics.

## 16. Final Visual Baseline Cleanup

The environment particle fragment pass keeps three depth bands and deterministic generation, but removes rigid whole-grid motion. Each band combines its broad directional drift with a smooth low-frequency flow field and stable per-cell phase, wobble, speed and size variation. Randomness is analytic and deterministic from cell/seed data so particles do not flicker between frames; reduced motion still freezes the complete field at one stable time.

The intermediate `curveBow = 0.032` plus one-sided `0.17` edge-gain tuning was implemented and manually compared, but remained visually equivalent to bent translucent stickers. It is explicitly superseded by the physical surface/camera design in Section 17 and must not survive as a second geometry path.

The obsolete Interaction Lab is removed as one closed surface: delete `spatial-lab.html` and every file under `src/spatial/lab/`, then remove lab-specific wording or fallback messages from shared engine code. The product shell remains the only Spatial composition UI; engine modules stay framework-neutral.

The right Dock removes its diagnostics action/event/import. `SpatialDesktopShell` removes the diagnostics ref/state/template overlay while retaining the viewport snapshot required for status text and fallback handling. Dedicated `.spatial-local-diagnostics` CSS is deleted; no hidden or unreachable diagnostics panel remains.

## 17. Physical Curved Window Camera Revision

### 17.1 Shared vertex model

The Source DOM remains a planar CSS/layout authority, but every window mesh vertex becomes a true camera-space point. For local normalized coordinates `(lx, ly)` and Source half-size `(hw, hh)`:

```text
arc       = lx * curveHalfAngle
radius    = hw / sin(curveHalfAngle)
localX    = sin(arc) * radius
localY    = ly * hh
localZ    = radius * (cos(arc) - 1)
rotated   = rotatePitch(rotateYaw(vec3(localX, localY, localZ), yaw), pitch)
cameraZ   = depth + rotated.z
persp     = focal / (focal + cameraZ)
screenXY  = windowCenter + rotated.xy * scale * persp + parallax
clipW     = (focal + cameraZ) / focal
```

The zero-curvature branch avoids division by a small sine and returns a planar local vertex. Positive local Z recedes from the camera; the negative edge Z generated by `cos(arc) - 1` brings both horizontal edges toward the viewer, forming the accepted inward wrap around the user. The shader writes `gl_Position = vec4(ndc * clipW, 0, clipW)` after computing perspective screen coordinates, preserving perspective-correct texture interpolation.

One focused engine module owns the CPU transform, focal-length rule, pose validation and projected-bound helpers. GLSL programs use one shared transform chunk/source builder rather than duplicating slightly different formulas across stable Source, aperture and ripple-particle shaders. The retired screen-Y bow and one-sided edge-scale formulas are deleted, not left selectable.

### 17.2 Position-derived pose

`windowGeometryToPose()` maps window-center displacement to physical pose independently of focus. Horizontal displacement normalizes against roughly 32% of viewport width and vertical displacement against roughly 34% of viewport height, not the much larger off-screen recovery travel. A continuous ease-out mapping starts at exact zero but produces readable pose through the common middle range.

Reference product calibration:

- horizontal yaw faces side windows inward toward the viewport center and reaches roughly 18°;
- vertical pitch reaches roughly 8° with symmetric top/bottom signs;
- combined side depth reaches roughly 200 CSS px, naturally reducing apparent scale through the camera projection;
- horizontal curve half-angle stays around 28–30° even for a centered window, matching the pronounced inward-wrap silhouette visible in the single-window reference `codex-clipboard-539026e7...png` and the sole multi-window reference `codex-clipboard-bab542d3...png`; the old/current implementation screenshots `codex-clipboard-3f95272b...png` and `codex-clipboard-6c813afe...png` are negative comparison evidence only;
- focal length is roughly `1.0 × max(viewportWidth, viewportHeight)`, strong enough for the curve's camera-space Z to create visible edge scale without an extra screen-space bow;
- `scale` remains an authored/base multiplier, not a compensating inverse for perspective.

The exact values are product options in one shell presentation object so hot-reload visual tuning does not require editing projection math. Focus and z-order changes never alter these values or animate a stationary window.

### 17.3 Input, drag, resize and recovery

CPU `projectSurfacePoint()` evaluates the same camera-space mesh vertices as the GPU. `unprojectVisibleMeshPoint()` keeps its current front-to-back cell traversal, triangle screen weights and clip-W correction, so semantic controls, text fields and resize handles remain aligned with the physical curve.

Pointer routing carries both screen/client delta and Source-local delta for captured gestures. Window title drag consumes screen delta to update `worldX/worldY`; resize consumes Source-local delta to preserve authored CSS dimensions under yaw/pitch. This separation prevents rotated windows from lagging or accelerating during drag.

Recovery clamp samples the projected mesh boundary plus the title/control anchors after pose calculation. It iteratively adjusts planar world center until the required title/control area remains inside the viewport; it does not infer recovery from `width * scale` alone. Viewport resize uses the same path.

### 17.4 Source frame and painter order

Windows remain sorted by session z. Each window has one product material draw: the sharp captured Source texture or its active lifecycle presentation. The Source root includes the 2–3 CSS px warm gray-white frame and optional 1 CSS px inner separator inside its existing border box, so the frame follows the exact physical mesh, UV mapping and perspective interpolation of the content.

The renderer removes product shadow/rim programs, buffers, options and adjacent draw calls instead of retaining zero-alpha dormant passes. Window body alpha remains about 90–92%, while title/control tabs reach about 94–96%, so overlap reads as occlusion instead of additive wallpaper mixing. No environment blur, backdrop sampling, replacement drop shadow, active glow or text Bloom is introduced in this revision.

### 17.5 Lifecycle integration

Opening aperture deformation modifies local Source geometry before the cylindrical/rigid/camera transform. Minimize/restore ripple mask samples Source UV unchanged, while point particles—including frame-colored samples—anchor to the same physical local surface before receiving their short presentation displacement. Stable, opening, closing, minimizing and restoring frames therefore share one final pose and cannot snap between screen-space and camera-space models. When the ripple removes a texel region, it removes the frame in the same pass; texture release therefore cannot leave a shadow or rim frame behind.

Physical projection itself is the only supported product window geometry; if its program cannot initialize, the existing typed renderer failure/fallback path applies rather than silently reviving the retired sticker transform. Reduced motion changes lifecycle duration only, never final geometry.

### 17.6 Rollback boundary

Rollback uses the same physical transform with zero yaw/pitch/depth/curve options, producing a planar window while preserving CPU/GPU/input contracts. It does not restore the deleted screen-space bow, edge-gain, GPU shadow/rim, focus decoration, Lab, or diagnostics overlay implementations.
