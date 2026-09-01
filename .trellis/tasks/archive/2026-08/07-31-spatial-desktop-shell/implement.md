# Spatial Desktop Shell Implementation Plan

## Preconditions

- Parent requirements plus the archived foundation's capability/capture/native-input/lifecycle contracts are authoritative; its global compositor shape is explicitly superseded.
- The task is already `in_progress`, but implementation pauses while this revised compositor design is reviewed. Product code resumes only after the user approves the final revised summary in a later turn.
- Preserve all unrelated worktree changes. The active task directories are currently untracked user/project planning work and must not be deleted or reset.
- Do not adapt domain panels or enable the production Spatial release gate in this child.
- For the current visual iteration, do not run tests, builds, type-check, lint, `git diff --check`, browser automation or assistant-side runtime verification. The user owns hot-reload visual acceptance; the post-implementation check is source review only.

## Step 1 — Config, Mode Resolver, and Neutral Boot

- [ ] Add `PlatformConfigAppearance` and `appearance.uiMode` to defaults, normalization, section keys and deep clone.
- [ ] Add pure build/device/mode eligibility and save-then-reload helpers with injectable environment dependencies.
- [ ] Refactor `App.vue` to wait for host initialization plus config preheat before shell mount.
- [ ] Keep auth, update refresh and attachment cleanup non-blocking after readiness.
- [ ] Add typed runtime fallback from Spatial to RetroOS without mutating saved preference.
- [ ] Add focused config/mode tests, including pre-Spatial config files and malformed appearance fields.

Validation:

```powershell
npm test -- --run apps/platform-web/src/config
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
```

Review gate: no localStorage mode key, no RetroOS flash, and no production-selectable Spatial path.

## Step 2 — Shell-Neutral Registry Extraction

- [ ] Create one registry for route definitions, stable app metadata, instance identity and per-shell presentation defaults.
- [ ] Move parameterized route/query parsing into pure helpers.
- [ ] Derive router records, RetroOS launchers/window inputs and Spatial descriptors from the registry.
- [ ] Keep `desktop-apps.ts` compatibility exports and exact existing ids used by before-close guards.
- [ ] Register pending Spatial presentations without importing RetroOS views into Spatial sources.
- [ ] Add tests for every ordinary, singleton, detail, editor and media route plus invalid parameters.

Validation:

```powershell
npm test -- --run apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/composables/useDesktopWindows.test.ts
npm run build:web
```

Review gate: RetroOS route/deep-link behavior and public helper ids are unchanged.

## Step 3 — Shared Viewport Controller Extraction

- [ ] Keep capability/renderer/scheduler/input/lifecycle behavior in the framework-neutral product-capable `SpatialViewportController`; do not restore the retired Lab adapter or probe UI.
- [ ] Add source enumerate/sync/release/restore/dirty APIs and a pre-render scene hook.
- [ ] Replace the global projection dependency with per-Source pose/curve configuration shared by renderer and input inversion.
- [ ] Preserve context loss/restore, page visibility, reduced motion, native control and resource teardown behavior.
- [ ] Run focused controller/projection/input tests during visual iteration; defer the complete Spatial suite to Step 8 after manual shape approval.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
```

Browser gate: rerun the existing lab's center/edge click, text/IME, picker, drag/resize, scroll and context-restore probes after extraction.

## Step 4 — Pure Spatial Window Session and Layout

- [ ] Implement window open/focus/move/resize/minimize/restore/close/minimize-all/clamp commands.
- [ ] Implement stable world coordinates, z order, readable viewport-relative default sizing and texture state transitions.
- [ ] Remove focus-driven camera target/step behavior; focus must not change Source layout or world coordinates.
- [ ] Remove per-window wheel zoom and its policy/state/tests; keep wheel available for ordinary content scrolling and defer camera zoom.
- [ ] Keep planar Source layout authoritative and derive an immutable per-window `SpatialSurfacePose` for rendering/input.
- [ ] Implement smooth side-band `depth/yaw/pitch/scale` without slots or coordinate quantization; focus must not mutate pose.
- [ ] Reuse stable before-close ids and test veto/no-mutation behavior.
- [ ] Add dense pure tests for stationary repeated focus, default viewport sizing, centered physical curve symmetry, camera-space XYZ/clip-W agreement, yaw/pitch/depth growth through ordinary viewport positions, projected recovery bounds, grid/diagonal continuity, overlap and viewport resize.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial/shell
```

Review gate: focusing changes only active state/z-order/route; no Source geometry moves. Wheel does not mutate window geometry.

## Step 5 — Spatial Shell Source DOM and Visual Primitives

- [ ] Add `SpatialDesktopShell.vue`, direct-child launcher/status/window sources, input plane and dedicated styles/tokens.
- [ ] Move time out of `SpatialStatusSurface`; add a timestamp-driven semantic wallpaper clock component with stable hour/minute/seconds/date typography and no backing panel, ready to become the low-z background Source in Step 5A.
- [ ] Move the wallpaper clock about 35–45 CSS px lower at a common 1080p viewport and add only layered warm-white/red halo plus dark readability drop shadows.
- [ ] Define the wallpaper ring's deterministic two-orbit, 72 varied radial-bar and pale-red-accent presentation data independently from input/DOM state so Step 5A can render it as a GPU decoration pass.
- [ ] Convert the existing launcher/status Sources into mirrored safe-inset circular Docks: launcher-only on the left, tasks plus compact utilities on the right, with five visible icon buttons and hidden-scrollbar vertical overflow while retaining every semantic button.
- [ ] Align both Docks with the window off-white/charcoal/red tokens and remove capsule/button/active/status shadows and glow.
- [ ] Reverse `viewportParallaxTarget()` on both axes and update its focused static expectations without changing recenter policy.
- [ ] Wire the shared viewport controller to the shell's Source enumeration and layout hook.
- [ ] Remove the all-sources surface framebuffer/global curve composite from the product path; keep environment/particles stable in viewport space.
- [ ] Rework only the environment particle fragment shader into denser, 5–8× faster three-band warm-white/pale-red points with compact cores, restrained halos and clamped straight-alpha output; preserve provider, scheduling, dirty-upload and reduced-motion behavior.
- [ ] Add a reusable two-axis tessellated ruled-patch Source mesh: fixed symmetric local bow, independent horizontal/vertical edge gradients, uniform recession, correct Source UV orientation and exact CPU/GPU triangle projection/inversion.
- [ ] Assign launcher/status Dock Sources scene z 10/11 below window session z 101+, draw Docks before windows, sort windows back to front, keep foreground markers last, and preserve the matching reverse-z projected-input order.
- [ ] Keep product windows free of active glow and decorative heavy borders; use a readable 90–92% gray-white Source body, 94–96% protruding tabs, and a narrow warm gray-white frame captured inside the Source texture. Preserve sharp captured Source content and do not restore diagnostic-only render paths.
- [ ] Resolve projected input front to back per Source, retain the selected pose through pointer capture, and drive drag/eight-way resize from Source-local deltas.
- [ ] Replace the full-width `SpatialWindowSurface` titlebar with permanent left title/drag and right control protruding tabs; retain semantic buttons and eight projected resize handles without window focus frames.
- [ ] Add native Spatial pending-app content for all not-yet-adapted routes.
- [ ] Keep every non-closed Source mounted; implement texture release/restoring-before-visible for minimize/restore.
- [ ] Keep engine status/fallback snapshots internal to the product shell; do not add a local diagnostics toggle or overlay.

Review gate:

- every drawable root is a direct Canvas child;
- the wallpaper clock remains semantic HTML and the ring remains deterministic/non-interactive; their final renderer composition and reduced-motion behavior are gated in Step 5A;
- Dock Sources render and hit-test behind every window while foreground environment markers remain after windows;
- no `retro-*` content surface or RetroOS view is rendered inside Spatial;
- shell/window/style responsibilities remain split by module seam.
- moving/resizing one window cannot deform another Source or the environment;
- focus changes z-order/emphasis only and leaves geometry/pose stationary;
- the old global rubber-sheet curve is absent from the product renderer.

## Step 5A — WebGL Environment Post-Processing Foundation

- [ ] Replace the product-only transparent/CSS wallpaper path with a context-restorable bundled-image environment provider that preserves the current centered `cover` crop; keep the same CSS image only as startup/failure fallback.
- [ ] Add renderer-owned environment-color plus reduced-resolution Bloom targets, programs and resize/restore/dispose lifecycle. Cap environment resolution independently from the HTML Source capture scale and reuse one Bloom ping-pong pair.
- [ ] Render wallpaper and environment particles into the environment target, extract/blur only luminance above a bounded threshold, and composite to the default framebuffer with center-zero radial RGB separation, restrained vignette and fine grain.
- [ ] Add typed effect options/uniforms, including a default-zero low-frequency atmospheric-refraction seam; keep every option product-scoped so generic procedural renderer consumers remain unchanged unless explicitly configured.
- [ ] Replace the root SVG/CSS RGB split and animated DOM ring with a renderer-owned GPU decoration pass that preserves the accepted two counter-rotating dashed orbits, deterministic radial bars, pale-red accents and reduced-motion still state.
- [ ] Promote the wallpaper clock to a non-interactive low-z HTML Source drawn sharply after the environment/ring and before Docks/windows; preserve its accepted typography, placement, cadence and occlusion.
- [ ] Keep Dock/window Source textures entirely outside the environment chain and preserve the exact flat-neutral color/alpha path, painter order, reverse-z input, pointer capture and CPU/GPU curve agreement.
- [ ] Keep static wallpaper/Bloom demand-driven; reuse the existing particle frame reason for temporal grain and freeze particle/ring/grain/refraction time under reduced motion.
- [ ] Fail safely: incomplete framebuffer/program/image initialization draws the wallpaper directly or falls back through the existing shell failure path, never a blank half-initialized desktop.
- [ ] Add only a typed per-Source presentation/effect seam for later lifecycle animation; do not change open/minimize/restore/close timing or state in this iteration.

Focused validation inventory (commands retained for the project gate; assistant execution remains deferred while the user owns hot-reload/manual visual testing):

```powershell
npm test -- --run apps/platform-web/src/spatial/engine apps/platform-web/src/spatial/shell
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
git diff --check
```

Review gate:

- environment color effects are visible without touching Source text or geometry;
- no backdrop/window/scene blur or glass path exists;
- environment targets are bounded, reused and recreated on resize/context restore;
- the clock remains semantic HTML and the ring no longer requires continuous large Source uploads;
- generic renderer consumers retain their prior default environment behavior.

## Step 5B — Curved-Aperture Open/Close Motion

- [ ] Add a pure per-window presentation state module with `capturing-open`, `opening`, `visible`, `guard-pending` and `closing` phases, normalized time advancement, duration-zero reduced-motion completion and independent concurrent entries.
- [ ] Keep logical geometry/session identity separate from presentation state. New windows mount at final geometry but remain renderer-hidden/input-excluded until the first valid Source upload starts `opening`; focusing an existing visible window does not replay.
- [ ] Split close approval from final removal: await/coalesce the existing async guard first, keep veto as a strict no-op, then retain DOM/texture through `closing` and perform removal/guard cleanup/focus-route synchronization exactly once on completion.
- [ ] Add typed per-Source presentation data to the controller/renderer boundary without encoding frame progress into Source CSS, DOM texture content or dirty-upload state.
- [ ] Extend the Source vertex shader with product-only curved-aperture uniforms: non-zero center Y collapse, presentation-only bow/depth energy and monotonic expansion/contraction back to the exact stable ruled-patch pose.
- [ ] Extend the Source fragment shader with transition-only alpha, warm-white/pale-red aperture-edge energy and restrained subpixel chromatic separation; leave stable flat-neutral output exact and bypass transition treatment for Docks/clock/Lab unless explicitly configured.
- [ ] Exclude capturing/opening/guard-pending/closing windows from projected input and window commands; restore normal hit testing only after `visible`. Do not add CPU inverse math for the near-singular aperture.
- [ ] Drive all active entries through the existing `transition` frame reason, reusing one uploaded Source texture across frames; prove transition frames do not mark HTML textures dirty.
- [ ] Handle resize, context loss/restore, shell disposal and cancellation deterministically: opening snaps visible, approved closing completes removal, stale callbacks cannot touch a disposed renderer.
- [ ] Keep minimize/minimize-all/restore behavior unchanged; Dock-anchor compression remains deferred.
- [ ] Fail open to immediate window lifecycle semantics if presentation shader support is unavailable; never fall back the entire shell to RetroOS for an optional animation failure.

Focused validation inventory (commands retained for the project gate; assistant execution remains deferred while the user owns hot-reload/manual visual testing):

```powershell
npm test -- --run apps/platform-web/src/spatial/engine apps/platform-web/src/spatial/shell
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
git diff --check
```

Review gate:

- new windows never flash fully visible or show an empty texture before opening;
- approved close never unmounts before contraction completes, while guard veto never animates;
- stable window color/alpha/pose and projected input are identical to the pre-animation baseline;
- transition frames reuse Source textures and multiple windows keep independent progress;
- reduced motion and optional-shader failure reach the same final session/route state immediately.

## Step 5C — Texture-Sampled Particle Ripple Minimize/Restore

- [ ] Add a pure Source-local origin helper and a stable selector/attribute for each minimize control. Direct clicks, keyboard minimize and minimize-all must resolve the button center against the owning Source border box, clamp it to UV, and use a deterministic fallback only when the control rect is unavailable.
- [ ] Extend presentation phases with `minimizing`, `minimized`, `capturing-restore` and `restoring`, plus immutable `originUv` and effect identity in snapshots. Add independent minimize/restore durations, monotonic advancement, zero-duration completion and exactly-once `minimize-ready` / `restored` events without changing aperture open/close behavior.
- [ ] Split durable minimize from transition start. Retain session DOM, active texture, geometry and painter order through `minimizing`; on completion call the existing session minimize path, release the Source texture, select the next active window and synchronize route. Coalesce/reject commands targeting non-visible phases.
- [ ] Make minimize-all start one independent entry per visible window using that window's own control UV, finalize each texture safely, and navigate to `/` after the requested group reaches its terminal state. Do not map to or move toward right-Dock task icons.
- [ ] Restore a minimized task through `capturing-restore`: keep it renderer-hidden/input-excluded, request the existing texture restoration, and start `restoring` only after a valid Source upload. Use fixed center origin `{ x: 0.5, y: 0.5 }`; complete to stable `visible` before enabling input.
- [ ] Add a dedicated radial-mask Source presentation program for minimizing/restoring. Use aspect-correct UV distance to the farthest corner, a narrow soft wavefront, and exact flat-neutral handoff outside the animated branch.
- [ ] Add a shared deterministic UV/seed point buffer and product-only particle vertex/fragment program. Sample each point's RGB/alpha from the existing Source texture, project its anchor through the same ruled-patch pose, render compact point sprites, and apply bounded radial/tangential/depth drift, fade, warm-white/pale-red edge energy and restrained chromatic separation.
- [ ] Draw the radial Source and its particle layer adjacently within each window's sorted painter slot. Reuse one uploaded HTML texture, keep stable windows/Docks/clock/aperture programs unchanged, and add no CPU particle loop, DOM segmentation, per-window framebuffer or per-frame texture upload.
- [ ] Extend input gating and the `transition` scheduler reason to all three minimize/restore transient phases. The particle pass is never a projected-input candidate and multiple windows advance independently.
- [ ] Rebuild/dispose the shared particle buffer and programs with existing context lifecycle. Reduced motion and unsupported particle presentation use immediate semantic completion; context loss finalizes minimizes and keeps restores capture-gated until a valid replacement texture exists; stale callbacks cannot mutate disposed shell/session state.
- [ ] Keep right-Dock task feedback visual-only and restrained. It may pulse on restore request but must not provide the particle origin or introduce cross-Surface projection.

Validation for this iteration is intentionally user-owned: inspect via hot reload that minimize disassembles sampled window content into compact particles from the minimize button, restore reconstructs from window center, and state/route/input remain correct. The assistant does not run automated or manual checks under the standing instruction.

Source-review gate:

- stable `visible` windows still use the exact flat-neutral path, while aperture open/close shaders and timings remain unchanged;
- particle color/alpha comes from the captured window texture and all animation frames reuse that texture;
- minimize releases the texture only after the final particle frame, and restore cannot draw or accept input before a valid upload;
- each minimize-all window owns independent origin/progress/completion with no Dock-anchor mapping;
- reduced-motion, unsupported-program, context-loss and disposal paths reach deterministic session terminal states.

## Step 5D — Intermediate Visual Tuning and Obsolete Surface Removal

- [ ] Make environment particle trajectories less regular without changing density, layer colors or scheduler ownership: add deterministic low-frequency flow plus per-cell phase/wobble/speed/size variation, avoiding frame-to-frame hash flicker and full-screen fog.
- [ ] Reduce the product window curve constant from `0.04` to `0.032` and increase one-sided gains from `0.14` to `0.17` as an intermediate tuning pass; this implementation is superseded by Step 5E after reference comparison showed the underlying screen-space model still reads as bent stickers.
- [ ] Delete the exact retired targets `apps/platform-web/spatial-lab.html` and `apps/platform-web/src/spatial/lab/`. Remove remaining lab-only wording/references from shared engine code without deleting reusable product engine modules.
- [ ] Remove the right-Dock diagnostics button, `toggleDiagnostics` event, shell listener/state/overlay and dedicated `.spatial-local-diagnostics` CSS. Retain viewport snapshot state needed by status/fallback behavior.
- [ ] Update directly coupled constant expectations or source contracts only where required; do not add new tests for this visual iteration.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation or manual verification.

Source-review gate:

- environment particles no longer read as a rigid translating lattice and remain deterministic/frozen under reduced motion;
- the intermediate 25px bow/1.17 edge-gain constants were applied consistently before the model was superseded by Step 5E;
- no source, import, page or UI control remains for Interaction Lab or the local diagnostics overlay;
- Spatial status/fallback handling and all accepted window lifecycle effects remain intact.

## Step 5E — Physical Curved Window Camera Model

This step records the implemented physical-projection baseline. Step 5F supersedes only its visual calibration and shadow/rim material items; the shared transform, CPU/GPU agreement, input delta split, projected clamp and lifecycle integration remain authoritative.

- [ ] Introduce one focused physical-surface transform module owning focal length, local cylindrical-arc XYZ, rigid yaw/pitch rotation, camera-space depth, perspective screen projection, clip W, pose validation and projected bounds. Remove the screen-Y bow and one-sided edge-scale formulas rather than retaining dual paths.
- [ ] Replace `curveBow` pose/Source metadata with a physical horizontal `curveHalfAngle` (or equivalently explicit curve-depth contract). Keep missing/blank metadata defaults valid for clock/Dock/generic Sources and migrate every engine/shell consumer coherently.
- [ ] Rebuild `windowGeometryToPose()` around viewport-center displacement with early readable continuous response, initial maxima around yaw 10–12°, pitch 4–6°, depth 90–140px and curve half-angle 6–8°. Focus must remain absent from the pose calculation.
- [ ] Update CPU `projectSurfacePoint()` and mesh generation to the physical XYZ transform. Preserve triangle-based perspective-correct inverse mapping and ensure projected depth/clip W vary per vertex rather than once per Source.
- [ ] Compose stable, aperture and particle-ripple vertex shaders from one shared physical-transform GLSL chunk. Apply aperture/ripple deformation in local space before the final rigid/camera projection; stable Source UVs and transition texture reuse remain unchanged.
- [ ] Extend projected pointer gesture data to retain screen/client deltas alongside Source-local deltas. Use screen delta for title drag and local delta for eight-way resize so rotated windows track naturally without per-control compensation.
- [ ] Replace planar `width * scale` recovery assumptions with projected mesh/title/control bounds. Clamp drag, resize and viewport changes iteratively while preserving symmetric recoverability.
- [ ] Add focus-independent per-window depth-material passes as the initial physical-model baseline. This implemented soft expanded/offset shadow and 1–2px rim are explicitly superseded and removed by Step 5F after reference comparison and hot-reload review exposed the translucent gray strip and minimize-tail artifact.
- [ ] Raise product Source body alpha to about 90–92% and title/control tabs to about 94–96%; preserve the borderless authored content language and remove only wallpaper bleed that weakens occlusion.
- [ ] Keep session z sorting, route/focus semantics, Source DOM lifetime, open/close guards, particle-ripple release/restore, reduced motion, context restore and optional-pass fallback intact. Do not reintroduce the Lab, diagnostics overlay, background blur or Dock-anchor motion.
- [ ] Update directly coupled projection/layout/renderer structural expectations for the new single geometry model, but do not add unrelated coverage.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation or manual verification.

Source-review gate:

- side windows visibly rotate in 3D, converge, and recede at ordinary mid-screen positions instead of only near off-screen recovery bounds;
- local curvature is depth-based and physically projected, not a screen-Y squeeze; content stays perspective-correct without fan/strip seams;
- CPU/GPU mesh vertices, clip W and inverse hit geometry match at center, edges and corners;
- drag uses screen motion, resize uses Source-local motion, and projected title/control areas remain recoverable;
- overlap reads as opaque occlusion with restrained rim/shadow, never active glow or broad blur;
- aperture and ripple lifecycle frames retain exactly the same final physical pose as stable windows.

## Step 5F — Reference-Calibrated Curve, Perspective, and Source Frame

- [ ] Replace the current shell calibration as one coherent preset: horizontal curve half-angle `30°` (acceptable first-pass tuning band 28–30°), maximum yaw `18°`, maximum pitch `8°`, side depth `200px`, focal factor `1.0`, horizontal response range `0.32` and vertical response range `0.34`. Preserve exact center-zero continuous ease-out and keep focus absent from pose calculation.
- [ ] Keep the existing physical transform sign and projection contract. Do not reintroduce screen-space Y bow, edge gain, compensating scale or a position-dependent reduction of local curve; the pronounced cylindrical wrap remains visible on a centered window, while yaw/pitch/depth provide the multi-window spatial arrangement.
- [ ] Remove product GPU shadow/rim programs, buffers, options, initialization/fallback branches and per-window draw calls. Preserve unrelated environment Bloom, clock readability shadows and lifecycle particle programs.
- [ ] Add a 2–3px warm gray-white frame and optional 1px low-contrast inner separator inside the `SpatialWindowSurface` Source border box so layout size and projected geometry do not change. The frame must be captured with content and inherit stable, aperture, ripple, particle, context-restore and texture-release behavior automatically.
- [ ] Add a top drag hit strip inside the Source: keep the outermost 2–3px top edge available to the top/corner resize handles, use the following 8–10px as drag affordance, and exclude title/control tabs. Keep left/right/bottom resize priorities and screen-delta drag versus Source-local resize semantics unchanged.
- [ ] Delete obsolete shadow/rim uniforms and state from painter-slot assembly without changing session z sorting, Source texture ownership, window opacity, lifecycle completion, route/focus behavior or projected input ordering.
- [ ] Update directly coupled source contracts and stale comments for the final one-material window path. Do not add new tests or run automated/manual validation under the user's standing hot-reload ownership.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation or manual verification.

Source-review gate:

- a centered large window exhibits the single-window reference's pronounced inward cylindrical wrap without text seams or a full-screen rubber-sheet deformation;
- side/rear and upper/lower windows reach the multi-window reference's readable yaw/pitch, scale convergence and depth at ordinary positions without becoming exaggerated trapezoids;
- no product shadow/rim resource or draw survives, and minimizing cannot leave a gray/black material strip after the Source ripple passes;
- the Source frame follows the same UV, curve and lifecycle mask as content, while the outer resize edge, inner drag strip, title tab and controls resolve with the intended priority;
- accepted aperture and particle effects, CPU/GPU projection agreement, projected recovery and window opacity remain unchanged except for the new calibration/frame.

## Step 5G — Floating-Node Dock Rails

- [ ] Remove the continuous translucent capsule background, inherited full-column border radius and shared panel fill from both Dock Source roots while keeping each root connected, non-zero and directly under the layout-subtree Canvas.
- [ ] Restyle launcher, task and utility buttons as independent 48px-class floating nodes using low-opacity warm-gray/charcoal fills and thin borders. Active launcher/task nodes become charcoal solids with a restrained red border; minimized tasks retain their muted mounted state; return RetroOS remains the only strong red utility node.
- [ ] Add a non-interactive, low-contrast, discontinuous 1px-class vertical guide behind each node list. The right task list and utility cluster are separated by a clear gap/rail break rather than a shared backplate. The rail must not become a new capsule, glow, shadow or backdrop blur.
- [ ] Delete `.spatial-status-surface__readout` markup and its signal/summary/count styles. Remove the now-unused `statusLabel` and `windowCount` presentation props from `SpatialStatusSurface` and its shell call site without deleting the typed viewport snapshot used by fallback/runtime logic.
- [ ] Preserve five visible scroll items, complete semantic DOM, hidden scrollbars, projected wheel routing, keyboard focus, Source z 10/11, window-over-Dock occlusion and the current safe inset/explicit `translate3d` layout.
- [ ] Update directly coupled source/style expectations. Do not add auto-hide, hover expansion, segmented wing backplates, new Dock motion or unrelated renderer changes.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation or manual verification.

Source-review gate:

- neither Dock contains a continuous light capsule or shared solid panel;
- nodes and broken rails remain legible over the wallpaper without glow/shadow and preserve active/minimized/exit hierarchy;
- `READY`/renderer/window-count chrome and unused props/styles are absent while runtime snapshots remain intact;
- scrolling, projected input, keyboard focus, z-order and direct Source eligibility are unchanged.

## Step 5H — Flat Cut-Corner Dock Marks

This step supersedes Step 5G's dashed-rail visual and simple circular node silhouette. It preserves Step 5G's deletion of the capsule/readout, content-sized right task list, Source synchronization and all interaction behavior.

- [ ] Remove every Dock connector-rail pseudo-element/token/style. Launcher marks, task marks and utility marks are visually independent; right task/tools grouping uses only the existing layout gap.
- [ ] Keep each button's 48px semantic/projected hit box, but render a 42–44px flat clipped-square/octagonal mark within it. Replace the plain circle with a 1px warm-white keyline, two discontinuous bracket strokes and one or two tiny ticks/notches around the same plane; keep the icon centered and coplanar.
- [ ] Use one low-opacity charcoal fill for idle marks. Active launcher/task marks increase flat fill opacity and switch one side wedge/short edge to restrained red. Minimized task marks remain muted. The return-Retro mark remains the only strong red utility; minimize-all stays neutral.
- [ ] Encode hover/focus only through fill, keyline and icon contrast. Do not add gradients, inset/outer shadows, bevels, highlights, nested cores, glow, blur, scale/translate motion, 3D transforms or material depth.
- [ ] Preserve transparent/non-zero direct Source roots, content-sized task list capped at five visible items, scroll behavior, hidden scrollbars, keyboard focus, projected input, z 10/11, safe inset, explicit `translate3d`, empty-task collapse and status-Source resynchronization.
- [ ] Update directly coupled source/style expectations and remove stale Step 5G rail assertions. Make no renderer or window changes.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation or manual verification.

Source-review gate:

- no capsule, shared panel, connector rail or plain single-outline circle remains;
- every mark reads as a precise flat graphic through clipped silhouette, interrupted keylines and micro-ticks, without 3D/material effects;
- idle, active, minimized, neutral utility and red exit hierarchy remains clear over the wallpaper;
- scroll, focus, projected input, Source sizing/sync and z-order contracts remain unchanged.

## Step 5I — Restore Flat Capsule Docks

This step supersedes Step 5G and Step 5H's Dock visuals after hot-reload review. Restore the original capsule composition without restoring the deleted readiness readout or changing accepted interaction/runtime behavior.

- [ ] Restore one continuous vertical capsule background on each launcher/status Source root, matching the original reference proportions and rounded silhouette. Remove the cut-corner SVG marker component/markup/styles and do not restore any connector rail.
- [ ] Keep every control's 48px semantic/projected hit box and restore the original flat circular icon-button treatment inside the capsule. Launcher/task/utility controls remain semantic buttons with existing active, minimized, focus and projected-input behavior.
- [ ] Adjust only the palette from the original: retain a lower-opacity gray-white capsule fill and soft warm-white outline so the Dock harmonizes with the decorative ring, window frame and clock; use slightly separated quiet gray-white circular controls with charcoal icon/outline contrast. Active launcher/task controls use stronger charcoal contrast with restrained red accent; minimize-all remains neutral; return RetroOS remains the only strongly red utility control.
- [ ] Keep `.spatial-status-surface__readout`, `READY`, renderer/window-count presentation props and their nested capsule styles deleted. Preserve the typed viewport snapshot used by fallback/runtime logic.
- [ ] Preserve five visible scroll items, hidden scrollbars, empty task-list behavior, keyboard focus, Source z 10/11, safe inset, explicit `translate3d`, window-over-Dock occlusion and status-Source relayout/synchronization. Make no renderer or window-system changes.
- [ ] Keep the result flat: no gradients, backdrop blur, inner/outer shadow, glow, bevel, scale animation, 3D transform or material thickness. Update only directly coupled source/style expectations.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation or manual verification.

Source-review gate:

- both Docks again read as continuous vertical capsules containing flat circular controls;
- no connector rail, cut-corner mark or `READY`/renderer/window-count nested capsule remains;
- idle, active, minimized, neutral utility and red exit hierarchy is legible in the low-opacity gray-white/warm-white palette;
- scroll, focus, projected input, Source sizing/sync and z-order contracts remain unchanged.

## Step 5J — Controller-Owned Eight-Direction Pointer Resize (Rejected / Superseded)

This experiment was removed after hot-reload review confirmed that it had absolutely no runtime effect. The completed items below record the rejected implementation only; they are not the active resize architecture.

- [x] ~~Classify the 14px corners, 3px top frame and 8px side/bottom bands in the controller.~~ Removed.
- [x] ~~Retain a controller-owned resize operation across projected/extrapolated moves.~~ Removed.
- [x] ~~Route deltas through `onWindowResize(sourceId, direction, delta)`.~~ Removed from the controller and shell wiring.
- [x] ~~Remove component-local pointer resize state.~~ Reversed by the task-history rollback below.
- [x] The ineffective authored-handle resolver/metadata path remains removed; the generic target resolver is again the only resolver path.

## Step 5K — Task-History Resize Rollback (Active Path)

Regression record: the authored-handle resolver exception, the root `surfaceEdgeHit` fallback and the controller-owned operation all produced no runtime change, so they are falsified hypotheses and must not be retained as fallback paths. The frame iteration is the discriminating task-history boundary: future frame/chrome edits must preserve direct handle start, component-local continuation and the inset `8px / 8px / 14px` geometry together.

- [x] Restore the working pre-Step-5F component-owned resize interaction: each semantic handle directly starts resize, while the captured window root consumes subsequent routed move/up/cancel events.
- [x] Keep one component-local interaction record with pointer id, resize direction, previous Source-local point and the separate screen point used by title drag. Resize emits successive local deltas; title drag continues to emit screen deltas.
- [x] Remove the post-Step-5F root edge classifier/fallback and keep root pointer-down focus-only. Preserve title/control/top-strip move handlers and keyboard resize.
- [x] Restore fully inset handle geometry: 8px north/south and east/west bands, 14px corners, all anchored at offset `0` and layered above current chrome. Keep the accepted 3px warm frame, flat chrome, full blank top drag area and absence of GPU shadow/rim.
- [x] Keep `data-spatial-gesture-start` and the existing PointerRouter capture promotion, captured projection/extrapolation, projection math, geometry direction signs, min/clamp, session and renderer paths unchanged.
- [x] Remove the rejected controller classifier/state/callback and shell callback wiring; keep the generic target resolver free of window-product resize policy.

Validation remains user-owned through hot reload. No tests, builds, type-check, lint, `git diff --check`, browser automation or manual runtime verification are run for this rollback.

## Step 5L — Visible-Mesh Capture Handoff (Rejected / Superseded)

User hot-reload verification confirmed that this experiment had absolutely no runtime effect. Its visible-mesh-only captured inverse and permanent tangent-differential handoff were reverted, including the associated static-assertion removals; the pre-Step-5L captured analytic inverse and differential sampling are restored. This is not an active or completed path.

## Step 5M — Center Eight-Direction Resize Test Pad (Temporary Diagnostic, Removed)

- [x] Add a clearly visible opaque 3×3 test pad at the center of each `SpatialWindowSurface`, above content, title chrome, frame and normal resize handles. Its eight direction cells are laid out as `NW / N / NE`, `W / label / E`, `SW / S / SE`.
- [x] Keep every direction cell on the existing component-owned path: retain `data-spatial-gesture-start`, stop pointer-down propagation and call `beginResize(direction, event)` directly. Do not add a resolver, controller operation, edge fallback or resize/session/input algorithm branch.
- [x] Highlight the direction whose pointer successfully entered `beginResize`, and clear that pressed state for the same pointer on both routed `pointerup` and `pointercancel`, even if the interaction record is no longer eligible for normal settlement.
- [x] Preserve the existing 8/8/14px edge/corner handles, 3px Source frame, title drag behavior, local resize deltas, router capture/extrapolation and session propagation unchanged. Remove this pad after the breakpoint is identified.

Interpretation outcomes:

1. A visible direction cell does not highlight when pressed: the failure is before or at the component's synthetic `pointerdown` delivery (`inputPlane -> resolveInput -> projectedSceneHits -> resolveProjectedTarget -> PointerRouter.down -> dispatch`), so downstream resize propagation has not started.
2. The direction cell highlights but the window does not resize: initial hit/dispatch and `beginResize` succeeded; investigate captured move/up routing, `continueInteraction`, Source-local delta emission and resize/session propagation after gesture start.
3. The direction cell highlights and the window resizes: the component-owned resize continuation and session path work from a large central target; the remaining fault is isolated to initial hit/target dispatch for the thin authored edge/corner handles rather than the resize algorithm.

Hot-reload result (2026-08-02): outcome 2 is confirmed. The central direction cell highlights, but dragging does not resize the window. This proves the projected Scene hit, semantic target resolution, synthetic `pointerdown` delivery and `beginResize` all succeed. Further investigation starts at the first native input-plane `pointermove`, then follows captured owner dispatch, Source-local delta emission and resize/session propagation; do not change edge hit testing or pointer-down handling again without new contradictory evidence.

## Step 5N — Cross-Layer Resize Telemetry (Temporary Diagnostic, Removed)

- [x] Pass the shell's existing reactive `SpatialPointerSnapshot` to each `SpatialWindowSurface`; do not add a controller callback, router hook or input/resize branch.
- [x] Upgrade the center pad label with persistent `N / R / E / S / L / G` telemetry. Reset all counters and pointer/geometry baselines only when a routed `beginResize` succeeds, keep the values visible throughout the gesture, and preserve the final values after routed pointer-up/cancel.
- [x] Count `N` only when the viewport snapshot's trusted coordinates change after pointer-down for the active `window:<id>` Source. Derive cumulative `S` from trusted screen coordinates and `L` from mapped planar Source-local coordinates even when no routed root move reaches the component; the initial down sample is the zero baseline and is not counted.
- [x] Count `R` only when a routed synthetic pointer move for the active resize pointer reaches `SpatialWindowSurface.continueInteraction`, and count `E` only when that continuation performs the existing component resize emit. Derive `G` as width/height change from the begin-resize geometry without changing session, layout, projection, capture or upload behavior.
- [x] Keep the pad opaque, central and above all other window layers, with the pressed direction highlight and its existing pointer-up/cancel clearing. Preserve all original edge/corner handles and resize algorithms unchanged.

Telemetry interpretation:

| Result | Breakpoint indicated |
| --- | --- |
| `N = 0` | Native continuation/capture or the input-plane pointer listener. |
| `N > 0`, `R = 0` | Router capture ownership or synthetic captured-owner dispatch. |
| `R > 0` but `L = 0` while `S` changes | Captured Source-local mapping/sample generation. |
| `R / E / L` are nonzero but `G = 0` | Shell command availability, window session, or layout propagation. |
| `G` changes | Resize path works; investigate visual Source capture/upload/rendering. |

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation, manual runtime verification or temporary computation scripts for this diagnostic.

## Step 5O — Captured Mapping Status Telemetry (Temporary Diagnostic, Removed)

User evidence from Step 5N: while the SW test direction remains visibly pressed, `N=40, R=41, E=41, S=-138,+111, L=0,0, G=0w,0h`. After releasing the pointer, `L` changes.

This proves the captured local mapping is frozen while capture is active, while ordinary uncaptured inverse mapping works after release. It also proves the two-`nextTick` telemetry shutdown allows the post-release uncaptured snapshot to contaminate the preserved final `L`.

- [x] Add a visible `T` field that preserves the latest `pointerSnapshot.status` observed while resize telemetry is active. Keep N/S/L coordinate updates scoped to the active window Source, but retain status from another status/source result so capture-path failure remains visible.
- [x] Stop telemetry synchronously when the matching routed `pointerup`/`pointercancel` reaches `endInteraction`; remove the delayed two-`nextTick` shutdown and generation machinery so the controller's second uncaptured post-release resolve cannot overwrite `L` or `T`.
- [x] Preserve the last pointer-move `L`/`T` values after release. The pointer-up sample itself is not required because `N` is the move evidence.

Interpretation while the direction remains held:

- `T=captured-extrapolated` with `L=0` means the captured inverse failed and the fallback differential produced zero (likely null).
- `T=captured` with `L=0` means the captured visible inverse returned a frozen mapping.
- `T=hit` or `T=no-hit` means `capturedSceneProjections` is missing or not used despite logical capture.
- Releasing the pointer must no longer change `L` or `T`.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation, manual runtime verification or temporary computation scripts for this diagnostic.

## Step 5P — Captured Differential Presence Telemetry (Temporary Diagnostic, Removed)

User evidence from Step 5O:

- On `pointerdown`, `T` briefly shows `hit`.
- On the first subsequent movement, `T` becomes `captured-extrapolated`.
- Even when the user tries not to drag, holding briefly changes `T` to `captured-extrapolated`.
- During capture, `S` changes while `L` remains zero; after release, uncaptured mapping can change `L`. Step 5O now prevents that release sample from contaminating the preserved telemetry.

- [x] Distinguish the captured extrapolation result by differential presence without changing mapping behavior: keep `captured-extrapolated` when `capturedInput.screenToLocal` exists, and report `captured-extrapolated-no-differential` when it is null.

Interpretation:

- `T=captured-extrapolated-no-differential` confirms the down-time differential constructor returned null and explains the frozen `L`.
- `T=captured-extrapolated` with `L=0` means a non-null differential is present but yields no effective local delta, requiring coefficient/value inspection.

Validation remains user-owned through hot reload. The assistant does not run tests, builds, type-check, lint, `git diff --check`, browser automation, manual runtime verification or temporary computation scripts for this diagnostic.

## Step 5Q — Explicit DOMRect Capture Snapshot

Source inspection proved that the captured mapping failure came from freezing browser `DOMRect` instances with object spread. `sceneSourceForElement` stores `root.getBoundingClientRect()`, and the viewport controller passes `canvas.getBoundingClientRect()` into `captureSceneProjection`; Chromium exposes the required `left`, `top`, `width` and `height` geometry as prototype accessors/non-enumerable fields, so `{ ...rect }` can omit them. The live `projectedSceneHits` path continued to work because it used the original `DOMRect` objects, while captured snapshots reached `projectCapturedSceneSource` with invalid geometry. That made captured projection fail immediately, made `capturedSceneScreenToLocalDifferential` return null, produced `captured-extrapolated-no-differential`, and left `L / G` at zero.

Existing tests missed the runtime shape because their rect fixtures are plain objects with enumerable own geometry fields, for which object spread preserves all four values.

User hot-reload acceptance (2026-08-02): the explicit captured-projection rectangle snapshots restore all eight resize directions through the accepted edge handles. This confirms the non-enumerable `DOMRect` spread was the breakpoint identified by Steps 5M–5P.

- [x] Add a tiny explicit `ClientRectLike` snapshot helper that reads `left`, `top`, `width` and `height` directly.
- [x] Use the helper for both `source.rect` and `viewportRect` in `captureSceneProjection`, while preserving Source/root/pose/parallax handling and all projection/differential math.
- [x] Keep the Step 5M–5P diagnostics only through user-owned hot-reload confirmation, then remove their center pad, telemetry state, shell prop and diagnostic status distinction after they identify the breakpoint.
- [x] Retain only the explicit `DOMRect` snapshot fix in `scene.ts`; preserve component-owned resize, captured projection/extrapolation and all projection/differential math unchanged.

No tests or automated/manual checks are added or run in this visual iteration; user-owned hot reload is the acceptance evidence. The temporary Step 5M–5P diagnostics are removed, and only the explicit `DOMRect` captured-projection snapshot fix remains.

## Step 6 — Route, Keyboard, and Session Integration

- [ ] Watch routes idempotently and open/focus the registry descriptor.
- [ ] Sync launcher/task/window focus actions back to the active URL without loops.
- [ ] Run before-close guard before route/focus/session mutation.
- [ ] Add keyboard launcher activation, open-window traversal, minimize and close commands with visible focus.
- [ ] Preserve state across focus, side movement, occlusion and minimize; only close unmounts.
- [ ] Verify direct loads rebuild only the deep-linked window.

Validation:

```powershell
npm test -- --run apps/platform-web/src/spatial/shell apps/platform-web/src/platform-apps.test.ts
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
```

## Step 7 — Development Mode Entry and Fallback

- [ ] Add a build-gated Appearance screen/command to RetroOS Settings.
- [ ] Add a local Spatial “return to RetroOS” command using the same save/reload helper.
- [ ] Dynamically import the Spatial shell only when the resolver permits it.
- [ ] Enforce fine-pointer, minimum viewport and runtime capability fallback without preference mutation.
- [ ] Keep `releaseReady=false`; do not add a production route or public partial registry switch.
- [ ] Inspect production output for lab/shell/experimental markers.

Validation:

```powershell
npm run build:web
Get-ChildItem apps/platform-web/dist -Recurse -File | Select-String -Pattern "spatial-lab|SpatialDesktopShell|data-spatial-source|texElementImage2D"
git diff --check
```

Expected: no local-only lab/shell marker in production output while the compile-time release gate is false.

## Step 8 — Full Quality and Browser Acceptance

- [ ] Run complete Spatial tests, platform-web Vue type-check, production build and whitespace checks.
- [ ] Verify RetroOS startup, launchers, deep links, window commands, Play fullscreen and before-close guards.
- [ ] In the Flag-enabled browser construct a central large window with side/rear and lower overlapping windows; verify a 28–30° depth-based cylindrical half-arc, up to about 18° side yaw, 8° pitch and 200px depth with natural perspective scale/convergence, a captured 2–3px Source frame, no independent shadow/rim or active glow, and absence of global rubber-sheet deformation.
- [ ] Verify windows visually and interactively occlude both Docks while foreground markers remain visible after Sources; confirm no retired Lab or diagnostics UI remains.
- [ ] Verify the WebGL wallpaper preserves the accepted centered `cover` crop and its CSS twin appears only during startup/failure; confirm context restore and viewport/DPR changes rebuild effect targets without a stale frame or blank desktop.
- [ ] Verify center-zero radial chromatic separation becomes clearly visible toward high-contrast wallpaper edges, threshold Bloom stays localized to moon/particle highlights, and vignette/grain remain subtle without fog, black corners or text contamination.
- [ ] Verify the inset clock remains sharp semantic HTML, updates seconds without width jitter, keeps its accepted lower position and is naturally hidden by overlapping Docks/windows; confirm the right Dock contains no time.
- [ ] Verify the GPU decorative ring remains behind clock/Docks/windows, rotates its two dashed rings in opposite directions with deterministic bars, intercepts no input, and freezes to a static decoration under reduced motion.
- [ ] Verify particles are at least visually about 3× denser and 5–8× faster than the old cyan-stain baseline, retain three readable depth bands and compact warm-white/pale-red points without fog, and freeze under reduced motion.
- [ ] Verify projected controls/drag/eight-way resize at center and visible curved edges for front and partially occluded windows; focus must not move or re-pose any window.
- [ ] Verify mode reload, launcher/status Sources, readable default size, minimize/restore state, route sync, DPR/viewport resize, reduced motion and context restore.
- [ ] Disable the Flag or capability and verify clean RetroOS fallback without changing saved `uiMode`.
- [ ] Record exact automated and browser evidence in `verification.md`.
- [ ] Update specs only for contracts proven by the implementation.

Commands:

```powershell
npm test -- --run apps/platform-web/src/spatial apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/config
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
npm run build:web
git diff --check
```

## Rollback Points

- Steps 1–2: default remains RetroOS; revert boot/registry adapters while preserving existing config data.
- Step 3: lab adapter remains the reference; controller extraction can be reverted before any shell imports it.
- Steps 4–6: the product renderer can temporarily fall back to planar per-Source quads while retaining session/Source DOM work; do not restore the rejected global curve as the acceptance target. RetroOS remains complete.
- Step 5A: disable product effect options and draw the bundled wallpaper directly through the environment provider; retain the current CSS image as a startup/failure fallback, but do not restore the fixed SVG RGB split as the final effect path.
- Step 5B: disable product presentation options and return to immediate open/close timing; keep the split guard/finalize-close methods only if they preserve the existing externally observable lifecycle.
- Step 5C: set ripple durations to zero and skip radial/particle draws while retaining the split minimize/restore completion hooks, current texture release/restore behavior and mounted DOM state. Do not roll back the accepted Step 5B aperture path.
- Step 5E: set physical yaw/pitch/depth/curve options to zero, yielding a planar surface through the same CPU/GPU transform. Never restore the retired screen-space bow/edge-gain implementation.
- Step 5F: revert only the centralized presentation constants and disable the Source frame/drag strip if necessary; keep deleted product shadow/rim resources deleted and retain the physical CPU/GPU/input model.
- Step 7: keep the release gate false. If target-browser shell interaction cannot preserve foundation alignment, do not expose or continue panel adaptation; return to design with browser evidence.
