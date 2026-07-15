# Agent 回复投影与开局历史统一

## Goal

统一 Agent 回复在「玩家可见历史」与「LLM 跨回合上下文」中的落点：开局正文不再走特殊 UI 文件源，而是与后续正式回合一样进入 turn history；后续通过通用回复投影能力支持 `content` / `displayContent` / `projections`，让前端自定义渲染与 Agent 上下文保持解耦。

## Background / Decisions

- 当前 bug：访谈阶段生成的开局正文会写入 `save/playthrough/opening-narrative.json` 并由默认前端特殊渲染，但正式 `sendMessage` 的 LLM 消息序列不会读取该文件，因此首个正式玩家回合看不到开局正文。
  - Step4 写入点：`apps/platform-web/src/storage/workspace-templates.ts:1792`
  - 默认前端读取开局正文：`apps/play-frontend-dev/src/composables/useTsian.ts:332`
  - 默认前端发送正式回合时只传 runtime/scene/protagonist injection：`apps/play-frontend-dev/src/composables/useTsian.ts:245`
  - 正式回合 UI 历史来自 `save/history/turns/turn-*.json`：`apps/platform-web/src/platform-host/history-turns.ts:223`
- 用户决策：选项是 assistant 正文的一部分，不做平台专用 `options` 字段。
- 用户决策：未来需要类似酒馆但更强的正则/投影系统；平台提供能力，不理解玩法内容。
- 用户决策：正则/HTML/DSL 渲染安全不作为平台成本目标；导入内容视为受信任，风险由社区审核和用户选择承担。
- 架构方向：
  - `context.json` 保存给 LLM 的纯净上下文。
  - turn history 保存玩家可见历史及前端渲染投影。
  - 未来 assistant timeline item 可形成 `content`（纯净正文）/ `displayContent`（展示投影文本）/ `projections`（任意 JSON 投影数据）三层。

## Task Map

- Child: `07-15-opening-turn0-player-context` — 开局正文纳入 turn 0 history 并 seed 玩家回合上下文。
- Child: `07-15-agent-reply-regex-projection` — 通用 Agent 回复正则投影系统。

Recommended order:

1. Implement the opening turn 0 / context seed child first, because it fixes the current bug and does not require the full projection system.
2. Implement the generic projection system second, then align both turn 0 and formal turns with the same reply projection pipeline.

## Requirements

- R1: The parent task owns the shared product decisions, child-task map, and final integration expectations; direct implementation should live in child tasks unless a final integration-only change is needed.
- R2: No platform-owned first-class `options` timeline field should be introduced as part of this task tree. Options and similar markers remain assistant-output conventions interpreted by frontends/projection rules.
- R3: Platform host code must not hardcode default-game-card concepts such as `save/playthrough/opening-narrative.json` as a special runtime prompt source.
- R4: Agent context must trend toward pure narrative/context text; UI-only markup, HTML/DSL render forms, and extracted frontend data belong in turn/UI projection surfaces rather than LLM context.
- R5: Future projection design must preserve inline render placement; a standalone extracted-data field is not sufficient by itself.

## Acceptance Criteria

- [ ] Parent PRD records the shared decisions and links both child tasks.
- [ ] Child PRDs capture their independent scope and acceptance criteria.
- [ ] Child A can be implemented and verified without waiting for the full regex/projection system.
- [ ] Child B can be designed without reintroducing platform-specialized options semantics.
- [ ] Final integration review confirms that opening turn 0 semantics do not conflict with the projection-system direction.

## Out of Scope

- Implementing code directly in the parent task unless required for final integration cleanup.
- Backward compatibility for old saves unless a child task explicitly reopens that scope.
- Security/sanitizer/ReDoS defenses for user/community-authored regex or HTML/DSL rendering.
