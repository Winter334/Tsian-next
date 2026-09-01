# Agent Provider Presets And Model Selection Design

## Architecture And Boundaries

The first implementation should extend the existing browser-local platform AI configuration instead of introducing a Dexie table or Game Card-owned config. API credentials are platform-local player secrets, while Game Cards and Agents remain reusable content. Future Agent-level model selection can reference a provider/model choice, but this task only changes the platform default provider used by current Agent Runtime calls.

Primary files:

- `apps/platform-web/src/config/ai.ts`: owns stored config shape, environment default normalization, active provider resolution, save/reset helpers, and model-list fetching helper types if kept storage-adjacent.
- `apps/platform-web/src/runtime-host/ai.ts`: continues to own OpenAI-compatible chat-completions calls and debug records; uses the resolved active provider config.
- `apps/platform-web/src/views/SettingsView.vue`: owns player-facing provider preset management UI.
- `apps/platform-web/src/App.vue`: keeps the short AI status derived from active config.

No shared contract change is needed unless implementation discovers a bridge-visible provider shape, which is currently out of scope.

## Data Model

Add a browser-local config shape similar to:

```ts
type BrowserAiProviderKind = "openai-compatible"

interface BrowserAiProviderPreset {
  id: string
  name: string
  kind: BrowserAiProviderKind
  baseUrl: string
  apiKey: string
  defaultModel: string
  fetchedModels?: BrowserAiModelEntry[]
  modelsFetchedAt?: string
}

interface BrowserAiModelEntry {
  id: string
  label?: string
}

interface BrowserPlatformConfigDraft {
  activeProviderId: string
  providers: BrowserAiProviderPreset[]
}
```

Compatibility path:

- Existing stored `chat` config is normalized into one local provider preset.
- Environment `VITE_AI_BASE_URL`, `VITE_AI_API_KEY`, and `VITE_AI_MODEL` are exposed as an implicit environment provider when no saved provider is active.
- Saving through the UI writes the new provider-preset shape and should not keep writing the old `chat` shape.

## Model Fetching

For OpenAI-compatible providers, fetch models from:

```text
GET {baseUrl without trailing slash}/models
Authorization: Bearer <apiKey>
```

Normalize common compatible payloads:

- preferred: `{ "data": [{ "id": "model-name" }] }`
- tolerate direct arrays of objects or strings if easy and safe.

Only `id` is required. Ignore malformed entries. If no model IDs are found, surface a UI error and preserve the current default model.

Model fetching should:

- require a non-empty base URL and API key;
- use the provider draft values, not only the already-saved active provider;
- not persist fetched models until the player saves or chooses a model;
- avoid logging API keys.

## Runtime Flow

`getBrowserAiConfig()` should keep returning the minimal resolved runtime config:

```ts
interface BrowserAiConfig {
  providerId?: string
  providerName?: string
  baseUrl: string
  apiKey: string
  model: string
}
```

`generateAssistantReply()` should not need to know about provider lists. It keeps receiving or resolving a single active config and sends `model: config.model` to chat completions.

## UI Shape

Control Panel should show one focused provider-management surface:

- active configuration status in the header;
- a provider selector plus create/delete controls;
- editable provider name, base URL, API key;
- a model row with fetch button, model select, and manual model input fallback;
- compact status/summary tiles showing provider name, kind, base URL, selected model, and fetch state.

Avoid exposing technical preset IDs. Use labels like "服务商", "接口地址", "模型", "拉取模型", and "手动输入".

## Compatibility And Migration

This is local prototype config. No Dexie migration is needed.

The localStorage reader must tolerate:

- missing config;
- the old `{ chat: { baseUrl, apiKey, model } }` shape;
- partially written new provider arrays;
- malformed JSON.

Reset removes the local config and returns to environment defaults.

## Trade-Offs

- Keeping presets browser-local avoids putting API keys into Game Cards or exports, but future per-Agent model choice will need a reference layer instead of storing secrets in Agent files.
- Supporting only OpenAI-compatible `/models` keeps the UX immediately useful without designing a provider abstraction too early.
- Retaining manual model input covers imperfect OpenAI-compatible services and keeps players unblocked.

## Rollback

If provider presets prove too broad during implementation, keep the runtime `BrowserAiConfig` shape stable and fall back to one provider preset in storage/UI. Existing runtime calls should continue to work as long as `getBrowserAiConfig()` resolves `{ baseUrl, apiKey, model }`.
