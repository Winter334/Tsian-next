# Model configuration UI redesign

## Goal

Redesign the AI provider/model configuration schema and its settings UI so common model settings are represented accurately for different provider protocols (OpenAI Chat Completions, OpenAI Responses, DeepSeek, Gemini, Claude, and future providers). The task avoids a large provider DSL, but it must stop treating provider-specific parameters as one universal flat object.

## Background And Confirmed Facts

- `SettingsView.vue` currently routes settings through screen states `hub`, `providers`, `models`, `semantic-search`, and `tunables`; provider/model management is one area inside the existing Settings route (`apps/platform-web/src/views/SettingsView.vue:138-144`).
- Provider management is currently a two-column screen: resident provider-type sidebar on the left and preset cards on the right. A preset card shows name/baseUrl, primary model, model count, fallback strategy, and a button to enter model configuration (`apps/platform-web/src/components/settings/ProviderManagementScreen.vue:1-114`).
- Model configuration is currently a compact table with fallback strategy plus columns for order, model id, enabled status, a single “编辑参数” action, move buttons, and delete (`apps/platform-web/src/components/settings/ModelConfigScreen.vue:1-96`).
- Adding/editing a model opens a dialog containing the entire `ModelParamsFields` form. That form stacks context/max output, sampling sliders, reasoning, tool-call mode, streaming, and custom JSON in one surface (`apps/platform-web/src/components/settings/ModelParamsFields.vue:1-125`, `apps/platform-web/src/components/settings/AddModelDialog.vue:58-70`, `apps/platform-web/src/components/settings/EditModelParamsDialog.vue:1-40`).
- Model parameters are currently a flat protocol-agnostic shape: `contextWindow`, `maxOutputTokens`, `temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `reasoningEffort`, and `customRequestParamsText` (`apps/platform-web/src/config/ai.ts:25-34`). Tool-call mode and streaming live on `BrowserAiModelConfig`, also per model.
- Provider presets currently hold protocol identity implicitly through their provider type; the preset itself stores `baseUrl`, `apiKey`, model configs, fallback strategy, fetched model list, and timestamps (`apps/platform-web/src/config/ai.ts:67-78`).
- `07-02-openai-responses-provider` added `OpenAI Responses` as a separate provider type and established that Responses uses `reasoning.effort`, flat function tools, local stateless replay, and provider-specific usage/cache fields. This makes protocol-specific differences visible in configuration and diagnostics.
- The project is still in development and has no old user data that must be preserved. This task does not need to preserve old flat parameter values or implement a compatibility migration.
- Gemini common configuration is not empty. Research notes (`research/provider-model-parameter-notes.md`) identify useful Gemini fields: `topK`, `frequencyPenalty`, `presencePenalty`, `stopSequences`, `responseMimeType`, `responseSchema`, and `thinkingConfig` (`thinkingBudget`, `includeThoughts` as advanced fields).
- Claude common configuration is also not empty. Research notes identify `top_k`, `stop_sequences`, `service_tier`, and extended-thinking fields: `thinking.type`, `thinking.budget_tokens`, and `thinking.display`; extended thinking has tool-choice compatibility constraints (`research/provider-model-parameter-notes.md`).
- The current UI already uses the RetroOS / terminal visual language. Any redesign should preserve that style rather than introduce a new visual identity (`.trellis/spec/platform-web/frontend/component-guidelines.md:13-19`).

## Product Decisions

- The root issue is schema semantics, not only UI layout.
- Use a **lightweight provider-aware model parameter schema**, not a large provider-configuration framework.
- Do not implement old data compatibility or migrations. Missing/invalid old parameter shapes may be defaulted or dropped during normalization.
- Store provider-specific parameter sections as optional branches keyed by provider kind; the parent `BrowserAiProviderType.kind` remains the source of truth for which branch runtime uses. Do not duplicate provider kind as a second authority inside each model.
- Provider-specific custom request JSON belongs inside each provider-specific parameter branch, not as one shared model-level field.
- Claude extended thinking should be exposed as an advanced provider-specific section, but new Claude model configs default to `thinkingMode: "disabled"`, `thinkingBudgetTokens: null`, and `thinkingDisplay: "summarized"` so unsupported models do not error by default.
- Configuration testing should cover the existing model-list/connectivity test plus a non-streaming chat ping for the selected model in this task. Streaming and native-tool tests can be designed as future/optional status slots, but are not required implementation scope.
- Keep the existing model table + add/edit parameter window interaction model for this task. Do not replace it with a persistent split-pane model detail editor yet; the provider-aware schema can be exposed through better sectioning inside the draggable parameter windows.
- The add-model dialog should be unified with the existing edit-model dialog surface by using the draggable `FloatingWindow` shell; the current fixed overlay add dialog is an old UI inconsistency.

## Requirements

### R1 — Provider-Aware Parameter Schema

- Replace the flat model-parameter shape with a schema that separates provider-agnostic fields from provider-specific fields.
- Keep tool-call mode and streaming as model capabilities, not sampling parameters.
- Store provider-specific settings under optional branches keyed by provider kind; runtime chooses the branch using the owning provider type.
- The schema should cover common provider settings without becoming a generic arbitrary provider metadata DSL.
- Do not implement migration/compatibility for old stored model parameter fields.

### R2 — Common Parameters

Common model parameters should include only fields that are broadly meaningful or Tsian-local:

- `contextWindow` — local budget/visualization; not necessarily sent to provider.
- `maxOutputTokens` — maps to provider-specific output-token field.
- `temperature`
- `topP`

### R3 — Provider-Specific Parameters

Provider-specific sections should cover common knobs for each provider kind:

- OpenAI-compatible Chat Completions:
  - `frequencyPenalty`
  - `presencePenalty`
  - `reasoningEffort` → `reasoning_effort`
  - `customRequestParamsText`
- OpenAI Responses:
  - `reasoningEffort` → `reasoning.effort`
  - `customRequestParamsText`
- DeepSeek:
  - `frequencyPenalty`
  - `presencePenalty`
  - `reasoningEffort` where supported by the configured endpoint/model
  - `customRequestParamsText`
- Gemini:
  - `topK`
  - `frequencyPenalty`
  - `presencePenalty`
  - `stopSequences`
  - `responseMimeType`
  - `responseSchemaText` (advanced JSON schema text)
  - `thinkingBudget`
  - `includeThoughts`
  - `customRequestParamsText`
- Claude:
  - `topK` → `top_k`
  - `stopSequences` → `stop_sequences`
  - `serviceTier` → `service_tier` (`"auto" | "standard_only"`, with blank = do not send)
  - `thinkingMode` → `thinking.type` (`"disabled" | "adaptive" | "enabled"`)
  - `thinkingBudgetTokens` → `thinking.budget_tokens` when `thinkingMode === "enabled"`
  - `thinkingDisplay` → `thinking.display` (`"summarized" | "omitted"`) when thinking is not disabled
  - `customRequestParamsText`
- `claude` defaults: `topK: null`, `stopSequences: []`, `serviceTier: ""`, `thinkingMode: "disabled"`, `thinkingBudgetTokens: null`, `thinkingDisplay: "summarized"`, `customRequestParamsText: ""`.

### R4 — Advanced Escape Hatch

- Preserve `customRequestParamsText` or an equivalent advanced JSON override inside each provider-specific parameter branch.
- Do not keep one shared model-level custom JSON field, because custom request keys are protocol/endpoint-specific.
- The UI must present provider custom JSON as advanced/provider-specific override, not as the main way to configure common knobs.
- Runtime builders must continue protecting runtime-owned fields from custom JSON overrides.

### R5 — UI Reflects Schema

The UI should make the new schema understandable while keeping the current table + parameter window flow:

- Keep `ModelConfigScreen` as a model table/list with fallback strategy, enabled state, order controls, and add/edit/delete actions.
- Use draggable `FloatingWindow` parameter windows for adding and editing models.
- Inside the parameter window, show common parameters separately from provider-specific parameters.
- Show only provider-relevant controls for the selected provider kind.
- Display protocol-aware labels/hints, e.g. OpenAI Responses sends `reasoning.effort`, while Chat Completions sends `reasoning_effort`.
- Avoid one long undifferentiated parameter form by using clear section headers and progressive disclosure for advanced/provider-specific controls.
- Do not implement a persistent split-pane model-detail editor in this task.

### R6 — Testing / Diagnostics Entry Point

- Preserve the existing model-list connectivity test for provider preset creation/editing.
- Add a selected-model non-streaming chat ping test in this task so users can verify the exact provider + preset + model + schema mapping works before using it in Agent Runtime.
- The chat ping should send a minimal prompt and display pass/fail plus a useful error message in the settings UI.
- Streaming and native-tool tests may appear as future/optional status slots in the UI design, but they are not required implementation scope for this task.
- Failures should surface useful messages without requiring users to inspect console logs.

### R7 — Add Model Dialog Consistency

- Convert the add-model dialog to the same draggable `FloatingWindow` shell used by the edit-model-params dialog.
- Preserve current add-model behavior: model id input, fetch/select model list, inline parameter configuration, validation, cancel/add actions.
- This is a direct UI consistency fix included in this task; it should not expand into a broader floating-window redesign.

### R8 — Visual Direction

- Preserve the existing restrained cyber/terminal/RetroOS shell, but make the model config area feel more like a capable control console than a cramped table + modal.
- Prefer dense-but-legible panels, status badges, section headers, and progressive disclosure over a full visual-language rewrite.

## Acceptance Criteria

- [ ] `BrowserAiModelParameters` no longer exposes provider-specific knobs as one flat universal object.
- [ ] Runtime config resolution chooses provider-specific params by the owning `BrowserAiProviderType.kind`, not by a duplicated kind stored on the model.
- [ ] Existing runtime adapters compile against and send the new schema fields correctly for OpenAI-compatible, OpenAI Responses, DeepSeek, Gemini, and Claude.
- [ ] Provider-specific custom JSON is stored and read from the active provider branch; runtime-owned request fields remain protected.
- [ ] Gemini UI/runtime exposes common Gemini knobs including `topK`, penalties, stop sequences, response MIME/schema, and thinking controls.
- [ ] Claude UI/runtime exposes `topK`, stop sequences, service tier, and advanced extended-thinking controls with disabled thinking as the default.
- [ ] Add-model and edit-model parameter dialogs both use draggable `FloatingWindow` surfaces.
- [ ] Model parameter UI is sectioned into common/capability/provider-specific/advanced/test areas and hides irrelevant provider controls.
- [ ] The selected model can be tested with a non-streaming chat ping from settings, with visible pass/fail feedback.
- [ ] Existing provider connectivity/model-list test still works.
- [ ] No backward-compatible migration of old flat model parameter values is implemented.
- [ ] `npm run build:web` passes.

## Out Of Scope

- Backward-compatible migration of existing provider config data.
- A fully generic provider metadata DSL or plugin-defined config schema.
- A persistent split-pane model detail editor; current model table + draggable parameter windows are sufficient for this task.
- Native-tool and streaming provider test implementation beyond optional/future UI status placeholders.
- Reworking Agent Runtime provider selection semantics outside settings.
- Server-side key storage, account-level secrets, or cloud sync.
- Replacing the entire Settings hub or desktop shell.
- Responses `previous_response_id` / server-side conversation state.
- Forced Claude `tool_choice` configuration; Tsian's tool-call mode remains the primary tool-use control, and Claude extended thinking can conflict with forced tool choices.

## Open Questions

None blocking.
