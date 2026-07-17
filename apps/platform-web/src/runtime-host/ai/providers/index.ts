import type { BrowserAiProviderKind } from "../../../config/ai"

import type { ProviderAdapter } from "../types"
import { claudeAdapter } from "./claude"
import { deepseekAdapter } from "./deepseek"
import { geminiAdapter } from "./gemini"
import { openaiAdapter } from "./openai-chat"
import { responsesAdapter } from "./openai-responses"

export function selectAdapter(kind: BrowserAiProviderKind): ProviderAdapter {
  if (kind === "openai-responses") {
    return responsesAdapter
  }
  if (kind === "gemini") {
    return geminiAdapter
  }
  if (kind === "claude") {
    return claudeAdapter
  }
  if (kind === "deepseek") {
    return deepseekAdapter
  }
  return openaiAdapter
}
