# RetroOS Multi-Window Desktop Shell

## Goal

Replace the current route-backed single-window RetroOS shell with a real platform desktop shell that supports multiple concurrent application windows, stable window sizing, resizing, minimizing/restoring, focus/z-order, a taskbar that reflects open windows, and a Play/Game Frontend window with fullscreen affordance.

This task exists because the current RetroOS pass has the right broad metaphor but not the expected desktop behavior: there is only one route wrapper, windows cannot be resized, taskbar buttons are static launch shortcuts, and route changes can cause visible window size jumps.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## User Value

- The Tsian home screen feels like an actual desktop environment instead of a themed page frame.
- Users can keep library, card detail, settings, and diagnostics surfaces open at the same time while switching between them through window focus or the taskbar.
- The game frontend follows the same desktop application model as the rest of the platform, with an obvious way to fullscreen when the user wants immersive play.
- Window layout changes feel deliberate and stable; changing active applications should not make the visible window jump between preset widths.
- The UI direction becomes a reusable foundation for later Game Card, Workspace Studio, Agent/Skill, settings, and diagnostics work.

## Confirmed Facts

- Current `apps/platform-web/src/App.vue` renders non-`/play` routes inside one centered `.desktop-window` wrapper.
- Current desktop icons call `router.push(...)`; there is no window instance model.
- Current taskbar renders every desktop icon as a button, not only open windows.
- Current minimize and close controls both navigate back to `/`.
- Current window width is route-derived through `.desktop-window--normal` and `.desktop-window--wide`, which explains the visible size jump between route-backed windows.
- Current CSS already has `desktop-*` shell classes and `retro-*` content chrome classes.
- `apps/platform-web/src/router/index.ts` uses hash routes for desktop, app market, settings, library, game-card detail, play, and debug.
- Existing platform-web specs say `/play` must remain outside the desktop shell, but this task intentionally changes that direction so play becomes a first-class desktop application window.
- `apps/platform-web/src/views/PlayView.vue` currently assumes a full viewport mount (`min-h-dvh`) and resolves the active Game Card frontend through global active card/save state.
- Existing platform-web specs previously allowed route-backed single active windows only because no task explicitly asked for a desktop compositor. This task explicitly asks for that compositor behavior.

## Requirements

- Implement a multi-window platform desktop shell for platform routes, including `#/play`.
- Make Play/Game Frontend a desktop window application instead of a separate unframed page.
- Provide a fullscreen/restore affordance for the Play window so the game frontend can become immersive when needed.
- Keep game frontend content isolated to the Play window content region or fullscreen mode; do not expose platform-only debug/storage surfaces through the game frontend bridge.
- Support opening multiple application windows concurrently from desktop icons, taskbar/start affordances, and platform route deep links.
- Support window focus and z-order so the active window is visually clear and receives interactions first.
- Support dragging windows by title bar on pointer-capable desktop layouts.
- Support resizing windows with stable min/max bounds and no content-driven layout jumps.
- Support minimize, restore, close, and focus from the taskbar.
- Make the taskbar represent open windows, including active and minimized states, rather than a static list of all launchable apps.
- Preserve desktop icons and right-click context affordances, but make `Open` create/focus a real window.
- Keep window state local to the shell. Refreshing the browser resets open windows, positions, and sizes.
- Preserve route/deep-link behavior: loading `#/settings`, `#/library`, `#/debug`, or a Game Card detail route should open the corresponding window and focus it.
- Preserve play route/deep-link behavior: loading `#/play` should open/focus the Play window and mount the active Game Card frontend.
- Avoid hardcoding gameplay semantics into the shell. The shell owns app/window chrome; route views own domain content.
- Keep route view content scrollable inside window content panes without changing the outer window size.
- On narrow/mobile viewports, degrade to a usable stacked or maximized-window model instead of broken overlapping chrome.
- Rework visual details enough that the desktop reads as intentional: titlebar controls, active/inactive titlebars, taskbar buttons, window borders, focus rings, resize affordances, and status/menu areas should be coherent.
- Use existing Vue patterns: `<script setup lang="ts">`, local refs/computed/watch, no global store library.
- Prefer existing `desktop-*` and `retro-*` class conventions, extracting shell components/composables only when it reduces `App.vue` complexity.

## Acceptance Criteria

- [ ] Opening Library, Settings, Debug/System Monitor, and App Market can leave multiple windows visible at once on desktop viewports.
- [ ] Clicking an already-open app icon or taskbar entry focuses/restores the existing window rather than creating unwanted duplicates.
- [ ] Game Card detail deep links open a focused detail/launcher window with the correct `cardId`.
- [ ] Window drag changes position without selecting desktop icons or losing pointer capture.
- [ ] Window resize changes dimensions within min/max bounds and route content scrolls inside the window when needed.
- [ ] Switching between open windows does not cause preset width jumps.
- [ ] Minimize hides a window from the desktop stage while leaving a taskbar entry that restores it.
- [ ] Close removes the window and updates active focus predictably.
- [ ] Taskbar entries show only open windows, include active/minimized states, and restore/focus on click.
- [ ] `/play` opens/focuses a Play/Game Frontend window in the desktop shell.
- [ ] The Play window mounts the same active Game Card frontend behavior currently provided by `PlayView.vue`.
- [ ] The Play window has a fullscreen/restore control and the game frontend resizes cleanly when toggled.
- [ ] Desktop, taskbar, windows, and context menus remain keyboard/focus accessible enough for current custom controls.
- [ ] Desktop viewport smoke check verifies windows can overlap, focus, drag, resize, minimize, restore, and close.
- [ ] Narrow viewport smoke check verifies platform views remain reachable without incoherent overlap.
- [ ] `npm run build:web` passes.

## Out Of Scope

- Persisting window positions/sizes across browser reloads unless the user explicitly chooses that scope.
- A full start menu implementation beyond whatever minimal launch affordance is needed for the taskbar/start button to feel coherent.
- Snapping/tiling, maximize animations, virtual desktops, or complex keyboard window manager shortcuts.
- Rewriting route view domain content such as Game Card library internals, settings forms, diagnostics data, or workspace editing.
- Changing runtime, storage, bridge, contracts, or Game Card frontend loading semantics beyond resizing `PlayView.vue` into a window content pane.
- Supporting multiple simultaneously running gameplay frontends against different active saves.
- Copying protected Windows branding, exact assets, or pixel-identical UI.

## Resolved Questions

- Window positions, sizes, and open/minimized state should not persist in this first implementation. Refreshing the browser resets the desktop session to defaults.
- Play/Game Frontend should be a singleton window tied to the current active save/card. Multiple concurrent gameplay windows are not necessary for this task and would require broader runtime-session isolation.
