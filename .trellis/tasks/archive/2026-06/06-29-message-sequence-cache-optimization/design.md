# 消息序列缓存命中优化 Design

## Overview

本任务把 Agent Runtime 的模型请求拆成更明确的缓存层：稳定系统前缀、半稳定工作区上下文、历史上下文、动态本轮请求、工具循环追加内容。目标是让 OpenAI-compatible provider 的隐式 prompt cache 尽量复用长前缀，同时保留 native function calling 和 text fallback 两条路径。

## 设计修正记录（2026-06-29）

> 本任务首次落地（`04585d6` + `1b8e625`）反而导致缓存命中率下降。排查后修正如下，供后续 Phase 遵循。

### 修正 1：`workspace.context` 不是稳定段，不得前置

**原设计**（Overview + Entry/Delegated Order 初版）把 `formatAgentRuntimeContext` 产生的 `workspace.context` 当作"半稳定工作区上下文"，置于 `history` 之前，意图让 Agent 定义 + workspace 索引形成更长稳定前缀。

**错误前提**：`formatAgentRuntimeContext` 实际含动态内容——`contextFiles` 是**文件正文**（`formatContextFiles`），Agent 一旦 `workspace_write`/`edit`，下一轮这些字节就变；`missingContextPaths`、`skillIndex` 也会随 workspace 状态变化。它不是稳定段。

**后果**：OpenAI-compatible prompt cache 是前缀逐字节匹配，第一个不同 token 即断、其后全部 miss。把动态的 `workspace.context` 插在稳定的 `history`（已发生剧情，跨 turn 不变）之前，Agent 写入 workspace 后，断点提前到 `workspace.context` 开头，**后续整个 history 段全部 miss**——这比原顺序（history 紧随 system 形成长稳定前缀）更差。

**修正**：`history` 紧随 `system.agent`，`workspace.context` 后置于 `history` 之后、`turn.runtime` 之前。稳定段判定以"跨 turn 字节级是否变化"为准，不以语义"上下文"为准。`ai.ts` `segmentStability` 里 `workspace.context` 标 `stable` 也需改为 `dynamic`。

### 修正 2：跨 turn 历史工具调用保持结构化，不改 user 摘要

**原落地**（`1b8e625`）把跨 turn 历史工具调用从 native 结构化（`assistant.toolCalls` + `role:tool` 完整 observation）改成 `role:user` 短摘要（observation 截断 1200 字符），理由是"避免大 observation 破坏 prefix cache"。

**错误前提**：已发生的历史 observation 是**不变字节**，本身就是可缓存前缀的一部分，改短只省 token、不提升命中率；改成 `role:user` 摘要还破坏了 native 历史结构，影响模型对工具历史的理解。

**修正**：恢复 native 结构化形态（`assistant.toolCalls` + `role:tool`），observation 可保留 R6a 的 compact 截断策略以控 token，但角色与结构不得改写为 user 摘要。当前 turn 工具循环内的 compact observation 策略（R6a）不受影响、继续推进。

### 保留的正确改动

- system 工具说明瘦身（`04585d6` 中 native 模式去掉具体联系人 id、只列工具名依赖 API schema）——对跨 Agent 缓存有益，保留。
- `buildDebugMessageSegments` / `AiDebugMessageSegment` 可观测性——保留，仅需同步修正 `segmentStability`。

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
2. `history`：`AgentContextSnapshot` 展开的 summary/recent turns，或旧兜底的最近对话文本。
3. `workspace.context`：`formatAgentRuntimeContext(context)`，不包含轮次号。
4. `turn.runtime`：当前轮次号、必要的运行时短元数据。
5. `injection.before-input`：前端 before-input 注入。
6. `turn.input`：用户/玩家本轮输入和附件。
7. `injection.after-input`：前端 after-input 注入。

说明：`history`（已发生剧情，跨 turn 字节级不变）是最长稳定前缀，必须紧随 `system.agent` 之后。`workspace.context` 含 contextFiles 文件正文、missingContextPaths、skillIndex 等 Agent 写入后即变的内容，属动态段，放在 `history` 之后——否则它的变化会把缓存断点提前到自身开头，使后续 history 全部 miss（见设计修正记录）。`turn.runtime`/`turn.input` 等强动态内容继续后置。如压缩逻辑依赖 history span，需同步更新 `locateHistorySpan`，不能靠内容字符串位置隐式判断。

## Delegated Agent Message Order

目标顺序：

1. `system.agent`：目标 Agent 的稳定 system prompt。
2. `caller.context`：调用方 Agent id/title/summary，属于半稳定（同一 caller 在一次会话内不变）。
3. `history`：按 `historyMode` 选择的最近对话窗口。
4. `workspace.context`：目标 Agent 的 notes/contextPaths/Skill Index（动态，见 Entry 说明）。
5. `turn.runtime`：当前回合、historyMode、调用深度等短动态元数据。
6. `turn.input`：玩家本轮输入。
7. `agent-call.request`：调用请求、原因、期望输出、调用方额外摘要。
8. `agent-call.final-instruction`：只回答调用方请求，不输出给玩家最终正文。

`agentCall.request` 和 `contextSummary` 是强动态内容，必须后置。`workspace.context` 同理动态后置于 `history` 之后。delegated agent 为一次性 agent_call，跨 turn 复用场景少于 entry，但顺序逻辑保持一致。

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

> **落地（2026-06-29 收尾）**：`formatActivatedSkillMessageBody` 已加 compact 分支——Skill 正文 ≤ 6000 字符全量注入；超过则 preview 前 2000 字符（关键指令常在开头）+ 续读线索（`workspace.read` + skill path + offset）。阈值与 observation compact（`workspace-tools.ts`）一致。去重注入（`injectedSkillPaths`）不变。

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

## 落地核查与收尾（2026-06-29）

首次落地（`04585d6` + `1b8e625`）后修正记录里的两处错误已正确回退，Phase 0-6 主体均落地。收尾审计发现两处遗漏并修复（commit `1ad911a`）：

1. **`buildToolOutput` 过时注释**：仍描述"model 路径全量 JSON.stringify"，但实际已走 `compactToolObservationForModel`。注释已改写为正确的 trace/model 分离描述。
2. **超长 SKILL.md compact**：上方 Skill Injection 部分已补"落地"记录。

综上，Phase 0-6 全部落地。任务可归档。

