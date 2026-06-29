# 消息序列缓存命中优化 Implementation Plan

## Phase 1: Segment Metadata And Debug Types

- 扩展 `packages/contracts/src/debug.ts`：为 `AiDebugRecord` 增加可选 message segment 摘要类型。
- 在 `apps/platform-web/src/runtime-host/ai.ts` 增加 message 分析 helper：为请求里的 messages 生成 role、label、stability、charLength、preview、imagePartCount。
- 所有 request push debug record 路径都写入 segment summary；console log 同步输出简表。

## Phase 2: Entry/Delegated Message Reordering

- 在 `apps/platform-web/src/agent-runtime/index.ts` 引入内部带 segment label 的 message builder，最终仍输出 `RuntimeChatMessage[]`。
- 重排 `buildEntryAgentMessages`：拆出 `workspace.context` 与 `turn.runtime`，确保轮次号不污染 workspace context。
- 重排 `buildDelegatedAgentMessages`：目标 Agent 稳定信息前置，调用请求和玩家输入后置。
- 更新 `locateHistorySpan` / `replaceHistorySpan` 相关逻辑，避免依赖旧消息位置或旧字符串前缀。

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
