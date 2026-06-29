# 消息序列缓存命中优化 Design

## Overview

本任务把 Agent Runtime 的模型请求拆成更明确的缓存层：稳定系统前缀、半稳定工作区上下文、历史上下文、动态本轮请求、工具循环追加内容。目标是让 OpenAI-compatible provider 的隐式 prompt cache 尽量复用长前缀，同时保留 native function calling 和 text fallback 两条路径。

## Message Segment Model

新增一个内部概念：message segment metadata。它不改变 provider 请求协议，只用于组装顺序、debug 展示和后续仪表盘扩展。

建议字段：

- `label`：例如 `system.agent`, `workspace.context`, `history`, `turn.runtime`, `turn.input`, `tool.observation`, `skill.injected`。
- `stability`：`stable`、`semi-stable`、`dynamic`。
- `charLength`：基于文本内容估算长度；多模态内容只统计 text part 并标记 image part 数量。
- `role` / `index`：便于 DebugView 对照实际请求顺序。

metadata 不发送给模型；只进入 `AiDebugRecord` 或 console log。

## Entry Agent Message Order

当前问题：`当前问答轮次/当前回合` 与 `formatAgentRuntimeContext` 同处一条 user message，轮次号会成为该 message 的早期动态断点。

目标顺序：

1. `system.agent`：平台 guard + `AGENT.md` + 可选 `SOUL.md` + 最小固定工具原则。
2. `workspace.context`：`formatAgentRuntimeContext(context)`，不包含轮次号。
3. `history`：`AgentContextSnapshot` 展开的 summary/recent turns，或旧兜底的最近对话文本。
4. `turn.runtime`：当前轮次号、必要的运行时短元数据。
5. `injection.before-input`：前端 before-input 注入。
6. `turn.input`：用户/玩家本轮输入和附件。
7. `injection.after-input`：前端 after-input 注入。

说明：`history` 可能随对话增长变化，但它通常比本轮输入稳定。`workspace.context` 放在历史前可以让 Agent 定义 + workspace 索引在多轮中形成更长稳定前缀；如压缩逻辑依赖 history span，需要同步更新 `locateHistorySpan`，不能靠内容字符串位置隐式判断。

## Delegated Agent Message Order

目标顺序：

1. `system.agent`：目标 Agent 的稳定 system prompt。
2. `workspace.context`：目标 Agent 的 notes/contextPaths/Skill Index。
3. `caller.context`：调用方 Agent id/title/summary，属于半稳定。
4. `history`：按 `historyMode` 选择的最近对话窗口。
5. `turn.runtime`：当前回合、historyMode、调用深度等短动态元数据。
6. `turn.input`：玩家本轮输入。
7. `agent-call.request`：调用请求、原因、期望输出、调用方额外摘要。
8. `agent-call.final-instruction`：只回答调用方请求，不输出给玩家最终正文。

`agentCall.request` 和 `contextSummary` 是强动态内容，必须后置。

## Tool Prompt Strategy

### Native Mode

Native function calling 下，API `tools` schema 是主要工具说明。system prompt 只保留短原则：

- 工具可选，只在上下文不足或需要读写 workspace 时使用。
- Skill 使用两步：先 `use_skill`，下一轮阅读注入的 `SKILL.md`，再按说明读取 references 或执行脚本。
- 可并行调用独立只读工具。
- 最终回复不暴露工具调用、observation 或实现细节。

删除或压缩 system prompt 里的具体 JSON 参数示例，尤其避免具体联系人 id 进入 system 前缀。

### Text Mode

Text fallback 必须保留。可以同步瘦身，但要保留足够格式约束：

- 明确 `<tsian-tool-call>` 块必须独占。
- 块内必须是纯 JSON，不带 Markdown fence、注释或解释。
- 保留一个最小示例。
- 多工具调用规则保持当前解析能力可支持的形态。

项目未上线，不需要兼容旧历史数据，但同一回合内 text 工具调用必须稳定。

## Function-Calling Schema Strategy

`buildEnabledToolSchemas` 继续按权限返回稳定工具列表，不引入 provider-specific 变体。

优化方向：

- 精简长 description，避免把 prompt 规则重复写进 schema。
- 保留工具用途、关键参数、返回里的续读字段说明。
- JSON Schema 使用 OpenAI-compatible provider 常见子集：`type`、`properties`、`required`、`enum`、`items`。
- 不改工具名，不随意改必填字段。
- 动态信息（联系人列表、Skill 列表、当前 workspace 状态）不进 schema。

## Observation Strategy

采用 Codex 式可续读 observation：模型上下文只持有必要事实与续读线索，完整事实留在 workspace/debug/trace。

### Small Result

小结果继续 inline，保持当前交互效率。

### Large Result

大结果进入模型上下文前转为 compact observation：

- `ok` / `tool` / `path` 或 `ref`。
- `preview`：前部或关键摘要片段，固定字符上限。
- `charCount` / `itemCount`。
- `offset` / `limit` / `returnedLines` / `totalLines` / `truncated`。
- `nextOffset` 或续读建议。

`workspace_read` 已有 line slicing metadata；本任务优先复用并统一 native/text observation formatter。`agent_call`、`inspect_frontend`、Skill 脚本返回等无分页工具，至少加模型上下文截断和 trace 完整保留策略。

### Skill Injection

`collectActivatedSkillContents` 已通过 `injectedSkillPaths` 避免同一 tool loop 重复注入同一 `SKILL.md`。本任务保留该机制，并为超长 `SKILL.md` 引入同样的 compact/续读策略，避免完整 Skill 长期常驻后续轮次。若 Skill 入口本身必须完整遵循，则优先限制为“只注入一次 + 后续不重复”，不要摘要掉关键指令。

## Debug Observability

扩展 `AiDebugRecord`，加入可选 `messageSegments` 或等价结构。DebugView 可在现有 AI debug 区域展示轻量列表，不做完整仪表盘。

建议每条 segment 展示：

- index / role / label / stability。
- char length / preview。
- image part count。

console log 同步输出 segment summary，便于和 provider 后台的输入 token/cache hit 对照。

## Validation

- `npm run build --workspace @tsian/contracts`
- `npm run build --workspace platform-web`
- 手动验证 native：助手一次普通问答、一次 workspace read、一次 Skill 激活。
- 手动验证 text：切换 `toolCallMode: "text"` 后执行最小 workspace read，确认 `<tsian-tool-call>` 仍可解析。
- DebugView 或 console 能看到 message segment 顺序与长度。

