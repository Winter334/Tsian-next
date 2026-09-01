# Design: 工作室宏模块开关分组与文件管理入口

## Architecture Boundaries

- Scope is `apps/platform-web` frontend Studio UI.
- Runtime macro expansion and contract types stay unchanged.
- Workspace file content editing stays in `WorkspaceEditorView`; Studio only routes users there.
- Workspace browsing for path selection uses platform-host public APIs, primarily `listPlatformWorkspaceDirectory`.

## Data Flow

### Current flow

1. `MessageSequenceEditor.vue` owns message sequence draft groups and `enabledModulesDraft`.
2. `EntryEditDialog.vue` edits one entry and receives all discovered modules for the selected Agent.
3. The dialog extracts enabled module macro paths from either inline template text or referenced file content.
4. Matching modules are passed to `ModuleSwitchList.vue`.
5. Module toggles update the dialog draft; saving the dialog marks the outer sequence dirty; clicking「保存序列」writes `agent.json`.

### New flow

1. `message-sequence.ts` exposes a grouped module switch helper/type:
   - input: extracted macro paths, all `PlatformStudioModuleInfo[]`;
   - output: groups keyed by macro path with display label and matched modules.
2. `EntryEditDialog.vue` computes `moduleSwitchGroups` instead of a flat `modulesForCurrentMacros` array.
3. `ModuleSwitchList.vue` renders groups. It still emits `enabledModules` as a string array of stems.
4. An embedded Studio-scoped workspace path picker emits selected file/directory paths. It lives inside `EntryEditDialog.vue` instead of opening a second modal window.
5. `EntryEditDialog.vue` consumes picker selections:
   - file selection for path entries sets `draft.path` and loads file content;
   - file selection for template entries inserts `{{file:path}}`;
   - directory selection for template entries inserts `{{file:dir/*.md?enabled}}`.
6. Route actions in the dialog/module list push to existing workspace routes.

## Component Design

### `message-sequence.ts`

Add small helper utilities/types, colocated with existing message sequence helpers because they are Studio-message-sequence specific:

- `ModuleSwitchGroup`
- `buildModuleSwitchGroups(modules, macroPaths)`
- `moduleDirectoryLabel(path)` / equivalent label helper if needed
- duplicate stem detection helper if needed for UI hints

Also fix the UI macro extraction regex to include wildcard module macros such as `modules/文风/*.md` and `modules/*.md`; runtime already supports `*`, so the UI should recognize the same common pattern.

### `ModuleSwitchList.vue`

Change prop shape from flat `modules` to `groups`.

Render structure:

- panel header with total enabled / total matched count;
- optional note when duplicate stems are visible;
- each group as an inner section:
  - group label/path;
  - enabled / total count;
  - module cards.

Each module card keeps the Switch and adds small action buttons:

- `编辑` emits `edit-module` with `module.path`;
- `目录` emits `open-module-directory` with `module.path`.

No direct router import in this child component is required if `EntryEditDialog` owns navigation.

### `WorkspacePathPicker.vue` (Studio embedded panel)

A small embedded panel is used because path selection is part of message-entry editing and must not create a second modal overlay.

Props:

- `open: boolean`
- `cardId: string`
- `mode: "file" | "directory"`
- optional `title` and `initialPath`

Emits:

- `update:open`
- `select(path: string)`

Behavior:

- list current directory via `listPlatformWorkspaceDirectory({ cardId, path })`;
- allow navigating into directories and parent directory;
- keep the file list in a bounded internal scroll area so long directories do not push the dialog controls off-screen;
- use single-selection rows plus a fixed footer confirm button instead of one `选择` button on every row;
- support double-click: directories enter, files confirm in file mode;
- in file mode, selecting a file confirms that file path;
- in directory mode, selecting current directory or a directory row confirms a directory path;
- show loading/error state.

Use existing restrained Studio/retro styling. Do not wrap this picker in `FloatingWindow`.

### `EntryEditDialog.vue`

Add route helpers:

- `directoryOf(path)`
- `createEditorSessionId()`
- `openWorkspaceDirectory(path)`
- `openWorkspaceEditor(path)`

Path entry UI:

- keep path input;
- add `选择文件`, `编辑`, `目录` buttons;
- `选择文件` opens picker in file mode;
- selected file normalizes path, sets draft path, then calls `loadFileContent()`.

Template entry UI:

- keep textarea;
- add actions:
  - `插入文件宏` opens picker in file mode and appends/inserts `{{file:path}}`;
  - `插入模块目录宏` opens picker in directory mode and appends/inserts `{{file:dir/*.md?enabled}}`.

Macro insertion can append to the end of the textarea with a newline. Cursor-aware insertion is nice but not required by acceptance criteria.

Route actions:

- `编辑` / `目录` are leave-and-navigate actions, not side-by-side modal interactions.
- If the entry dialog has unsaved changes, show a simple confirmation: `当前还有未保存的修改，如果此时离开会被丢弃。` with buttons `确认` and `取消`.
- On confirm, close the entry dialog first, then route to Workspace editor/explorer.
- Do not save the message-entry draft from this confirmation path.

Module switch list:

- pass grouped data;
- handle edit/directory events using route helpers.

## Compatibility Notes

- `enabledModules` remains `string[]` of file stems.
- Duplicate stems are not made independently togglable.
- No contracts or runtime storage schema changes.
- No Dexie schema change.
- No route shape changes are required.

## Trade-offs

- The path picker is embedded to avoid nested modal overlays. This keeps `FloatingWindow`'s click shield behavior intact and avoids making one-off pointer-through exceptions.
- Opening parent directory instead of exact file reveal avoids changing Workspace explorer route state. Direct editor covers the common “edit this file now” flow.
- Stem-based toggling means grouped UI can show two rows with the same switch state if duplicate stems exist. This is intentional and should be communicated rather than hidden.

## Rollback Shape

All changes are localized to Studio Vue components and helpers. Reverting the new component plus edits to `EntryEditDialog.vue`, `ModuleSwitchList.vue`, and `message-sequence.ts` restores previous flat rendering and manual path behavior without data migration.
