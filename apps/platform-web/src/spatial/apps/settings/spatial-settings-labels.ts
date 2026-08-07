import type { BrowserAiProviderKind } from "@/config/ai"

export function spatialProviderKindLabel(kind: BrowserAiProviderKind): string {
  switch (kind) {
    case "openai-responses": return "OpenAI Responses 接口"
    case "deepseek": return "DeepSeek 接口"
    case "gemini": return "Gemini 接口"
    case "claude": return "Claude 接口"
    case "openai-compatible": return "OpenAI 兼容接口"
  }
}
