# 开发者诊断：trace 人类可读渲染 + DebugView 浏览器 + 数据采集增强

## Goal

让 traces 从"机器可解析的 JSONL"升级为"开发者/高级玩家能直接读、能拿来排错的运行日志"。存储格式（JSONL）不动——它对 `diagnostics.ts` 解析正确；新增人类可读渲染层 + DebugView 浏览入口 + 补齐关键诊断数据采集。助手 agent 也能帮玩家看（trace 经渲染后可读，agent 读 JSONL 诊断已支持）。

## Confirmed Facts（代码调研确认）

### trace 存储与诊断现状
- trace 文件 `.tsian/save/traces/turns/turn-NN.jsonl`（追加型日志，`isAppendOnlyLogPath` 识别，不进 checkpoint）。18 种事件类型（`trace.ts:3-22`），每事件 `{type,timestamp,turn,agentId?,debugLabel?,ok?,data?}`。
- `diagnostics.ts` 从 trace 解析 → 构建 `RuntimeDiagnosticSummary`（facts + health + status，`contracts:576-590`）。facts 带 severity/code/message/relatedPaths。health 带 agentIds/各类调用计数/mutation 路径/warning+error 计数。
- **DebugView 已消费诊断**（`DebugView.vue:239` diagnosticItems）：按 turn 列 issues（fact 摘要）、stats（error/warning 计数）。但**没有原始 trace 事件流的人类可读视图**——`trace: "Trace"`（:437）只是 fact source label，不是 trace 浏览 tab。

### 数据采集的遗漏点（排错时缺的细节）
- `model_call_completed`（`index.ts:1532`）：有 messageCount/outputLength/toolCallCount/round，**缺 finishReason、usage(token 数)、模型名、工具调用名+参数键**。排查"AI 为什么回这个"时看 turn 文件全文（trace 不存回复内容——截断片段不足以判断反而误导，且与 turn 文件职责重叠）。
- `workspace_tool_called`（`workspace-tools.ts:243`）：有 tool/部分 args/result 摘要，**缺 durationMs(耗时)**。完整工具结果在 workspace 文件（trace 不存结果内容——同上，截断片段无用且与 workspace 职责重叠）。
- 失败事件：`model_call_completed` ok:false 时**无 error 堆栈/详情**；`turn_failed`/`agent_step_failed` 的 error 信息待确认完整度。
- 无 `agent_step_started/completed` 的耗时（durationMs）——排"哪步慢"时缺数据。

### 采集原则（关键）——trace 只记元数据，不记业务内容片段
trace = 运行日志（事件流 + 摘要元数据），turn 文件 = 业务日志（完整对话），workspace 文件 = 完整工具结果。**trace 不存任何业务内容的截断片段**（回复文本/工具结果）——截断片段不足以判断反而误导，且与 turn/workspace 文件职责重叠。也不给"去哪看全文"指引——开发者知道自己架构（回复在 turn 文件、结果在 workspace），看不懂的玩家把 trace 交给助手 agent 诊断（agent 自有 workspace 工具读全文）。trace 只记：事件类型、标识（谁/哪个 skill/哪个工具）、元数据（计数/耗时/token 数/finishReason）、结果状态（ok/failed + error）。

### 现有采集的不合理点（需修正）
- `context_compressed`（`index.ts:2076`）：data 有 `budget`/`triggerThreshold`/`mode`，**缺最关键的压缩效果数据——before/after tokens + ratio**。压缩事件该告诉你"压缩了多少"，现在只告诉你"用什么参数压缩"。`compressContext`（`context-lifecycle.ts:442`）返回新 snapshot 但不返回前后 token 数——需在调用方算 `estimateTokenCount(before)` / `estimateTokenCount(after)` 填入 data。
- `script_log`：data 设计合理（level/messagePreview/dataSummary），无需修正。

### 现有采集的过度点（需删减）——日志不是越详细越好
日志原则：记"发生了什么 + 结果如何"，不记"机制内部状态"；记"标识"（谁/哪个 skill），不记"固有属性"；记"摘要"不记"全文"；每字段问"排错时会看吗"。
- `workspace_mutation`（`browser-skill-script-executor.ts:390`）：`updatedAt` 是文件元数据（文件自己的时间戳），排错不看 → **删**。留 path/size/mutation。
- `agent_called`（`workspace-tools.ts`）：`callerDepth`/`depth`/`maxDepth`/`callCount`/`historyMode` 是调用机制内部状态，排错不看 → **删**。留 targetAgentTitle/outputSummary/error。
- `skill_loaded`（`workspace-tools.ts`）：`skill.scope`/`skill.agentId` 是 skill 固有属性（配置期信息，非运行期诊断）→ **删**。留 skill.name/skill.path/declarationErrorCount（actionCount 价值低但无害，可留）。

## Decisions（已与用户确认）

1. **存储格式不动**：JSONL 继续存（机器解析友好）；人类可读是渲染层，不改变存储。
2. **渲染器放 trace.ts**：`formatTraceEventForHuman(event)` / `formatTraceForHuman(events)` 纯函数——type 对齐 + 时间偏移(相对回合起点) + data 拍平 key=value + ok/failed 标记。参考 rust tracing/logfmt 风格。
3. **DebugView 加 trace 浏览器**：按回合列 trace 文件 + 选回合看人类可读事件流。开发者 + 高级玩家可看；看不懂让助手 agent 帮忙（agent 读 JSONL 诊断已支持，渲染文本也可喂 agent）。
4. **数据采集增强 + 修正 + 删减**：补遗漏点（finishReason/usage/模型名/工具调用名+参数键/durationMs/错误详情）+ 修正不合理点（context_compressed 加 before/after tokens + ratio）+ 删过度点（workspace_mutation 的 updatedAt、agent_called 的 depth/callCount 等、skill_loaded 的 scope/agentId）+ **不记业务内容片段**（无 outputPreview/resultPreview——截断片段无用且与 turn/workspace 职责重叠，trace 只记元数据，看全文去 turn/workspace 文件）。
5. **视图默认显示最新回合事件流**：DebugView trace 浏览器打开即显示当前/最新回合的事件流（开发者主要看现在发生什么）；历史回合是次要入口（偶发 bug 才回看，优先级低，但不严重的话可后做历史切换）。
6. **不做跨回合聚合/错误检索**（本轮）：聚焦单回合可读 + 数据完整，跨回合视图后续单开。

## Requirements

- `trace.ts` 加 `formatTraceEventForHuman(event): string` + `formatTraceForHuman(events: RuntimeTraceEvent[]): string`：时间偏移 `mm:ss.SSS`、type 左对齐定宽、data 拍平 `key=value`（嵌套用 `key.sub=val`）、ok/failed 标记、turn/agentId 前缀。
- trace 事件采集增强：
  - `model_call_completed` 加 `finishReason`、`usage`（input/output/total tokens）、`model`（模型名）、`toolCalls`（工具调用名+参数键名数组）。**不记 outputPreview**——回复全文在 turn 文件，trace 只记 outputLength（已有）。
  - `workspace_tool_called` 加 `durationMs`。**不记 resultPreview**——完整结果在 workspace 文件，trace 只记 resultCount（已有）。
  - `agent_step_started/completed` 加 `durationMs`（completed 时算与 started 的差）。
  - 失败事件（`model_call_completed` ok:false / `turn_failed` / `agent_step_failed`）加 `error`（message + 截断 stack）。
- DebugView 加 trace 浏览器：回合列表（按 turn）→ 选回合 → 渲染 `formatTraceForHuman` 输出（等宽字体、可滚动、可复制）。复用现有 diagnosticItems 的回合范围或单独列 trace 文件。
- 截断长度常量（`TRACE_ERROR_STACK_LIMIT`）放 trace.ts，不进玩家配置。trace 不记业务内容片段，故无 output/result preview 常量。

## Acceptance Criteria

- [ ] DebugView 打开 trace 浏览器 → **默认显示最新回合**的人类可读事件流（非 JSONL 原文），type 对齐、时间偏移、data 拍平、ok/failed 标记；可切换历史回合（次要入口）。
- [ ] trace 事件含增强数据：model_call_completed 有 finishReason/usage/model/toolCalls；workspace_tool_called 有 durationMs；失败事件有 error 详情。
- [ ] context_compressed 修正：data 含 before/after tokens + ratio（压缩效果可读）。
- [ ] 过度采集删减：workspace_mutation 无 updatedAt；agent_called 无 depth/callCount/historyMode；skill_loaded 无 scope/agentId。
- [ ] 截断生效：errorStack 不超常量长度，超长截断 + `…` 标记。（无 outputPreview/resultPreview——trace 不记业务内容片段。）
- [ ] 助手 agent 仍能经 `runtime-diagnostics` 读诊断（JSONL 解析不破坏）；渲染文本可被 agent 读取辅助玩家。
- [ ] vue-tsc + vite build 通过。

## Out of Scope

- 跨回合诊断聚合（错误趋势、mutation 热点、压缩失败频率）——后续单开。
- 错误检索/按 severity+code 跨回合搜索——后续单开。
- trace retention 策略（只留最近 N 回）——后续优化。
- 玩家配置层（截断长度是开发者常量，不进 platform-config）。
- 存储格式改纯文本——不动 JSONL。

## Open Questions

- 截断长度的具体常量值（outputPreview 200? resultPreview 500? errorStack 1000?）——实现时定默认，可调。
