# PRD — 原生工具调用（API function calling）

> 父任务：`06-19-ai-streaming-response`。本子任务先于流式子任务（`06-19-ai-streaming-sse`）完成——流式依赖本任务提供的结构化 text/tool_call 事件边界。

## 目标与用户价值
- 将 agent 工具调用从文本嵌入协议（`<tsian-tool-call>{...}</tsian-tool-call>`）升级为 API 原生 function calling（OpenAI `tools` + `tool_calls`、Gemini `functionDeclarations` + `functionCall`、Claude `tools` + `tool_use`）。
- 获得结构化的 text/tool_call 事件边界：模型回复中"正文文本"与"工具调用"是分离的字段，不再混在一段文本里靠正则切分。
- 为流式子任务铺路：流式响应中 text delta 与 tool_call delta 是不同事件类型，可干净分离（文本推 UI、工具调用后台累积）。
- 文本工具协议保留为降级方案：端点不支持原生工具调用时，回退到现状的 `<tsian-tool-call>` 文本协议。

## 确认事实（来自勘察）
- 现工具协议：`<tsian-tool-call>{"name":"...","arguments":{...}}</tsian-tool-call>` 文本块，靠 system prompt 约束（`agent-runtime/index.ts:407-409`）。
- `parseRuntimeWorkspaceToolCalls`（`workspace-tools.ts:524`）正则匹配闭合标签，`stripRuntimeWorkspaceToolCallBlocks`（`:536`）移除块。
- 工具目录（`workspace-tools.ts:26-38`）：`skill_load`、`action_call`、`agent_call`、`workspace.read/list/search/diff/patch/write/move/delete/validate`。
- 工具调用形状：`{name: string, arguments: object}`（`parseToolCall` `:469-522`）。
- 工具循环：`callAgentModelWithWorkspaceTools`（`index.ts:924+`），每轮 `callModel` → 解析工具调用 → 执行 → observation 拼回 messages → 下一轮；无工具调用则返回 `stripRuntimeWorkspaceToolCallBlocks(response).trim()`。
- adapter 层（`runtime-host/ai.ts`）`buildRequestBody` 现不传 tools；`extractText` 读完整 JSON 的 text 字段。

## 需求

### R1 工具 schema 定义
- 把现有工具目录定义为 JSON schema（name/description/parameters），供请求体 `tools` 字段使用。
- schema 按当前 agent 启用的工具子集动态生成（`enabledPlatformTools` / `canCallAgents` 等已有 gating 逻辑复用）。
- 各家格式转换：OpenAI `{type:"function",function:{name,description,parameters}}`、Gemini `{name,description,parameters}` 放 `tools:[{functionDeclarations}]`、Claude `{name,description,input_schema}`。

### R2 adapter 层原生工具支持
- `ProviderAdapter` 加可选 `buildToolRequestBody(config, messages, tools?)`：在现有 body 基础上注入 `tools` 数组（OpenAI/Claude）或 `tools:[{functionDeclarations}]`（Gemini）。
- `extractToolCalls(payload)`：从完整 JSON 响应解析原生工具调用，返回 `ParsedRuntimeWorkspaceToolCall[]`（复用现有形状 `{name, arguments}`）。
  - OpenAI/DeepSeek：`choices[0].message.tool_calls[].function.{name,arguments(JSON 字符串→parse)}`。
  - Gemini：`candidates[0].content.parts[]` 中 `functionCall.{name,args}`。
  - Claude：`content[]` 中 `type:"tool_use"` 块的 `{id,name,input}`。
- `extractText` 在原生工具模式下只取 text 部分（不包含 tool_call 块）。

### R3 工具循环重构
- `callAgentModelWithWorkspaceTools`：当端点支持原生工具时，用 `buildToolRequestBody` 传 tools；`callModel` 返回后用 `extractToolCalls` 解析（替代 `parseRuntimeWorkspaceToolCalls` 文本正则）。
- tool observation 回传格式：OpenAI 用 `role:"tool"` + `tool_call_id`；Gemini 用 `functionResponse` part；Claude 用 `role:"user"` + `tool_result` block + `tool_use_id`。
- 不支持原生工具的端点：降级走现状文本协议（`parseRuntimeWorkspaceToolCalls`），行为不变。

### R4 工具调用模式配置（已收敛：绑 model 层 + 用户配置选择 + 无 auto）
- 「工具调用模式」字段挂在 `BrowserAiModelConfig`（model 层，非 preset 层）——同一 endpoint 下不同模型对原生工具支持可能不同，粒度对齐现有参数配置（temperature/reasoning_effort 也挂 model 层）。
- 两选一：`native`（原生 function calling）/ `text`（文本 `<tsian-tool-call>` 协议）。**无 auto 模式**，不做自动探测降级。
- 默认 `text`（保守，用户显式开启 native 才用原生）。
- 两个配置入口：
  - 控制面板模型配置界面：模型参数区加「工具调用模式」开关（与 reasoning_effort 等并列）。
  - 本地助手 agent UI：加模式开关覆盖/指定本地助手用的工具调用模式（独立于控制面板的入口）。
- `toolCallMode` 是**必填字段**，缺失报错强制重配（原型期破坏性更新，不迁移不兼容）。

### R5 system prompt 改造
- 原生工具模式：system prompt 不再教模型写 `<tsian-tool-call>` 块（API 自己管 tool call 格式），但仍说明各工具用途/何时用。工具用途说明改用精简的 schema description 风格（见下）。
- 文本协议降级模式：保留现有 `<tsian-tool-call>` 指令。
- **工具 schema description 文案重写**（已收敛）：参考成熟 agent 框架（如 OpenAI function calling / Anthropic tool use 的官方示例）的工具提示词规范，为每个工具写精简、声明式的 description + parameters schema。现有文本协议的教学式提示词后续也会重写，不直接复用。

### R6 兼容性（原型期破坏性更新）
- `AiChatMessage` contracts 不变（OpenAI 内部表示，adapter 内部转各家格式）。
- `executeRuntimeWorkspaceToolCalls` / 工具执行逻辑不变（输入仍是 `{name, arguments}`）。
- **`toolCallMode` 必填，不迁移不兼容**：`normalizeModelConfig` 遇到缺失 `toolCallMode` 的旧 model 配置直接报错/丢弃，强制用户重新配置。贯彻原型期破坏性更新原则，不写迁移兜底逻辑。

## 验收标准
- [ ] 支持原生工具调用的端点（OpenAI/Claude/Gemini 任一实测）用 function calling 执行工具循环，不再出现 `<tsian-tool-call>` 文本。
- [ ] 默认 text 模式行为同现状（文本协议工具循环）。
- [ ] 工具循环多轮（load skill → action → 返回正文）正确完成（native + text 两模式）。
- [ ] 控制面板模型配置界面可切换「工具调用模式」（native/text），保存后刷新保留。
- [ ] 本地助手 agent UI 有模式开关。
- [ ] 旧 model 配置缺失 `toolCallMode` 时报错/强制重配（不迁移）。
- [ ] `npm run build` 通过。
- [ ] 三家原生工具格式正确（需真实 key 实测）。

## 明确不做
- 不做流式（流式是子2，依赖本任务的 extractToolCalls/structured boundary）。
- 不改工具执行逻辑（`executeRuntimeWorkspaceToolCalls`）。
- 不改 UI 展示模型。

## 开放问题
- 无（协议判断、schema 描述来源已收敛）。
