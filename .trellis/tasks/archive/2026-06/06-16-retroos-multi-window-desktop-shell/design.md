# RetroOS Multi-Window Desktop Shell Design

## Architecture

The platform shell should move from "current route wrapped in one window" to "desktop compositor owns window instances." `App.vue` may still own top-level app boot, splash state, storage/AI readouts, and the top-level shell mount, but the desktop shell should be extracted enough to keep the window manager understandable.

Recommended source shape:

- `App.vue`
  - keeps splash, platform initialization, and top-level shell mount;
  - delegates desktop behavior, including the Play window, to shell components/composables.
- `components/desktop/`
  - `DesktopShell.vue` for menubar, desktop stage, taskbar, context menu, and overlays;
  - `DesktopWindow.vue` for titlebar, controls, drag/resize handles, active/minimized styling, and content frame;
  - optional small components for desktop icons and taskbar buttons if the shell grows too dense.
- `composables/useDesktopWindows.ts`
  - owns open window list, active window id, z-index ordering, open/focus/minimize/restore/close, default placement, and bounds clamping.
- `desktop-apps.ts` or a nearby registry module
  - maps app/window ids to route names, paths, icons, titles, captions, default sizes, minimum sizes, fullscreen support, and content components.

This keeps platform shell logic in frontend UI code and avoids adding a global store library.

## Window Model

Each open window should have a stable instance record:

```ts
interface DesktopWindowState {
  id: string
  appId: string
  routeName: string
  routePath: string
  title: string
  caption: string
  icon: Component
  component: Component
  props: Record<string, unknown>
  x: number
  y: number
  width: number
  height: number
  minWidth: number
  minHeight: number
  zIndex: number
  minimized: boolean
}
```

The exact type can be adjusted during implementation, but the important boundary is that window geometry and open/minimized/focused state are no longer derived from the active route.

## Route And Deep-Link Sync

Vue Router should remain the browser deep-link source. The desktop shell should watch platform routes and ensure that the matching window exists and is focused.

Proposed behavior:

- Loading `#/settings` opens/focuses the Control Panel window.
- Loading `#/library` opens/focuses the My Apps window.
- Loading `#/debug` opens/focuses the System Monitor window.
- Loading `#/market` opens/focuses the App Market window.
- Loading `#/cards/:cardId` opens/focuses a Game Launcher/detail window for that card id.
- Loading `#/play` opens/focuses a Play/Game Frontend window and mounts the active Game Card frontend.
- Opening a desktop icon focuses an existing singleton window or creates it if absent, then updates the route to that window's route path.
- Focusing a taskbar entry may update the route to that window path. Browser refresh must not restore the prior desktop session; it may only rebuild the single deep-linked active surface with default geometry.

The shell should not try to make the URL represent every open window. The URL represents the active/deep-linked surface; the in-memory window list represents the desktop session.

## Singleton And Detail Windows

For this first task:

- App Market, My Apps, Control Panel, and System Monitor should be singleton windows.
- Play/Game Frontend is singleton for the first implementation. Current runtime/frontend bridge behavior is keyed to global active save/card state, and multiple gameplay windows would imply a larger runtime-session model that is out of scope.
- Game Card detail should be keyed by card id if feasible, so different card details can eventually coexist.
- If multiple Game Card detail windows are too much for the first implementation, the acceptable fallback is one Game Launcher window whose props update to the latest `cardId`. This fallback should be called out in implementation notes before coding.

## Play Window And Fullscreen

`PlayView.vue` should stop assuming that it always owns `100dvh`. Its mount root should be able to fill a window content pane and respond to parent size changes. Loading/error overlays should cover the Play window content area rather than the whole desktop unless the Play window is fullscreen.

The Play window should expose a fullscreen/restore control. The first implementation can treat fullscreen as shell fullscreen: the Play window expands over the desktop stage with game-first chrome and an obvious restore control. If browser Fullscreen API support is added, it must remain user-gesture driven and fail gracefully.

The game frontend bridge remains the same bridge; the shell change is presentational and should not expand frontend permissions.

## Drag And Resize

Use pointer events with pointer capture:

- Titlebar pointer down starts a drag only from drag-safe titlebar areas, not from buttons.
- Resize handles on edges/corners start resize with a direction.
- Movement clamps windows inside the desktop stage, with enough margin to recover windows after viewport changes.
- Minimum dimensions are fixed per app category to keep controls reachable.
- Content panes scroll inside `.desktop-window-content`; content height must not resize the outer window.

Avoid depending on browser-native `resize: both` because the shell needs taskbar-aware bounds, custom handles, and stable mobile behavior.

## Taskbar

The taskbar should become session state, not launcher state:

- render open windows only;
- show active state when focused;
- show minimized state distinctly;
- click minimized entry restores and focuses;
- click inactive visible entry focuses;
- click active entry may minimize only if that feels natural during implementation, but the safer first behavior is focus/no-op;
- keep clock/status area.

The start button can remain a home/show-desktop action for now. A full start menu is not required in this task.

## Visual Direction

The direction should be "Tsian RetroOS desktop compositor": classic desktop OS affordances filtered through the existing warm CRT palette.

Required refinements:

- active and inactive titlebars;
- real-looking minimize/close controls, with resize affordances that are visible but not noisy;
- taskbar buttons that feel pressed/raised and map to open windows;
- consistent window border/inset treatment;
- cursor changes for draggable/resizable areas;
- no oversized marketing/hero composition;
- no nested decorative cards inside window frames.

The shell should feel more faithful than the current pass while staying distinct from protected Windows branding.

## Mobile And Narrow Viewports

Overlapping desktop windows are a desktop interaction. On narrow viewports:

- windows may behave as maximized panels or a stacked active-window view;
- taskbar must still let the user switch/restore/close;
- drag/resize can be disabled or heavily constrained;
- route contents must remain reachable without horizontal overflow or incoherent overlap.

## Compatibility

- `/play` becomes a desktop shell route that opens/focuses the Play window.
- Existing route views should keep owning content-level chrome and should not add a second outer window titlebar.
- Window state is intentionally in-memory only. No IndexedDB, localStorage, runtime storage, or migration work is required for window positions, sizes, z-order, or minimized/open state.
- No contract/runtime-core changes are expected.

## Risks

- Rendering multiple route views concurrently may expose assumptions that only one route view is mounted at a time. Mitigation: start with platform views that use local refs and storage/platform APIs, and verify library/settings/debug together.
- Rendering gameplay inside the desktop shell may expose `PlayView.vue` assumptions about viewport height. Mitigation: refactor it to fill its parent content pane before adding fullscreen mode.
- Multiple Play windows would conflict with global active save/card assumptions. Mitigation: keep Play singleton in this implementation.
- Router syncing can create loops if open/focus calls push routes unconditionally. Mitigation: compare current route path before pushing and keep route watcher idempotent.
- Drag/resize can fight with text selection or buttons. Mitigation: start interactions only from explicit titlebar/handle targets and use pointer capture.
- Mobile overlap can become unusable. Mitigation: explicit narrow layout behavior rather than trying to shrink desktop interactions indefinitely.
