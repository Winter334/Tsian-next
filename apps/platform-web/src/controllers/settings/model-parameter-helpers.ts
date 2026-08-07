import {
  createDefaultBrowserClaudeModelParameters,
  createDefaultBrowserDeepSeekModelParameters,
  createDefaultBrowserGeminiModelParameters,
  createDefaultBrowserOpenAiCompatibleModelParameters,
  createDefaultBrowserOpenAiResponsesModelParameters,
  type BrowserAiCommonModelParameters,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiReasoningEffort,
  type BrowserClaudeModelParameters,
  type BrowserClaudeServiceTier,
  type BrowserDeepSeekModelParameters,
  type BrowserGeminiModelParameters,
  type BrowserOpenAiCompatibleModelParameters,
  type BrowserOpenAiResponsesModelParameters,
} from "@/config/ai"

export const NO_REASONING_OPTION = "__none"
export const NO_SERVICE_TIER_OPTION = "__none"

export const MODEL_PARAMETER_TIPS = {
  contextWindow: "模型能处理的最大上下文长度（token 数）。用于在发送前截断过长的历史消息。",
  maxOutputTokens: "模型单次回复的最大 token 数。值越大回复越长，但消耗更多额度。对应 max_tokens / max_output_tokens。",
  temperature: "采样温度，控制输出随机性。0 更确定/聚焦，2 更发散/有创意，常见值 0.7。对应 temperature。",
  topP: "核采样阈值：只从累计概率达到 top_p 的候选词中采样。与温度二选一调节即可。对应 top_p。",
  toolCallMode: "模型调用工具的方式。原生 = 使用 API function calling 字段；文本协议 = 在普通聊天文本中承载 Tsian 工具调用协议。",
  streaming: "开启后逐 token 流式返回回复，首字更快；关闭则一次性返回完整结果。",
  frequencyPenalty: "对已出现的高频词施加惩罚以降低重复。正值减少重复，负值增加重复，范围 -2~2。对应 frequency_penalty。",
  presencePenalty: "鼓励引入新话题。正值提升模型谈论新内容的概率，负值相反，范围 -2~2。对应 presence_penalty。",
  reasoningEffort: "推理模型的思考强度，越高推理越深但更慢更贵。不发送 = 不向接口传该参数。对应 reasoning_effort。",
  topK: "采样候选数量：每个位置只从概率最高的 K 个候选词中采样。越大越多样，越小越确定。对应 topK / top_k。",
  responseMimeType: "强制指定响应的 MIME 类型，如 application/json 让模型直接返回 JSON。对应 responseMimeType。",
  responseSchema: "用 JSON Schema 约束结构化输出的字段与类型，需配合响应类型 application/json。对应 responseSchema。",
  stopSequences: "遇到这些字符串时立即停止生成，每行一个。对应 stop_sequences / stopSequences。",
  thinkingBudget: "思考模式的最大思考 token 预算。留空 = 不限制/不发送。对应 thinkingBudget / budget_tokens。",
  includeThoughts: "是否在响应中返回模型的思考过程内容。对应 includeThoughts。",
  serviceTier: "服务等级，影响延迟与可用性。auto = 自动选择，standard_only = 仅标准。对应 service_tier。",
  thinkingMode: "Claude 扩展思考开关。disabled = 关闭，adaptive = 自适应，enabled = 启用。对应 thinking.type。",
  thinkingDisplay: "思考内容的展示方式。summarized = 摘要展示，omitted = 不返回思考内容。对应 thinking.display。",
  customRequestParams: "以 JSON 形式追加任意请求参数，会合并到发送给接口的请求体中。适合配置未被面板覆盖的字段，如 { \"seed\": 42 }。",
} as const

export function numToText(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
}

export function textToNum(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

export function linesToText(value: readonly string[]): string {
  return value.join("\n")
}

export function textToLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeReasoningValue(value: unknown): BrowserAiReasoningEffort {
  return typeof value === "string" && value !== NO_REASONING_OPTION
    ? value as BrowserAiReasoningEffort
    : ""
}

export function activeProviderTitleForKind(kind: BrowserAiProviderKind): string {
  switch (kind) {
    case "openai-responses":
      return "OPENAI RESPONSES"
    case "deepseek":
      return "DEEPSEEK"
    case "gemini":
      return "GEMINI"
    case "claude":
      return "CLAUDE"
    case "openai-compatible":
    default:
      return "OPENAI CHAT"
  }
}

export function openAiCompatibleParams(
  parameters: BrowserAiModelParameters,
): BrowserOpenAiCompatibleModelParameters {
  return parameters.provider.openaiCompatible ?? createDefaultBrowserOpenAiCompatibleModelParameters()
}

export function openAiResponsesParams(
  parameters: BrowserAiModelParameters,
): BrowserOpenAiResponsesModelParameters {
  return parameters.provider.openaiResponses ?? createDefaultBrowserOpenAiResponsesModelParameters()
}

export function deepSeekParams(parameters: BrowserAiModelParameters): BrowserDeepSeekModelParameters {
  return parameters.provider.deepseek ?? createDefaultBrowserDeepSeekModelParameters()
}

export function geminiParams(parameters: BrowserAiModelParameters): BrowserGeminiModelParameters {
  return parameters.provider.gemini ?? createDefaultBrowserGeminiModelParameters()
}

export function claudeParams(parameters: BrowserAiModelParameters): BrowserClaudeModelParameters {
  return parameters.provider.claude ?? createDefaultBrowserClaudeModelParameters()
}

export function activeCustomRequestParamsText(
  parameters: BrowserAiModelParameters,
  kind: BrowserAiProviderKind,
): string {
  switch (kind) {
    case "openai-responses":
      return openAiResponsesParams(parameters).customRequestParamsText
    case "deepseek":
      return deepSeekParams(parameters).customRequestParamsText
    case "gemini":
      return geminiParams(parameters).customRequestParamsText
    case "claude":
      return claudeParams(parameters).customRequestParamsText
    case "openai-compatible":
    default:
      return openAiCompatibleParams(parameters).customRequestParamsText
  }
}

export function updateCommonParameters(
  parameters: BrowserAiModelParameters,
  patch: Partial<BrowserAiCommonModelParameters>,
): BrowserAiModelParameters {
  return {
    ...parameters,
    common: { ...parameters.common, ...patch },
    provider: { ...parameters.provider },
  }
}

export function updateOpenAiCompatibleParameters(
  parameters: BrowserAiModelParameters,
  patch: Partial<BrowserOpenAiCompatibleModelParameters>,
): BrowserAiModelParameters {
  return {
    ...parameters,
    provider: {
      ...parameters.provider,
      openaiCompatible: { ...openAiCompatibleParams(parameters), ...patch },
    },
  }
}

export function updateOpenAiResponsesParameters(
  parameters: BrowserAiModelParameters,
  patch: Partial<BrowserOpenAiResponsesModelParameters>,
): BrowserAiModelParameters {
  return {
    ...parameters,
    provider: {
      ...parameters.provider,
      openaiResponses: { ...openAiResponsesParams(parameters), ...patch },
    },
  }
}

export function updateDeepSeekParameters(
  parameters: BrowserAiModelParameters,
  patch: Partial<BrowserDeepSeekModelParameters>,
): BrowserAiModelParameters {
  return {
    ...parameters,
    provider: {
      ...parameters.provider,
      deepseek: { ...deepSeekParams(parameters), ...patch },
    },
  }
}

export function updateGeminiParameters(
  parameters: BrowserAiModelParameters,
  patch: Partial<BrowserGeminiModelParameters>,
): BrowserAiModelParameters {
  return {
    ...parameters,
    provider: {
      ...parameters.provider,
      gemini: { ...geminiParams(parameters), ...patch },
    },
  }
}

export function updateClaudeParameters(
  parameters: BrowserAiModelParameters,
  patch: Partial<BrowserClaudeModelParameters>,
): BrowserAiModelParameters {
  return {
    ...parameters,
    provider: {
      ...parameters.provider,
      claude: { ...claudeParams(parameters), ...patch },
    },
  }
}

export function updateActiveCustomRequestParamsText(
  parameters: BrowserAiModelParameters,
  kind: BrowserAiProviderKind,
  value: string,
): BrowserAiModelParameters {
  switch (kind) {
    case "openai-responses":
      return updateOpenAiResponsesParameters(parameters, { customRequestParamsText: value })
    case "deepseek":
      return updateDeepSeekParameters(parameters, { customRequestParamsText: value })
    case "gemini":
      return updateGeminiParameters(parameters, { customRequestParamsText: value })
    case "claude":
      return updateClaudeParameters(parameters, { customRequestParamsText: value })
    case "openai-compatible":
    default:
      return updateOpenAiCompatibleParameters(parameters, { customRequestParamsText: value })
  }
}

export function normalizeServiceTierValue(value: unknown): BrowserClaudeServiceTier {
  return value === NO_SERVICE_TIER_OPTION ? "" : value as BrowserClaudeServiceTier
}
