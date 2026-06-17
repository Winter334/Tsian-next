# Agent Model Parameters Settings

## Goal

Polish the Control Panel provider configuration UI and add player-editable model parameters to each local OpenAI-compatible provider preset. The Settings surface should stop exposing developer/debug-style status blocks, and it should let players configure common model behavior without editing JSON or source files.

## Confirmed Facts

- `apps/platform-web/src/views/SettingsView.vue` currently shows redundant provider status blocks:
  - `localStorage / 本地预设 / 活动存档`;
  - a separate "当前生效" box;
  - a right-side "配置摘要" panel repeating provider/base URL/model/API key status.
- `apps/platform-web/src/config/ai.ts` stores provider presets in browser localStorage under `tsian-platform-config`.
- Provider presets currently contain provider name, `baseUrl`, `apiKey`, default model, fetched models, and fetch timestamp.
- `apps/platform-web/src/runtime-host/ai.ts` sends OpenAI-compatible chat-completions requests with only `model` and `messages`.
- API credentials are local sensitive configuration and must not enter Game Cards, Runtime Workspace files, packages, or bridge payloads.

## Requirements

1. Remove the developer/debug-style status block from the provider section.
2. Remove the separate "current effective" box from the main provider area.
3. Remove the right-side configuration summary panel and replace that space with model parameter controls.
4. Keep the Settings UI ordinary-player friendly:
   - avoid `localStorage`, storage ids, save ids, and other implementation terms;
   - use direct labels such as "服务商", "模型", "模型参数", and "自定义请求参数";
   - keep all common parameter controls visible, not folded into an advanced section.
5. Add model parameter configuration to each provider preset:
   - context window;
   - max output tokens;
   - temperature;
   - reasoning effort;
   - top_p;
   - frequency penalty;
   - presence penalty;
   - custom request parameters.
6. Send supported request parameters in OpenAI-compatible chat-completions calls.
7. Preserve compatibility with existing provider presets and legacy `{ chat }` localStorage config by applying defaults for missing model parameters.
8. Custom request parameters must be JSON-object-only. Invalid JSON or non-object input must prevent saving or request use with a clear error.
9. Custom request parameters must not override protected request fields owned by the runtime:
   - `model`;
   - `messages`;
   - `stream`;
   - protected auth/transport fields such as `apiKey`, `baseUrl`, or `headers`.
10. Context window is saved as model capability/budget metadata in this task. Do not claim complete token-budget truncation unless implementation adds actual prompt trimming.

## Acceptance Criteria

- [x] The yellow-box development status information from the screenshot is gone.
- [x] The red-box "当前生效" UI from the screenshot is gone.
- [x] The blue-box right panel is replaced with always-visible model parameter controls.
- [x] Provider presets save/load model parameters with sane defaults.
- [x] Existing local providers and old `{ chat }` config still load without manual migration.
- [x] Chat-completions request bodies include configured supported parameters when values are present.
- [x] Invalid custom request parameter JSON shows a clear UI error and is not saved.
- [x] Custom request parameters cannot override protected runtime-owned fields.
- [x] API keys remain hidden from summaries and distributable content.
- [x] `npm run build:web` passes.

## Out Of Scope

- Agent-level model parameter overrides.
- Per-Agent fallback chains.
- Full token counting or prompt truncation based on context window.
- Non-OpenAI-compatible provider protocols.
- Streaming, native provider tool calling, or response-format UI.
- Account sync or server-side secret storage.

## Decisions

- Common model parameters remain visible by default; no folded "advanced" section for this task.
- Truly advanced provider-specific behavior is handled through a custom request parameters JSON object.
