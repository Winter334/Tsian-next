# Design: 拆分 AssistantView 巨型组件

## Split Shape

候选结构：

```text
apps/platform-web/src/views/assistant/
  AssistantSessionSidebar.vue
  AssistantMessageList.vue
  AssistantComposer.vue
  AssistantAskDialog.vue
  useAssistantSessions.ts
  useAssistantComposer.ts
  useAssistantScroll.ts
```

或将可复用子组件放入 `apps/platform-web/src/components/assistant/`，route-only glue 留在 `views/AssistantView.vue`。

## State Boundaries

- Session loading/selection/rename/delete: sessions composable。
- Composer text/attachments/send lock: composer composable。
- Scroll-to-bottom/focus behavior: scroll composable tied to refs。
- Ask dialog active state: local composable or child component props/emits。

## Rollback

- Baseline branch: `backup/split-assistant-view-pre-split`。
- Patch checkpoints per UI seam/component extraction.
