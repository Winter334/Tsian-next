# Agent Model Parameters Settings Design

## Architecture And Boundaries

This task extends browser-local provider preset configuration. It does not move provider settings into Game Cards or Runtime Workspace content.

Primary files:

- `apps/platform-web/src/config/ai.ts`
  - add model parameter types;
  - normalize saved provider presets and old `{ chat }` config;
  - expose parsed runtime-ready model request settings;
  - validate custom request parameters.
- `apps/platform-web/src/runtime-host/ai.ts`
  - add safe request parameter merging before `fetch`;
  - keep `model` and `messages` owned by runtime;
  - avoid logging secrets.
- `apps/platform-web/src/views/SettingsView.vue`
  - remove redundant status/summary UI;
  - render model parameter controls in the right panel;
  - validate custom request JSON on save.
- `.trellis/spec/platform-web/frontend/state-management.md`
  - update provider config contract after implementation if needed.

No shared `@tsian/contracts` changes are expected because provider config remains platform-local and is not bridge/package visible.

## Data Shape

Add a model parameter object to `BrowserAiProviderPreset` and the resolved runtime config:

```ts
export type BrowserAiReasoningEffort = "" | "low" | "medium" | "high"

export interface BrowserAiModelParameters {
  contextWindow: number | null
  maxOutputTokens: number | null
  temperature: number | null
  topP: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}
```

Runtime request mapping:

- `maxOutputTokens` -> `max_tokens`
- `temperature` -> `temperature`
- `topP` -> `top_p`
- `frequencyPenalty` -> `frequency_penalty`
- `presencePenalty` -> `presence_penalty`
- `reasoningEffort` -> `reasoning_effort`
- `customRequestParamsText` -> parsed JSON object merged after standard optional parameters, except protected fields are rejected.
- `contextWindow` -> saved/displayed model capability metadata only in this task.

## Defaults And Validation

Defaults should keep existing behavior:

- numeric parameters default to `null`, meaning "do not send this parameter";
- `reasoningEffort` defaults to empty string, meaning "do not send";
- `customRequestParamsText` defaults to an empty string;
- legacy provider presets and old `chat` config receive default parameters.

Validation:

- Numeric fields may be blank.
- `contextWindow` and `maxOutputTokens` must be positive integers when present.
- `temperature` and `topP` should be between `0` and `2` for compatibility-first MVP.
- penalties should be between `-2` and `2`.
- `reasoningEffort` must be empty, `low`, `medium`, or `high`.
- custom request params must parse as a plain JSON object.
- protected keys are rejected even when nested at the root custom object.

## UI Shape

The Control Panel content should keep a two-column layout:

- Left/main column:
  - provider selector and add/delete;
  - provider name, base URL, API key;
  - model fetch/list/manual input;
  - feedback/error state.
- Right column:
  - "模型参数" panel replacing the old "配置摘要";
  - compact numeric controls for context window, max output tokens, temperature, top_p, frequency/presence penalty;
  - reasoning effort select;
  - custom request parameters textarea.

Remove the top provider-section debug box and the separate current-effective box.

## Request Construction

`generateAssistantReply()` should build request body through one helper:

```ts
const body = buildChatCompletionsRequestBody({
  model: config.model,
  messages,
  parameters: config.parameters,
})
```

The helper should:

- start with runtime-owned `model` and `messages`;
- add recognized optional parameters only when non-null/non-empty;
- parse and merge custom params;
- reject protected custom keys;
- keep protected runtime fields authoritative.

## Compatibility

- Existing saved provider presets without `parameters` must still normalize.
- Existing old `{ chat }` storage must still normalize.
- Env-only configuration should still resolve a usable config, with default empty parameters.
- Reset still removes local provider presets and returns to env fallback.

## Trade-Offs

- Context window is visible and saved now, but full token-aware trimming is deferred. This avoids false precision while giving players a place to record the model's effective window.
- Custom request parameters are powerful enough for provider-specific options without making the ordinary UI bloated.
- Sending only non-empty parameters preserves existing model behavior for users who do not touch the new controls.
