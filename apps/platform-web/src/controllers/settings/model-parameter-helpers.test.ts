import { describe, expect, it } from "vitest"
import { createDefaultBrowserAiModelParameters } from "@/config/ai"
import { activeCustomRequestParamsText, textToLines, updateActiveCustomRequestParamsText, updateClaudeParameters, updateGeminiParameters, updateOpenAiCompatibleParameters } from "./model-parameter-helpers"

describe("model parameter helpers", () => {
  it("updates provider-specific fields without dropping the other parameter contracts", () => {
    const initial = createDefaultBrowserAiModelParameters()
    const openai = updateOpenAiCompatibleParameters(initial, { frequencyPenalty: 0.5, reasoningEffort: "high" })
    const gemini = updateGeminiParameters(openai, { topK: 32, stopSequences: textToLines("END\n STOP ") })
    const claude = updateClaudeParameters(gemini, { thinkingMode: "enabled", thinkingBudgetTokens: 2048 })
    expect(claude.common).toEqual(initial.common)
    expect(claude.provider.openaiCompatible?.frequencyPenalty).toBe(0.5)
    expect(claude.provider.gemini?.stopSequences).toEqual(["END", "STOP"])
    expect(claude.provider.claude?.thinkingBudgetTokens).toBe(2048)
  })

  it("routes custom request text to every provider's existing field", () => {
    let parameters = createDefaultBrowserAiModelParameters()
    for (const kind of ["openai-compatible", "openai-responses", "deepseek", "gemini", "claude"] as const) {
      parameters = updateActiveCustomRequestParamsText(parameters, kind, `{ "provider": "${kind}" }`)
      expect(activeCustomRequestParamsText(parameters, kind)).toContain(kind)
    }
  })
})
