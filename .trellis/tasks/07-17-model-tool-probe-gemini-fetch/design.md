# Design: 模型工具调用测试与 Gemini 模型拉取

## Scope

This task changes only `apps/platform-web` browser-side provider configuration, Settings model-test UI, and AI client helpers. It does not add storage fields or change shared `@tsian/contracts` shapes.

## Architecture

### 1. Base URL normalization

Add a small provider-agnostic helper in `config/ai.ts`:

```ts
normalizeBrowserAiProviderBaseUrl(input: string): string
```

Behavior is intentionally minimal:

1. trim whitespace;
2. if non-empty and no URL scheme is present, prefix `https://`;
3. strip trailing slashes;
4. strip obvious endpoint suffixes only:
   - `/chat/completions`
   - `/responses`
   - `/messages`
   - `/models`
   - `/embeddings`

No provider-specific guesses. Unknown middleman paths are preserved.

Use this helper at both boundaries:

- Settings add/edit preset saves and connectivity tests store/use normalized values.
- Runtime/fetch config resolution also normalizes before URL construction, so older saved values benefit without a migration.

### 2. Model list fetching

Keep `fetchBrowserAiProviderModels()` as the single UI entry point, but make its provider-kind branches more faithful.

- OpenAI-compatible / OpenAI Responses / DeepSeek / Claude keep existing generic `{ data: [...] }` or bare-array extraction behavior.
- Gemini uses the official `{ models: [...] }` shape:
  - read `name`, strip leading `models/` for the stored/displayed model id;
  - if `supportedGenerationMethods` is an array and it does not include `generateContent`, skip that entry;
  - if `supportedGenerationMethods` is missing, keep the entry for proxy compatibility;
  - follow `nextPageToken` until exhausted or until a small defensive page limit is hit.

The fetch timeout remains one timeout around the whole model-list operation.

### 3. Native tool-call probe

Add a dedicated helper in `runtime-host/ai.ts` that sends a non-streaming native function-calling request with one harmless probe tool.

Conceptual API:

```ts
probeAssistantNativeToolCalling(config: BrowserAiConfig, options?: { signal?: AbortSignal }): Promise<{ ok: boolean; message: string }>
```

Probe tool:

```ts
{
  name: "tsian_tool_probe",
  description: "Probe whether this model can call tools.",
  parameters: {
    type: "object",
    required: ["ping"],
    properties: { ping: { type: "string" } }
  }
}
```

The probe never executes workspace tools. It only checks whether the provider/model response contains a native tool call named `tsian_tool_probe`.

To reduce false negatives, extend native request building with an optional `forceToolName` used only by the probe:

- OpenAI-compatible / DeepSeek Chat Completions: `tool_choice: { type: "function", function: { name } }`.
- OpenAI Responses: best-effort forced function tool choice in the Responses request body. If a middleman rejects it, the failure is correctly surfaced as unsupported/invalid tool-choice for that API.
- Gemini: `toolConfig.functionCallingConfig.mode = "ANY"` with the probe function name allowed when supported by the API shape.
- Claude: `tool_choice: { type: "tool", name, disable_parallel_tool_use: true }`.

Regular runtime model calls do not set `forceToolName`, so existing Agent behavior is unchanged.

### 4. Settings UI

`ModelParamsFields.vue` keeps the existing TEST section but makes the two checks explicit:

- `Chat 测试`: existing ordinary non-streaming chat ping.
- `原生工具调用测试`: new probe, available when a model id is present.

`AddModelDialog.vue` and `EditModelParamsDialog.vue` accept/pass a new `testToolCalling` prop parallel to the existing `testModel` prop.

`SettingsView.vue` owns the implementation of both tests because it has the active preset/kind and can build an in-memory runtime config from the draft.

Tool test behavior:

- always probes native tool calling, regardless of the current `toolCallMode` dropdown value;
- does not persist the result;
- does not auto-switch `toolCallMode`;
- surfaces a short actionable message.

## Data Flow

1. Player opens add/edit model dialog.
2. Player enters model id or selects one from fetched list.
3. Chat test path builds temporary model config and calls `generateAssistantReply()` as today.
4. Tool probe path builds temporary model config with `toolCallMode: "native"`, `streaming: false`, calls `probeAssistantNativeToolCalling()`, and displays the result in local component state.
5. Save/add still only persists model id, parameters, selected `toolCallMode`, and streaming flag.

## Compatibility

- No Dexie schema changes.
- No contract package changes.
- Existing provider presets are read through the new baseUrl normalizer at runtime/fetch boundaries.
- OpenAI-compatible fetch behavior remains the same except for harmless baseUrl cleanup.

## Trade-offs

- The probe uses a real provider call and may cost a tiny amount. It is manual, not automatic or batched.
- Some models may still refuse to call a forced tool despite API support. The UI should classify this as “API accepted tools but no tool call returned” rather than definitive API unsupported.
- Responses tool-choice support across middlemen may vary. The probe is allowed to fail there; that is useful feedback for player configuration.

## Rollback

- Remove the new UI prop/button path and the runtime probe helper.
- Revert `fetchBrowserAiProviderModels()` to the previous single-request extraction if Gemini changes cause issues.
- BaseUrl normalization is isolated in one helper; callers can stop using it without data migration.
