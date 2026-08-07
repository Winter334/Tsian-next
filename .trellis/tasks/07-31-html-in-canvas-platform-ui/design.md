# Spatial Desktop Technical Design

## 1. Purpose and Boundary

This task introduces a second platform UI environment under `apps/platform-web`: a Spatial FUI desktop rendered from real HTML through HTML-in-Canvas and a GPU scene. The existing RetroOS remains intact and usable.

The parent task owns the cross-cutting requirements, child-task map, shared architecture, release gate, and final integration review. It should not be the direct implementation target.

In scope:

- platform shell selection and persisted UI preference;
- a curved multi-window spatial desktop;
- HTML capture, GPU composition, projection-aware input, motion, accessibility, and media policy;
- new spatial presentations for every platform-owned application and global overlay;
- route/deep-link parity and final release gating.

Out of scope:

- replacing or deleting RetroOS;
- modifying Game Card iframe frontend presentation;
- building an HTML-in-Canvas polyfill;
- mobile/narrow Spatial Desktop behavior;
- preserving or converting a live window session when switching UI modes.

No backend, shared-contract, bridge, Agent Runtime, or storage-schema change is expected unless a child discovers a concrete platform-owned media source that cannot be rendered without a new same-origin delivery path. Such a discovery must return to planning rather than expanding scope silently.

## 2. Current Architecture Evidence

- `App.vue` directly mounts `DesktopShell`; there is no shell selector.
- `desktop-apps.ts` already centralizes route identity, application metadata, Vue content components, and window defaults.
- `DesktopShell.vue`, `DesktopWindow.vue`, and `useDesktopWindows.ts` own the RetroOS compositor and session behavior.
- Route views own domain UI and often mix presentation with local state; many use shared platform/storage APIs and event modules rather than a global store.
- `style.css` combines global tokens, RetroOS shell styling, and route-level `retro-*` chrome.
- Existing specs require non-closed windows to remain mounted so scroll, drafts, and runtime state are not lost.
- `.tsian/local/platform-config.json` is the authoritative, assistant-visible platform preference file and is the correct home for a new UI-mode preference.

## 3. Target Topology

```text
platform boot
  -> preheat platform config
  -> resolve uiMode: retro | spatial
      -> RetroOS DesktopShell (existing)
      -> SpatialDesktopShell (new)

PlatformAppRegistry
  -> shell-neutral route/app identity and business entry points
  -> retro presentation component + retro window defaults
  -> spatial presentation component + spatial window defaults

SpatialDesktopShell
  -> spatial window session
  -> HTML source layer: direct canvas children, real Vue/DOM
  -> graphics engine: element textures -> per-source curved mesh/pose -> scene
  -> input projector: screen -> topmost surface -> inverse pose/curve -> window UV -> DOM target
  -> spatial global hosts: splash, toast, confirm, floating surfaces
```

The visible GPU canvas and the HTML source tree are two representations of one UI state. The HTML source remains authoritative for layout, semantics, focus, form state, and events; the GPU scene owns only visual composition and spatial geometry.

## 4. UI Mode Selection

Add an `appearance` section to `.tsian/local/platform-config.json`:

```ts
interface PlatformConfigAppearance {
  uiMode: "retro" | "spatial"
}
```

- Default is `retro`, preserving existing behavior.
- Platform config remains the single source of truth; do not mirror the preference into localStorage.
- Startup must resolve the config before mounting a shell. A neutral boot gate may render while config is loading; do not flash RetroOS before switching to Spatial Desktop.
- Both Control Panel presentations expose the same mode command.
- Saving a different mode performs a full page reload. Hash route state survives; in-memory window sessions do not.
- Production exposure is controlled by one release-ready gate. Child tasks may enable a local development entry, but no partial spatial registry ships as a user-selectable production mode.

The exact HTML-in-Canvas capability-detection and Flag guidance mechanism is deferred until implementation, as required by the PRD. It must remain isolated from shell/domain code.

## 5. Shell-Neutral Application Registry

Refactor `desktop-apps.ts` into a shell-neutral registry without breaking existing imports in one step.

Each application definition owns:

- stable `appId`, route name/path, label, title, caption, icon, and singleton/detail identity;
- RetroOS component and geometry defaults;
- Spatial component and spatial size defaults;
- readiness metadata used only by the local development gate.

Keep `desktop-apps.ts` as a compatibility barrel for RetroOS while the registry moves to a focused module such as `platform-apps.ts`. Route parsing, detail/editor ids, and deep-link identity must have one source of truth shared by both shells.

Spatial views must not wrap or embed RetroOS route views. When an existing view mixes domain state and presentation, extract a shared pure helper or explicit controller composable, then render separate RetroOS and Spatial components over that shared behavior. Do not duplicate platform mutations, storage access, event subscriptions, route identity, or validation logic.

## 6. Spatial Source Layer

The spatial canvas uses `layoutsubtree`. Every drawable top-level window/source surface is a direct canvas child, satisfying the current API constraint.

Each source wrapper owns:

- one mounted Vue application surface;
- stable source dimensions and DPR-aware texture dimensions;
- source-local focus and interactive-descendant geometry;
- dirty state driven by the canvas `paint` event and `changedElements`;
- a link to one spatial window record.

Inactive, occluded, and minimized window components stay mounted until close. A minimized window may release GPU texture memory, but its Vue/DOM state remains alive and it must recapture before restore becomes visible.

## 7. Graphics Engine

Create a framework-neutral `spatial/engine/` area. Keep orchestration in Vue thin.

Responsibilities are split by seam:

- `capabilities.ts`: nonstandard API/context capability boundary;
- `renderer.ts`: context lifecycle, buffers, textures, framebuffer, draw scheduling;
- `element-textures.ts`: HTML element snapshot upload and resource release;
- `scene.ts`: windows, camera, environment layers, z/depth ordering;
- `projection.ts`: invertible per-surface local curve/pose/world/screen coordinate transforms;
- `shaders/`: per-source curved presentation, pose, restrained color and transition effects;
- `frame-scheduler.ts`: event-driven renders and animation windows;
- `metrics.ts`: development frame/upload counters.

V1 should use a raw WebGL renderer so the nonstandard `texElementImage2D` upload remains under project control. Attempt the most capable WebGL context that actually exposes the required element upload, without making WebGL2-only features part of the rendering contract. WebGPU is a future backend, not a V1 dependency.

Rendering pipeline:

1. Changed HTML elements mark their window textures dirty.
2. Dirty textures are uploaded at the start of a render frame.
3. Environment and particles render in stable viewport space.
4. Each Source renders independently on a tessellated shallow local arc with its own derived `depth/yaw/pitch/scale` pose.
5. Opaque gray-white window Source meshes render back to front without window underlay/shadow/rim passes; shell foreground accents render last.
6. Background, windows and foreground layers use separate restrained parallax weights; there is no all-sources global curve pass.

Each active surface keeps its primary reading region low-distortion while its local silhouette remains visibly curved. Text, forms, and active controls do not receive continuous heavy glitch or chromatic separation. Transitions may temporarily raise effect strength.

Window chrome is part of the captured Source: a permanent left top-edge title/drag tab and permanent right control tab sit above a flat gray-white borderless body. The body has no grid, gradient, texture, selection shadow or glow. Local bow targets roughly 28–34 CSS pixels at the default 1114×778 size; pose does not amplify that curve.

Rendering is event-driven when idle. Continuous `requestAnimationFrame` runs only during camera motion, pointer-driven parallax, transitions, animated effects, or dirty content. Cap DPR and texture size through one policy rather than per-panel guesses.

## 8. Spatial Window Model

Spatial window state is independent from `useDesktopWindows.ts`:

```ts
interface SpatialWindowState {
  id: string
  appId: PlatformAppId
  routePath: string
  sourceWidth: number
  sourceHeight: number
  azimuth: number
  elevation: number
  distance: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  focused: boolean
  snap: "free" | "curve"
}
```

- Free dragging and resizing update world/tangent coordinates.
- Near side regions, a soft snap aligns the window to the cylindrical surface; it never locks permanently.
- Focus changes only active state, z-order, and route. It does not change camera or window coordinates.
- New Spatial windows use a readable viewport-relative default (about 58% width and 72% height at 1920×1080) while preserving per-app minimums and recoverable clamping.
- Window dimensions change only through resize handles. Wheel remains available to content; future background-wheel camera zoom will be designed separately and must not masquerade as window resizing.
- Minimize/restore/close semantics match the existing product mental model.
- Viewport changes clamp all windows to a recoverable spatial region.
- URL remains the active/deep-linked surface, not a serialization of the complete spatial session.

## 9. Projection-Aware Input

Curved visual output invalidates ordinary planar pointer coordinates. Input accuracy is a foundation requirement, not a per-panel patch.

Input flow:

```text
screen pointer
  -> visit projected Sources front to back
  -> inverse candidate pose and local curve
  -> intersect the candidate surface
  -> window UV / source-local CSS coordinate
  -> resolve source DOM target
  -> dispatch native-realm pointer/mouse/wheel sequence
  -> focus target; keyboard input remains native DOM behavior
```

The input subsystem owns hover enter/leave, click, double-click, pointer capture proxying, drag, resize, wheel/scroll, context menu, focus, and cancellation. Pure projection/intersection functions must be unit-tested with round-trip and edge cases.

Existing event-activation work in `platform-host/frontend-inspector-dom.ts` is evidence for browser-realm event sequencing, but it is inspector-specific. Extract only genuinely reusable low-level dispatch helpers when the second consumer exists; do not import the inspector domain into Spatial Desktop or copy the event sequence.

Text selection, native select popups, file pickers, sliders, IME, and contenteditable require browser probes. Any control that cannot preserve native behavior through synthetic forwarding must receive an explicit spatial interaction adapter or remain in the low-distortion center band. Silent broken input is not acceptable.

## 10. Accessibility and Motion

- Source DOM remains the semantic and focus authority; do not mark interactive source trees `inert`.
- Keep logical DOM order deterministic, with the active window first in navigation order while retaining mounted state.
- Focus styling is part of the captured source and must be visible in the GPU result.
- Keyboard-only users can open, focus, move between, minimize, and close windows without spatial pointer gestures.
- Respect `prefers-reduced-motion`; also structure effect strengths so a future explicit setting can be added without rewriting shaders.
- The canvas itself exposes a concise label, but does not replace the semantic descendants.

## 11. Media and Privacy-Preserving Painting

HTML-in-Canvas may omit privacy-sensitive cross-origin pixels. Audit every platform-owned image source used by spatial panels:

- same-origin static assets and Blob/object URLs are preferred;
- CORS-readable external images may be materialized as Blob URLs through one shared media helper;
- unavailable external avatars/covers use a designed FUI placeholder and retain all non-image functionality;
- do not add an unrestricted server image proxy as an incidental UI change.

The media policy and failure state are shared. Individual panels must not each invent fetch/CORS fallbacks.

## 12. Global Surfaces

Spatial Desktop needs its own presentation for:

- splash/boot sequence;
- launchers, task/status areas, and context menus;
- toast and confirmation surfaces;
- general floating windows/dialogs;
- Play host chrome and fullscreen controls.

These surfaces share the same source/capture and input system. A flat DOM overlay above the GPU canvas is allowed only for browser-owned surfaces that cannot be textured safely (for example a native file picker), not as the normal implementation shortcut.

## 13. Child Task Map and Dependencies

The parent task will be split into independently verifiable children:

1. **Spatial rendering and input foundation** — capability adapter, HTML source capture, renderer, projection, input router, metrics, reduced motion, interaction lab.
2. **Spatial shell and window session** — UI mode config, shell selector, app registry, curved desktop, launch/focus/drag/resize/minimize/close, route sync.
3. **Library and market surfaces** — My Apps (first real vertical slice), App Market, Game Card detail, shared image policy.
4. **Workspace surfaces** — Explorer, editor, media viewer, context menus, keyboard shortcuts, draft/close guards.
5. **Agent surfaces** — Studio and Desktop Assistant, streaming, ask-user, attachments, configuration dialogs.
6. **System surfaces** — Control Panel, Account, Announcements, System Monitor.
7. **Play and global surfaces** — Play host/launcher, splash, toast, confirm, floating/dialog surfaces.
8. **Release integration and parity** — complete registry, accessibility/performance/browser matrix, production release gate, final visual consistency.

Dependency order:

- Child 2 depends on Child 1.
- Children 3–7 depend on Child 2 and may proceed in parallel with disjoint write scopes.
- Child 8 depends on Children 3–7.
- The parent is archived only after Child 8 and parent-level acceptance review pass.

## 14. Rollout and Rollback

- `retro` remains the default and a complete rollback path.
- Spatial mode is hidden behind a release-ready gate until all child scopes pass.
- Switching modes reloads the page; no dual-shell live state bridge exists.
- A graphics/context failure before shell readiness returns to RetroOS or a clear unsupported screen without mutating the saved preference silently.
- Rollback consists of disabling the Spatial release gate; no business-data migration is involved.

## 15. Principal Risks

- **Nonlinear hit testing:** mitigate with one inverse-projection/input subsystem and browser interaction probes before panel migration.
- **API churn:** isolate nonstandard HTML-in-Canvas calls behind one capability/texture adapter.
- **Texture cost:** event-driven uploads, DPR cap, release minimized textures, and instrument upload/frame counts.
- **State loss:** never unmount non-closed application sources; preserve existing close-guard contracts.
- **Presentation duplication:** extract shared domain controllers rather than copying mutation/storage logic into spatial views.
- **Cross-origin media omission:** shared materialization/fallback policy; no hidden per-panel failures.
- **Visual overload:** low-distortion center band, state-driven effects, reduced motion, and strict readability review.
