# 消息序列缓存命中优化 Implementation Plan

> 本任务首次落地（`04585d6` + `1b8e625`）使缓存变差，已回退错误顺序（见 design.md 设计修正记录）。Phase 0 修正落地错误，Phase 1+ 沿修正后顺序推进。

## Phase 0: Revert Wrong Landing（回退错误落地）

> 目标：把首次落地中"使缓存变差"的两处错误改回正确形态，恢复 `history` 紧随 `system.agent` 的长稳定前缀，并恢复跨 turn 历史工具调用的 native 结构化形态。

- `apps/platform-web/src/agent-runtime/index.ts` `buildEntryAgentMessages`：把 `workspace.context` 从 `historyMessages` 之前移到之后、`turn.runtime` 之前，恢复顺序为 `system → history → workspace.context → turn.runtime → before-input → turn.input → after-input`。
- `apps/platform-web/src/agent-runtime/index.ts` `buildDelegatedAgentMessages`：把 `目标 Agent 上下文` 从 `最近对话窗口`/`调用方 Agent` 之前移到 `history` 之后、`turn.runtime` 之前，对齐 design 修正后的 delegated 顺序。
- `apps/platform-web/src/agent-runtime/index.ts` `buildAgentContextMessages`：跨 turn 历史工具调用恢复 native 结构化形态（`assistant.toolCalls` + `role:tool` 完整 observation），回退 `1b8e625` 引入的 `role:user` 短摘要（`formatHistoricalToolCallSummary`/`formatHistoryToolArguments`/`previewHistoryToolText`）。observation 体积控制交给 R6a compact 策略，不在历史层改写角色。
- `apps/platform-web/src/agent-runtime/index.ts` `locateHistorySpan`：更新锚点——`workspace.context` 现在位于 history 之后，剧情段仍是 `system` 之后到 `当前回合/当前问答轮次` 之前的独立 message 序列，起始 `start` 不再因 `workspace.context` 前置而偏移到 index 2。
- `apps/platform-web/src/runtime-host/ai.ts` `segmentStability`：`workspace.context` 从 `stable` 改为 `dynamic`（与修正前提一致）；`history.tools.summary` 标注随 Phase 0 回退同步移除或调整。
- 保留 `04585d6` 中的正确改动：system 工具说明瘦身（native 只列工具名、去掉具体联系人 id）、`buildDebugMessageSegments` 可观测性骨架。

## Phase 1: Segment Metadata And Debug Types

- 扩展 `packages/contracts/src/debug.ts`：为 `AiDebugRecord` 增加可选 message segment 摘要类型。
- 在 `apps/platform-web/src/runtime-host/ai.ts` 增加 message 分析 helper：为请求里的 messages 生成 role、label、stability、charLength、preview、imagePartCount。
- 所有 request push debug record 路径都写入 segment summary；console log 同步输出简表。

## Phase 2: Entry/Delegated Message Reordering

> Phase 0 已回退错误顺序。本 Phase 在正确顺序上做精细化，确保 segment label 与 `locateHistorySpan` 锚点稳定。

- 在 `apps/platform-web/src/agent-runtime/index.ts` 引入内部带 segment label 的 message builder，最终仍输出 `RuntimeChatMessage[]`。
- 确认 `buildEntryAgentMessages` 顺序为 `system → history → workspace.context → turn.runtime → before-input → turn.input → after-input`（Phase 0 已落地的基准）。
- 确认 `buildDelegatedAgentMessages` 顺序为 `system → caller.context → history → workspace.context → turn.runtime → turn.input → agent-call.request`（Phase 0 已落地的基准）。
- 更新 `locateHistorySpan` / `replaceHistorySpan` 相关逻辑，避免依赖旧消息位置或旧字符串前缀；剧情段边界以 `当前回合/当前问答轮次` 锚点为准。

## Phase 3: Prompt And Schema Slimming

- 拆分 `buildWorkspaceToolInstructions` 为 native/text 两套输出。
- native 输出只保留短原则，不包含具体联系人 id 或大量 JSON 示例。
- text 输出保留最小 `<tsian-tool-call>` 协议说明和示例。
- 精简 `apps/platform-web/src/agent-runtime/tool-schemas.ts` 中过长 description，保留参数语义和续读字段说明。

## Phase 4: Compact Observation Formatting

- 在 `apps/platform-web/src/agent-runtime/workspace-tools.ts` 增加 compact observation formatter，统一 native/text 使用。
- 小结果 inline；大结果输出 preview + ref/path/range/offset/limit/truncated/total 等续读线索。
- 优先处理 `workspace_read`、`search`、`glob`、`agent_call`、`inspect_frontend`、`run_script` 的大结果。
- 保持 trace/UI tool output 可显示足够完整结果；模型上下文 compact 与 debug/trace 分离。

## Phase 5: DebugView Lightweight Display

- 在 `apps/platform-web/src/views/DebugView.vue` 的现有 AI debug 区域增加 message segment 列表。
- 展示 index、role、label、stability、char length、preview。
- 不做单独缓存仪表盘。

## Phase 6: Validation

- 若现有测试体系可直接复用，增加 focused fixture 测试覆盖 entry/delegated message order、native/text prompt 差异、compact observation 输出。
- 若没有合适测试体系，不为本任务单独引入大型测试框架；改用可导出的 debug/helper 断言路径配合 build 和手动验证。
- 运行 contracts build。
- 运行 platform-web build。
- 手动用 native 模式验证普通问答、工具调用、Skill 激活。
- 手动用 text 模式验证 workspace read fallback。
- 对照 DebugView/console，确认稳定段在前、动态段后置、大 observation compact。
