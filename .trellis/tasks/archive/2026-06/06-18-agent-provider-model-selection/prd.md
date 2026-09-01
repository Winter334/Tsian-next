# Agent Provider Model Selection

## Goal

Let each Agent choose which saved provider preset to use for its model calls. A player can save multiple OpenAI-compatible provider presets (each with apiUrl, apiKey, default model, and model parameters), and each Agent can select one as its API configuration. When an Agent runs, the runtime resolves that Agent's selected provider preset instead of always using the platform-global active provider.

## Confirmed Facts

- `apps/platform-web/src/config/ai.ts` already stores multiple provider presets in localStorage under `tsian-platform-config`, with `activeProviderId`, `providers[]` (name, baseUrl, apiKey, defaultModel, parameters, fetchedModels).
- `apps/platform-web/src/views/SettingsView.vue` lets players create/edit/save/reset provider presets, fetch models, and configure model parameters. This surface is complete for the preset side.
- `apps/platform-web/src/runtime-host/ai.ts` `generateAssistantReply()` resolves config via `getBrowserAiConfig()` (the platform-global active provider) and sends OpenAI-compatible chat-completions. It accepts an optional `config` override.
- `apps/platform-web/src/agent-runtime/index.ts` calls `capabilities.callModel(messages, options)`; the platform-host wires this to `generateAssistantReply` without passing any per-Agent provider choice.
- `AgentConfig` in `@tsian/contracts/runtime.ts` has no provider/model fields.
- `apps/platform-web/src/agent-runtime/registry.ts` parses `agent.json` into `AgentRegistryEntry`; adding a field requires normalizing it there.
- `apps/platform-web/src/platform-host/index.ts` persists `agent.json` via `writeAgentConfigRecord` for card agents; local assistant config lives in `.tsian/local/assistant/agent.json` persisted via `saveLocalAssistantFiles`.
- The local assistant agent is stored at `.tsian/local/assistant/agent.json` and participates in the same registry.
- API keys and provider credentials must never enter game-card packages, exports, or remote frontend payloads. Agent config only stores a reference to a provider preset id, not the key.

## Requirements

1. Add an optional provider selection field to Agent config (`agent.json`). It references a saved provider preset by id. When unset, the Agent falls back to the platform-global active provider.
2. The Agent provider selection must store only the provider preset id (a local reference), never the apiKey or baseUrl directly. This keeps API credentials local and out of distributable game-card content.
3. The runtime must resolve the Agent's selected provider preset before each model call:
   - If the Agent selected a provider id that exists in saved presets, use that preset's baseUrl, apiKey, model, and parameters.
   - If the selected provider id is missing or the preset was deleted, fall back to the platform-global active provider (`getBrowserAiConfig()`).
   - If neither resolves, use environment defaults as before.
4. Both the AIRP play turn and the desktop Assistant chat turn must use the per-Agent provider resolution. The Assistant (local agent in `.tsian/local/assistant/`) is also selectable.
5. The Studio UI must show the Agent's current provider selection (provider name + selected model) and let the player choose or clear a saved provider preset from a dropdown.
6. Only saved provider presets should appear in the Agent selection dropdown. The environment-default provider is an implicit fallback, not a selectable preset entry.
7. Model parameters from the selected provider preset are used as-is. No per-Agent model parameter overrides in this task.
8. Provider preset selection in Agent config must not break when a game card is distributed to another player who has different (or no) local presets: the reference resolves to the fallback chain gracefully.
9. Existing provider presets and model parameters in Settings must continue to work unchanged.
10. `npm run build:contracts` and `npm run build:web` must pass.

## Product Constraints

- This is a player-facing configuration surface. Avoid exposing raw preset ids in the Studio UI; show provider names.
- Do not store API keys in game-card content, Agent files, exports, or remote bridge payloads. Agent config only carries a preset id reference.
- Do not add per-Agent model parameter overrides, fallback chains between providers, or non-OpenAI-compatible protocols in this task.
- Prototype period: breaking changes to Agent config shape are allowed; no legacy compatibility shims needed for the new field.

## Acceptance Criteria

- [ ] `AgentConfig` and `AgentRegistryEntry` carry an optional provider preset id reference.
- [ ] A player can save multiple provider presets in Control Panel (existing) and select a different preset for different Agents in Studio.
- [ ] An Agent with a selected provider preset uses that preset's endpoint, key, model, and parameters for model calls.
- [ ] An Agent with no selection uses the platform-global active provider as before.
- [ ] Deleting or missing a referenced preset falls back gracefully to the global active provider without crashing.
- [ ] The desktop Assistant agent can also select a provider preset.
- [ ] API keys never appear in agent.json, game-card packages, or exports.
- [ ] `npm run build:contracts` passes.
- [ ] `npm run build:web` passes.

## Out Of Scope

- Per-Agent model parameter overrides (parameters stay on the provider preset).
- Fallback chains between multiple providers or models.
- Non-OpenAI-compatible provider protocols.
- Server-side secret storage or multi-device sync.
- Streaming responses or native tool-calling changes.

## Decisions

- Agent config stores a provider preset id reference only. The preset (with credentials) lives in platform-local localStorage and is never distributed.
- Resolution order: Agent-selected preset -> platform-global active provider -> environment defaults.
- The new field is optional and additive. Existing agents without it keep working via the global provider.
