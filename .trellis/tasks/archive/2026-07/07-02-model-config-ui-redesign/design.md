# Model configuration UI redesign — Design

## Overview

The work changes model parameter configuration from a flat, protocol-agnostic object into a lightweight provider-aware schema. The UI remains the existing model table plus add/edit parameter windows, but those windows become sectioned and provider-aware. Runtime adapters continue to own protocol mapping, now reading only the common parameters and the active provider branch.

This is a schema correction with a modest UI cleanup, not a full Settings redesign.

## Data Model

### Provider kind remains outer authority

`BrowserAiProviderType.kind` remains the protocol authority. Model configs do not store their own `providerKind`; runtime config resolution receives the owning provider kind and selects the matching provider branch.

### Proposed model parameter types

```ts
export interface BrowserAiCommonModelParameters {
  contextWindow: number | null
  maxOutputTokens: number | null
  temperature: number | null
  topP: number | null
}

export interface BrowserOpenAiCompatibleModelParameters {
  frequencyPenalty: number | null
  presencePenalty: number | null
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}

export interface BrowserOpenAiResponsesModelParameters {
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}

export interface BrowserDeepSeekModelParameters {
  frequencyPenalty: number | null
  presencePenalty: number | null
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}

export interface BrowserGeminiModelParameters {
  topK: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
  stopSequences: string[]
  responseMimeType: string
  responseSchemaText: string
  thinkingBudget: number | null
  includeThoughts: boolean
  customRequestParamsText: string
}

export type BrowserClaudeThinkingMode = "disabled" | "adaptive" | "enabled"
export type BrowserClaudeThinkingDisplay = "summarized" | "omitted"
export type BrowserClaudeServiceTier = "" | "auto" | "standard_only"

export interface BrowserClaudeModelParameters {
  topK: number | null
  stopSequences: string[]
  serviceTier: BrowserClaudeServiceTier
  thinkingMode: BrowserClaudeThinkingMode
  thinkingBudgetTokens: number | null
  thinkingDisplay: BrowserClaudeThinkingDisplay
  customRequestParamsText: string
}

export interface BrowserAiProviderModelParameters {
  openaiCompatible?: BrowserOpenAiCompatibleModelParameters
  openaiResponses?: BrowserOpenAiResponsesModelParameters
  deepseek?: BrowserDeepSeekModelParameters
  gemini?: BrowserGeminiModelParameters
  claude?: BrowserClaudeModelParameters
}

export interface BrowserAiModelParameters {
  common: BrowserAiCommonModelParameters
  provider: BrowserAiProviderModelParameters
}
```

### Defaults

`createDefaultBrowserAiModelParameters()` should return common defaults plus all provider branch defaults. This keeps UI code simple and still treats branches as provider-specific; runtime only uses the active branch.

Default highlights:

- `common`: all nullable numeric fields `null`.
- OpenAI-compatible / DeepSeek: penalties `null`, `reasoningEffort: ""`, custom JSON `""`.
- OpenAI Responses: `reasoningEffort: ""`, custom JSON `""`.
- Gemini: numeric fields `null`, stop sequences `[]`, response fields `""`, `includeThoughts: false`, custom JSON `""`.
- Claude: `topK: null`, stop sequences `[]`, `serviceTier: ""`, `thinkingMode: "disabled"`, `thinkingBudgetTokens: null`, `thinkingDisplay: "summarized"`, custom JSON `""`.

### Normalization and compatibility

Project is in development and no old user data must be preserved. Normalize defensively but do not migrate old flat fields:

- Invalid/missing `parameters.common` → default common params.
- Invalid/missing provider branch → default branch.
- Old flat fields such as top-level `frequencyPenalty` / `reasoningEffort` are not copied into the new branches.
- Stored models may remain if their id/toolCallMode/streaming are valid; their invalid parameter object can normalize to defaults.

### Runtime config shape

`BrowserAiConfig.parameters` can remain `BrowserAiModelParameters`. Add helper selectors in `config/ai.ts`, for example:

```ts
providerParamsForKind(parameters, kind)
customParamsTextForKind(parameters, kind)
```

Adapters should read through helpers or directly from the active branch to avoid accidental cross-provider fields.

## Runtime Mapping

### OpenAI-compatible and DeepSeek

- Common:
  - `maxOutputTokens` → `max_tokens`
  - `temperature` → `temperature`
  - `topP` → `top_p`
- Active provider branch:
  - `frequencyPenalty` → `frequency_penalty`
  - `presencePenalty` → `presence_penalty`
  - `reasoningEffort` → `reasoning_effort`
  - `customRequestParamsText` → custom merge

`deepseek` reuses the OpenAI Chat Completions adapter but reads the `deepseek` branch.

### OpenAI Responses

- Common:
  - `maxOutputTokens` → `max_output_tokens`
  - `temperature` → `temperature`
  - `topP` → `top_p`
- Active provider branch:
  - `reasoningEffort` → `reasoning.effort`
  - `customRequestParamsText` → custom merge
- Continue to enforce local stateless replay: `store: false`, no `previous_response_id`, no `conversation`.

### Gemini

- Common:
  - `maxOutputTokens` → `generationConfig.maxOutputTokens`
  - `temperature` → `generationConfig.temperature`
  - `topP` → `generationConfig.topP`
- Gemini branch:
  - `topK` → `generationConfig.topK`
  - `frequencyPenalty` → `generationConfig.frequencyPenalty`
  - `presencePenalty` → `generationConfig.presencePenalty`
  - `stopSequences` → `generationConfig.stopSequences`
  - `responseMimeType` → `generationConfig.responseMimeType`
  - `responseSchemaText` parses to JSON and maps to `generationConfig.responseSchema`
  - `thinkingBudget` / `includeThoughts` map to `generationConfig.thinkingConfig` when present
  - `customRequestParamsText` → custom merge

If `responseSchemaText` is non-empty and invalid JSON, fail loudly before sending the request.

### Claude

- Common:
  - `maxOutputTokens` → `max_tokens` (fallback remains 4096 when unset)
  - `temperature` → `temperature`
  - `topP` → `top_p`
- Claude branch:
  - `topK` → `top_k`
  - `stopSequences` → `stop_sequences`
  - `serviceTier` → `service_tier` when non-empty
  - `thinkingMode`:
    - `disabled` → omit `thinking` (or send disabled only if needed later; omission is safer default)
    - `adaptive` → `{ type: "adaptive", display }`
    - `enabled` → `{ type: "enabled", budget_tokens, display }`
  - `customRequestParamsText` → custom merge

Validate `thinkingBudgetTokens >= 1024` when `thinkingMode === "enabled"`. If `common.maxOutputTokens` is set, validate budget is less than max output tokens to avoid common API errors.

## Validation

Update validation to be provider-kind aware:

```ts
validateBrowserAiModelParameters(parameters, kind)
validateBrowserPlatformConfigDraft(input)
```

`validateBrowserPlatformConfigDraft` already iterates provider types and can pass `type.kind` into model validation.

Validation rules:

- Common:
  - `contextWindow`, `maxOutputTokens`: positive integers when set.
  - `temperature`, `topP`: keep existing broad range unless provider-specific docs justify a narrower UI validation. Claude docs say temperature 0-1; the UI can hint this without blocking values beyond 1 unless we want strict provider validation.
- Custom JSON: parse every active branch's `customRequestParamsText` when validating the owning provider kind.
- Gemini:
  - `topK`: positive integer when set.
  - `responseSchemaText`: valid JSON object when non-empty.
- Claude:
  - `topK`: positive integer when set.
  - `serviceTier`: `"" | "auto" | "standard_only"`.
  - `thinkingMode`: valid enum.
  - `thinkingBudgetTokens`: required and >= 1024 for `enabled`; less than `maxOutputTokens` when max is set.

## UI Design

### Keep model table

`ModelConfigScreen` remains the high-level model list/table with:

- fallback strategy selector
- model order
- enabled switch
- edit parameters action
- move/delete actions
- optional status badges for capability/test state if simple to add

### Parameter windows

Both add and edit parameter flows use `FloatingWindow`:

- Convert `AddModelDialog.vue` from its custom overlay to slot-mode `FloatingWindow`.
- Keep `EditModelParamsDialog.vue` on `FloatingWindow`.
- Keep add-model-specific model id input and fetched model list inside the window.

### `ModelParamsFields` sections

Refactor `ModelParamsFields` into sectioned form blocks:

1. Common
   - context window
   - max output tokens
   - temperature
   - top_p
2. Capabilities
   - tool call mode
   - streaming
3. Provider-specific
   - rendered by provider kind
4. Advanced JSON
   - active provider branch custom JSON
5. Test
   - selected model chat ping status/action when the caller provides model id + preset context

The component can stay as one SFC initially, but if it becomes too large split provider sections into small subcomponents after searching existing component patterns.

## Model Chat Ping

Add a settings-only non-streaming chat ping that builds a `BrowserAiConfig` for the selected provider/preset/model and calls the regular non-stream text path with a minimal prompt.

Implementation options:

- Export a helper from `config/ai.ts` to resolve a config from an in-memory preset and provider kind, so settings can test unsaved draft values.
- Import `generateAssistantReply` in the settings component or a small settings helper module and call it with:
  - config: selected model config
  - messages: `[ { role: "user", content: "Reply with exactly OK." } ]`
  - debugLabel: `settings-model-ping`

UI should show:

- testing state
- success message with a short response preview
- error message from the provider/runtime

Do not implement streaming or native-tool ping in this task.

## Compatibility / Rollback

- No Dexie schema change.
- Provider config file shape changes destructively during development; users may need to reconfigure local providers.
- Keep reset behavior simple: invalid provider config normalizes to defaults or drops invalid model entries according to existing prototype-period patterns.
- Existing runtime provider adapters remain the rollback point: if provider-specific params cause errors, users can leave fields blank and use custom JSON only where needed.
