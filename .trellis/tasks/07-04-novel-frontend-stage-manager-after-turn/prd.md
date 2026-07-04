# 默认 novel 前端回合后场记编排

## Goal

默认 novel 前端在说书人正文完成后发起一次场记 Agent 调用，完成 runtime/entity/scene/relationship/memory/status bar 维护，并处理状态同步中、失败重试、下一轮锁定与 checkpoint 策略。该流程属于默认 novel 前端编排，不写死在平台核心。

## Requirements

- R1: 正文回合由说书人负责，场记不由说书人在 `AGENT.md` 中每轮自行 call。
- R2: 前端在说书人正文流式完成后立即展示正文，并进入“状态同步中”。
- R3: 前端通过通用 AgentInvocation / invokeAgent 调用场记，输入应尽量简洁，例如指定刚完成的 turn，让场记自行读取 turn history、runtime、active scene 和相关实体。
- R4: 场记维护完成前，下一轮玩家输入应被禁用或明确等待，以避免说书人读取旧状态。
- R5: 场记失败时，正文不隐藏；前端显示同步失败并提供重试能力。
- R6: 场记维护的 workspace 写入需要纳入合适的 commit/checkpoint 策略，保证恢复到该回合时可得到正文后维护完成的状态。
- R7: 场记可在维护中使用 `agent_call` 调用世界架构师或资料员。
- R8: 状态栏、人物卡、背包等 UI 在场记完成后刷新；这些是前端默认渲染结构，不是玩法启用项。

## Acceptance Criteria

- [ ] 默认 novel 前端实现正文完成后的场记调用流程。
- [ ] UI 有状态同步中、同步失败、重试、下一轮锁定/解锁状态。
- [ ] 场记调用不阻塞正文首屏/流式展示。
- [ ] 场记完成后 runtime/entity/scene 等更新能被状态栏读取。
- [ ] 场记失败不会静默丢失，且不会允许下一轮在旧状态上继续。
- [ ] checkpoint/restore 行为与回合后维护状态一致。
- [ ] 平台核心没有硬编码 novel AIRP 的说书人→场记 pipeline。

## Notes

该任务依赖通用 AgentInvocation 流式/事件与提交策略的部分能力。若通用提交策略尚未完成，本任务应先设计最小可用路径并记录待补验证。
