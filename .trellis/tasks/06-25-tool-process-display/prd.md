# 游戏前端与桌面助手工具调用过程显示优化

## Goal

让玩家/用户能在回复完成后回看工具调用过程（而非随 snapshot 覆盖渲染消失），且 agent_call 的返回内容对玩家可读，方便玩家判断问题、找助手 agent 咨询和修复。截断位置从平台 runtime 层迁移到 UI 侧。

## User Value

- 玩家能看到"master 调了哪些工具、调了哪个子 agent、子 agent 答了什么"，据此判断是否存在问题。
- 工具卡片不再在回复完成后消失，会话内可回看。
- agent_call 的玩家可读部分（被调用 agent 的 title + response）不再被埋在 500 字截断的结构化 JSON 里。

## Confirmed Facts (调研已确认)

### 截断机制
- 平台 runtime 层 `summarizeToolObservationOutput`（`workspace-tools.ts:2063`）对所有工具统一 `JSON.stringify(result)` 后截断到 500 字（`TURN_TOOL_OUTPUT_MAX_LENGTH`），塞进 `turn-tool` 事件 `output` 字段。这是平台侧截断，非 UI 侧。
- 前端 `default-frontend-files.ts:502` 的 `slice(0, 500)` 是冗余兜底（平台已 ≤500）。
- agent_call 的 500 字配额给的是整坨 `JSON.stringify({status, targetAgent, historyMode, metadata, response})`，结构字段抢配额且 response 常被腰斩。

### master 上下文不受影响（架构保证）
- master 实时上下文（turn 内工具循环）：经 `formatRuntimeWorkspaceToolObservationMessage`（`workspace-tools.ts:2350`）全量 `JSON.stringify(observations, null, 2)` 喂回模型，**不截断**。
- master 持久化上下文（`recentTurns`）：`appendTurnToContext`（`context-lifecycle.ts:625`）只存 user/assistant 正文，**从不存工具调用**。UI 改动污染不到 master。
- agent_call 跨 turn 连贯性靠正文沉淀（master 把结论写进最终正文）+ `historyMode` 给被调用 agent 正文窗口，不依赖工具过程持久化。

### 过程数据载体可达性
- `turn-tool` 事件：前端实时可达，但仅内存，turn 结束后随流式状态丢弃。
- `turn-completed.snapshot`：只含剧情正文（`RuntimeStateShell.state.messages`），不含工具过程。
- trace（`.tsian/local/.../traces/`）：落盘但远程前端被 `REMOTE_RESOURCE_FORBIDDEN` 拦截，不可达。
- **现状：没有任何既前端可达、又跨加载持久化的工具过程载体。**

### 现状行为（默认打包游戏前端）
- `handleSnapshot`（`default-frontend-files.ts:638`）在 turn-completed 时 `$story.innerHTML = ""` 清空重建，过程区连同工具卡片被抹掉，只留 user/assistant 正文。
- `finalizeTurn`（L601）的折叠逻辑在 snapshot 覆盖渲染后实际是死代码（折叠游离节点）。

## Requirements

### R1 平台 runtime 层（`workspace-tools.ts`）
- `summarizeToolObservationOutput` 不再截断，完整 output 透传给 `onTool`（服务游戏前端 + 桌面助手）。
- agent_call 给结构化字段：提取 `targetAgent.title` + `response`，而非整坨 JSON.stringify。
- **不动**喂回模型的 `formatRuntimeWorkspaceToolObservationMessage`（native content 冗余包装是单独技术债，见 `docs/active/tool-result-structure-followup.md`）。

### R2 默认打包游戏前端（`default-frontend-files.ts`）
- 工具卡片 + 过渡文本（interim）留在前端内存跨 turn 保留；`handleSnapshot` 覆盖渲染时不清过程区。
- 普通工具：只显"调了什么 + 成功/失败"，不显 output 内容。
- agent_call：显 `title` + `response`，UI 侧控制截断/折叠。
- **不持久化**：刷新页面 / 重开存档 → 只剩正文，工具过程丢失（方案 A，用户已确认）。

### R3 桌面助手（`AssistantView.vue` + `useAssistantTimeline.ts`）
- 工具卡片拿到完整 output，UI 侧决定显示策略和截断。
- agent_call 同样显 `title` + `response`。

### R4 契约层（`@tsian/contracts` 的 `turn-tool` 事件 payload）
- 需确认 `output` 字段语义变更形态（string → string | 结构化对象？），design 阶段定。

## Acceptance Criteria

- [ ] 回复完成后，工具调用卡片在游戏前端不消失，会话内可折叠回看。
- [ ] agent_call 工具卡片显示被调用 agent 的 title + response（玩家可读），非整坨 JSON。
- [ ] 普通工具卡片只显示工具名 + 成功/失败状态，不显示结构化 output。
- [ ] 工具调用时的过渡文本（interim）作为过程节点保留，不混入剧情正文。
- [ ] 桌面助手工具卡片显示完整 output（UI 侧截断），agent_call 显 title + response。
- [ ] master agent 行为不受影响：实时上下文仍拿完整 observation，持久化上下文仍只存正文。
- [ ] 刷新页面 / 重开存档后，工具过程不残留（仅正文），符合方案 A。
- [ ] lint + type-check 通过。

## Out of Scope

- native 模式 tool message content 冗余包装优化（单独技术债，`docs/active/tool-result-structure-followup.md`）。
- 工具过程跨加载持久化（方案 B/C，用户已确认不需要）。
- trace 对前端开放（保持 `REMOTE_RESOURCE_FORBIDDEN`）。
- master 上下文装配逻辑任何改动。

## Resolved Decisions

- **普通工具 output 显示**：统一不显。所有非 agent_call 工具只显工具名 + 成功/失败状态，不显示 output 内容（含 read/semantic_search 等可读工具，用户确认）。

## Open Questions (design 阶段定)

- 过程区跨 turn 保留的具体机制（`handleSnapshot` 保留过程区 vs 从内存累积数组重建）。
- agent_call 结构化 output 的字段定义（契约 payload 形态）。
