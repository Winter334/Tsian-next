# 解耦平台硬编码剧情选项

## Goal

移除 `[[选项]]...[[/选项]]` 作为平台 runtime/host 硬编码玩法约定的侵入，让选项格式回到默认游戏卡与默认前端的协作约定。平台不再主动教所有入口 Agent 输出该 marker，也不再为新正式 turn 解析、剥离、emit 选项。

## Requirements

- 平台 runtime guard 不再提及 `[[选项]]`、平台剥离、玩家点击选项等默认前端玩法格式。
- platform-host 不再对新正式 turn 调用 `extractStoryOptions`，不再写新的 `{ kind: "options" }` timeline item，不再 emit 新的 `turn-options`。
- 默认 play frontend 保持现有用户体验：仍可从流式文本、历史文本和 setup 响应中解析 `[[选项]]` 并渲染 `StoryOptions`。
- 默认卡/默认前端约定补位：默认三人写手 AGENT.md 说明 `[[选项]]` 是默认前端识别的行动选项格式，而非平台行为。
- 保留旧协议/旧存档兼容：`TurnTimelineItem.options`、`turn-options` event、`TurnEndResult.options` 暂不删除；默认前端仍从旧 timeline options 恢复按钮。
- 不实现可配置正则/render-rules，不写未确认规范。

## Acceptance Criteria

- [ ] `ENTRY_AGENT_PLATFORM_GUARD` 不含 `[[选项]]`。
- [ ] `platform-host/index.ts` 新 turn 不再调用 `extractStoryOptions`，不再 append `{ kind: "options" }`，不再 emit `turn-options`。
- [ ] 默认前端解析选项逻辑位于 `apps/play-frontend-dev`，不再从 `@tsian/play-bridge` import 该 parser。
- [ ] 旧 SDK/contract options surface 保留并标记 legacy/backcompat。
- [ ] 默认卡三人写手提示包含默认前端选项格式约定。
- [ ] Type checks/builds pass for touched packages.

## Notes

本任务只解决已确认的选项平台侵入。关于卡级可编程渲染/正则规则系统仍处于需求探索阶段，不纳入本任务。