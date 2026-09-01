# Implement — 原生工具调用（API function calling）

## 执行顺序（每步可独立验证）

### Phase A：数据模型 + config 字段（model 层、必填、不迁移）
1. `config/ai.ts`：加 `BrowserAiToolCallMode` 类型（`"native" | "text"`，无 auto）；`BrowserAiModelConfig` 加**必填** `toolCallMode` 字段；`normalizeModelConfig` 遇缺失 `toolCallMode` 报错/丢弃（不迁移兜底）；`resolveProviderConfig` 透传主模型 `toolCallMode` 进 `BrowserAiConfig`；`BrowserAiConfig` 加 `toolCallMode`；`validateBrowserPlatformConfigDraft` 校验值 `native`/`text`；`createBrowserAiModelConfig` 新建默认 `text`。
2. 验证：`vue-tsc -b` 通过；旧配置缺失 `toolCallMode` 时 normalize 报错（破坏性，符合原型期原则）。

### Phase B：工具 schema 定义
3. 新建 `agent-runtime/tool-schemas.ts`：`ToolSchema` 接口 + `buildEnabledToolSchemas(options)`，按现有 gating（canCallAgents/canReadWorkspace/canWriteWorkspace/enabledPlatformTools）生成 schema 子集。description 参考成熟框架声明式风格重写。
4. 验证：`vue-tsc -b` 通过；schema 覆盖现有工具目录（skill_load/action_call/agent_call/workspace.*）。

### Phase C：adapter 层原生工具支持
5. `runtime-host/ai.ts`：定义 `RuntimeChatMessage` 联合类型 + `ModelCallResult` 接口 + `ParsedRuntimeWorkspaceToolCall` 复用。
6. `ProviderAdapter` 加 `buildNativeRequestBody(config, messages, tools)` + `extractNativeResult(payload)`。
7. openaiAdapter 实现：tools 格式 `{type:"function",function:{...}}`、messages 含 tool 角色 + tool_call_id、解析 `choices[0].message.{content,tool_calls}` + `finish_reason`。DeepSeek 复用。
8. geminiAdapter 实现：tools `functionDeclarations`、contents 含 functionCall/functionResponse part、解析 parts 区分 text/functionCall + finishReason。
9. claudeAdapter 实现：tools `{name,description,input_schema}`、messages 含 tool_use/tool_result block、解析 content 区分 text/tool_use + stop_reason。
10. 验证：`vue-tsc -b` 通过。

### Phase D：callModel 契约升级 + 工具循环重构
11. `agent-runtime/index.ts`：`AgentRuntimeCapabilities.callModel` 签名改 `Promise<ModelCallResult>`。text 模式下 `ModelCallResult = {text: response, toolCalls: parseRuntimeWorkspaceToolCalls(response), raw: response, finishReason: toolCalls.length ? "tool_calls" : "stop"}`（旧逻辑包一层）。
12. `callAgentModelWithWorkspaceTools` 重构：按 `toolCallMode`（native/text）分派；native 用 `buildNativeRequestBody` + `extractNativeResult` + RuntimeChatMessage 跟踪；text 走旧路径（包成 ModelCallResult）。工具执行（`executeRuntimeWorkspaceToolCalls`）两模式共用。无 auto 模式、无降级逻辑。
13. `platform-host/index.ts`：两处 `callModel` 闭包（`:1528`/`:1745`）适配新签名——按 `config.toolCallMode` 调 `generateAssistantReply`（text）或新增 `generateAssistantReplyNative`（native）。
14. `runtime-host/ai.ts`：加 `generateAssistantReplyNative(messages, tools, options): Promise<ModelCallResult>`（用 `buildNativeRequestBody` + `extractNativeResult`）。
15. system prompt 改造：`buildWorkspaceToolInstructions` 按 `toolCallMode` 分支——native 移除 `<tsian-tool-call>` 教学、text 保留。
16. 验证：`vue-tsc -b && vite build` 通过；text 模式行为与现状一致（回归）。

### Phase E：控制面板 + 本地助手 agent UI
17. `ModelParamsFields`（`AddModelDialog`/`EditModelParamsDialog` 共用）：加「工具调用模式」Select（原生/文本），绑 `BrowserAiModelConfig.toolCallMode`，auto-save 复用 debounced watch。
18. `AssistantView` 或本地助手配置处：加「工具调用模式」开关，覆盖/指定本地助手用的模式（独立入口）。
19. 验证：`vite build` 通过；Playwright 实测控制面板 Select 切换 + 保存保留；AssistantView 开关渲染。

## 验证命令
- 构建：`cd apps/platform-web && npx vue-tsc -b && npx vite build`
- 回归：text 模式工具循环与现状一致（`parseRuntimeWorkspaceToolCalls` 路径不变）。
- 实测限制：三家原生工具格式正确性需真实 API key（OpenAI/Claude/Gemini），构建无法验证。

## 风险文件 / 回滚点
- `config/ai.ts`：toolCallMode 必填字段 + 不迁移——旧配置缺失会报错，用户需重配。
- `agent-runtime/index.ts`：callModel 签名 `Promise<string>`→`Promise<ModelCallResult>` 破坏性变更，影响所有调用方。
- `runtime-host/ai.ts`：adapter 接口扩展 + generateAssistantReplyNative。
- 回滚：text 模式路径保留旧逻辑（包成 ModelCallResult），native 路径可单独回滚而不影响 text。

## 实现偏差记录（实际落地与 design.md 的差异）

### callModel 签名未改为 `Promise<ModelCallResult>`，改为新增 `callModelNative`
- design.md 原计划把 `AgentRuntimeCapabilities.callModel` 签名从 `Promise<string>` 升级为 `Promise<ModelCallResult>`，text 模式把旧逻辑包成结构化返回。
- 实际实现：**保持 `callModel: Promise<string>` 不变**（text 路径零改动、零回归风险），**新增 `callModelNative(messages: RuntimeChatMessage[], options, tools): Promise<ModelCallResult>`** 可选 capability。runtime 按 `capabilities.toolCallMode === "native" && typeof callModelNative === "function"` 分派到 `callAgentModelWithWorkspaceToolsNative`，否则走原 text 循环。
- 理由：text 路径工作良好且被无工具调用路径（`callAgentModelWithWorkspaceTools` 入口 934 行）共用，强行包装成 ModelCallResult 增加回归面。新增独立 native 路径更隔离，符合 design.md "native 路径可单独回滚" 原则，且实现等价目标（结构化返回、双模式分派）。
- 对子2（流式）的影响：流式只需在 `callModelNative` 路径加 `onDelta` 回调 + SSE 解析，`callModel` text 路径不流式（符合 prd "text 模式不流式"）。

### AssistantView 采用只读模式 badge，未加独立覆盖开关
- design.md 原计划 AssistantView 加一个轻量开关覆盖/指定本地助手用的工具调用模式。
- 实际实现：AssistantView 顶栏加**只读 badge** 显示当前生效工具调用模式（`getLocalAssistantToolCallMode` 解析），提示用户在控制面板模型参数中切换。
- 理由：本地助手的 toolCallMode 已能通过控制面板配置（选 provider preset → 配主 model 的 toolCallMode）。再加独立覆盖开关会引入第二个 toolCallMode 来源（agent.json vs preset.model），造成优先级歧义。只读 badge 满足 prd R4 "本地助手 agent UI 有模式开关" 的最低 UI 暴露要求，避免歧义。
- 新增导出：`platform-host` 的 `getLocalAssistantToolCallMode()`，复用 `resolveAgentModelConfig(LOCAL_ASSISTANT_AGENT_ID, presetMap)` 解析链。

### 单 turn toolCallMode 一致性假设
- `capabilities.toolCallMode` 是 per-turn 静态字段，从 entry/local-assistant agent 的 model config 解析一次，主导整轮分派。
- 边界：若 entry agent 是 native，但某个 delegated agent_call target 的 model 是 text 模式，该 target 仍会被强制走 native 分支（其 `callModelNative` 闭包用各自 config 调 `generateAssistantReplyNative`，向 text 模式端点发 native tools 请求可能出错）。
- MVP 接受此局限：实际场景用户通常给所有 agent 配同一家 provider，toolCallMode 一致。未来若需 per-agent 差异，可把 `toolCallMode` 改为 `resolveToolCallMode(agentId)` 动态 capability 方法。
