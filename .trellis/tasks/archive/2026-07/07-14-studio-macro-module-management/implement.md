# Implementation Plan: 工作室宏模块开关分组与文件管理入口

## Checklist

1. Planning / activation
   - [ ] Finalize `prd.md`, `design.md`, and `implement.md`.
   - [ ] Start task with `python ./.trellis/scripts/task.py start .trellis/tasks/07-14-studio-macro-module-management`.
   - [ ] Load pre-development specs for `platform-web/frontend`.

2. Grouped module switch data
   - [ ] Update enabled module macro extraction to recognize wildcard module macros.
   - [ ] Add grouped module switch types/helpers in `message-sequence.ts`.
   - [ ] Add duplicate-stem detection helper or compute locally in `ModuleSwitchList.vue`.

3. Module switch UI
   - [ ] Refactor `ModuleSwitchList.vue` from flat modules to grouped sections.
   - [ ] Preserve stem-based Switch behavior.
   - [ ] Add `编辑` and `目录` emits for each module.
   - [ ] Add duplicate-stem linked-state hint when applicable.

4. Workspace path picker
   - [ ] Add a Studio-scoped embedded `WorkspacePathPicker.vue` using `listPlatformWorkspaceDirectory`.
   - [ ] Support file mode and directory mode.
   - [ ] Include loading/error/empty states, single-selection rows, bounded scrolling, and fixed footer actions.
   - [ ] Avoid wrapping the picker in `FloatingWindow`; it must not create a second modal overlay.

5. Entry edit dialog integration
   - [ ] Replace flat `modulesForCurrentMacros` with grouped computed value.
   - [ ] Wire module edit/directory emits to existing workspace routes.
   - [ ] Add file picker to path entry mode and load selected file.
   - [ ] Add inline template insertion actions for `{{file:path}}` and `{{file:dir/*.md?enabled}}`.
   - [ ] Add referenced-file edit/directory jump buttons.
   - [ ] Make edit/directory jumps close the entry dialog before routing; if there are unsaved dialog changes, confirm discarding with only `确认` / `取消`.

6. Validation
   - [ ] Run `npm run build:web`.
   - [ ] If possible, manually inspect Studio flows listed in PRD acceptance criteria.

## Risk Areas

- `enabledModulesConfigured` absent-vs-empty semantics: do not alter `MessageSequenceEditor.vue` save behavior except through existing draft flow.
- UI macro extraction regex must align with common runtime forms, especially `modules/*.md?enabled` and `modules/<dir>/*.md?enabled`.
- Workspace picker should not mutate workspace files; it only lists paths and emits a selection.
- Route navigation from a dialog should not close/discard local drafts automatically unless the user chooses to navigate away; pushing route opens/focuses the workspace window under existing desktop shell behavior.

## Validation Commands

```bash
npm run build:web
```

Run `npm run build:contracts` only if contract shapes change; current design avoids contract changes.
