# invokeAgent workspace-with-checkpoint 提交语义实现

## Goal

实现 `invokeAgent` 的 `workspace-with-checkpoint` 提交模式：维护类调用（如场记回合后维护）完成后，在 workspace 写入落盘的同时创建一个可恢复 checkpoint，保证 restore 到该回合时正文与维护后状态一致。

## Background · 缺口来源

`07-04-agent-invocation-streaming`（已归档）在 design.md:184-205 与 implement.md:18 明确选择：**只在契约层预留 `commitMode: "workspace-with-checkpoint"` 字段，不实现 checkpoint 行为**，并把实现推给"场记编排子任务"。但场记编排任务（`07-04-novel-frontend-stage-manager-after-turn`）是前端编排任务，不实现平台层 checkpoint 存储——缺口落在前端与平台的缝隙里，无人认领。

本任务补上这个平台层缺口。

## Current State

- `packages/contracts/src/runtime.ts:680`：`AgentInvocationCommitMode = "workspace" | "workspace-with-checkpoint"` 已定义。
- `apps/platform-web/src/platform-host/index.ts:1123`：`commitMode === "workspace-with-checkpoint"` 直接 `throw "not implemented yet"`。
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts:133`：bridge 层已校验两个合法值，参数透传正常。
- `apps/platform-web/src/storage/saves.ts:124`：主 turn 的 `sendMessage` 完成时会创建 `checkpointReason: "after-turn"` 的 checkpoint——这是现成的 checkpoint 创建路径，本任务可参考或复用。
- 前端消费者已就绪：`07-04-novel-frontend-stage-manager-after-turn` 的 `useSyncAfterTurn` 当前用 `commitMode: "workspace"`，本任务完成后只需改 commitMode + 加 `checkpointReason: "post-turn-maintenance"` 即可获得 checkpoint 一致性，前端编排不变。

## Requirements

- R1: `invokeAgent` 接受 `commitMode: "workspace-with-checkpoint"` 时，不再 throw，而是执行完整流程：agent 运行 → workspace 写入落盘 → 创建 checkpoint。
- R2: checkpoint 应在 workspace 写入完成**之后**创建，确保 restore 到该 checkpoint 时能看到维护后的状态（不是维护前）。
- R3: `checkpointReason` 字段透传到 checkpoint 记录，便于 DebugView 和 restore 对话框区分 checkpoint 来源（`after-turn` vs `post-turn-maintenance` 等）。
- R4: checkpoint 的 turn 归属应正确：维护类调用的 checkpoint 归属当前 turn（不推进 turn），与 `sendMessage` 的 after-turn checkpoint 同 turn 但不同 reason，restore 时两者都可见或维护 checkpoint 覆盖 after-turn（实施时确认语义，记录在 design.md）。
- R5: 失败时（agent 运行失败或 workspace 写入失败）不创建 checkpoint，已写入的 workspace 变更按现有 workspace 模式的事务语义处理（实施时确认是否回滚）。
- R6: `workspace` 模式行为不变（向后兼容）。
- R7: 不改变 `invokeAgent` 的流式事件协议（started/delta/round-end/tool/completed/failed）；checkpoint 创建发生在 completed 之前或之后由实施决定，但 completed 事件应在 checkpoint 创建后发出（确保前端收到 completed 时状态已可恢复）。

## Acceptance Criteria

- [ ] `invokeAgent` 传 `commitMode: "workspace-with-checkpoint"` 不再 throw，正常完成 agent 运行 + workspace 写入 + checkpoint 创建。
- [ ] checkpoint 记录包含 `checkpointReason`（如 `post-turn-maintenance`）。
- [ ] restore 到维护类 checkpoint 时，workspace 状态反映维护后内容（正文 + runtime/entity/scene 等维护结果一致）。
- [ ] `workspace` 模式行为不变，现有调用方无回归。
- [ ] DebugView / 检查点列表能区分 `after-turn` 与 `post-turn-maintenance` 等 reason。
- [ ] `npm run build:contracts` 与 `npm run build:web` 通过。
- [ ] 前端 `useSyncAfterTurn` 切换到 `workspace-with-checkpoint` 后，端到端 restore 一致性验证通过（可作为本任务验收的端到端测试，或留给场记编排任务的 G3 复验）。

## Dependencies

- 契约层 `AgentInvocationCommitMode` + `InvokeAgentRequest` 已就绪（无需改动）。
- `saves.ts` 现有 checkpoint 创建逻辑（参考或复用）。
- 端到端验收可依赖 `07-04-novel-frontend-stage-manager-after-turn` 的前端编排作为消费者。

## Notes

- 本任务范围聚焦平台层 checkpoint 存储语义，不触及前端编排（前端切换 commitMode 是一行改动，留给本任务验收或场记任务复验）。
- 若 checkpoint 创建与 workspace 事务的原子性有复杂度（如写入成功但 checkpoint 创建失败），在 design.md 记录权衡，MVP 可接受"写入成功 + checkpoint 尽力创建"语义，记录为已知限制。
