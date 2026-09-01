# PRD — AI 原生工具调用与流式输出（父任务）

## 目标与用户价值
- 让 AI 回复逐字流式出现，而非整段一次性出现，改善对话/剧情等待体验。
- 将工具调用从文本嵌入协议（`<tsian-tool-call>`）升级为 API 原生 function calling，获得结构化的 text/tool_call 事件边界。
- 两者关系：原生工具调用是流式的前提——流式响应中 text delta 与 tool_call delta 是不同事件类型，可干净分离（文本实时推 UI、工具调用后台累积），从而实现真流式无回滚。文本工具协议因无结构化边界（工具调用即普通文本）无法干净流式，保留为降级方案（降级时不流式）。

## 子任务映射
- **子1：原生工具调用**（`06-19-native-tool-calling`，已归档）— 定义工具 schema、请求体传 tools、解析 tool_calls 响应、重构工具循环。先做。
- **子2a：流式输出 + 思考流可见**（`06-19-ai-streaming-sse`）— 在子1的结构化边界上实现 SSE 流式；text delta 全推（思考流与最终回复都流式显示，无 onReset 回滚）；`turn-delta` 事件带轮号；前端打字机节流 + 智能滚动锚定 + 停止生成按钮。依赖子1。先做。
- **子2b：工具过程可见 + 并行执行**（`06-19-ai-agent-process-visible`，待创建）— 在子2a 的流式通道上叠加 `turn-round-end`/`turn-tool` 事件，工具调用过程（状态 + 输出，默认折叠可展开）可见；单轮内无状态工具并行执行。依赖子2a。后做。

子任务各自的 prd/design/implement 独立，依赖顺序写在各子任务 prd/implement 里（Trellis 父子结构不是依赖系统，靠子任务文档显式声明）。

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
- 不做 auto 自动探测降级（两选一 native/text，用户显式配置）。
- 不写旧数据迁移（原型期破坏性更新，`toolCallMode` 必填，缺失报错强制重配）。

## 关于"过程可见"的方向调整（2026-06-19 决策）
原"明确不做"含"不改 UI 展示模型为显示 agent 思考多轮过程 + 工具状态徽标（留演进）"。现反转：**过程可见纳入范围**。理由：Tsian 区别于普通聊天客户端——拥有检查点回滚、助手 agent 优化、手动编辑等干预手段。让玩家看到 agent 的思考流与工具调用过程，能在发现问题时展开复查、据此选择回滚检查点/叫助手优化/手动编辑，而非只能对着一段黑箱回复干等。呈现原则：**默认折叠、想看再展开**（流式时以折叠一行 + 逐字最终回复减少等待焦虑；结束后过程折叠、最终回复展开；过程可随时展开复查）。桌面 AssistantView 只做基础逐字流式验证，小说式/折叠呈现归 play 前端（game-card packaged frontend）消费平台事件渲染。因此平台必须推送**带类型/轮号标记的事件**供游戏前端区分思考/最终/工具，而非单一 text 流。落实拆为子2a（流式 + 思考流可见基础）与子2b（工具过程可展开 + 并行执行）。

## 开放问题
- 无（协议判断、schema 描述、旧数据处理均已在子1 收敛）。
