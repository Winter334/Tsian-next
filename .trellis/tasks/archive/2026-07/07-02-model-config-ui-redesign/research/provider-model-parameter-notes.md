# Provider Model Parameter Notes

## User decision

- Project is still in development; there is no old user data to preserve.
- Do not spend implementation complexity on migrating/compatibly reading old model-parameter fields.
- Redesign can be a destructive config-shape update, consistent with prototype-period provider config rules.
- Store provider-specific parameter branches keyed by provider kind; the parent provider type remains the source of truth for which branch runtime uses.

## Gemini researched fields

Sources checked:

- https://ai.google.dev/api/generate-content
- https://ai.google.dev/api/rest/v1beta/GenerationConfig
- https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html
- https://ai.google.dev/gemini-api/docs/thinking

Common Gemini `generationConfig` / `GenerateContentConfig` fields relevant to a model settings UI:

```ts
{
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  responseMimeType?: string
  responseSchema?: unknown
  thinkingConfig?: ThinkingConfig
}
```

GenerationConfig-oriented docs clearly show:

- `maxOutputTokens: integer`
- `temperature: number`
- `topP: number`
- `topK: integer`
- `candidateCount: integer`
- `stopSequences: string[]`
- `responseMimeType: string`
- `responseSchema: object / Schema`

Google GenAI JS SDK docs also list:

- `frequencyPenalty?: number`
- `presencePenalty?: number`
- `thinkingConfig?: ThinkingConfig`

Thinking details are doc-fragment dependent. The JS SDK surface exposes `thinkingConfig`, with nested fields commonly represented as:

```ts
thinkingConfig?: {
  thinkingBudget?: number
  includeThoughts?: boolean
}
```

But available docs did not consistently expose exact nested field details for `generateContent`; treat this as an advanced Gemini provider-specific section rather than a universal required field.

## Claude researched fields

Sources checked:

- https://platform.claude.com/docs/en/api/messages
- https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
- https://platform.claude.com/docs/en/api/messages-examples

Claude Messages API request fields relevant to a model settings UI:

```ts
{
  max_tokens: number
  temperature?: number // default 1.0, documented range 0.0-1.0
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  stream?: boolean
  service_tier?: "auto" | "standard_only"
  metadata?: { user_id?: string }
  thinking?:
    | { type: "enabled", budget_tokens: number, display?: "summarized" | "omitted" }
    | { type: "adaptive", display?: "summarized" | "omitted" }
    | { type: "disabled" }
  tool_choice?:
    | { type: "auto", disable_parallel_tool_use?: boolean }
    | { type: "any", disable_parallel_tool_use?: boolean }
    | { type: "tool", name: string, disable_parallel_tool_use?: boolean }
    | { type: "none" }
}
```

Extended thinking notes:

- `thinking.type: "enabled"` requires `budget_tokens`.
- `budget_tokens` must be `>= 1024` and normally less than `max_tokens`.
- `thinking.display` can be `"summarized"` or `"omitted"`; invalid when `thinking.type: "disabled"`.
- Extended thinking with tools supports only `tool_choice: {"type":"auto"}` or `{ "type": "none" }`; forced tool choices can error.
- For multi-turn tool use, prior thinking blocks and signatures must be passed back unchanged. Tsian's current Claude adapter already parses visible `thinking_delta` for streaming display, but config schema should not imply arbitrary thinking replay semantics unless runtime supports it.
- Manual `budget_tokens` support varies by Claude model family; make it an optional advanced provider-specific setting, not a default.

## Suggested common-vs-provider split

Keep as common because they are broadly meaningful or Tsian-local:

- `contextWindow` — local budget/visualization; not necessarily sent to provider.
- `maxOutputTokens` — maps to provider-specific output-token field (`max_tokens`, `max_output_tokens`, `maxOutputTokens`, etc.).
- `temperature`
- `topP`

Provider-specific common fields:

- OpenAI Chat Completions / DeepSeek:
  - `frequencyPenalty`
  - `presencePenalty`
  - `reasoningEffort`
- OpenAI Responses:
  - `reasoningEffort` → `reasoning.effort`
- Gemini:
  - `topK`
  - `frequencyPenalty`
  - `presencePenalty`
  - `stopSequencesText` or `stopSequences`
  - `responseMimeType`
  - `responseSchemaText` (advanced JSON)
  - `thinkingBudget`
  - `includeThoughts`
- Claude:
  - `topK`
  - `stopSequencesText` or `stopSequences`
  - `thinkingMode`: `"disabled" | "adaptive" | "enabled"`
  - `thinkingBudgetTokens`
  - `thinkingDisplay`: `"summarized" | "omitted"`
  - `serviceTier`: `"" | "auto" | "standard_only"`

Keep `customRequestParamsText` as the advanced escape hatch, preferably at model/provider-specific level, and protect runtime-owned fields in request builders.
