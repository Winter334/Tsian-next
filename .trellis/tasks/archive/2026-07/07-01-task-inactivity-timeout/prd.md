# Task 超时改为无响应超时

## Goal

将 task 模式（助手 agent + 委托 agent_call）的超时机制从"总时长超时"改为"无响应超时"：只有在距离上一次活动（model delta、tool 调用、round end）超过阈值没有任何进展时才触发超时，而不是从 turn 开始累计总时长到达阈值就杀掉。

## Background

当前超时机制有两处"总时长"检查：
- `assistant-chat.ts` line 373-375：`setTimeout(taskTimeoutMs)` 从 turn 开始倒计时，5 分钟到就 abort，不管中间有多少活动。
- `index.ts` line 1450-1454 + 1837-1841：每次压缩触发时查 `Date.now() - taskStartedAt > taskTimeoutMs`，也是从 turn 开始算总时长。

问题：助手在调试脚本时做了大量文件操作（读 SKILL.md、读脚本、调 test_skill_script、读 trace），每步都在正常推进，但 5 分钟累计到了就被杀掉——即使它一直在工作。

## Requirements

- 超时语义从"总时长"改为"无响应"：距离上一次活动超过阈值才触发。
- "活动"定义：model delta 流、tool 调用开始/完成、round end。
- 默认无响应阈值 10 分钟（`DEFAULT_TASK_INACTIVITY_TIMEOUT_MS = 600_000`）。
- `assistant-chat.ts` 的 `setTimeout` 改为可重置计时器：每次活动回调里重置。
- `index.ts` 的 `taskStartedAt` 检查改为 `lastActivityAt` 检查：每次有活动时更新。
- 超时错误信息从"任务执行超时（300s）"改为"任务无响应超时（600s）"。
- 不影响 narrative 模式（master），master 无超时。

## Acceptance Criteria

- [ ] 助手持续工作超过 5 分钟但每步都有响应时不被超时杀掉
- [ ] 助手卡住（无 delta、无 tool 调用、无 round end）超过 10 分钟时被超时杀掉
- [ ] `agent_call` 委托 agent 同样使用无响应超时
- [ ] master narrative 模式不受影响（无超时）
- [ ] `npm run build --workspace platform-web` 通过

## Out Of Scope

- 超时阈值用户可配置（后续可加，当前用固定默认值）
- narrative 模式超时（master 不设超时）

## Confirmed Facts

- `DEFAULT_TASK_TIMEOUT_MS = 300_000`（5 分钟）定义在 `context-lifecycle.ts:85`
- `assistant-chat.ts:373-375` 的 `setTimeout` + `timeoutController`
- `index.ts:1450-1454`（native 路径）+ `1837-1841`（text 路径）的 `taskStartedAt` 检查
- `turn-types.ts:100` 的 `taskTimeoutMs` 字段
- `TaskTimeoutError` 定义在 `context-lifecycle.ts:372`
