# Agent Provider Presets And Model Selection

## Goal

Make Agent Runtime model configuration understandable and reusable for ordinary players by replacing the single raw chat config with OpenAI-compatible provider presets. A player should configure a provider once, fetch its available models, choose one as that provider's default model, and have Agent Runtime use that selected provider/model for current model calls.

This task intentionally keeps the first version simple: only OpenAI-compatible chat APIs are supported, the selected model is stored as the provider's default model, and there is no Agent-level fallback chain yet.

## Confirmed Facts

- Current platform AI config is a single browser-local `chat` draft in `apps/platform-web/src/config/ai.ts` with `baseUrl`, `apiKey`, and `model`.
- `apps/platform-web/src/runtime-host/ai.ts` sends OpenAI-compatible `POST {baseUrl}/chat/completions` requests and expects a chat-completions-style response.
- `apps/platform-web/src/views/SettingsView.vue` is the current Control Panel route for model configuration.
- `apps/platform-web/src/platform-host/index.ts` injects model calls into Agent Runtime through `generateAssistantReply()` and does not pass Agent-specific provider choices.
- The app currently falls back from blank local fields to `VITE_AI_BASE_URL`, `VITE_AI_API_KEY`, and `VITE_AI_MODEL`.
- Local prototype storage policy prefers localStorage for browser platform config and Dexie only for platform data that needs stronger structured persistence.

## Requirements

1. Replace the single raw provider form with a provider preset model suitable for ordinary players.
2. Only support OpenAI-compatible APIs in this task.
3. A provider preset must include:
   - player-facing provider name;
   - OpenAI-compatible base URL;
   - API key;
   - selected default model;
   - fetched model list cache/status when available.
4. The Settings / Control Panel UI must let the player:
   - create or select a provider preset;
   - edit provider name, base URL, and API key;
   - fetch model IDs from the provider;
   - choose a fetched model from a list;
   - manually enter a model as a fallback when model fetching fails or the provider does not expose `/models` correctly;
   - save and reset local provider configuration.
5. The selected model is the provider's default model. Do not add Agent-level model overrides or fallback chains in this task.
6. Agent Runtime model calls must use the selected provider preset's default model.
7. Existing environment variable configuration should remain usable as an initial/default source for users who have not saved local presets yet.
8. API keys must not be displayed in clear text in summaries, status tiles, diagnostics, or debug records.
9. Model fetching errors must be shown in the UI with actionable text and must not erase the existing selected/default model.
10. Keep future support for per-Agent model selection possible, but do not expose that UI yet.

## Product Constraints

- This is a player-facing configuration surface, not a developer metadata editor.
- Avoid exposing low-level IDs unless necessary. Ordinary players should think in terms of provider name and model choice.
- Keep the UI information density moderate; the player should see what to fill in, the currently selected model, and whether fetching succeeded.
- Do not introduce Claude/Gemini/Ollama-native protocol support in this task.
- Do not store API keys in Game Card packages, Runtime Workspace files, exports, or remote frontend bridge payloads.
- API provider credentials remain local sensitive configuration even after a future account system exists. Account features may handle identity or sync UX later, but this task must not move API keys into distributable Game Card or Agent content.

## Acceptance Criteria

- [x] A fresh browser with only `VITE_AI_*` env values still reports AI as configured and can make existing Agent Runtime calls.
- [x] A player can create/save an OpenAI-compatible provider preset with name, base URL, API key, and default model.
- [x] A player can fetch models from the configured provider and choose one without manually typing the model ID.
- [x] A player can manually enter a model when fetching models fails or returns no usable IDs.
- [x] Agent Runtime calls use the active provider preset's default model in chat-completions requests.
- [x] Settings UI masks API keys outside the password input and does not leak them to status summaries.
- [x] Resetting local settings removes local provider presets/selection and returns to environment defaults.
- [x] Failed model fetching shows a clear error and preserves the previous provider/default model.
- [x] `npm run build:web` passes.

## Out Of Scope

- Per-Agent provider/model selection UI.
- Fallback chains between providers or models.
- Non-OpenAI-compatible native provider protocols.
- Provider config import/export through Game Card packages.
- Server-side secret storage or multi-device sync.
- Streaming responses or native tool-calling changes.

## Decisions

- Provider presets stay platform-global browser-local config for this task. Future Game Card/Agent files may reference provider/model choices, but must not contain API credentials.
