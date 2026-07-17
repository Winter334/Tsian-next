# Implementation Plan: 模型工具调用测试与 Gemini 模型拉取

## Pre-implementation context

Required specs/research:

- `.trellis/spec/platform-web/frontend/index.md`
- `.trellis/spec/platform-web/frontend/component-guidelines.md`
- `.trellis/spec/platform-web/frontend/state-management.md`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `.trellis/spec/platform-web/frontend/quality-guidelines.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`
- `.trellis/tasks/07-17-model-tool-probe-gemini-fetch/research.md`

## Steps

1. **BaseUrl helper**
   - Add `normalizeBrowserAiProviderBaseUrl()` in `apps/platform-web/src/config/ai.ts`.
   - Use it when normalizing/creating provider presets and when resolving/fetching provider configs.
   - Keep behavior provider-agnostic and minimal.

2. **Gemini model-list fetch**
   - Update model-list URL construction to support Gemini pagination params.
   - Update Gemini extraction to filter out entries whose `supportedGenerationMethods` exists and lacks `generateContent`.
   - Preserve generic extraction for OpenAI-compatible, Responses, DeepSeek, and Claude.
   - Ensure empty filtered Gemini list produces a clear existing-style error.

3. **Native tool probe in AI client**
   - Extend `ProviderAdapter.buildNativeRequestBody()` with an optional forced tool name.
   - Add provider-specific forced tool-choice fields only when `forceToolName` is present.
   - Add `probeAssistantNativeToolCalling()` using one harmless `tsian_tool_probe` schema and `generateAssistantReplyNative()`.
   - Classify success vs no returned tool call vs thrown provider/API error into short `{ ok, message }` results.

4. **Settings model-test wiring**
   - Add `testToolCalling` prop signatures to `ModelParamsFields.vue`, `AddModelDialog.vue`, and `EditModelParamsDialog.vue`.
   - Split TEST UI labels into explicit chat and native tool-call tests.
   - Keep separate local loading/result state, or one shared result state with clear labels, matching surrounding component style.
   - In `SettingsView.vue`, implement `testActiveModelToolCalling()` parallel to `testActiveModel()` and pass it to add/edit dialogs.

5. **Manual review pass**
   - Search for all `fetchBrowserAiProviderModels`, `testModel`, `toolCallMode`, and baseUrl call sites to ensure props and helper use are consistent.
   - Confirm no new persisted fields were added.

6. **Validation**
   - Run `npm run build:web`.
   - If build output points to unrelated pre-existing issues, report them exactly and do not claim full verification.

## Risk points

- Provider-specific forced tool-choice field shapes are intentionally probe-only; they must not affect normal runtime calls.
- BaseUrl normalization must not rewrite unknown middleman paths except common endpoint suffix stripping.
- Gemini filtering must not drop proxy responses that omit `supportedGenerationMethods`.

## Rollback points

- After step 2: model-list fetch changes can be reverted independently of tool probe UI.
- After step 3: runtime probe helper can be reverted without touching stored config.
- After step 4: UI wiring can be reverted without schema migration.
