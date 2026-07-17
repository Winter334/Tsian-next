import type {
  BrowserAiCommonModelParameters,
  BrowserAiModelParameters,
  BrowserAiToolCallMode,
  BrowserClaudeModelParameters,
  BrowserDeepSeekModelParameters,
  BrowserGeminiModelParameters,
  BrowserOpenAiCompatibleModelParameters,
  BrowserOpenAiResponsesModelParameters,
} from "./types"

export const DEFAULT_BROWSER_AI_TOOL_CALL_MODE: BrowserAiToolCallMode = "native"
export const DEFAULT_BROWSER_AI_STREAMING: boolean = true

export function createDefaultBrowserAiCommonModelParameters(): BrowserAiCommonModelParameters {
  return {
    contextWindow: null,
    maxOutputTokens: null,
    temperature: null,
    topP: null,
  }
}

export function createDefaultBrowserOpenAiCompatibleModelParameters(): BrowserOpenAiCompatibleModelParameters {
  return {
    frequencyPenalty: null,
    presencePenalty: null,
    reasoningEffort: "",
    customRequestParamsText: "",
  }
}

export function createDefaultBrowserOpenAiResponsesModelParameters(): BrowserOpenAiResponsesModelParameters {
  return {
    reasoningEffort: "",
    customRequestParamsText: "",
  }
}

export function createDefaultBrowserDeepSeekModelParameters(): BrowserDeepSeekModelParameters {
  return {
    frequencyPenalty: null,
    presencePenalty: null,
    reasoningEffort: "",
    customRequestParamsText: "",
  }
}

export function createDefaultBrowserGeminiModelParameters(): BrowserGeminiModelParameters {
  return {
    topK: null,
    frequencyPenalty: null,
    presencePenalty: null,
    stopSequences: [],
    responseMimeType: "",
    responseSchemaText: "",
    thinkingBudget: null,
    includeThoughts: false,
    customRequestParamsText: "",
  }
}

export function createDefaultBrowserClaudeModelParameters(): BrowserClaudeModelParameters {
  return {
    topK: null,
    stopSequences: [],
    serviceTier: "",
    thinkingMode: "disabled",
    thinkingBudgetTokens: null,
    thinkingDisplay: "summarized",
    customRequestParamsText: "",
  }
}

export function createDefaultBrowserAiModelParameters(): BrowserAiModelParameters {
  return {
    common: createDefaultBrowserAiCommonModelParameters(),
    provider: {
      openaiCompatible: createDefaultBrowserOpenAiCompatibleModelParameters(),
      openaiResponses: createDefaultBrowserOpenAiResponsesModelParameters(),
      deepseek: createDefaultBrowserDeepSeekModelParameters(),
      gemini: createDefaultBrowserGeminiModelParameters(),
      claude: createDefaultBrowserClaudeModelParameters(),
    },
  }
}
