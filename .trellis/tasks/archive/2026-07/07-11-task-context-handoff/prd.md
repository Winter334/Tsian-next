# Task 模式上下文管理优化

## Goal

优化 Tsian 桌面助手与 task 模式 Agent 的历史工具上下文管理，降低长任务中工具调用结果反复进入模型上下文导致的 token 膨胀与注意力污染，同时保留 UI / debug 的完整可回溯能力。

目标策略：task 模式采用「执行日志外置 + 任务状态常驻 + 工具结果限额回放」；AIRP / narrative 模式保持现有轻量上下文机制，不引入复杂工具历史管理。

## Background / Confirmed Facts

- 当前桌面助手以 task 模式运行：`runAssistantChat` 注入 `compressionMode: "task"`，见 `apps/platform-web/src/platform-host/assistant-chat.ts:461`、`apps/platform-web/src/platform-host/assistant-chat.ts:468`。
- 当前同一批 `turnToolCalls` 同时写入 UI 会话消息与 agent context：UI 写入见 `apps/platform-web/src/platform-host/assistant-chat.ts:751`，agent context 写入见 `apps/platform-web/src/platform-host/assistant-chat.ts:761`。
- `appendTurnToContext` 会把本轮 user / assistant 正文追加到 `recentTurns`，并把工具调用挂在 assistant entry 上，见 `apps/platform-web/src/agent-runtime/context-lifecycle.ts:712`。
- `buildAgentContextMessages` 会把历史 assistant `toolCalls` rebuild 为模型可见工具历史：native 模式还原为 `assistant.toolCalls` + `role:"tool"` observation，见 `apps/platform-web/src/agent-runtime/index.ts:284`、`apps/platform-web/src/agent-runtime/index.ts:300`、`apps/platform-web/src/agent-runtime/index.ts:309`、`apps/platform-web/src/agent-runtime/index.ts:311`。
- 当前跨 turn 压缩是按 turn 粒度：`compressContext` 保留最近 `keepRecentTurns` 轮，旧 turn 进入 summary，见 `apps/platform-web/src/agent-runtime/context-lifecycle.ts:475`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:482`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:529`。
- 当前工具 observation 收集明确不做持久化层二次截断，见 `apps/platform-web/src/agent-runtime/index.ts:1313`、`apps/platform-web/src/agent-runtime/index.ts:1318`。
- 工具结果喂模型前已有浅层 compact，但主要处理 string result 或对象顶层 `content` 字段，见 `apps/platform-web/src/agent-runtime/workspace-tools.ts:2597`、`apps/platform-web/src/agent-runtime/workspace-tools.ts:2610`、`apps/platform-web/src/agent-runtime/workspace-tools.ts:2618`、`apps/platform-web/src/agent-runtime/workspace-tools.ts:2631`。
- 外部参考（用户提供）：https://news.qq.com/rain/a/20260608A07HSX00。选用其中最适合 Tsian task 模式的原则：分层渐进、工具原文作为可回溯日志、用户意图优先、可逆隐藏 / placeholder、确定性投影优先于 LLM 摘要、避免滑窗式不稳定裁剪。

## Requirements

- R1：新策略只作用于 task 模式，包括桌面助手与 delegated task agents；AIRP / narrative master 暂不引入复杂工具历史管理。
- R2：UI / debug 层继续保留完整工具过程，模型上下文层不再默认回放完整历史工具 observation。
- R3：task 模式 agent context 应转向 task handoff 风格：保留用户关键意图、当前目标、关键约束、已完成工作、关键结论、文件 / 资源锚点、待办和少量最近工具行动痕迹。
- R4：工具结果进入模型上下文前必须有预算控制，避免最近 K turn 中单个或多个工具调用无限膨胀。
- R5：对常见高风险工具结果提供 deterministic projection / snip，至少覆盖 workspace read/search/list/glob、agent_call、inspect_frontend、run_script / user tools 的大输出形态。
- R6：模型可见工具记忆需要保留可回溯锚点，但 MVP 中 `rawRef` 仅服务 UI / debug；模型需要精确信息时通过现有 workspace tools 重新读取 / 重新 inspect，不新增 raw-log 回取工具。
- R7：上下文策略应保持 prompt 稳定，避免每轮滑窗式重排导致缓存命中和模型历史视角抖动。
- R8：MVP 不引入 LLM 增量 handoff summary / scratchpad 自动维护；第一版先交付 deterministic projection、raw/model 分离与工具预算，后续阶段再评估自动摘要。
- R9：第一版覆盖桌面助手主入口和 delegated `agent_call` 返回给父 agent 的 observation 投影；不为 delegated 子 agent 增加跨 turn 持久化上下文。
- R10：deterministic projection 第一版默认预算采用稍宽松、可后续收紧的策略；建议初始配置使用字符预算而非 tokenizer，例如单工具模型可见投影约 8k 字符、最近工具投影总量约 32k 字符、保留最近约 3 个 assistant turn 的工具 snips，具体值在设计阶段根据现有配置命名落地。
- R11：超出预算或超过最近保留窗口的工具 snips 在 MVP 中不直接消失，应保留极短占位符（tool name、关键参数 / 行动痕迹、状态、UI/debug 可回溯提示），但不鼓励模型回读 raw log；模型需要精确信息时通过现有 workspace tools 重新获取。
- R12：MVP 不复用 `AgentContextToolCall.observation` 承载模型可见 projection；应在 contracts / runtime 层引入显式的 model-facing 工具上下文类型，使 UI/raw 工具调用记录与 agent model context 的工具记忆在类型和语义上分离，避免后续排查 raw/projection 混淆。
- R13：新的 model-facing 工具上下文类型采用通用结构 + `summaryText` 的中间方案，而不是纯字符串或按工具类型定义复杂 union；建议字段包含 id/sourceToolCallId/toolName/status/visibility/title/summaryText/anchors/argsSummary/tokenEstimate 等，projection 内部可按工具类型特判但输出统一。
- R14：task 模式工具记忆应从 `recentTurns` 中拆出，成为 agent context 的独立 top-level 列表（例如 `toolMemories`），使对话正文与工具记忆拥有不同预算、保留窗口和 placeholder 策略；`recentTurns` 继续只表达用户 / 助手正文。
- R15：MVP 不新增独立 `taskState` / `scratchpad` 顶层结构；第一版只新增 `toolMemories`，任务状态继续由现有 `summary` + `recentTurns` 承担，后续若实现 LLM 增量 handoff / TODO 自动维护再引入结构化 task state。
- R16：项目尚未上线，MVP 不做旧 `context.json` 的兼容读取或迁移；历史挂在 assistant turn 上的 `toolCalls` 可直接丢弃，新代码只写入 / 读取新结构。
- R17：新策略不得造成 task 模式 prompt cache 命中率持续性恶化；工具记忆渲染必须 deterministic、避免每轮重排 / 重写旧内容，并尽量不把高频变化块插入大段稳定上下文之前。允许上线后第一次 prompt 结构变化导致一次性 cold cache。

## Technical Notes

- `AgentContextToolCall` 继续作为 UI/raw 会话消息工具记录；新增 model-facing 工具记忆类型用于 `AgentContextSnapshot.toolMemories`。
- `recentTurns` 在新结构中只承载 user / assistant 正文，工具记忆 top-level 独立管理。
- task-mode prompt 渲染历史工具记忆时应使用普通工作日志文本，不再重建历史 native tool protocol message。
- delegated `agent_call` 的 UI/timeline full output 可继续完整；喂给父模型的 observation 需要递归 compact，尤其处理 `response` 等非 `content` 大字段。
- Assistant context 继续作为 `.tsian/local/assistant/sessions/<sessionId>/context.json` 虚拟文件保存，不新增隐藏 Dexie 状态。

## Acceptance Criteria

- [ ] 桌面助手长任务中，历史工具调用不会再因最近 K turn 原样回放而线性膨胀；模型可见工具历史有明确 per-tool / total budget。
- [ ] UI 会话历史和 timeline 仍能展示完整工具过程，不因模型上下文裁剪而丢失用户可见调试信息。
- [ ] task 模式下一轮上下文能看到任务摘要 / 最近对话 / 最近工具行动痕迹，而不是完整 raw observation。
- [ ] AIRP / narrative 模式行为保持简单，不引入 task-mode 工具历史状态机或额外噪声。
- [ ] 关键用户指令、纠正、偏好、当前目标优先保真，不被工具结果挤出模型上下文。
- [ ] 对 agent_call / inspect_frontend / run_script 等大对象输出，模型可见内容有可靠 snip / projection，不依赖对象顶层 `content` 字段才裁剪。
- [ ] `context.json` 新写入结构包含 top-level `toolMemories`，且 `recentTurns` 不再写 turn-level `toolCalls`。
- [ ] 设计文档说明 raw log、model context、toolMemories、summary/recentTurns 的边界和数据流。
- [ ] 实施计划列出分阶段交付与验证方式。
- [ ] `npm run build:contracts` 与 `npm run build:web` 在实现后通过。

## Out of Scope

- 不在本任务中重做 AIRP / narrative 上下文机制。
- 不在本任务中实现长期向量记忆或跨会话知识库。
- 不在本任务中实现完整 Claude Code / Codex / Cursor 风格全功能上下文面板。
- 不在本任务中实现 LLM 增量 handoff summary / scratchpad 自动维护。
- 不在本任务中新增 raw-log 回取工具。
- 不在本任务中为旧 `context.json` 做兼容读取或迁移。
- 不把 UI / debug raw 日志删除或改成只存摘要。
