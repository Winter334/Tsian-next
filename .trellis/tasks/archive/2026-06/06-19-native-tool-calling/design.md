# Design — 原生工具调用（API function calling）

## 核心设计决策

### callModel 契约从 `Promise<string>` 升级为结构化返回

现状：`callModel(messages, options): Promise<string>`，runtime 从字符串里正则解析 `<tsian-tool-call>` 块。

原生工具调用：`callModel` 需同时返回**文本**和**结构化工具调用**（分离的字段）。新返回类型：

```ts
interface ModelCallResult {
  /** 用户可见的正文文本（不含工具调用）。 */
  text: string
  /** 原生工具调用（已解析为 {name, arguments}）；文本协议模式下为空。 */
  toolCalls: ParsedRuntimeWorkspaceToolCall[]
  /** 原始完整响应（含工具调用块，用于 transcript 记录）。 */
  raw: string
  /** 终止原因：stop（最终回复）/ tool_calls（要执行工具）。 */
  finishReason: "stop" | "tool_calls"
}
```

`AgentRuntimeCapabilities.callModel` 签名改为 `Promise<ModelCallResult>`。

**为什么不保持 `Promise<string>` + 内部文本编码**：原生工具调用下，tool observation 回传需要 `tool_call_id`（OpenAI/Claude）或 `tool_use_id`，这些 ID 在文本协议里不存在。如果内部仍用扁平文本编码，adapter 每次 request 要从文本反解出 ID 再重建原生格式，复杂且易错。结构化返回让 runtime 直接持有 `{name, arguments, id}`，adapter 构造 request 时直接用。

### AiChatMessage contracts 不变，但工具轮消息用结构化跟踪

`AiChatMessage`（`contracts/src/debug.ts`）保持 `{role: "user"|"assistant"|"system", content: string}`——这是**给 debug/transcript 用的人类可读表示**。

工具循环内部，runtime 维护一个**结构化消息序列**（新类型 `RuntimeChatMessage`），与 `AiChatMessage` 分离：
```ts
type RuntimeChatMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ParsedRuntimeWorkspaceToolCall[] }
  | { role: "tool"; toolCallId: string; content: string }  // observation 回传
```

`callModel` 接收 `RuntimeChatMessage[]`，adapter 的 `buildRequestBody` 据此构造各家原生格式。transcript/debug 记录时降级为 `AiChatMessage`（assistant 的 toolCalls 编码进 content 文本，tool 角色转为 user + observation 文本）。

> 取舍：引入 `RuntimeChatMessage` 增加一个内部类型，但避免了在扁平文本里反复编解码 tool_call_id 的复杂性。`AiChatMessage` 仍是外部契约，不受影响。

## 数据模型变更

### `BrowserAiModelConfig` 加 `toolCallMode`（model 层，非 preset 层）

```ts
export type BrowserAiToolCallMode = "native" | "text"

// BrowserAiModelConfig 加必填字段：
toolCallMode: BrowserAiToolCallMode
```

- 挂 model 层而非 preset 层：同一 endpoint 下不同模型对原生工具支持可能不同，粒度对齐现有参数配置（temperature/reasoning_effort 也挂 model 层）。
- 两选一 `native`/`text`，**无 auto**，默认 `text`（保守）。
- `normalizeModelConfig`：`toolCallMode` **必填**，缺失报错/丢弃（原型期破坏性更新，不迁移）。不写"缺失→默认"兜底。
- `resolveProviderConfig`：把主模型的 `toolCallMode` 透传进 `BrowserAiConfig`。
- `BrowserAiConfig` 加 `toolCallMode: BrowserAiToolCallMode`。
- `validateBrowserPlatformConfigDraft`：校验值为 `native`/`text`。
- `createDefaultBrowserAiModelParameters` 或 `createBrowserAiModelConfig` 新建时默认 `text`。

### 无 auto 模式

不做自动探测降级。runtime 按 model 的 `toolCallMode` 直接分派 native/text 路径，无运行时模式切换逻辑。

## adapter 层扩展

### ProviderAdapter 接口新增

```ts
interface ProviderAdapter {
  // 现有 4 方法不变
  buildUrl(config): string
  buildHeaders(config): string
  buildRequestBody(config, messages): Record<string, unknown>  // 保留（文本协议/无工具）
  extractText(payload): string

  // 新增：原生工具调用
  /** 构造带 tools 的请求体。messages 用 RuntimeChatMessage[]（含 tool 角色）。 */
  buildNativeRequestBody(config, messages: RuntimeChatMessage[], tools: ToolSchema[]): Record<string, unknown>
  /** 从完整 JSON 响应解析原生工具调用 + 文本 + finishReason。 */
  extractNativeResult(payload): ModelCallResult
}
```

### 三家原生格式

**OpenAI / DeepSeek**：
- 请求 `tools`：`[{type:"function", function:{name, description, parameters}}]`。
- 请求 messages：assistant 带 `tool_calls`、新增 `role:"tool"` + `tool_call_id`。
- 响应解析：`choices[0].message.{content, tool_calls}` + `choices[0].finish_reason`。
- tool_calls：`[{id, function:{name, arguments(JSON 字符串→parse)}}]`。

**Gemini**：
- 请求 `tools`：`[{functionDeclarations:[{name, description, parameters}]}]`。
- 请求 contents：assistant 的 `functionCall` part、`functionResponse` part（回传 observation）。
- 响应解析：`candidates[0].content.parts[]` 区分 `text` / `functionCall`；`candidates[0].finishReason`。

**Claude**：
- 请求 `tools`：`[{name, description, input_schema}]`。
- 请求 messages：assistant 带 `content:[{type:"tool_use",id,name,input}]`、`role:"user"` + `{type:"tool_result",tool_use_id,content}`。
- 响应解析：`content[]` 区分 `{type:"text"}` / `{type:"tool_use",id,name,input}`；`stop_reason`。

## 工具 schema 定义

新建 `agent-runtime/tool-schemas.ts`：

```ts
export interface ToolSchema {
  name: string
  description: string
  parameters: JSONSchema  // {type:"object", properties:{...}, required:[...]}
}

/** 按 agent 启用的工具子集生成 schema 列表。复用现有 gating（canCallAgents/canReadWorkspace/canWriteWorkspace/enabledPlatformTools）。 */
export function buildEnabledToolSchemas(options: {
  enabledPlatformTools: AgentPlatformToolName[]
  allowAgentCall: boolean
  visibleContacts: AgentRegistryEntry[]
}): ToolSchema[]
```

description 文案：参考 OpenAI/Anthropic 官方 function calling 示例的声明式风格重写（精简、说"做什么"+关键参数约束，非教学式）。

## 工具循环重构（callAgentModelWithWorkspaceTools）

现状（文本协议，`index.ts:958-1062`）：
```
for round:
  response = await callModel(nextMessages)  // string
  toolCalls = parseRuntimeWorkspaceToolCalls(response)  // 正则
  if no toolCalls: return stripBlocks(response).trim()
  observations = executeTools(toolCalls)
  nextMessages += [{assistant: response}, {user: observationText}]
```

重构后（支持双模式）：
```
for round:
  if mode == native:
    result = await callModelNative(runtimeMessages, toolSchemas)  // ModelCallResult
    toolCalls = result.toolCalls
    if result.finishReason == "stop": return result.text.trim()
  else:  // text 协议（现状）
    response = await callModel(runtimeMessages)  // string（旧路径）
    toolCalls = parseRuntimeWorkspaceToolCalls(response)
    if no toolCalls: return stripBlocks(response).trim()

  // 有工具调用 → 执行（两模式共用 executeRuntimeWorkspaceToolCalls）
  observations = executeTools(toolCalls)

  if mode == native:
    runtimeMessages += [{assistant: result.text, toolCalls}, ...observations.map(o => {tool, toolCallId, content})]
  else:
    nextMessages += [{assistant: response}, {user: observationText}]
```

- `callModelNative` 和 `callModel`（文本）共存，runtime 按 `toolCallMode` 分派。
- `executeRuntimeWorkspaceToolCalls` 不变（输入仍是 `{name, arguments}`）。
- transcript 记录：native 模式下 `modelOutput` 用 `result.raw`，toolCalls 用 `result.toolCalls`。

## system prompt 改造

`buildWorkspaceToolInstructions`（`index.ts:348-411`）：
- native 模式：移除 `<tsian-tool-call>` 格式教学（`407-409`），保留工具用途/何时用说明（但说明改精简，与 schema description 呼应）。
- text 模式：保留现状（含 `<tsian-tool-call>` 格式教学）。
- 按 `toolCallMode` 分支构造。

## UI 变更（两个入口）

### 控制面板模型配置界面
- `ModelParamsFields`（`AddModelDialog`/`EditModelParamsDialog` 共用）：加「工具调用模式」Select（原生 native / 文本 text），与 reasoning_effort 等参数并列。绑 `model.parameters` 同层的 `toolCallMode`（或 `BrowserAiModelConfig` 上，取决于字段挂 parameters 还是 model——倾向挂 `BrowserAiModelConfig` 顶层，因为它是行为开关非采样参数）。
- auto-save 复用现有 debounced watch。

### 本地助手 agent UI
- `AssistantView` 或其配置处：加「工具调用模式」开关，覆盖/指定本地助手用的工具调用模式。独立于控制面板入口——本地助手 agent 的工具调用模式不一定跟随某个 provider model 的配置（本地助手可能用默认/全局设置）。
- 具体挂载位置（AssistantView 顶栏设置 / 本地助手配置文件 / 全局设置）待实现时定，倾向 AssistantView 加一个轻量开关。

## 兼容性（原型期破坏性更新）
- `AiChatMessage` contracts 不变。
- `executeRuntimeWorkspaceToolCalls` / 工具执行不变。
- **`toolCallMode` 必填，不迁移**：旧 model 配置缺失该字段 → `normalizeModelConfig` 报错/丢弃，强制重配。用户现有配置（瓜饭等）需重新进模型配置设工具调用模式。
- `getBrowserAiConfig` / `resolveProviderConfig` 行为不变（加透传 toolCallMode）。

## 风险 / 回滚点
- `callModel` 签名 `Promise<string>` → `Promise<ModelCallResult>` 是破坏性变更，影响所有调用方（platform-host 两处闭包）。回滚需同步改回。
- `RuntimeChatMessage` 新类型扩散到 callModel 接口 → 若 native 模式有问题，可先只让 text 模式用新签名（text 模式下 ModelCallResult.text=response、toolCalls=[]、finishReason="stop"），native 路径单独回滚。
- 三家原生格式正确性需真实 key 实测（构建无法验证）。
