# Component Guidelines

Vue components use `<script setup lang="ts">`. Route views may own screen-local state and call platform APIs; shared logic should move to small helpers or composables.

## Route Views

- `AppMarketView.vue` owns the desktop App Market placeholder until upload/download package flows are implemented.
- `GameCardLibraryView.vue` owns the My Apps Explorer view for installed Game Cards.
- `GameCardDetailView.vue` owns Game Card launcher, save-slot management, and folder-like Workspace entry points.
- `SettingsView.vue` owns browser chat model configuration.
- `DebugView.vue` owns read-only observability for AI debug, history, checkpoints, and snapshot.
- `PlayView.vue` mounts the active play frontend and should remain a thin loader.

## UI Rules

- Preserve the current restrained cyber/terminal styling unless a task explicitly redesigns the visual language.
- Use existing UI primitives under `components/ui/`.
- Keep repeated fixed-format elements stable with explicit grid/flex constraints.
- Do not put long-running runtime logic inside templates.

### Convention: RetroOS Desktop Shell And Route Chrome

**What**: The platform shell presents platform routes through a RetroOS desktop compositor: splash -> desktop wallpaper -> desktop application icons -> multiple desktop application windows -> taskbar entries for open windows. `App.vue` owns app boot and shell mounting; `components/desktop/*`, `desktop-apps.ts`, and `useDesktopWindows.ts` own window registration, open/focus/minimize/close/fullscreen state, route sync, and taskbar behavior. Desktop icons are launcher shortcuts and support double-click plus a right-click `Open` menu. Route views provide window contents such as toolbars, property tabs, inset panes, and status bars; they should not add a second outer title bar when the desktop shell already owns the application window frame.

**Why**: Tsian's RetroOS direction depends on an operating-system mental model, not a conventional admin sidebar. Keeping window/session behavior in desktop shell modules preserves the app metaphor while letting route views stay focused on domain content.

**Example**:

```vue
<!-- DesktopWindow.vue owns the desktop window frame. -->
<section class="desktop-window">
  <header class="desktop-window-titlebar">...</header>
  <div class="desktop-window-content">
    <component :is="window.component" v-bind="window.props" />
  </div>
</section>

<!-- Route views own the content chrome only. -->
<div class="retro-toolbar border-b">...</div>
<main class="retro-inset">...</main>
<footer class="retro-statusbar border-t">...</footer>
```

**Rules**:
- Keep `desktop-*` classes for the OS shell and `retro-*` classes for content-level chrome.
- Keep `/play` as a desktop application window. `PlayView.vue` should remain a thin loader and fill its parent pane (`h-full` / `min-h-0`) instead of assuming it owns the browser viewport.
- Keep the Play window singleton while play frontend bridge/runtime state is keyed to the global active save/card. Do not add multiple simultaneous gameplay windows without a broader runtime-session design.
- Use the URL as the active/deep-linked surface, not as a serialization of every open window. Refresh may rebuild the deep-linked window with default geometry, but it should not restore the previous in-memory window session unless a task explicitly adds persistence.
- Keep the old lobby out of the main UX; users enter play from Game Card launchers and save slots.
- Use `retro-focus` on custom interactive controls so keyboard focus remains visible.
- On narrow viewports, show the active window as a maximized/stacked panel and use the taskbar/start affordance for switching or showing the desktop; do not let overlapping windows make route panes unreachable.
- Keep draggable/resizable window behavior in the desktop shell/composable layer, not in route views.
- Position route-level context menus relative to the route view container, not with viewport `position: fixed` coordinates. `.desktop-window` uses `transform: translateZ(0)`, so a fixed child inside a window gets a transformed containing block and can appear offset from the pointer. Use a `relative` route root, an `absolute` menu, and translate `MouseEvent.clientX/clientY` through `getBoundingClientRect()`.
- Keep file creation and rename path decisions in resource-manager views. Lightweight editor windows may display file identity and edit content/media type, but they should not expose a path field for renaming; use Explorer-style context menu/F2 rename affordances instead.

### Convention: Studio Agent Skill Management

**What**: Studio should be Agent-centered: select one Agent, then manage literal files such as `AGENT.md` and `SOUL.md` plus one enable/disable Skill list for that Agent. Player-facing labels should say whether the selected Agent can use a Skill, not whether the registry entry is `shared` or `agent-local`.

**Why**: `shared` / `agent-local` are runtime workspace storage details. Showing them as primary categories makes players manage file layout concepts instead of the actual question: can this Agent use this Skill?

**Example**:

```vue
<!-- Good: selected-Agent capability state. -->
<span>{{ skillEnabled(skill) ? "启用" : "禁用" }}</span>

<!-- Bad: storage-scope category as product language. -->
<span>{{ skill.scope === "shared" ? "共享能力" : "专用能力" }}</span>
```

## Bridge And Persistence

- Components may call exported platform-host functions for platform shell actions.
- Play frontends must use `PlayFrontendBridge`; they must not import platform-web storage or model code.
- Components should not silently write Dexie except through storage helpers or platform-host APIs.

## Avoid

- Do not restore mod/resource/workflow editor routes as part of routine UI work.
- Do not expose Vue refs through contracts or bridge payloads.
- Do not add untyped `any` props to reusable components unless an upstream library forces it.
