# RetroOS Multi-Window Desktop Shell Implementation Plan

## Preconditions

- Task remains in `planning` until the user approves implementation.
- Before editing code, load `trellis-before-dev` and the relevant platform-web frontend specs.
- Do not start this task with `task.py start` until PRD/design/implement are reviewed.

## Ordered Checklist

1. Audit current shell behavior and route-view assumptions.
   - Confirm every non-play route can be rendered as a window content component.
   - Identify any route view that depends on being the only mounted platform view.
   - Confirm `PlayView.vue` can be refactored to fill a parent window content pane instead of the full viewport.

2. Introduce desktop app/window registry.
   - Define app descriptors for App Market, My Apps, Game Launcher/detail, Control Panel, System Monitor, and Play/Game Frontend.
   - Include route mapping, title/caption/icon, default size, minimum size, singleton/detail keying, fullscreen capability, and async content component.

3. Add window manager composable.
   - Open/focus/close/minimize/restore windows.
   - Maintain active window id and monotonically increasing z-index.
   - Compute default placement with slight cascaded offsets.
   - Clamp geometry to the desktop stage.

4. Extract desktop shell/window components as needed.
   - Move titlebar controls and taskbar rendering out of `App.vue` if the file would otherwise become too dense.
   - Remove the current `/play` desktop bypass and route it through the Play window instead.

5. Implement route-to-window sync.
   - Watch route changes for platform routes and open/focus the matching window.
   - Update route when opening/focusing a window only when needed.
   - Preserve direct hash deep links.
   - Make `#/play` open/focus the Play window instead of bypassing the shell.

6. Implement drag and resize.
   - Use pointer events and pointer capture.
   - Add titlebar drag logic and edge/corner resize handles.
   - Clamp to min sizes and desktop bounds.
   - Disable or constrain drag/resize on narrow viewports.

7. Rework taskbar behavior.
   - Render open windows instead of all desktop icons.
   - Show active/minimized state.
   - Restore/focus from taskbar click.
   - Keep clock and compact system readout.

8. Polish RetroOS details.
   - Active/inactive titlebar states.
   - Pressed/raised taskbar buttons.
   - Resize cursors and handles.
   - Stable scrollable content panes.
   - No text overlap in taskbar/window controls.

9. Add Play window fullscreen behavior.
   - Refactor `PlayView.vue` sizing so iframe mount and overlays fill the parent pane.
   - Add fullscreen/restore control for Play windows.
   - Verify game frontend mount resizes cleanly in normal and fullscreen window modes.

10. Manual browser smoke.
   - Open multiple windows on desktop viewport.
   - Focus, drag, resize, minimize, restore, close.
   - Deep link to `#/settings`, `#/library`, `#/debug`, and `#/cards/:cardId` when a card exists.
   - Verify `#/play` opens/focuses the Play window, mounts the active game frontend, and fullscreen/restore works.
   - Verify narrow viewport does not become incoherent.

11. Quality verification.
    - Run `npm run build:web`.
    - Run any focused tests already present for platform-web if applicable.
    - Use Browser/Playwright smoke screenshots after significant frontend changes.

## Validation Commands

```bash
npm run build:web
```

Use the in-app Browser for local smoke checks after starting the appropriate dev server.

## Risky Files

- `apps/platform-web/src/App.vue`
- `apps/platform-web/src/style.css`
- `apps/platform-web/src/router/index.ts`
- any new `apps/platform-web/src/components/desktop/*`
- any new `apps/platform-web/src/composables/*`

## Rollback Points

- After adding the registry/composable but before replacing the visible shell.
- After replacing taskbar behavior but before drag/resize polish.
- Before broad CSS polish, in case the behavior works but the visual layer needs iteration.

## Review Gate Before `task.py start`

- User has accepted the non-persistent MVP: refresh resets open windows, positions, sizes, and minimized state.
- User has accepted singleton Play/Game Frontend behavior for this first task.
- PRD acceptance criteria still match the desired first implementation slice.
- The task is started only when implementation is requested.
