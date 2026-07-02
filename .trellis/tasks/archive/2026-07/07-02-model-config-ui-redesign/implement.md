# Model configuration UI redesign — Implementation Plan

## Preconditions

- User-approved scope:
  - Lightweight provider-aware schema.
  - No old data migration/compatibility.
  - Optional provider branches keyed by provider kind.
  - Provider-specific custom JSON.
  - Claude advanced thinking defaults disabled.
  - Existing model table + draggable parameter windows, not split-pane detail UI.
  - Connectivity test + non-streaming chat ping only.
- Before editing, run `trellis-before-dev` and load platform-web frontend specs.

## Ordered Checklist

### 1. Update model parameter types and defaults

- Replace flat `BrowserAiModelParameters` with:
  - `BrowserAiCommonModelParameters`
  - provider-specific parameter interfaces
  - `BrowserAiProviderModelParameters`
  - nested `BrowserAiModelParameters`
- Add default creators for common/provider branches.
- Update `createDefaultBrowserAiModelParameters()`.
- Update clone helpers to deep-clone nested arrays/objects.

### 2. Update normalization and validation

- Update `normalizeModelParameters` for the new shape, defaulting invalid/missing branches without preserving old flat fields.
- Update `normalizeModelConfig` / `normalizeModelConfigs` call sites if needed.
- Update `validateBrowserAiModelParameters` to accept `kind` or add a provider-kind-aware wrapper.
- Update `validateBrowserPlatformConfigDraft` to pass `type.kind` into validation.
- Validate provider-specific enums, positive integers, custom JSON, Gemini response schema JSON, and Claude thinking constraints.

### 3. Update runtime config resolution helpers

- Add helpers to pick active provider params by `BrowserAiProviderKind`.
- Add helper to get custom request params text for active provider branch.
- Add/export a resolver that can build `BrowserAiConfig` from an in-memory preset + kind + optional model id so Settings can run chat ping before debounced persistence.
- Update `getBrowserAiProviderPresetModels` to read `parameters.common.contextWindow`.

### 4. Update provider adapters

- OpenAI Chat Completions adapter:
  - common fields from `parameters.common`
  - OpenAI-compatible or DeepSeek branch fields based on `config.kind`
  - custom JSON from active branch
- OpenAI Responses adapter:
  - common fields from `parameters.common`
  - Responses branch `reasoningEffort` and custom JSON
- Gemini adapter:
  - common fields into `generationConfig`
  - Gemini branch fields into `generationConfig`
  - parse `responseSchemaText` when non-empty
  - custom JSON from Gemini branch
- Claude adapter:
  - common fields into Messages request
  - Claude branch `topK`, `stopSequences`, `serviceTier`, `thinking`
  - custom JSON from Claude branch

### 5. Update settings UI form structure

- Refactor `ModelParamsFields.vue` to read/write nested params.
- Section the form into common, capabilities, provider-specific, advanced JSON, and optional test area.
- Show provider-specific fields only for the active `kind`.
- Keep the current visual language and use existing primitives.

### 6. Convert AddModelDialog to FloatingWindow

- Replace custom Teleport/overlay shell with `FloatingWindow` slot mode.
- Preserve model id input, fetch model list, list selection, inline params, errors, and add/cancel actions.
- Confirm keyboard behavior still works for Enter/Escape where appropriate.

### 7. Add model chat ping

- Add a settings-level model ping action using non-streaming `generateAssistantReply` with an in-memory resolved config.
- Display testing/success/error state in the parameter window.
- Keep existing preset connectivity/model-list test unchanged.
- Do not implement streaming or native tool tests.

### 8. Validation

Run:

- `npm run build:web`

If contract shapes unexpectedly change outside platform-web, also run:

- `npm run build:contracts`

## Risk / Rollback Points

- `apps/platform-web/src/config/ai.ts`: highest schema risk; keep helper names explicit and avoid hidden migrations.
- `apps/platform-web/src/runtime-host/ai.ts`: provider adapter mapping risk; verify every adapter reads the correct branch.
- `apps/platform-web/src/components/settings/ModelParamsFields.vue`: likely grows; split only if it becomes unwieldy.
- `apps/platform-web/src/components/settings/AddModelDialog.vue`: shell conversion should preserve behavior.
- `apps/platform-web/src/views/SettingsView.vue`: chat ping state and draft resolver wiring.

## Manual Verification Checklist

- Add model window is draggable and visually consistent with edit model params.
- Add model still supports model-list fetch and selecting a fetched model id.
- For each provider kind, parameter window shows relevant provider-specific fields and hides irrelevant fields.
- Custom JSON appears under the active provider section and saves into that branch.
- Non-streaming chat ping runs against the selected model and surfaces success/error.
- Existing provider preset connectivity test still runs.
- Existing runtime calls still build after schema update.
