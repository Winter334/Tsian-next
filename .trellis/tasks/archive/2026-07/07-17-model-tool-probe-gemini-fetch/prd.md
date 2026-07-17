# 模型工具调用测试与 Gemini 模型拉取

## Goal

让玩家在添加或编辑模型时区分“接口能连通 / 模型能普通对话 / 模型能原生工具调用”，避免保存模型后才在 Agent 工具循环中发现 `tools` / function calling 不可用。

同时修正 Gemini 类型模型列表拉取对官方 API 形状支持不足的问题，保持 OpenAI-compatible 已可用拉取行为不回退。

## Background and Confirmed Facts

- 提供商预设的“测试连通性”实际调用 `fetchBrowserAiProviderModels()`，用模型列表接口兼作连通性与鉴权探针：`apps/platform-web/src/views/SettingsView.vue:341`、`apps/platform-web/src/config/ai.ts:1490`。
- 添加模型弹窗的“拉取模型列表”也调用同一个 `fetchBrowserAiProviderModels()`：`apps/platform-web/src/components/settings/AddModelDialog.vue:181`。
- 当前模型参数面板已有“测试当前模型”，但只是普通 chat ping：`SettingsView.vue:testActiveModel` 调 `generateAssistantReply()`，提示词为 `Reply with exactly OK.`，不会发送 `tools`，所以不能验证原生工具调用能力：`apps/platform-web/src/views/SettingsView.vue:598`。
- 新模型默认 `toolCallMode` 为 `native`：`apps/platform-web/src/config/ai.ts:23`、`apps/platform-web/src/config/ai.ts:25`。
- runtime 已有各 provider 的原生工具调用请求构造与响应解析：`apps/platform-web/src/runtime-host/ai.ts` 中 `ProviderAdapter.buildNativeRequestBody()`、`generateAssistantReplyNative()`。
- Gemini 类型的 baseUrl placeholder 是 `https://generativelanguage.googleapis.com/v1beta`：`apps/platform-web/src/views/SettingsView.vue:213`。
- 当前 Gemini 模型列表 URL 构造为 `${baseUrl}/models`，注释写着 “API key goes in the query string”，但实际鉴权统一走 `buildProviderHeadersForKind()`，Gemini 发送 `x-goog-api-key` header：`apps/platform-web/src/config/ai.ts:1389`、`apps/platform-web/src/config/ai.ts:1405`。
- Gemini 官方 list models REST endpoint 是 `GET https://generativelanguage.googleapis.com/v1beta/models`，响应形状为 `{ models: Model[], nextPageToken?: string }`，`Model.name` 形如 `models/gemini-...`，并带 `supportedGenerationMethods`。
- Anthropic list models endpoint 是 `GET https://api.anthropic.com/v1/models`，响应形状为 `{ data: ModelInfo[], ... }`。

## Requirements

- R1: 添加模型 / 编辑模型时提供一个明确的“原生工具调用测试”，不再让普通连通性测试被误认为工具能力测试。
- R2: 工具调用测试必须是模型级测试，使用当前 provider preset、provider kind、model id、模型参数构造临时配置，不批量测试拉取列表中的所有模型。
- R3: 工具调用测试只发送无害 probe schema，不执行真实 workspace 工具。
- R4: 工具调用测试结果需要给出玩家可操作建议，例如“支持原生工具调用”或“建议切换为文本（兼容）模式”。
- R5: 修正 Gemini 模型列表拉取实现与官方 API 差异，至少覆盖响应形状、分页与 chat 模型过滤中的必要部分。
- R6: 保持 OpenAI-compatible 已可用模型拉取行为不回退。
- R7: baseUrl 兜底只做基础、常见、可自动判断的通用修正：trim、补缺失的 `https://`、去尾 `/`、裁掉明显请求端点尾巴（如 `/models`、`/chat/completions`、`/responses`、`/messages`、`/embeddings`）。除此之外不做复杂 provider-specific 推断或中转协议诊断。
- R8: 工具调用测试结果 MVP 不持久化到模型配置，仅在添加/编辑弹窗当前会话内显示。

## Acceptance Criteria

- [ ] 在添加模型弹窗中，玩家填写或选择 model id 后可以手动运行原生工具调用测试。
- [ ] 在编辑模型参数弹窗中，玩家可以对现有模型运行同样的原生工具调用测试。
- [ ] 普通 chat ping 和工具调用测试在 UI 文案上清晰区分。
- [ ] 当原生工具调用测试失败时，错误信息能说明是 API 拒绝 tools / 模型未返回工具调用 / 网络鉴权失败中的哪一类（尽量从错误中判断）。
- [ ] Gemini 类型模型列表拉取使用与 Gemini REST API 兼容的请求方式，并能解析 `{ models: [...] }`；不会破坏 OpenAI-compatible 的 `{ data: [...] }` 解析。
- [ ] Gemini 模型列表优先展示支持 `generateContent` 的模型，避免 embedding-only 模型被误加为 chat 模型。
- [ ] baseUrl 只做通用轻量规范化，不按 provider 类型自动猜测或改写未知中转路径。
- [ ] 工具调用测试结果不会写入模型配置；关闭弹窗或重新打开后不要求保留上次测试状态。
- [ ] 通过前端类型检查 / 构建验证相关改动。

## Out of Scope

- 不自动批量测试所有拉取到的模型，避免额外费用、限流和长等待。
- 不自动修改玩家选择的 `toolCallMode`；只给出建议，是否切换由玩家决定。
- 不在本任务内实现完整 provider 能力矩阵或云端代理服务。
- 不持久化工具调用测试结果，不在模型列表页展示工具能力徽章。
- 不做复杂 provider-specific baseUrl 推断，不诊断未知中转属于 Gemini 原生还是 OpenAI-compatible。

## Open Questions

None.
