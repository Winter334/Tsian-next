# Spatial Play and Global Surfaces Design

## 1. Boundaries

This child owns platform-level presentations that are not ordinary application content: Confirm, Toast, form dialogs, shell context menus, save launcher, and Play host chrome. It may extract Play/save controllers from existing Retro components, but it does not change persistence, runtime/bridge contracts, the existing Retro Nyan splash, game-card frontend code, projection math, or the production release gate.

The approved first implementation slice is Spatial Confirm. Later phases remain in the same task and must keep the first slice green.

## 2. Host topology

`App.vue` selects global presentation with the shell:

```text
booting -> neutral boot gate only
retro   -> DesktopShell + Retro Splash/Toast/Confirm/DialogForm hosts
spatial -> SpatialDesktopShell
             canvas direct children
               shell/window Sources
               SpatialGlobalSurfaceHost fragment
                 global:modal-shield
                 global:confirm | global:dialog
                 global:toast
```

The Spatial host reads the same singleton composable state. It emits Source-set/state changes to `SpatialDesktopShell`; the shell alone calls `viewportController.syncSources()` and `requestSourcePaint()`. This keeps engine ownership out of presentation components.

## 3. Modal source model

- `global:modal-shield`: full viewport, reserved global z=1,000,000, zero curve/parallax, fully transparent pointer/wheel/contextmenu sink. It is marked `data-spatial-render="none"`, remains in projected input and z-order, and never allocates, uploads or draws a texture. It exists whenever a global modal is active.
- `global:confirm`: centered readable panel, z=1,000,010, shallow local curve, warm-gray body, charcoal title structure and red severity accent.
- `global:dialog`: same source family for `useDialogForm`, z ordered deterministically with Confirm if both stores are active. No new global request queue is introduced.
- `global:toast`: top-right compact stack below the modal panel but above application windows.

The shield and panel are separate Sources so the panel keeps a compact texture/curve while the input-only shield owns whole-desktop hit isolation without entering GPU composition. Closing removes both from Source synchronization and restores the prior connected focus target.

## 4. Spatial Confirm component

`SpatialConfirmHost.vue` renders a fragment whose direct roots carry the Source attributes. Shared presentation helpers normalize:

- active kind and danger state;
- cancel/confirm/choice result mapping;
- prompt value/error reset and validation;
- focus capture, initial focus, Tab loop and restoration;
- keyboard Escape and prompt Enter behavior.

The helper remains presentation-only and emits `request-close`; it does not expose a second confirm API. The shell runs the panel's horizontal renderer-owned close presentation, retains its texture through the terminal frame, and only then calls `resolveConfirm`. Buttons use `SpatialActionButton`; prompt uses the shared Spatial input language. Choice labels wrap within a scrollable action area rather than expanding beyond the Source.

The panel alone participates in the renderer-owned aperture presentation. The transparent shield is input-only and remains stable for the modal lifetime, preventing both background input leakage and full-screen transparent texture snapshots that can flash black in the target Chromium implementation.

The panel emits `source-dirty` for prompt/error/focus-visible state changes and `sources-changed` when it appears/disappears. Hover/active changes continue through the viewport controller's existing routed-state capture.

## 5. Remaining global presentations

Toast becomes one compact Source stack reading `useToasts`; the existing store remains timeout authority. Local enter/leave transitions use `data-spatial-source-animation` and stop under reduced motion.

Dialog Form shares the modal shield/panel frame, renders built-in fields and `SpatialSelect`, and preserves validation/test semantics. Retro-only slot `FloatingWindow` callers are not imported by Spatial presentations; local Spatial dialogs remain in their owning window Source.

Shell context menu state remains local to `SpatialDesktopShell`/dock presentation and uses mapped Source-local coordinates. No global context-menu service is added.

Spatial does not add a theme-specific splash or seen key. The pre-shell neutral boot gate remains an ordinary page because renderer capability is not yet established; the existing Retro Nyan splash remains the only product splash and is not duplicated inside Canvas.

## 6. Shared Play architecture

```text
usePlayController(instance)
  platform active card/save + events
  remote/packaged mount handles
  bridge target registration
  phase/error/rebuild state
  enterLauncher / continue / return / dispose

useGameLauncherController(card)
  save list operations and busy state
  version/cloud/delete confirmation
  import/export/download commands

Retro PlayView/GameLauncherPanel ----+
                                     +--> same controllers
SpatialPlayView/SpatialGameLauncher -+
```

DOM refs, native file picker activation, iframe mount element, route navigation and layout stay at the presentation boundary. Async mount commands carry generation/disposed guards so stale remote/packaged work cannot replace a newer phase.

## 7. Spatial maximize and Play fullscreen

Spatial window chrome exposes maximize/restore only when the shared descriptor is `fullscreenable`, matching Retro OS placement and semantics. `SpatialWindowState` retains ordinary geometry separately from a maximized flag/effective viewport geometry; maximizing does not overwrite the restore geometry or remount the application. Move and resize are unavailable while maximized. Viewport changes recompute only effective maximized geometry, and restore clamps the retained ordinary geometry to the current viewport.

The browser Fullscreen API remains presentation-owned. Extract the existing vendor-compatible request/current/exit adapter from Retro `DesktopShell` into a narrow shared browser helper, then keep Retro behavior unchanged while allowing Spatial shell to consume it. No fullscreen command enters `usePlayController`.

The Spatial titlebar maximize click follows the same branch as Retro OS:

```text
fullscreenable non-Play window -> toggle Spatial maximized state
Play without a ready iframe    -> toggle Spatial maximized state
Play with a ready iframe       -> request fullscreen on that exact iframe
  request succeeds             -> mark window maximized; browser owns display/input
  request fails/unsupported    -> fall back to Spatial maximized state
browser Escape/fullscreen exit -> clear maximized state; same iframe returns to Source
```

The Play iframe is not cloned, reparented, or remounted for fullscreen. Runtime/bridge/save identity survives entry and exit. Minimize, close, reload and controller disposal keep their existing resource ownership; fullscreen listeners are shell/presentation resources and clean up exactly once.

## 8. Iframe preflight

The target Flag Chromium matrix is intentionally asymmetric. Curved mode proves remote and packaged iframe capture, readable display, center/edge basic projected click and the maximize control's routed activation. Browser fullscreen proves real pointer, keyboard, focus, resize, reload and Escape exit while preserving the same iframe/runtime instance. Full curved gameplay parity is not a requirement.

If curved capture/display/basic click fails, or the routed maximize click cannot enter native iframe fullscreen in the target browser, record evidence and return to design. Ordinary DOM-over-Canvas iframe fallback is prohibited. A rejected/unsupported Fullscreen API may use the documented Retro-compatible Spatial-window maximize fallback, but that fallback does not count as native-fullscreen acceptance.

## 9. Compatibility and rollback

- Retro is preserved by conditional host mounting and controller-first migration.
- First-slice rollback removes `SpatialConfirmHost` and restores the unconditional Retro host without touching `useConfirm` callers.
- Global Source failure must not silently resolve or lose a pending request; shell fallback to Retro retains the singleton state and lets the Retro host render it.
- Spatial maximize can roll back by removing the generic session/chrome state; the shared browser fullscreen adapter must leave Retro behavior unchanged.
- Play rollback sets its Spatial registrations back to pending; shared controllers remain valid Retro consumers.

## 10. Verification strategy

Unit tests cover durable state/result/focus/source-lifecycle behavior, maximize/restore geometry retention, viewport changes, move/resize exclusion, browser fullscreen success/failure/exit and exact listener cleanup. Flag Chromium owns curve appearance, center/edge basic iframe hit testing, routed fullscreen activation, real fullscreen input/focus/resize/reload and native Escape. Tests avoid exact CSS colors, pixel snapshots and animation intermediate frames.
