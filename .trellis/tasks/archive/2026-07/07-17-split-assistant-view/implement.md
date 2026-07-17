# Implementation Plan: 拆分 AssistantView 巨型组件

## Checklist

- [x] Read component/hook/state-management specs before implementation.
- [x] Record baseline commit and create `backup/split-assistant-view-pre-split`.
  - Baseline: `8466711c295ff93cd82a44baddb74611ca845c65`
  - Backup ref existed and points to the baseline.
- [x] Map template sections to candidate components.
- [x] Extract presentational message list or session sidebar first.
- [x] Extract composer/attachment UI.
- [x] Extract ask dialog UI.
- [x] Move stable state clusters into composables only after component extraction compiles.
- [x] Preserve props/emits names and event semantics.
- [x] Run `git diff --check`.
- [x] Run `npm run build:web` after extraction.
- [ ] Perform manual smoke notes for send/edit/copy/attach/ask/scroll if a browser check is available.

## Module Map

Route shell retained in:

- `apps/platform-web/src/views/AssistantView.vue`
  - Owns route-level orchestration, session persistence flow, assistant turn lifecycle, provider config persistence, active card refresh, recovery-point handling, and modal/config shell wiring.

Route-local assistant modules added under `apps/platform-web/src/views/assistant/`:

- `AssistantSessionSidebar.vue`
  - Session list, running indicators, create/select/rename/delete affordances.
- `AssistantChatHeader.vue`
  - Assistant route header, provider preset/model selectors, context ring, config button.
- `AssistantEmptyState.vue`
  - No-message suggestions and no-active-card actions.
- `AssistantMessageList.vue`
  - Conversation rendering, assistant timeline groups, message attachments, copy/edit toolbar, typing-dot styling.
- `AssistantComposer.vue`
  - Footer composer, pending attachment previews, file picker, paste handling, stop/send controls, and ask-panel switching.
- `AssistantAskPanel.vue`
  - Active `ask_user` question UI, answer/custom/cancel events, custom input focus.
- `useAssistantComposer.ts`
  - Local composer state for input text, pending attachments, drag-over, object URL cleanup, and attachment persistence via existing storage API.
- `useAssistantScroll.ts`
  - Local scroll container ref, pinned-to-bottom state, jump-to-bottom state, rAF scroll-position persistence, restore helper.
- `format.ts`
  - Small formatting helpers shared by extracted components.
- `types.ts`
  - Route-local DTOs for suggestions, pending attachments, and active ask state.

## Compatibility Notes

- Route path and route-level shell remain unchanged.
- No global store was introduced; extracted modules communicate through explicit props/emits or route-local composables.
- Session create/select/rename/delete flows remain in `AssistantView.vue`; sidebar only emits intent events.
- Send/edit/copy/attachment/ask behavior is preserved through the original route handlers; child components emit the same user intents back to the shell.
- Provider preset/model persistence remains in `AssistantView.vue`; header only renders selectors and emits changes.
- Scroll persistence/autoscroll logic moved to `useAssistantScroll` without changing thresholds (`80` pinned / `120` jump affordance) or storage key usage.
- Composer attachment save/cleanup moved to `useAssistantComposer`; still uses `saveAssistantAttachment` and object URL revoke semantics.

## Validation Notes

- `git diff --check`: passed.
- `npm run build:web`: passed after extraction and after moving typing-dot scoped CSS into `AssistantMessageList.vue`.
  - Build output still reports existing Rollup warnings about `@vueuse/core` pure annotations and large chunks; no build failure.
- Browser manual smoke test was not run in this agent session.

## Rollback Notes

- Baseline backup ref: `backup/split-assistant-view-pre-split` at `8466711c295ff93cd82a44baddb74611ca845c65`.
- Final product-source forward/revert patches are stored under `.trellis/tasks/07-17-split-assistant-view/rollback/`.
- Revert patch was checked with `git apply --check` after generation.

## Check-Agent Review

- Review date: 2026-07-17.
- Scope confirmed: dirty files are limited to `apps/platform-web/src/views/AssistantView.vue`, `apps/platform-web/src/views/assistant/**`, and `.trellis/tasks/07-17-split-assistant-view/**`; `task.json` status drift is expected from task start. No `platform-host` files were edited.
- Previous partial task-artifact edit check: `implement.md` already had implementation notes and no prior `## Check-Agent Review`; `prd.md` checkboxes were still unchecked and have now been marked complete after verification.
- Boundary result: `AssistantView.vue` remains route shell owner for session persistence/load/select/create/rename/delete, assistant turn lifecycle, provider/model persistence, active card refresh, error state, recovery points, ask routing, and config modal shell. Extracted children are route-local presentational components with explicit props/emits; no Pinia/Vuex/global store was introduced. `useAssistantComposer` and `useAssistantScroll` are route-local composables and keep persistence through existing storage helpers.
- Props/emits result: session create/select/rename/delete, send/edit/copy, attachment pick/drop/paste/remove, ask answer/custom/cancel, scroll/jump-to-bottom, focus/reset/autogrow, and provider/model selector intents are preserved through shell handlers.
- Import-boundary result: no import from assistant children back into `AssistantView.vue`; no cycle found in `views/assistant/**`. Child components import only shared UI, route-local helpers/types, storage types/helpers, and `assistant-message-mappers` for existing display helpers.
- Self-fixes applied: restored the missing route-local `suggestions` constant in `AssistantView.vue` after `vue-tsc` caught it; regenerated rollback patches so the revert patch matches the current fixed files and applies cleanly; removed the temporary `node_modules` junction after build.
- Verification: `git apply --check .trellis/tasks/07-17-split-assistant-view/rollback/assistant-view-split-revert.patch` passed; `git diff --check` passed; untracked new-file whitespace scan passed; `npm run build:web` passed using a temporary junction from `F:\workspace\Tsian-worktrees\assistant-view\node_modules` to `F:\workspace\Tsian\node_modules` because dependencies were missing, then the junction was removed.
- Browser manual smoke was not run. Recommended smoke paths: create/select/rename/delete sessions; send/stop/edit/copy messages; upload/drop/paste/remove attachments; answer/custom/cancel ask_user prompt; verify jump-to-bottom and focus/autogrow; switch provider/model when idle and confirm disabled while generating.
