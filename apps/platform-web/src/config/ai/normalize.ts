import {
  DEFAULT_BROWSER_AI_STREAMING,
  DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
  createDefaultBrowserAiCommonModelParameters,
  createDefaultBrowserAiModelParameters,
  createDefaultBrowserClaudeModelParameters,
  createDefaultBrowserDeepSeekModelParameters,
  createDefaultBrowserGeminiModelParameters,
  createDefaultBrowserOpenAiCompatibleModelParameters,
  createDefaultBrowserOpenAiResponsesModelParameters,
} from "./defaults"
import type {
  BrowserAiCommonModelParameters,
  BrowserAiFallbackStrategy,
  BrowserAiModelConfig,
  BrowserAiModelEntry,
  BrowserAiModelParameters,
  BrowserAiProviderKind,
  BrowserAiProviderModelParameters,
  BrowserAiReasoningEffort,
  BrowserAiToolCallMode,
  BrowserClaudeModelParameters,
  BrowserClaudeServiceTier,
  BrowserClaudeThinkingDisplay,
  BrowserClaudeThinkingMode,
  BrowserDeepSeekModelParameters,
  BrowserGeminiModelParameters,
  BrowserOpenAiCompatibleModelParameters,
  BrowserOpenAiResponsesModelParameters,
  BrowserPlatformConfigDraft,
} from "./types"

const PROTECTED_CUSTOM_REQUEST_KEYS = new Set([
  "apikey",
  "authorization",
  "baseurl",
  "contents",
  "conversation",
  "frequency_penalty",
  "generationconfig",
  "headers",
  "input",
  "max_output_tokens",
  "max_tokens",
  "messages",
  "model",
  "presence_penalty",
  "previous_response_id",
  "reasoning",
  "reasoning_effort",
  "service_tier",
  "stop_sequences",
  "store",
  "stream",
  "system",
  "systeminstruction",
  "temperature",
  "thinking",
  "tools",
  "tool_choice",
  "tool_config",
  "toolchoice",
  "toolconfig",
  "top_k",
  "top_p",
])

export function readStoredText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

const KNOWN_BROWSER_AI_ENDPOINT_SUFFIXES = [
  "/chat/completions",
  "/responses",
  "/messages",
  "/models",
  "/embeddings",
] as const

export function normalizeBrowserAiProviderBaseUrl(input: string): string {
  let value = input.trim()
  if (!value) {
    return ""
  }

  if (value.startsWith("//")) {
    value = `https:${value}`
  } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    value = `https://${value}`
  }

  value = value.replace(/\/+$/, "")
  const lower = value.toLowerCase()
  for (const suffix of KNOWN_BROWSER_AI_ENDPOINT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return value.slice(0, -suffix.length).replace(/\/+$/, "")
    }
  }
  return value
}

export function normalizeModelEntries(input: unknown): BrowserAiModelEntry[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const models: BrowserAiModelEntry[] = []

  for (const item of input) {
    const id = typeof item === "string"
      ? item.trim()
      : typeof item === "object" && item !== null
        ? readStoredText((item as { id?: unknown }).id)
        : ""

    if (!id || seen.has(id)) {
      continue
    }

    seen.add(id)
    models.push({ id })
  }

  return models
}

function normalizeNullableNumber(input: unknown): number | null {
  if (input === null || input === undefined || input === "") {
    return null
  }

  const value = typeof input === "number"
    ? input
    : typeof input === "string"
      ? Number(input.trim())
      : Number.NaN

  return Number.isFinite(value) ? value : null
}

export function normalizePositiveInteger(input: unknown): number | null {
  const value = normalizeNullableNumber(input)
  if (value === null || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function normalizeReasoningEffort(input: unknown): BrowserAiReasoningEffort {
  if (
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high" ||
    input === "xhigh"
  ) {
    return input
  }

  return ""
}

export function normalizeToolCallMode(input: unknown): BrowserAiToolCallMode | null {
  return input === "native" || input === "text" ? input : null
}

/**
 * Normalize a stored `streaming` flag. Returns `true` only for an explicit
 * `true`/`"true"` value; anything else (missing, `false`, invalid) returns
 * `false`. New-model defaults are applied by creators, not this read-path
 * normalizer.
 */
function normalizeStreaming(input: unknown): boolean {
  return input === true || input === "true"
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }
  return input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeClaudeServiceTier(input: unknown): BrowserClaudeServiceTier {
  return input === "auto" || input === "standard_only" ? input : ""
}

function normalizeClaudeThinkingMode(input: unknown): BrowserClaudeThinkingMode {
  return input === "adaptive" || input === "enabled" ? input : "disabled"
}

function normalizeClaudeThinkingDisplay(input: unknown): BrowserClaudeThinkingDisplay {
  return input === "omitted" ? "omitted" : "summarized"
}

function normalizeCommonModelParameters(input: unknown): BrowserAiCommonModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserAiCommonModelParameters()
  }

  const record = input as Record<string, unknown>
  return {
    contextWindow: normalizePositiveInteger(record.contextWindow),
    maxOutputTokens: normalizePositiveInteger(record.maxOutputTokens),
    temperature: normalizeNullableNumber(record.temperature),
    topP: normalizeNullableNumber(record.topP),
  }
}

function normalizeOpenAiCompatibleModelParameters(input: unknown): BrowserOpenAiCompatibleModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserOpenAiCompatibleModelParameters()
  }
  const record = input as Record<string, unknown>
  return {
    frequencyPenalty: normalizeNullableNumber(record.frequencyPenalty),
    presencePenalty: normalizeNullableNumber(record.presencePenalty),
    reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
    customRequestParamsText: readStoredText(record.customRequestParamsText),
  }
}

function normalizeOpenAiResponsesModelParameters(input: unknown): BrowserOpenAiResponsesModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserOpenAiResponsesModelParameters()
  }
  const record = input as Record<string, unknown>
  return {
    reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
    customRequestParamsText: readStoredText(record.customRequestParamsText),
  }
}

function normalizeDeepSeekModelParameters(input: unknown): BrowserDeepSeekModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserDeepSeekModelParameters()
  }
  const record = input as Record<string, unknown>
  return {
    frequencyPenalty: normalizeNullableNumber(record.frequencyPenalty),
    presencePenalty: normalizeNullableNumber(record.presencePenalty),
    reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
    customRequestParamsText: readStoredText(record.customRequestParamsText),
  }
}

function normalizeGeminiModelParameters(input: unknown): BrowserGeminiModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserGeminiModelParameters()
  }
  const record = input as Record<string, unknown>
  return {
    topK: normalizePositiveInteger(record.topK),
    frequencyPenalty: normalizeNullableNumber(record.frequencyPenalty),
    presencePenalty: normalizeNullableNumber(record.presencePenalty),
    stopSequences: normalizeStringList(record.stopSequences),
    responseMimeType: readStoredText(record.responseMimeType),
    responseSchemaText: readStoredText(record.responseSchemaText),
    thinkingBudget: normalizePositiveInteger(record.thinkingBudget),
    includeThoughts: record.includeThoughts === true,
    customRequestParamsText: readStoredText(record.customRequestParamsText),
  }
}

function normalizeClaudeModelParameters(input: unknown): BrowserClaudeModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserClaudeModelParameters()
  }
  const record = input as Record<string, unknown>
  return {
    topK: normalizePositiveInteger(record.topK),
    stopSequences: normalizeStringList(record.stopSequences),
    serviceTier: normalizeClaudeServiceTier(record.serviceTier),
    thinkingMode: normalizeClaudeThinkingMode(record.thinkingMode),
    thinkingBudgetTokens: normalizePositiveInteger(record.thinkingBudgetTokens),
    thinkingDisplay: normalizeClaudeThinkingDisplay(record.thinkingDisplay),
    customRequestParamsText: readStoredText(record.customRequestParamsText),
  }
}

function normalizeModelParameters(input: unknown): BrowserAiModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserAiModelParameters()
  }

  const record = input as Record<string, unknown>
  const providerRecord = typeof record.provider === "object" && record.provider !== null
    ? record.provider as Record<string, unknown>
    : {}

  return {
    common: normalizeCommonModelParameters(record.common),
    provider: {
      openaiCompatible: normalizeOpenAiCompatibleModelParameters(providerRecord.openaiCompatible),
      openaiResponses: normalizeOpenAiResponsesModelParameters(providerRecord.openaiResponses),
      deepseek: normalizeDeepSeekModelParameters(providerRecord.deepseek),
      gemini: normalizeGeminiModelParameters(providerRecord.gemini),
      claude: normalizeClaudeModelParameters(providerRecord.claude),
    },
  }
}

export function cloneModelParameters(input: BrowserAiModelParameters): BrowserAiModelParameters {
  const normalized = normalizeModelParameters(input)
  return {
    common: { ...normalized.common },
    provider: {
      openaiCompatible: { ...normalized.provider.openaiCompatible! },
      openaiResponses: { ...normalized.provider.openaiResponses! },
      deepseek: { ...normalized.provider.deepseek! },
      gemini: {
        ...normalized.provider.gemini!,
        stopSequences: [...normalized.provider.gemini!.stopSequences],
      },
      claude: {
        ...normalized.provider.claude!,
        stopSequences: [...normalized.provider.claude!.stopSequences],
      },
    },
  }
}

export function cloneBrowserAiModelParameters(input: BrowserAiModelParameters): BrowserAiModelParameters {
  return cloneModelParameters(input)
}

export type BrowserAiActiveProviderParameters =
  | BrowserOpenAiCompatibleModelParameters
  | BrowserOpenAiResponsesModelParameters
  | BrowserDeepSeekModelParameters
  | BrowserGeminiModelParameters
  | BrowserClaudeModelParameters

export function providerParamsForKind(
  parameters: BrowserAiModelParameters,
  kind: BrowserAiProviderKind,
): BrowserAiActiveProviderParameters {
  const normalized = normalizeModelParameters(parameters)
  switch (kind) {
    case "openai-responses":
      return normalized.provider.openaiResponses!
    case "deepseek":
      return normalized.provider.deepseek!
    case "gemini":
      return normalized.provider.gemini!
    case "claude":
      return normalized.provider.claude!
    case "openai-compatible":
    default:
      return normalized.provider.openaiCompatible!
  }
}

export function customParamsTextForKind(
  parameters: BrowserAiModelParameters,
  kind: BrowserAiProviderKind,
): string {
  return providerParamsForKind(parameters, kind).customRequestParamsText
}

export function providerBranchKeyForKind(kind: BrowserAiProviderKind): keyof BrowserAiProviderModelParameters {
  switch (kind) {
    case "openai-responses":
      return "openaiResponses"
    case "deepseek":
      return "deepseek"
    case "gemini":
      return "gemini"
    case "claude":
      return "claude"
    case "openai-compatible":
    default:
      return "openaiCompatible"
  }
}

function normalizeModelConfig(input: unknown): BrowserAiModelConfig | null {
  if (typeof input !== "object" || input === null) {
    return null
  }
  const record = input as Record<string, unknown>
  const id = readStoredText(record.id)
  if (!id) {
    return null
  }
  // Prototype-period destructive update: toolCallMode is required and not
  // migrated. A missing/invalid value drops the model so the user must
  // reconfigure it explicitly (no silent default fallback on the read path).
  const toolCallMode = normalizeToolCallMode(record.toolCallMode)
  if (!toolCallMode) {
    return null
  }
  // streaming: explicit true/false honored for both modes; missing → false on
  // read path for compatibility (new-model defaults are applied at create time).
  const streaming = normalizeStreaming(record.streaming)
  return {
    id,
    label: readStoredText(record.label) || undefined,
    parameters: normalizeModelParameters(record.parameters),
    enabled: record.enabled !== false,
    toolCallMode,
    streaming,
  }
}

export function normalizeModelConfigs(input: unknown): BrowserAiModelConfig[] {
  if (!Array.isArray(input)) {
    return []
  }
  const seen = new Set<string>()
  const models: BrowserAiModelConfig[] = []
  for (const item of input) {
    const config = normalizeModelConfig(item)
    if (!config || seen.has(config.id)) {
      continue
    }
    seen.add(config.id)
    models.push(config)
  }
  return models
}

function cloneModelConfig(input: BrowserAiModelConfig): BrowserAiModelConfig {
  return {
    ...input,
    parameters: cloneModelParameters(input.parameters),
  }
}

export function normalizeFallbackStrategy(input: unknown): BrowserAiFallbackStrategy {
  return input === "ordered" ? "ordered" : "primary-only"
}

export function createBrowserAiModelConfig(
  input: Partial<BrowserAiModelConfig & { model: string }> = {},
): BrowserAiModelConfig {
  const id = readStoredText(input.id ?? input.model)
  const toolCallMode = normalizeToolCallMode(input.toolCallMode) ?? DEFAULT_BROWSER_AI_TOOL_CALL_MODE
  return {
    id,
    label: readStoredText(input.label) || undefined,
    parameters: normalizeModelParameters(input.parameters),
    enabled: input.enabled !== false,
    toolCallMode,
    streaming: input.streaming === undefined ? DEFAULT_BROWSER_AI_STREAMING : normalizeStreaming(input.streaming),
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseBrowserAiCustomRequestParams(input: string): Record<string, unknown> {
  const trimmed = input.trim()
  if (!trimmed) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error("自定义请求参数必须是有效的 JSON 对象。")
  }

  if (!isPlainJsonObject(parsed)) {
    throw new Error("自定义请求参数必须是 JSON 对象，不能是数组或其它类型。")
  }

  for (const key of Object.keys(parsed)) {
    if (PROTECTED_CUSTOM_REQUEST_KEYS.has(key.toLowerCase())) {
      throw new Error(`自定义请求参数不能覆盖运行时字段：${key}`)
    }
  }

  return parsed
}

function assertIntegerParameter(value: number | null, label: string): void {
  if (value === null) {
    return
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是大于 0 的整数。`)
  }
}

function assertRangeParameter(
  value: number | null,
  label: string,
  min: number,
  max: number,
): void {
  if (value === null) {
    return
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} 必须在 ${min} 到 ${max} 之间。`)
  }
}

function parseJsonObjectText(input: string, label: string): Record<string, unknown> | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${label} 必须是有效的 JSON 对象。`)
  }

  if (!isPlainJsonObject(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象，不能是数组或其它类型。`)
  }

  return parsed
}

function assertReasoningEffort(value: BrowserAiReasoningEffort): void {
  if (!["", "minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    throw new Error("推理程度只能是最低/低/中/高/最高或留空。")
  }
}

function assertStringList(value: string[], label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} 必须是字符串列表。`)
  }
}

export function validateBrowserAiModelParameters(
  parameters: BrowserAiModelParameters,
  kind: BrowserAiProviderKind,
): void {
  const normalized = normalizeModelParameters(parameters)
  const common = normalized.common
  assertIntegerParameter(common.contextWindow, "上下文窗口")
  assertIntegerParameter(common.maxOutputTokens, "最大输出 token")
  assertRangeParameter(common.temperature, "温度", 0, 2)
  assertRangeParameter(common.topP, "top_p", 0, 2)

  switch (kind) {
    case "openai-compatible": {
      const provider = normalized.provider.openaiCompatible!
      assertRangeParameter(provider.frequencyPenalty, "频率惩罚", -2, 2)
      assertRangeParameter(provider.presencePenalty, "存在惩罚", -2, 2)
      assertReasoningEffort(provider.reasoningEffort)
      parseBrowserAiCustomRequestParams(provider.customRequestParamsText)
      return
    }
    case "openai-responses": {
      const provider = normalized.provider.openaiResponses!
      assertReasoningEffort(provider.reasoningEffort)
      parseBrowserAiCustomRequestParams(provider.customRequestParamsText)
      return
    }
    case "deepseek": {
      const provider = normalized.provider.deepseek!
      assertRangeParameter(provider.frequencyPenalty, "频率惩罚", -2, 2)
      assertRangeParameter(provider.presencePenalty, "存在惩罚", -2, 2)
      assertReasoningEffort(provider.reasoningEffort)
      parseBrowserAiCustomRequestParams(provider.customRequestParamsText)
      return
    }
    case "gemini": {
      const provider = normalized.provider.gemini!
      assertIntegerParameter(provider.topK, "Gemini topK")
      assertRangeParameter(provider.frequencyPenalty, "Gemini 频率惩罚", -2, 2)
      assertRangeParameter(provider.presencePenalty, "Gemini 存在惩罚", -2, 2)
      assertStringList(provider.stopSequences, "Gemini 停止序列")
      assertIntegerParameter(provider.thinkingBudget, "Gemini thinkingBudget")
      parseJsonObjectText(provider.responseSchemaText, "Gemini responseSchema")
      parseBrowserAiCustomRequestParams(provider.customRequestParamsText)
      return
    }
    case "claude": {
      const provider = normalized.provider.claude!
      assertIntegerParameter(provider.topK, "Claude topK")
      assertStringList(provider.stopSequences, "Claude 停止序列")
      if (provider.serviceTier !== "" && provider.serviceTier !== "auto" && provider.serviceTier !== "standard_only") {
        throw new Error("Claude service_tier 只能是 auto、standard_only 或留空。")
      }
      if (provider.thinkingMode !== "disabled" && provider.thinkingMode !== "adaptive" && provider.thinkingMode !== "enabled") {
        throw new Error("Claude thinking.type 只能是 disabled、adaptive 或 enabled。")
      }
      if (provider.thinkingDisplay !== "summarized" && provider.thinkingDisplay !== "omitted") {
        throw new Error("Claude thinking.display 只能是 summarized 或 omitted。")
      }
      if (provider.thinkingMode === "enabled") {
        if (provider.thinkingBudgetTokens === null || provider.thinkingBudgetTokens < 1024) {
          throw new Error("Claude thinking.budget_tokens 启用时必须至少为 1024。")
        }
        if (common.maxOutputTokens !== null && provider.thinkingBudgetTokens >= common.maxOutputTokens) {
          throw new Error("Claude thinking.budget_tokens 必须小于最大输出 token。")
        }
      }
      parseBrowserAiCustomRequestParams(provider.customRequestParamsText)
      return
    }
  }
}

export function validateBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): void {
  for (const type of input.providerTypes) {
    for (const provider of type.presets) {
      if (!Array.isArray(provider.models) || provider.models.length === 0) {
        throw new Error("服务商预设至少需要一个模型配置。")
      }
      for (const model of provider.models) {
        if (!model.parameters) {
          throw new Error("模型参数缺失。")
        }
        if (model.toolCallMode !== "native" && model.toolCallMode !== "text") {
          throw new Error("工具调用模式必须是「原生」或「文本」。")
        }
        validateBrowserAiModelParameters(model.parameters, type.kind)
      }
    }
  }
}
