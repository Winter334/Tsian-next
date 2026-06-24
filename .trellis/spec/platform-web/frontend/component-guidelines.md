# Component Guidelines

Vue components use `<script setup lang="ts">`. Route views may own screen-local state and call platform APIs; shared logic should move to small helpers or composables.

## Route Views

- `AppMarketView.vue` owns the desktop App Market placeholder until upload/download package flows are implemented. Installing a package no longer routes to the card detail view (task `06-24-library-interaction-refinement`); it shows a toast and the card appears in My Apps via the `GAME_CARDS_CHANGED_EVENT` refresh.
- `GameCardLibraryView.vue` owns the My Apps Explorer view for installed Game Cards. Card tiles expose hover/focus quick actions: copy (`copyPlatformGameCardAsLocal` with `${原名} 副本`) and load (`setPlatformActiveGameCard`), in addition to the right-click context menu (open/load/delete). Card import no longer routes to detail (task `06-24-library-interaction-refinement`); it toasts and the card appears via event refresh. Card tiles are `<div role="button" tabindex="0">` (not `<button>`) because they nest quick-action buttons.
- `GameCardDetailView.vue` owns Game Card overview (manifest metadata, cover, load/delete) and frontend binding configuration. Properties (name/summary/cover) are **all draft-until-saved** (task `06-24-library-interaction-refinement`): cover changes stage a `CoverDraft` (upload preview via `URL.createObjectURL`, url, or clear) without writing, and a single "保存属性" button commits metadata + cover together with a toast. The "另存为本地副本" button was removed (quick-copy lives on card tiles). The view registers a `setBeforeClose` guard (`detailWindowIdFor(cardId)`) that prompts to discard unsaved changes on window close. Save-slot management was removed earlier (task `06-24-game-launcher-saves`); this view holds no "enter play" affordance.
- `SettingsView.vue` owns browser chat model configuration.
- `DebugView.vue` owns read-only observability for AI debug, history, checkpoints, and snapshot.
- `PlayView.vue` is a thin phase router for the `/play` singleton window: it resolves the active card, then either renders `<GameLauncherPanel>` (select/create/rename/delete saves, then continue), shows an unplayable-card guide, or mounts the active frontend iframe. The save-selection UI lives in `components/play/GameLauncherPanel.vue`; PlayView itself stays a thin loader (no save-list business UI inline) per the thin-loader convention. `playing`-phase return-to-launcher is an in-view button + ESC.

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
- Preserve scroll position across desktop focus switches. Desktop windows' "invisible" states (minimized / inactive / occluded) MUST be implemented with render-tree-preserving hides (`display:none` via `.desktop-window--minimized`, `visibility`, or z-index occlusion), NEVER by removing the window component from the DOM. Removing or non-rendering a window causes its inner component state (scroll, form input, drafts, runtime) to be lost AND triggers browsers to asynchronously reset `scrollTop` to 0 on containers that leave the render tree — neither side effect can be reliably countered with application-layer patches. **Closing a window is the only legitimate unmount point.** `useDesktopWindows.ts` `visibleWindows` was removed for this reason: the v-for renders all windows (`windows.value`), minimized ones are hidden by CSS, components stay mounted. A route view that owns a scrollable conversation/list should still persist `scrollTop` per session (e.g. `assistant-scroll-top:{id}` meta key) via a rAF-throttled `scroll` handler — this covers hard-refresh and window-close-reopen — but restoration is now a single nextTick fallback (if `scrollTop === 0` and target > 0, set it), not a multi-frame defensive poll, because the render-tree-preserving hide no longer triggers the async reset. Skip restoration when the persisted target is 0. Do NOT add `content-visibility:auto` or similar non-rendering optimizations to desktop windows — they reintroduce the same reset-on-non-render problem.

### Convention: Resource Manager Windows-Style Interactions

**What**: `WorkspaceExplorerView.vue` mirrors Windows Explorer for file/folder operations: inline new-file/new-folder creation (no modal, no editor redirect — create with a default name then auto-enter rename selecting the name stem), copy/cut/paste with a view-local clipboard, and keyboard shortcuts (Ctrl+C/X/V, Delete, F2; not F5 — preserve browser refresh). Conflict naming uses numeric increment (`新建文件(1).txt`, `foo - 副本.txt`).

**Why**: The workspace is a file-based store (IndexedDB keyed by file path), so "empty folder" has no persistent representation. A `.keep` anchor file makes a folder appear and persist: it is written on folder creation, survives single-file delete/move inside the folder (the backend deletes/moves by exact path, never touching `.keep`), and only disappears on whole-folder delete/move (backend prefix-match sweeps it along). The resource manager filters `.keep` from the rendered list so the folder displays as empty. The agent-facing `workspace.list`/`read`/`write`/`move`/`delete` APIs do **not** hide `.keep` — UI rendering convention must not leak into the workspace operation layer; agents see real storage and the anchor is harmless (empty content, ignored by business logic).

**Rules**:
- New file/folder: create with default name (`新建文件.txt` / `新文件夹`), numeric-increment on conflict, then auto-enter inline rename selecting the name stem (not the extension).
- Empty folder persistence: write `<dir>/.keep` (empty, `text/plain`). Filter `entry.name === ".keep"` in a `visibleEntries` computed; base selection, rename, context menu, and clipboard on `visibleEntries`. Never hide `.keep` from `workspace-operations.ts` / agent tools.
- Clipboard is view-local (`ref<ClipboardEntry | null>`), not persisted. Cross-directory retention is required (cross-dir move is cut's core use case); clear only on cross-card / cross-local-root / return-to-root-picker via a `clipboardContextKey` computed watch. Cut items render `opacity-50` while in the source directory.
- Copy = `read` source → `write` target (recursive `list`+`read`+`write` for folders, including `.keep`). Cut = `move` (backend already handles directory-level prefix move). Paste target is always the current directory.
- Keyboard shortcuts: Ctrl+C/X/V, Delete, F2, Esc. Guard with `isEditableKeyboardTarget` so browser text operations inside inputs/textarea/contenteditable are not hijacked. Do not bind F5.
- `save/` virtual slot guard: reuse `canDeleteEntry` (rejects `save` and `save/save-\d+`) for copy/cut/rename/delete; reject paste/new-file/new-folder only at `currentPath === "save"` (slot interiors `save/save-XX/` are editable runtime files).

### Convention: Studio Agent Skill Management

**What**: Studio should be Agent-centered: select one Agent, then preview literal files such as `AGENT.md` and `SOUL.md`, manage one enable/disable Skill list for that Agent, and expose only runtime-enforced platform tool / Workspace permission controls backed by `agent.json`. Player-facing labels should say whether the selected Agent can use a Skill or capability, not whether the registry entry is `shared`, `agent-local`, or an executor implementation detail.

**Why**: `shared` / `agent-local` and executor names are runtime workspace storage details. Showing them as primary categories makes players manage file layout concepts instead of the actual question: can this Agent use this Skill, ask another Agent, read Workspace context, or maintain Workspace files?

**Example**:

```vue
<!-- Good: selected-Agent capability state. -->
<span>{{ skillEnabled(skill) ? "启用" : "禁用" }}</span>
<span>{{ platformToolEnabled("workspace_write") ? "启用" : "禁用" }}</span>

<!-- Bad: storage-scope category as product language. -->
<span>{{ skill.scope === "shared" ? "共享能力" : "专用能力" }}</span>
<span>{{ action.executor.type }}</span>
```

### Convention: Workspace Editor Simplification And Media Viewer Routing

**What**: `WorkspaceEditorView.vue` is a text-only editor (toolbar has only Save; CodeMirror owns Ctrl+Z undo; no mediaType dropdown, no validate/restore buttons). Files route by media type on open: text → editor, image/audio/video → `WorkspaceMediaView.vue`. The desktop shell supports a per-window `beforeClose` guard so the editor can prompt save/discard/cancel on unsaved changes.

**Why**: mediaType is derived from the file path (`inferMediaTypeFromPath`), so a dropdown is redundant. Windows-style unsaved-change prompts require a close-hook mechanism in the desktop shell because editor windows are route-driven (props are static route-query snapshots, not dynamic callbacks).

**Rules**:
- Editor toolbar: keep only Save. Remove mediaType dropdown, validate button, restore button, `resetDraft`. Ctrl+S is a window-level `keydown` that checks `route.name === "workspace-editor"` (no editable-target guard — Ctrl+S must fire inside CodeMirror). `*` in the title marks unsaved changes (`hasDraftChanges`).
- `beforeClose` hook: `useDesktopWindows.ts` exports a module-level `beforeCloseHandlers: Map<string, () => Promise<boolean>>` with `setBeforeClose`/`clearBeforeClose`. `closeWindow` is async; it awaits the handler and aborts on `false`. `useDesktopWindows()` returns a fresh instance per call (no provide/inject), so a module-level Map keyed by window id is the sharing mechanism. `desktop-apps.ts` exports `editorWindowIdFor(...)` so the editor view can recover its own window id from route query and register/unregister on mount/unmount — capture the id once at mount (props.path may change after a save route-sync).
- The three-option unsaved prompt (save/discard/cancel) uses `confirmChoice` from `useConfirm.ts` (an extension of the confirm dialog with `options: ConfirmChoiceOption[]`). `DesktopShell.closeWindow` is fire-and-forget async (`void desktop.closeWindow(id).then(...)`).
- Resource manager `openFile(path)` routes by `inferMediaTypeFromPath`: image/audio/video → `workspace-media` route, else → `workspace-editor`. Context-menu "打开" replaces "编辑". Extension change on rename prompts a danger `confirm` ("改变扩展名 ... 可能导致文件无法正确解析").
- `WorkspaceMediaView.vue` reads `WorkspaceFile.binary` (Blob) and renders `<img>`/`<audio>`/`<video>` via `URL.createObjectURL`; revoke on unmount.

## Bridge And Persistence

- Components may call exported platform-host functions for platform shell actions.
- Play frontends must use `PlayFrontendBridge`; they must not import platform-web storage or model code.
- Components should not silently write Dexie except through storage helpers or platform-host APIs.

## Avoid

- Do not restore mod/resource/workflow editor routes as part of routine UI work.
- Do not expose Vue refs through contracts or bridge payloads.
- Do not add untyped `any` props to reusable components unless an upstream library forces it.
