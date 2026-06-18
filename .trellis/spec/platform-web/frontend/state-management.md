# State Management

The app uses Vue local state, Dexie persistence, and explicit bridge/platform-host APIs. There is no Pinia, Vuex, or global store library.

## Vue State

- Use `ref`, `computed`, and `watch` for view-local state.
- Keep async status visible in local refs such as `feedback`, `settingsError`, or loading flags.
- Route views should refresh from platform/storage APIs after mutations instead of assuming local optimistic state is authoritative.

## Dexie State

- Table shapes live in `storage/db.ts`.
- Prototype schema changes use a new database name, not migrations.
- Multi-table writes should use `localDb.transaction`.
- Current active tables are `meta`, `gameCards`, `gameCardFrontendFiles`, `saves`, `saveSnapshots`, `saveHistory`, `checkpoints`, and `workspaceFiles`.
- Game cards own reusable content files (`contentFiles`) such as Agents, Skills, rules, schemas, docs, assistant metadata, and optional frontend bindings.
- Saves are playthrough slots linked to `gameCardId` / `gameCardVersion`; `workspaceFiles` stores only save runtime data mounted at `save/...` plus host-owned `.tsian/...` metadata.
- Packaged frontend files are reusable Game Card assets stored beside game cards, not copied into save runtime data.
- Built-in game cards may be refreshed by platform seed helpers when their source is `builtin` and their content/manifest is stale. This refresh updates reusable card content; existing saves see the updated card content through the effective workspace layer.
- Checkpoints store snapshot, history, and save runtime files. They do not snapshot card-owned content.

## Runtime State

- `LocalRuntimeEngine` owns the in-memory snapshot.
- `platform-host/index.ts` owns loading snapshots from storage, assembling the effective workspace from card content plus save runtime data, running Agent Runtime turns, persisting successful turns, checkpoint creation, and rollback on failure.
- `interaction.sendMessage` should not persist partial user/assistant messages when the Agent Runtime turn fails.

## Scenario: Browser AI Provider Config And Secrets

### 1. Scope / Trigger

- Trigger: platform-web changes browser AI provider configuration, `VITE_AI_*` fallback behavior, model fetching, Agent Runtime model-call config resolution, Game Card package import/export, or bridge/query payloads that might expose platform secrets.

### 2. Signatures

- `getBrowserAiConfig(): BrowserAiConfig | null`
- `getBrowserPlatformConfigDraft(): BrowserPlatformConfigDraft`
- `saveBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): void`
- `resetBrowserPlatformConfigDraft(): void`
- `fetchBrowserAiProviderModels(provider, options?): Promise<BrowserAiModelEntry[]>`
- `validateBrowserAiModelParameters(parameters: BrowserAiModelParameters): void`
- `parseBrowserAiCustomRequestParams(input: string): Record<string, unknown>`
- `resolveBrowserAiConfigForProviderId(providerId: string): BrowserAiConfig | null` — resolve a specific saved preset by id; null when missing/incomplete so callers fall back to the global active provider.
- `listBrowserAiProviderPresetOptions(): Array<{ id: string; name: string }>` — id+name only (no credentials), used to populate the per-Agent provider dropdown in Studio.
- `buildAgentProviderPresetMap(files: WorkspaceFile[]): Map<string, string>` — maps agent id -> `providerPresetId` from parsed registry entries.
- `resolveAgentModelConfig(agentId, presetMap): BrowserAiConfig | null` — resolves a per-Agent config override from the preset map.
- `updatePlatformStudioAgentProviderPreset(input: PlatformStudioAgentProviderPresetInput): Promise<WorkspaceFile>` — sets/clears `providerPresetId` in a card Agent's `agent.json`.
- `getLocalAssistantProviderPreset()` / `updateLocalAssistantProviderPreset(providerPresetId)` — same for the local Assistant agent in `.tsian/local/assistant/agent.json`.
- Environment fallback keys: `VITE_AI_BASE_URL`, `VITE_AI_API_KEY`, `VITE_AI_MODEL`.

### 3. Contracts

- Browser AI provider presets are platform-local player secrets stored under localStorage key `tsian-platform-config`.
- Provider presets currently support only OpenAI-compatible APIs: `baseUrl`, `apiKey`, provider default model, fetched model IDs, and model parameters.
- Model parameters are provider-local settings. Supported request fields include `max_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `reasoning_effort`, and custom JSON-object request params.
- `contextWindow` is saved as model capability/budget metadata only until a token-counting prompt-truncation task implements enforcement.
- Custom request params must be a JSON object and must not override runtime-owned/protected fields such as `model`, `messages`, `stream`, `apiKey`, `baseUrl`, or `headers`.
- `getBrowserAiConfig()` returns only the resolved active runtime config needed for a model call: provider identity/name when available plus `baseUrl`, `apiKey`, `model`, and normalized model parameters.
- When no complete local provider is active, `getBrowserAiConfig()` may fall back to complete `VITE_AI_*` environment values.
- Existing old localStorage shape `{ chat: { baseUrl, apiKey, model } }` is compatibility input and should normalize into a local OpenAI-compatible provider.
- API keys must not be written into Game Card manifests, Game Card packages, Runtime Workspace files, remote/packaged frontend bridge payloads, debug summaries, or visible non-password UI summaries.
- Per-Agent provider selection stores **only a provider preset id reference** (`providerPresetId?: string`) on `AgentConfig` / `AgentRegistryEntry` (`packages/contracts/src/runtime.ts`). The preset (with `apiKey`/`baseUrl`) stays in platform-local localStorage and is never distributed with game-card content.
- Resolution order for every model call: Agent-selected preset (`resolveBrowserAiConfigForProviderId`) -> platform-global active provider (`getBrowserAiConfig()`) -> `VITE_AI_*` environment defaults. `generateAssistantReply` applies this via `const config = options.config ?? getBrowserAiConfig()`.
- Both the AIRP play turn and the desktop Assistant chat turn must resolve the active Agent's provider config in their `callModel` closure and pass it as `config` only when it is non-null (omit the key otherwise so the global fallback applies).
- The local Assistant agent (`.tsian/local/assistant/agent.json`) participates in the same registry and the same provider selection/resolution path as card Agents.
- `PlatformStudioSnapshot.providerPresets` exposes only `{ id, name }` options (no credentials) so the Studio dropdown can list saved presets without leaking keys.
- Distributing a game card to another player with a `providerPresetId` set must resolve gracefully: the preset id is unlikely to exist in the recipient's localStorage, so resolution falls back to their global active provider without crashing.
- Future account-system work may manage identity or sync UX, but must not move API credentials into distributable Game Card or Agent content.

### 4. Validation & Error Matrix

- Missing/blank local provider fields plus incomplete env fallback -> `getBrowserAiConfig()` returns `null`.
- Malformed localStorage JSON -> ignore stored config and fall back to environment defaults.
- Old `chat` shape present -> normalize as one local provider without requiring a manual migration.
- Model fetch with blank base URL -> throw a clear local error before network fetch.
- Model fetch with blank API key -> throw a clear local error before network fetch.
- Model fetch HTTP error -> surface provider error message when present, otherwise status-based error.
- Model fetch returns no usable IDs -> surface an error and preserve the provider's existing default model.
- Numeric model parameter outside its supported range -> saving provider config fails with a clear field-specific error.
- Custom request params are invalid JSON or not an object -> saving provider config fails with a clear error.
- Custom request params include a protected key -> saving provider config fails and the key is named in the error.
- Per-Agent `providerPresetId` is blank/whitespace -> `resolveBrowserAiConfigForProviderId` returns `null` -> the call falls back to the global active provider.
- Per-Agent selected preset id no longer exists in saved presets (deleted by the player, or a card distributed to a player without that preset) -> `resolveBrowserAiConfigForProviderId` returns `null` -> falls back to the global active provider without crashing.

### 5. Good/Base/Bad Cases

- Good: Settings saves a local provider preset; Agent Runtime uses that provider's default model on the next turn.
- Good: Settings saves `temperature: 0.8` and `maxOutputTokens: 4096`; Agent Runtime sends `temperature` and `max_tokens` in the next chat-completions body.
- Good: custom request params `{ "seed": 42 }` are merged into the chat-completions body.
- Good: `/models` returns `{ data: [{ id: "model-name" }] }`; Settings lets the player choose `model-name`.
- Base: fresh browser with complete `VITE_AI_*` values has no local providers but still reports AI configured.
- Base: a provider whose `/models` endpoint is incompatible can still use manual model input.
- Bad: custom request params `{ "model": "override" }` replace the runtime-selected model.
- Bad: exporting a Game Card writes `apiKey` into `game-card.json`, `workspace/*`, `frontend/*`, or package metadata.
- Bad: a remote/packaged frontend can query provider config or API keys through the bridge.
- Good: a player selects a different saved provider preset for each Agent in Studio; each Agent's next model call uses that preset's endpoint, key, model, and parameters.
- Good: clearing an Agent's provider selection (empty dropdown) makes its next model call fall back to the platform-global active provider.
- Good: the desktop Assistant agent selects its own provider preset via the AssistantView header dropdown and uses it for chat turns.
- Bad: an Agent's `agent.json` stores `apiKey` or `baseUrl` directly instead of a `providerPresetId` reference.
- Bad: a card with `providerPresetId` set crashes when opened by a player who lacks that preset; it must instead fall back to their global active provider.

### 6. Tests Required

- Assert env-only configuration still resolves a usable `BrowserAiConfig`.
- Assert old `{ chat }` localStorage shape resolves to one local provider.
- Assert existing provider presets without `parameters` receive default model parameters.
- Assert reset removes local provider config and restores env fallback behavior.
- Assert model-fetch failure preserves the previous default model.
- Assert invalid custom request param JSON and protected custom keys fail before saving or request execution.
- Assert configured non-empty model parameters appear in chat-completions request bodies.
- Assert Game Card package export and bridge/query surfaces do not include provider config or API keys when those areas change.
- Assert an Agent with a `providerPresetId` pointing to an existing preset uses that preset's endpoint/key/model/parameters on its next model call.
- Assert an Agent with no `providerPresetId` (or an empty/whitespace one) falls back to the platform-global active provider.
- Assert an Agent whose `providerPresetId` was deleted resolves to the global active provider without throwing.
- Assert `agent.json` / Game Card packages never contain `apiKey` or `baseUrl`, only the `providerPresetId` reference.
- Assert `PlatformStudioSnapshot.providerPresets` exposes only `{ id, name }` with no credential fields.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "manifest": { "id": "my-card" },
  "aiProvider": {
    "baseUrl": "https://api.example/v1",
    "apiKey": "sk-secret",
    "model": "example-model"
  }
}
```

#### Correct

```typescript
const config = getBrowserAiConfig()
await generateAssistantReply(messages, { config })
```

Game Card or Agent content may later reference a provider/model preference, but the API credential stays in local browser platform config.

Per-Agent provider selection stores only a preset id reference and resolves at call time:

```typescript
// Correct — callModel closure resolves the Agent's preset, omits config when null
callModel(messages, options) {
  const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
  return generateAssistantReply(messages, {
    debugLabel: options.debugLabel,
    signal: options.signal,
    ...(agentConfig ? { config: agentConfig } : {}),
  })
}
```

```json
// Wrong — Agent config stores credentials directly instead of a preset id reference
{
  "id": "my-agent",
  "provider": { "baseUrl": "https://api.example/v1", "apiKey": "sk-secret" }
}
```

```json
// Correct — Agent config stores only the preset id reference
{ "id": "my-agent", "providerPresetId": "preset-abc-123" }
```

Custom request params are merged only after validation:

```typescript
parseBrowserAiCustomRequestParams('{ "seed": 42 }')
parseBrowserAiCustomRequestParams('{ "model": "override" }') // throws
```

## Scenario: Current Game Card And Active Save State

### 1. Scope / Trigger

- Trigger: platform-web changes Game Card loading, desktop app context, Play frontend resolution, Workspace/Studio views, or active save selection.

### 2. Signatures

- `getActiveGameCardId(): Promise<string | null>`
- `setActiveGameCardId(cardId: string | null): Promise<void>`
- `getPlatformActiveGameCard(): Promise<LocalGameCardRecord | null>`
- `setPlatformActiveGameCard(cardId: string): Promise<LocalGameCardRecord>`
- `getPlatformActiveSaveId(): Promise<string | null>`
- `selectPlatformSave(saveId: string): Promise<void>`

### 3. Contracts

- The desktop has one currently loaded Game Card stored in `meta["active-game-card-id"]`.
- The active Save Instance is separate state stored in `meta["active-save-id"]`.
- Desktop apps such as Play, Studio, Assistant, and Game entrypoints use the current Game Card by default and must not add their own ordinary card picker.
- Save-scoped runtime work must use the active save's own `gameCardId` when composing an effective workspace.
- Selecting or creating a save updates the current Game Card to that save's card.
- Opening/loading a Game Card may update the current Game Card without requiring a save.
- If no current Game Card is stored, platform initialization may derive one from the active save, first save, or built-in blank card.

### 4. Validation & Error Matrix

- Stored current Game Card id does not exist -> initialize/fall back to an existing card.
- `setPlatformActiveGameCard` receives an unknown card id -> throw a clear error.
- Active save belongs to a different card than current Game Card -> Studio may show card-only content, but save-scoped runtime operations must still use the save's card.
- No active save -> Play/Runtime save-scoped queries may show empty or not-configured states; Studio registry views should still read current card content.

### 5. Good/Base/Bad Cases

- Good: opening a Game Card detail sets the current Game Card, then Studio opens without asking the user to choose a card again.
- Good: selecting a save sets both active save and current Game Card to that save's card.
- Good: Studio can list Agents/Skills from card content when no save exists.
- Base: built-in blank card is the fallback current Game Card for a fresh profile.
- Bad: effective workspace for active save is composed with an unrelated current Game Card.
- Bad: every desktop app implements a separate Game Card picker.

### 6. Tests Required

- Assert current Game Card id persists through refresh.
- Assert opening/loading a Game Card updates current Game Card without creating a save.
- Assert selecting a save updates current Game Card.
- Assert registry/Studio reads can use card content without an active save.
- Assert save-scoped runtime operations compose with the save's own card, not a mismatched current card.

### 7. Wrong vs Correct

#### Wrong

```typescript
const activeCard = await getPlatformActiveGameCard()
return listEffectiveWorkspaceFilesForSave(activeSaveId, activeCard)
```

#### Correct

```typescript
const activeSave = saves.find((save) => save.id === activeSaveId)
const sourceCard = activeSave?.gameCardId
  ? await getLocalGameCard(activeSave.gameCardId)
  : await getBuiltinBlankGameCard()
return sourceCard
  ? listEffectiveWorkspaceFilesForSave(activeSaveId, sourceCard)
  : []
```

## Bridge State

- Bridge payloads must stay framework-neutral and serializable.
- `debug.onTurnDebugReady` is a notification to re-read debug/query resources, not a data transport.
- Remote iframe frontend state is per-mount: the adapter owns the generated bridge session id, accepted iframe origin, and `message` listener cleanup. Do not persist bridge session ids in Dexie or workspace files.
- Remote iframe workspace writes/deletes call `platform.runAction` immediately against `save/...`. They are not part of the Agent Runtime staged transaction used inside `interaction.sendMessage`.

## Avoid

- Do not add compatibility migrations unless explicitly requested.
- Do not store AI/runtime state only in component refs when it must survive navigation.
- Do not reintroduce events/archives as platform-owned required memory tables.
