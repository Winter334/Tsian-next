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

**What**: The platform shell should present non-`/play` routes through the RetroOS desktop in `App.vue`: splash -> desktop wallpaper -> desktop application icons -> route-backed application window. Desktop icons are the primary entry points and support double-click plus a right-click `Open` menu. Route views should provide window contents such as toolbars, property tabs, inset panes, and status bars; they should not add a second outer title bar when the desktop shell already owns the application window frame.

**Why**: Tsian's RetroOS direction depends on an operating-system mental model, not a conventional admin sidebar. Keeping the desktop shell in one place preserves the app metaphor while letting route views stay focused on domain content.

**Example**:

```vue
<!-- App.vue owns the desktop window frame. -->
<section class="desktop-window">
  <header class="desktop-window-titlebar">...</header>
  <div class="desktop-window-content">
    <router-view />
  </div>
</section>

<!-- Route views own the content chrome only. -->
<div class="retro-toolbar border-b">...</div>
<main class="retro-inset">...</main>
<footer class="retro-statusbar border-t">...</footer>
```

**Rules**:
- Keep `desktop-*` classes for the OS shell and `retro-*` classes for content-level chrome.
- Keep `/play` outside the desktop shell so the active game frontend owns the viewport.
- Keep the old lobby out of the main UX; users enter play from Game Card launchers and save slots.
- Use `retro-focus` on custom interactive controls so keyboard focus remains visible.
- On narrow viewports, the desktop shell may still show a window, but controls and route panes must remain reachable without the old sidebar squeezing content.
- Do not build draggable multi-window management unless a task explicitly asks for a desktop compositor; route-backed single active windows are enough for the current shell.

## Bridge And Persistence

- Components may call exported platform-host functions for platform shell actions.
- Play frontends must use `PlayFrontendBridge`; they must not import platform-web storage or model code.
- Components should not silently write Dexie except through storage helpers or platform-host APIs.

## Avoid

- Do not restore mod/resource/workflow editor routes as part of routine UI work.
- Do not expose Vue refs through contracts or bridge payloads.
- Do not add untyped `any` props to reusable components unless an upstream library forces it.
