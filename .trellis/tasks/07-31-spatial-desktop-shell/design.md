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
            -> SpatialWindowSession + camera
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

Extract reusable behavior from `SpatialLabController` into an engine-level `SpatialViewportController` (or equivalently focused modules). It owns:

- capability acquisition and typed unsupported results;
- renderer, element-texture registry and paint synchronization;
- frame scheduler, reduced motion, visibility, resize and context restore;
- parallax and product frame hooks;
- projected target resolution, pointer routing, native controls and focus;
- source release/restore/dirty requests and deterministic disposal.

The controller accepts narrow callbacks for source enumeration, pre-render scene updates, status/metrics and product-specific activation reporting. Lab-only diagnostics, probe labels, forced context loss and result matrices remain in `SpatialLabController`, which composes the shared controller.

The product shell must not import any file under `spatial/lab/`. Controller extraction is complete only when the existing lab suite and browser matrix still exercise the same shared path.

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

```

- World coordinates are independent of the active route and remain stationary when focus changes.
- `focusWindow()` raises z-order and restores if needed; it does not set a camera target or rewrite window geometry.
- Source planar rects are computed from world position, viewport size, and smooth side depth. The computed result is applied to Source DOM CSS; renderer and target resolver then observe the same box.
- Spatial registration/default placement uses a viewport-relative readable target: about 58% of width and 72% of height on a 1920×1080 viewport, clamped by per-app minimums and reserved launcher/status recovery space.
- Wheel does not mutate window geometry. Window dimensions change only through resize handles; background-wheel camera zoom is explicitly deferred.
- Drag converts mapped planar deltas to world deltas using the same layout scale. Resize operates in source CSS coordinates and updates world size with min constraints.
- On drag/resize completion, a smooth side-band function may update `sideDepth` and recoverable bounds. It never snaps to slots or quantizes horizontal position.
- Viewport resize clamps enough title/chrome area to remain recoverable but preserves world order.

Window commands are pure/stateful functions with unit tests. Vue components only translate mapped pointer/keyboard events into commands.

## 7. Canvas and Source Structure

```html
<section class="spatial-desktop-shell">
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

- Keyed reordering may put the active window first in logical keyboard order without remounting it.
- Minimized sources remain mounted and non-zero but visually hidden; the controller explicitly releases their textures. Restore marks the source `restoring`, reacquires and requests paint, then exposes it after a valid upload.
- Closing is the only normal unmount point.
- Dedicated Spatial tokens/styles live under `src/spatial/shell/` or `src/spatial/theme/`; RetroOS global classes are not reused for content chrome.

## 8. Route and Session Synchronization

- A route watcher resolves a `PlatformWindowDescriptor` and idempotently opens/focuses it.
- Launcher actions resolve the same descriptor, open/focus it, then push its route only when different.
- Focusing, minimizing or closing the active window synchronizes the URL to the next active window or `/` after state transition/guard completion.
- URL state does not encode the complete window list.
- Reload creates only the current deep-linked window with default world geometry.
- before-close handlers remain keyed by the stable registry window id and are called before any Spatial close mutation.

## 9. Input, Accessibility, and Motion

- The full-screen input plane receives trusted pointer/wheel/context events; all coordinates are inverse-curved before Source resolution.
- The final dual-axis curve is materialized by one shared CPU/GLSL projection configuration; no per-control correction is permitted.
- Window titlebars and resize handles use ordinary semantic buttons/regions in Source DOM. Pointer capture stays in the shared router.
- Launchers and task entries are keyboard-focusable. A small shell command layer supports launcher activation, next/previous open window, minimize and close without requiring a spatial pointer.
- Source roots are never inert. Focus-visible styles are part of captured output.
- Reduced motion does not change focus or final window state.

## 10. Local Placeholder and Visual Contract

`SpatialPendingAppSurface` displays shell-neutral icon/title/caption and an explicit local-development readiness state. It may contain stateful probe controls used to verify minimize/restore preservation, but it performs no domain mutation and imports no RetroOS view.

The shell reuses the foundation environment and restrained FUI direction. Continuous glitch, strong text bloom, debug grids and permanent diagnostics are prohibited. Diagnostics remain development-only and hidden unless explicitly opened.

## 11. Failure, Rollback, and Production Isolation

- Capability/shader/context startup failure returns a typed reason to the boot resolver and falls back to RetroOS.
- A context loss after readiness suspends rendering; successful restore recaptures mounted sources. Repeated restore failure presents a local Spatial error action that returns to RetroOS.
- Saved `uiMode` is not silently rewritten by runtime fallback, allowing the user to retry after enabling the Flag or restoring the viewport.
- Disabling the one release gate is the rollback. RetroOS registry presentation and default config remain complete.
- Production build inspection must prove the partial shell is not selectable and, while the gate is compile-time false, that local-only shell/lab markers are absent from emitted output.

## 12. Validation Strategy

Automated tests cover config normalization, mode resolution, route/identity extraction, RetroOS compatibility adapters, stationary focus, viewport-relative default sizing, dual-axis projection round trips/domain coverage, side snap, resize clamp, minimize texture states, before-close veto and reduced motion.

Existing complete Spatial tests remain mandatory after controller extraction. The target Flag-enabled browser matrix verifies startup mode switch, multi-window source capture, stationary focus, readable default window size, shallow hemispherical horizontal/vertical curvature without top/bottom dead bands, projected drag/resize at all four edges, minimize state preservation, route sync, DPR/resize, reduced motion, unsupported fallback and context restore.
