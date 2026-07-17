# Implementation Plan: 拆分 AssistantView 巨型组件

- [ ] Read component/hook/state-management specs before implementation.
- [ ] Record baseline commit and create `backup/split-assistant-view-pre-split`.
- [ ] Map template sections to candidate components.
- [ ] Extract presentational message list or session sidebar first.
- [ ] Extract composer/attachment UI.
- [ ] Extract ask dialog UI.
- [ ] Move stable state clusters into composables only after component extraction compiles.
- [ ] Preserve props/emits names and event semantics.
- [ ] Run `git diff --check`.
- [ ] Run `npm run build:web` after each component/composable seam.
- [ ] Perform manual smoke notes for send/edit/copy/attach/ask/scroll if a browser check is available.
