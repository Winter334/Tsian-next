# Agent Model Parameters Settings Implementation Plan

## Checklist

1. Update provider config types and normalization.
   - Add `BrowserAiModelParameters`.
   - Add defaults for new and legacy provider presets.
   - Include parameters in `BrowserAiConfig`.
   - Add validation/parsing helper for custom request params.

2. Update runtime request construction.
   - Add a helper that maps model parameters to OpenAI-compatible request keys.
   - Merge custom request params after standard optional fields.
   - Reject protected fields.
   - Keep `model` and `messages` runtime-owned.

3. Redesign Settings UI.
   - Remove top-right provider debug metadata.
   - Remove "当前生效" box.
   - Replace right summary panel with always-visible "模型参数" controls.
   - Add custom request params textarea and validation feedback.

4. Compatibility checks.
   - Existing provider without parameters loads with defaults.
   - Old `{ chat }` storage still loads with defaults.
   - Env-only config still reports model configured.

5. Validation.
   - Run `npm run build:web`.
   - Browser smoke on `127.0.0.1:5173` if available:
     - Control Panel renders without screenshot-highlighted redundant blocks.
     - New parameter panel is visible.
     - Invalid custom JSON blocks save with clear error.

## Risky Files

- `apps/platform-web/src/config/ai.ts`: model parameter normalization and custom JSON validation.
- `apps/platform-web/src/runtime-host/ai.ts`: request-body merge safety.
- `apps/platform-web/src/views/SettingsView.vue`: layout density and form validation.

## Rollback Points

- If custom request params complicate runtime safety, keep standard model parameters and defer custom params.
- If context window enforcement becomes too broad, keep it as saved metadata and explicitly document that full prompt truncation is deferred.

## Validation Commands

```bash
npm run build:web
```
