# Agent Provider Presets And Model Selection Implementation Plan

## Checklist

1. Update browser AI config helpers.
   - Add provider preset types.
   - Normalize old `chat` storage into a provider preset.
   - Resolve active runtime config from saved provider or environment defaults.
   - Keep API-key masking out of persisted summaries.

2. Add OpenAI-compatible model fetching.
   - Build `/models` URL from draft base URL.
   - Fetch with bearer token and timeout/error handling.
   - Normalize response IDs.
   - Preserve current model on failure.

3. Redesign Control Panel AI section.
   - Provider selector and active status.
   - Create/save/reset provider controls.
   - Base URL/API key/model editing.
   - Fetch models button and model select.
   - Manual model fallback.
   - Clear feedback/error states.

4. Wire runtime behavior.
   - Keep `generateAssistantReply()` using `getBrowserAiConfig()`.
   - Include provider label in debug logs only if useful and safe.
   - Ensure Agent Runtime calls use the active provider's default model.

5. Check compatibility.
   - Fresh env-only config works.
   - Existing old `chat` localStorage shape resolves as one provider.
   - Reset returns to env defaults.
   - Empty/malformed providers do not crash settings.

6. Validate.
   - Run `npm run build:web`.
   - Optional browser smoke at `127.0.0.1:5173` if a dev server is already running or easy to start.

## Risky Files

- `apps/platform-web/src/config/ai.ts`: storage compatibility and active config resolution.
- `apps/platform-web/src/views/SettingsView.vue`: dense UI state can become confusing if not kept focused.
- `apps/platform-web/src/runtime-host/ai.ts`: model calls must keep current OpenAI-compatible behavior.

## Rollback Points

- If model fetching causes trouble, leave provider presets and manual model input working, then defer fetching behind a disabled/error state.
- If multi-provider UI becomes too large, ship one editable active provider preset with the new storage model and defer multiple saved presets.

## Validation Commands

```bash
npm run build:web
```
