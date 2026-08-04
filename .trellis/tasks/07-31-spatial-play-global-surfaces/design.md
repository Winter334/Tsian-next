# Spatial Play and Global Surfaces Design

## 1. Boundaries

This child owns platform-level presentations that are not ordinary application content: Confirm, Toast, form dialogs, Spatial splash, shell context menus, save launcher, and Play host chrome. It may extract Play/save controllers from existing Retro components, but it does not change persistence, runtime/bridge contracts, game-card frontend code, projection math, or the production release gate.

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
                 global:splash
```

The Spatial host reads the same singleton composable state. It emits Source-set/state changes to `SpatialDesktopShell`; the shell alone calls `viewportController.syncSources()` and `requestSourcePaint()`. This keeps engine ownership out of presentation components.

## 3. Modal source model

- `global:modal-shield`: full viewport, reserved global z=1,000,000, zero curve/parallax, fully transparent pointer/wheel/contextmenu sink. It is marked `data-spatial-render="none"`, remains in projected input and z-order, and never allocates, uploads or draws a texture. It exists whenever a global modal is active.
- `global:confirm`: centered readable panel, z=1,000,010, shallow local curve, warm-gray body, charcoal title structure and red severity accent.
- `global:dialog`: same source family for `useDialogForm`, z ordered deterministically with Confirm if both stores are active. No new global request queue is introduced.
- `global:toast`: top-right compact stack below the modal panel but above application windows.
- `global:splash`: full viewport Source after renderer readiness; input is isolated to the splash while active.

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

Spatial splash receives a mode-specific seen key. The pre-shell neutral boot gate is intentionally not textured because renderer capability is not yet established.

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

## 7. Iframe preflight

Before Spatial Play ready work, probe target Flag Chromium for remote and packaged iframe capture, pointer/keyboard/focus forwarding, resize, reload and fullscreen. The acceptable path must remain inside the Spatial source/compositor contract. If the probe fails, record evidence and return to design; ordinary DOM-over-Canvas iframe fallback is prohibited.

## 8. Compatibility and rollback

- Retro is preserved by conditional host mounting and controller-first migration.
- First-slice rollback removes `SpatialConfirmHost` and restores the unconditional Retro host without touching `useConfirm` callers.
- Global Source failure must not silently resolve or lose a pending request; shell fallback to Retro retains the singleton state and lets the Retro host render it.
- Play rollback sets its Spatial registrations back to pending; shared controllers remain valid Retro consumers.

## 9. Verification strategy

Unit tests cover durable state/result/focus/source-lifecycle behavior. Flag Chromium owns curve appearance, center/edge hit testing, keyboard/IME, modal isolation, native escapes and iframe evidence. Tests avoid exact CSS colors, pixel snapshots and animation intermediate frames.
