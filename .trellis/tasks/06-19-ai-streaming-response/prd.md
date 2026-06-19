# PRD — AI 原生工具调用与流式输出（父任务）

## 目标与用户价值
- 让 AI 回复逐字流式出现，而非整段一次性出现，改善对话/剧情等待体验。
- 将工具调用从文本嵌入协议（`<tsian-tool-call>`）升级为 API 原生 function calling，获得结构化的 text/tool_call 事件边界。
- 两者关系：原生工具调用是流式的前提——流式响应中 text delta 与 tool_call delta 是不同事件类型，可干净分离（文本实时推 UI、工具调用后台累积），从而实现真流式无回滚。文本工具协议因无结构化边界（工具调用即普通文本）无法干净流式，保留为降级方案（降级时不流式）。

## 子任务映射
- **子1：原生工具调用**（`06-19-native-tool-calling`）— 定义工具 schema、请求体传 tools、解析 tool_calls 响应、重构工具循环。先做。
- **子2：流式输出**（`06-19-ai-streaming-sse`）— 在子1的结构化边界上实现 SSE 流式。依赖子1。后做。

子任务各自的 prd/design/implement 独立，依赖顺序写在子2 的 prd/implement 里（Trellis 父子结构不是依赖系统，靠子任务文档显式声明）。

## 确认事实（来自 06-19-control-panel-rework 收尾勘察）
- `runtime-host/ai.ts` `generateAssistantReply` 返回 `Promise<string>`，`fetchJsonWithTimeout` 一次性 `response.json()`，无 ReadableStream/SSE。
- `config/ai.ts:110` `"stream"` 在 `PROTECTED_CUSTOM_REQUEST_KEYS`，用户无法手动开启。
- 工具调用是 `<tsian-tool-call>...</tsian-tool-call>` 文本块协议，靠 system prompt 约束（`agent-runtime/index.ts:407-409`），非 API 原生 function calling。
- `parseRuntimeWorkspaceToolCalls`（`workspace-tools.ts:524`）用正则匹配闭合标签，需完整字符串才能可靠判断有无工具调用。
- AssistantView（`views/AssistantView.vue:528-562`）只显示 `result.replyText`（最终回复），中间轮/工具过程不可见；`runAssistantChat` 总构建 workspaceFiles → entry agent 总走 tool-loop path（`agent-runtime/index.ts:958+`）。
- adapter 层（openai/gemini/claude/deepseek）现只有 buildUrl/buildHeaders/buildRequestBody/extractText，无流式/原生工具方法。

## 跨子任务验收标准（父任务集成层）
- [ ] 子1 完成后：`toolCallMode=native` 的模型用 function calling 执行工具循环；`toolCallMode=text` 用文本协议（行为同现状）。模式挂在 model 层、用户配置选择、默认 text、无 auto。
- [ ] 子2 完成后：`toolCallMode=native` 模式下最终回复逐字流式渲染；`text` 模式不流式（一次性返回，同现状）。
- [ ] 三家协议（OpenAI 兼容/DeepSeek、Gemini、Claude）的流式 + 原生工具调用格式均正确（需真实 key 实测）。
- [ ] `npm run build`（含 contracts 包）通过。

## 明确不做（父任务层面）
- 父任务本身不做实现，只持有需求集 + 子任务映射 + 集成验收。
- 不改 contracts `AiChatMessage`（仍是 OpenAI 内部表示，adapter 内部转换）。
- 不改 UI 展示模型为"显示 agent 思考多轮过程 + 工具状态徽标"（留演进）。
- 不做 auto 自动探测降级（两选一 native/text，用户显式配置）。
- 不写旧数据迁移（原型期破坏性更新，`toolCallMode` 必填，缺失报错强制重配）。

## 开放问题
- 无（协议判断、schema 描述、旧数据处理均已在子1 收敛）。
