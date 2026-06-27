# Design — 开发者诊断

## 架构与边界

改动跨 `agent-runtime/trace.ts`（渲染器 + 截断常量）、`agent-runtime/index.ts`（trace 事件 data 增强）、`agent-runtime/workspace-tools.ts`（tool_call data 增强）、`views/DebugView.vue`（trace 浏览器 UI）。不影响 contracts/bridge（trace 是平台内部，`RuntimeTraceEvent` 类型已在 trace.ts，data 是 `Record<string, JsonValue>` 开放结构，加字段不破契约）。

## 采集原则（关键设计决定）

**trace 只记元数据，不记业务内容片段。** 完整回复在 turn 文件，完整工具结果在 workspace 文件——trace 不存它们的截断片段，因为：
- 截断片段（200 字符）不足以判断回复内容/走向，对核心诊断问题无用反而误导。
- 与 turn/workspace 文件职责重叠（两处存回复内容，模糊真相之源）。
- 增体积 + agent 经 runtime-diagnostics 读 trace 时的泄漏风险。

trace 记：事件类型、标识（agentId/skill 名/工具名）、元数据（计数/耗时/token 数/finishReason/usage）、结果状态（ok/failed + error/stack）。不记业务内容片段，也不给"去哪看全文"的指引——开发者知道自己项目架构（回复在 turn 文件、工具结果在 workspace），看不懂的玩家把 trace 交给助手 agent 诊断（agent 自有 workspace 工具读全文）。

```ts
const TRACE_ERROR_STACK_LIMIT = 1000

export function formatTraceEventForHuman(event: RuntimeTraceEvent, baseTimestamp?: number): string
export function formatTraceForHuman(events: RuntimeTraceEvent[]): string
```

渲染格式（参考 rust tracing / logfmt）：
```
[turn 5] 00:00.000  turn_started          agent=master
[turn 5] 00:01.200  model_call_completed  agent=master ok  model=gpt-4o round=1 msg=12 out=3400 tools=2 finish=stop tokens_in=4500 tokens_out=3400
[turn 5] 00:01.500  workspace_tool_called agent=master ok  tool=read dur=12ms results=3
[turn 5] 00:02.100  context_compressed    agent=master ok  before=4500 after=2000 ratio=0.44
[turn 5] 00:03.000  turn_completed        agent=master ok
[turn 5] 00:04.000  turn_failed           agent=master FAIL error="model timeout" stack="Error: timeout\n  at ..."
```

- 时间偏移 `mm:ss.SSS`（相对 turn_started 或首事件 timestamp）。
- type 左对齐定宽（最长 24 字符 padding）。
- data 拍平 `key=value`，已知 key 用友好名（`outputLength`→`out`、`messageCount`→`msg`、`tokens`→`tokens_in/out`）。
- ok 省略（默认），FAIL 显式标记。error/stack 单独行。
- 纯函数，无副作用，可单测。

## 数据采集增强

### model_call_completed（index.ts:1532,1660,1862）
data 加：
- `finishReason`（已有 `result.finishReason`，:1545）
- `usage`（已有 `lastRoundUsage`，:1546 → `{inputTokens, outputTokens, totalTokens}`）
- `model`（agentContext 的 provider/model——确认字段名）
- `toolCalls`（`result.toolCalls.map(tc => ({name: tc.function?.name, argsKeys: Object.keys(参数对象)})`）——**只记工具名 + 参数键名，不记参数值**。
- **不记 outputPreview**——回复全文在 turn 文件，trace 只记 outputLength（已有）。失败时(ok:false)加 `error`+`errorStack`。

### workspace_tool_called（workspace-tools.ts:243）
data 加：
- `durationMs`（call 开始到 observation 完成的耗时——需在 emit 前记录 startTime）
- **不记 resultPreview**——完整结果在 workspace 文件，trace 只记 resultCount（已有）。失败时加 `error`。

### agent_step_started/completed（index.ts:1110,1187,2022,2158）
- completed 时 data 加 `durationMs`（与同 agentId 的 started timestamp 差——需传 started timestamp 或在 collector 里配对）。
- 简化方案：completed 事件 data 加 `startedAt`（started 的 timestamp），渲染器算偏移；或直接在 emit 时算差值。

### 失败事件（turn_failed index.ts:965/assistant-chat.ts:692, agent_step_failed index.ts:1222,2165, model_call ok:false）
- data 加 `error`（`error.message`）+ `errorStack`（`String(error.stack).slice(0, TRACE_ERROR_STACK_LIMIT)`）。

### context_compressed 修正（index.ts:2076）— 现有不合理点
- 现状 data 只有 `budget`/`triggerThreshold`/`mode`，缺压缩效果。
- 修正：调用 `compressContext` 前后算 `estimateTokenCount`（`context-lifecycle.ts:89`），data 加 `beforeTokens`/`afterTokens`/`ratio`（after/before）。`compressContext` 返回新 snapshot，调用方在 emit trace 前算前后 token 差。
- 渲染器友好名：`beforeTokens`→`before`、`afterTokens`→`after`、`ratio`→`ratio`。

### 过度采集删减（现有不合理点）— 日志不是越详细越好
原则：记"发生了什么 + 结果"，不记"机制内部状态"；记"标识"不记"固有属性"；每字段问"排错时会看吗"。
- `workspace_mutation`（`browser-skill-script-executor.ts:390`）：删 `updatedAt`（文件元数据，非诊断信息）。留 path/size/mutation。
- `agent_called`（`workspace-tools.ts`）：删 `callerDepth`/`depth`/`maxDepth`/`callCount`/`historyMode`（调用机制内部状态）。留 targetAgentTitle/outputSummary/error。
- `skill_loaded`（`workspace-tools.ts`）：删 `skill.scope`/`skill.agentId`（skill 固有属性，配置期信息非运行期诊断）。留 skill.name/skill.path/declarationErrorCount。

## DebugView trace 浏览器

- 新增 tab 或 section："Trace"（与现有 source label 一致）或"运行日志"。
- **默认显示最新回合事件流**：打开即加载当前/最新 turn 的 trace events → `formatTraceForHuman` 渲染。开发者主要看"现在发生什么"。
- 历史回合切换：次要入口（下拉/列表选历史 turn）。偶发 bug 才回看历史，优先级低——首版可只做"最新回合 + 上/下回合切换"，完整历史列表后续补。
- 右侧渲染区：等宽字体 `<pre>`、可滚动、可复制。
- events 来源：从 trace 文件解析（复用 diagnostics.ts 的 `parseTraceFile` 或新加 `loadTraceEventsForTurn`）。最新回合 = 当前 active save 的 maxTurn。

## 契约兼容

- `RuntimeTraceEvent.data` 是 `Record<string, JsonValue>`（开放），加字段不破现有 `diagnostics.ts` 解析（它按 key 取，未知 key 忽略）。
- `RuntimeDiagnosticSummary` 不变（facts/health 仍从增强后的 data 提取，可选利用新字段如 usage/duration）。

## 风险点

- **trace 体积增长**：加 stack（截断上限 1000）会让失败事件 data 变大。截断常量控制上限。trace 不记业务内容片段（无 outputPreview/resultPreview），增量有限；且 trace 不进 checkpoint，不放大存储。
- **durationMs 配对**：agent_step 的 started/completed 跨事件配对，需确认 collector 能传 started timestamp 或在 completed emit 时拿到。若复杂，降级为只在 completed 存 `startedAt` 让渲染器算。
- **DebugView 加载 trace events**：现有 diagnosticItems 是 summary，trace 浏览器要原始 events——新增加载路径（读 `.tsian/save/traces/` 文件 → parse）。复用 diagnostics.ts 的 parse 逻辑。

## 风险文件

- `agent-runtime/trace.ts` — 渲染器 + 截断常量。
- `agent-runtime/index.ts` — 6+ 处 trace emit data 增强。
- `agent-runtime/workspace-tools.ts:243` — tool_call data + durationMs。
- `platform-host/index.ts:965`、`platform-host/assistant-chat.ts:692` — turn_failed error。
- `views/DebugView.vue` — trace 浏览器 UI。
