# State Management

The app uses Vue local state, Dexie persistence, and explicit bridge/platform-host APIs. There is no Pinia, Vuex, or global store library.

## Vue State

- Use `ref`, `computed`, and `watch` for view-local state.
- Keep async status visible in local refs such as `feedback`, `settingsError`, or loading flags.
- Route views should refresh from platform/storage APIs after mutations instead of assuming local optimistic state is authoritative.

## Cross-View Refresh Via Entity Event Bus

Desktop windows are not keep-alive: closing a window unmounts its component, reopening re-mounts and re-runs `onMounted`. While a window stays open it never auto-refreshes unless it subscribes to an event. The app has no global store, so cross-view synchronization uses a `window.dispatchEvent` + `CustomEvent` pub/sub pattern, not shared reactive state.

Two event modules, both payload-less (subscribers respond by re-reading their own data via platform/storage APIs — a payload would only introduce "detail doesn't match my context" false-negatives):

- `lib/workspace-events.ts` — `WORKSPACE_CONTENT_CHANGED_EVENT` `{ cardId, path }`. Emitted by editor save / explorer mutations; `WorkspaceExplorerView` subscribes and filters by `cardId` (Explorer is single-card-context, so it ignores other cards' events).
- `lib/platform-events.ts` — `GAME_CARDS_CHANGED_EVENT` / `ACTIVE_CARD_CHANGED_EVENT` / `SAVES_CHANGED_EVENT`. Emitted by `platform-host/game-cards.ts` mutation functions on the success path (never on throw). Entity-list views (`GameCardLibraryView`, `GameCardDetailView`, `StudioView`, `AssistantView`) subscribe and call their own `refresh()`/`refreshCards()`/`refreshData()`. These subscribers do **not** filter by id — they care about the global card/save list, so any change triggers a full re-read.

Conventions:

- Emit only in platform-host public mutation functions, not in storage-layer helpers. Storage helpers are pure DB ops unaware of "active" semantics; platform-host is the business-change boundary.
- Emit only after a successful mutation (before `return`, never before a `throw`). A failed operation must not trigger subscriber refreshes.
- Subscribe in `onMounted`, unsubscribe in `onBeforeUnmount`. Handler + add/removeEventListener pattern mirrors `WorkspaceExplorerView`'s `onWorkspaceContentChanged`.
- Composite calls producing multiple emits are harmless: `createDefaultPlatformGameCard` calls `copyPlatformGameCardAsLocal` (emits game-cards-changed for the pre-frontend copy) then emits again at the end (final state with frontend). Subscribers' idempotent full re-reads handle this; IndexedDB local reads are fast enough that no debounce is needed. If a future high-frequency emit scenario appears, coalesce on the subscriber side with `requestAnimationFrame` (see AssistantView streaming-UI rAF pattern), not at the emitter.
- Do not add a general-purpose EventBus class. Keep module-level emit/guard functions per `lib/workspace-events.ts` / `lib/platform-events.ts`.

## Dexie State

- Table shapes live in `storage/db.ts`.
- Prototype schema changes use a new database name, not migrations.
- Multi-table writes should use `localDb.transaction`.
- Current active tables are `meta`, `gameCards`, `gameCardContentFiles`, `gameCardFrontendFiles`, `saves`, `saveSnapshots`, `saveHistory`, `checkpoints`, `workspaceFiles`, `assistantAttachments`, and `skillConfigs`.
- **Assistant attachments (task 06-22-assistant-attachments)**: `assistantAttachments` table stores attachment Blobs keyed by `&id, sessionId, createdAt`. Attachments are per-session temp files at VFS path `temp/<sessionId>/<name>`. Image attachments (`kind: "image"`) carry `binary` + `imageMimeType` and are sent to LLMs as multimodal `ContentPart[]` (base64 image blocks). Text attachments (`kind: "text"`) have their content read and injected as message text. `saveAssistantAttachment(sessionId, file)` stores the Blob and returns an `AttachmentRef` (path + metadata, no Blob). `ConversationMessageRecord.attachments?: AttachmentRef[]` persists refs on user messages; `normalizeMessages` preserves the `attachments` field. `deleteAssistantSession` cascades `deleteAttachmentsBySession`. `cleanupOrphanAttachments` runs on App startup (7-day stale + no live session). `WorkspaceScope "temp"` (readLevel 0, editLevel 4) routes `temp/` paths; `TempVolume` (workspace-volumes.ts) wraps the table (enumerate only; write/delete throw — attachments managed via `saveAssistantAttachment` UI path). DB name bumped v8→v9; SW `DB_NAME` must mirror.
- Game cards own reusable content files such as Agents, Skills, rules, schemas, docs, assistant metadata, and optional frontend bindings. Content files are stored **per-file** in `gameCardContentFiles` (keyed `${gameCardId}::${path}`), not as an embedded array on the `gameCards` row. A single file write touches one `gameCardContentFiles` row + bumps the card's `updatedAt`; it does not rewrite the whole card. `putLocalGameCard` takes an optional `contentFiles`: `undefined` leaves the content table untouched (metadata-only write), an array does a full replace inside the transaction (import/copy/seed). Read views (`getLocalGameCard` / `listLocalGameCards` / `putLocalGameCard` / `ensureBuiltinBlankGameCard`) return `LocalGameCardView`, which extends `LocalGameCardRecord` with an optional preloaded `coverContentFile` so the sync render path `getGameCardCoverUrl` can resolve the cover without an async table query.
- Saves are playthrough slots linked to `gameCardId` / `gameCardVersion`; `workspaceFiles` stores only save runtime data mounted at `save/...` plus host-owned `.tsian/...` metadata.
- The local assistant identity and session state live in the `local-assistant-files` Dexie map (`assistant-local-files` key) as a virtual file system under `.tsian/local/assistant/`: agent identity files (agent.json/SOUL.md/AGENT.md/notes.md/skills/) are cross-session shared, while per-session agent context snapshots live at `.tsian/local/assistant/sessions/<sessionId>/context.json` (task-summary steady state, separate from the visible-messages `assistant-session:<sessionId>` Dexie key). `loadLocalAssistantFiles`/`saveLocalAssistantFiles` (merge mode) handle the map; `deleteLocalAssistantFile` removes a single entry (used by `deleteAssistantSession` to clean up the context file). The snapshot is agent-visible via `workspace_read`/`workspace_write` — see the "Assistant Cross-Turn Context Persistence" scenario in type-safety.md.
- **Assistant skill seed + merge strategy (task 06-20 子2)**: `defaultLocalAssistantFileMap()` seeds factory skills as string constants (SKILL.md + optional `scripts/*.js`) into the map. `defaultAssistantConfig()`'s `skills.enabled` is the whitelist — non-empty `enabled` short-circuits registry discovery (`registry.ts`), so every factory skill name MUST be listed there or it won't appear in the Skill Index. Factory skills: `framework-knowledge` (extended body: permission matrix + skill lifecycle + assistant vs runtime agent boundary), `agent-authoring` (pure guidance), `skill-authoring` (pure guidance), `card-content-drafting` (1 `browser_script` action `validate_workspace_layout` — read-only README existence check). `loadLocalAssistantFiles` merges: after parsing the stored map, it fills in any default keys missing from the stored copy (only fills, never overwrites user edits) and persists the merged map. This ensures new factory skills reach existing users without a manual reset. `saveLocalAssistantFiles` remains merge-only (never deletes); `deleteLocalAssistantFile`/`deleteLocalAssistantPath` handle explicit removal.
- Packaged frontend files are reusable Game Card assets stored beside game cards, not copied into save runtime data.
- Packaged frontends are served by a Service Worker (`apps/platform-web/public/tsian-game-card-frontend-sw.js`) that reads `gameCardFrontendFiles` from IndexedDB. The SW DB name **must** stay in sync with `storage/db.ts`'s `TsianLocalDb` constructor database name (currently `tsian-agent-runtime-v10`). The SW is a standalone static asset that cannot import the TS constant, so the SW file carries the same literal plus a comment pointing back to `db.ts`. Update both together whenever the database name changes; a mismatch makes every packaged frontend serve 404.
- **Skill config overrides (task 06-24-assistant-web-search)**: `skillConfigs` table stores player-saved skill config overrides keyed by `&skillPath, updatedAt` (the `skillPath` is the skill **directory**, e.g. `skills/web-search`, derived from the `SKILL.md` path by stripping `/SKILL.md`). `LocalSkillConfigRecord.values` is a JSON-serialized `Record<string, string>`; `readSkillConfig`/`writeSkillConfig`/`deleteSkillConfig` (`storage/skill-config-storage.ts`) wrap the table and handle JSON (de)serialization. Overrides never enter the workspace and never travel with an exported skill package — only the `skill.config` declaration + defaults do. This mirrors AI provider apiKey preset locality (see the "Browser AI Provider Config And Secrets" scenario) and is a registered Fileification exception (see `guides/data-fileification-principle.md`). DB name bumped v9→v10; SW `DB_NAME` must mirror.
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
- `toolCallMode: "native" | "text"` is a **required** field on `BrowserAiModelConfig` (model layer, not preset or parameters) and a required field on the resolved `BrowserAiConfig`. No `auto` mode. It selects how the Agent Runtime asks the model to invoke tools: `native` uses API-native function calling (OpenAI `tools`/`tool_calls`, Gemini `functionDeclarations`/`functionCall`, Claude `tools`/`tool_use`) and provides structured text/tool-call boundaries; `text` uses the legacy `<tsian-tool-call>` text-embedding protocol and is the conservative default. Prototype-period destructive update: `normalizeModelConfig` drops a model missing/invalid `toolCallMode` (no migration fallback); `validateBrowserPlatformConfigDraft` throws on an invalid value; `createBrowserAiModelConfig` defaults new models to `text`. `resolveProviderConfig` threads the primary model's `toolCallMode` into `BrowserAiConfig`; the env fallback config defaults to `text`.
- `streaming: boolean` is a field on `BrowserAiModelConfig` (model layer) and the resolved `BrowserAiConfig`. It controls whether the native model-call path uses SSE streaming (`streamAssistantReplyNative`) or the one-shot JSON path (`generateAssistantReplyNative`). Streaming is **native-mode only**: `toolCallMode === "text"` always forces `streaming: false` (the `normalizeStreaming` helper and `validateBrowserPlatformConfigDraft` both enforce this; the UI switch is disabled under text). Defaulting: missing/invalid `streaming` on stored data is defaulted from `toolCallMode` at read time (native → true, text → false) rather than dropping the model — unlike `toolCallMode`, `streaming` has a safe default. New models inherit the same default via `createBrowserAiModelConfig`. The `callModelNative` closure streams only when `options.onDelta` is set (entry agent, not delegated) **and** the resolved config's `streaming` is true; otherwise it takes the non-streaming path. This lets a player opt out of streaming for endpoints that answer `200 + text/event-stream` with an error body instead of a real SSE stream.
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
- Stored model config missing/invalid `toolCallMode` -> `normalizeModelConfig` drops the model (prototype-period destructive update; the user must reconfigure it). A preset left with zero models after this drop is caught by the existing "at least one model" validation.
- `toolCallMode` value other than `native`/`text` at save time -> `validateBrowserPlatformConfigDraft` throws "工具调用模式必须是「原生」或「文本」".
- `streaming === true` while `toolCallMode === "text"` at save time -> `validateBrowserPlatformConfigDraft` throws "文本工具调用模式不支持流式输出，请先切换为原生模式。".
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
- Streaming text deltas flow through `src/streaming-events.ts` (`emitTurnDelta`/`subscribeTurnDelta`), a `Set`-based pub/sub mirroring `debug-events.ts`. It is an internal module: do not reuse it as a general event bus. The AIRP turn wires `runAgentRuntimeTurn` `onDelta` to `emitTurnDelta(delta, nextTurn, round)`; `remote-iframe-bridge.ts` subscribes and forwards each delta as a `turn-delta` bridge event `{ delta, turn, round }`. The desktop Assistant chat path does not emit `turn-delta` (it is in-process, not bridged) — it threads `onDelta` directly into the view. Platform only provides the channel; how the play frontend renders (typewriter, folding, thought/final split) is the game frontend's responsibility.
- Tool process events (`turn-round-end` + `turn-tool`, task `06-19-ai-agent-process-visible`) extend the same `streaming-events.ts` pub/sub with `emitTurnRoundEnd`/`subscribeTurnRoundEnd` and `emitTurnTool`/`subscribeTurnTool`, reusing the Set/shallow-clone/swallow-exception pattern. `turn-round-end` `{ turn, round, kind: "thought" | "final" }` fires after every `callModelNative` round so the play frontend can classify the round's `turn-delta` text (thought = `tool_calls` finish, final = `stop` finish). `turn-tool` `{ turn, round, callId, name, status, output? }` fires before/after each workspace tool executes (`loading` → `success`/`failed`; `running` is not emitted — workspace tools are in-memory fast). `output` is truncated at 500 chars. Both events are **native-mode only**: text-protocol turns and delegated `agent_call` targets do not emit them (the text path's `executeRuntimeWorkspaceToolCalls` context omits `onTool`; delegated agent options omit `onRoundEnd`/`onTool`). The AIRP turn binds `nextTurn` at the platform-host layer (`onRoundEnd: (round, fr) => emitTurnRoundEnd(nextTurn, round, finishReasonToKind(fr))`); the desktop Assistant chat path threads `onTool` straight into the view (stripping `round`) and does not bind a turn (not bridged).
- `executeRuntimeWorkspaceToolCalls` (`workspace-tools.ts`) splits a tool-loop round into three groups to cut multi-file query latency while keeping stateful writes ordered. Tool names are short primitives (`read`/`list`/`search`/`glob`/`diff`/`write`/`move`/`delete` + `use_skill`/`run_script`/`agent_call`); the legacy `workspace.<op>` prefix was removed in task `06-19-tool-rename-and-glob` (the `browser_script` SDK RPC wire protocol in `browser-skill-script-executor.ts` still uses `workspace.<op>` strings and is a separate path). Parallel group (scheme A, by top-level tool name): `use_skill`, `read`/`list`/`search`/`glob`/`diff` (read-only, stateless; `glob` added by the same task). `agent_call` group: `agent_call` targets run concurrently via a dedicated `agentCallGroup` (task `06-20-agent-call-concurrency`); each target is a delegated tool loop, but multiple `agent_call`s in the same round are independent. Serial group: `write`/`move`/`delete`, `run_script` (side effects + bounded timeout), and unparseable calls. `patch`/`validate` tools were removed (the underlying operations are retained for the editor save flow and the SDK); observations are collected in a `Map<index, observation>` and returned in original call order — the invariant `observations[i]` corresponds to `calls[i]` is preserved so the native loop can pair each with `result.toolCalls[index].id`. Parallelism is a tool-execution-layer optimization orthogonal to streaming: text-protocol turns also benefit. On abort, `Promise.all` rejects fast; already-resolved observations are kept in the map but the turn's outer catch path handles termination (partial observations are not threaded back).
- Desktop Assistant streaming UI (`AssistantView.vue`): push an empty reactive assistant placeholder before `await runAssistantChat`, append deltas into it, and reconcile with `result.replyText` after. Deltas are buffered in a queue and released on `requestAnimationFrame` (typewriter throttling) so a token burst does not thrash the renderer. Auto-scroll during streaming uses `maybeScrollToBottom`, which only scrolls when `userPinnedToBottom` is true (user within ~80px of the bottom); a user scrolling up freezes auto-scroll and surfaces the existing jump-to-bottom affordance — never yank the view. A "stop generating" button aborts the turn's `AbortController` (threaded as `AssistantChatInput.signal` into `runAssistantChat`, which merges it into the turn controller); on abort, keep the partial text and append a `（已停止）` marker, or drop the placeholder if nothing streamed. `persistCurrentSession` still runs only after the await resolves — never persist half-streamed text mid-flight. Tool process lines (`toolLines`, native-mode only) render transient "🔧 name 执行中…/✓/✗ output" status rows during the turn and are cleared in `finally` — they are not persisted; only the final reply survives.

## Avoid

- Do not add compatibility migrations unless explicitly requested.
- Do not store AI/runtime state only in component refs when it must survive navigation.
- Do not reintroduce events/archives as platform-owned required memory tables.

## Scenario: Frontend Package Import/Export

### 1. Scope / Trigger

- Trigger: platform-web changes standalone frontend package (`.tsian-frontend.zip`) import/export, the `tsian.frontend-package.v1` manifest shape, packaged frontend file path conventions, `inferMediaType` media-type mapping, or the frontend tab UI in `GameCardDetailView.vue`.

### 2. Signatures

- `FRONTEND_PACKAGE_SCHEMA = "tsian.frontend-package.v1"` and `FrontendPackageManifest` / `FrontendPackageFileEntry` in `packages/contracts/src/game-card.ts`.
- `importGameCardFrontendPackage(cardId, input): Promise<LocalGameCardRecord>` in `storage/game-card-packages.ts`.
- `exportGameCardFrontendPackage(cardId): Promise<Blob>` in `storage/game-card-packages.ts`.
- `importPlatformGameCardFrontendPackage(cardId, input)` / `exportPlatformGameCardFrontendPackage(cardId)` in `platform-host/index.ts`.
- `assertSafeRelativePath(path)` (frontend-package paths do not carry `workspace/`/`frontend/`/`cover/` prefixes, so it must not reuse `assertAllowedPackagePath`).
- `inferMediaType(path)` extended with audio/video/avif mappings.

### 3. Contracts

- A frontend package is a focused, frontend-only distribution unit (`.tsian-frontend.zip`), distinct from the whole-card `.tsian-card.zip`. Whole-card import (`importGameCardPackage`) is unchanged and still brings frontends in; the frontend package only replaces the frontend portion of an already-existing card.
- Package structure: root `frontend.json` manifest (schema `tsian.frontend-package.v1`) with `entry`, `bridgeVersion: "tsian.play-bridge.v1"`, and `files: [{ path, mediaType, size }]`; build-output files placed at their manifest `path`.
- **Manifest `path` values do NOT carry the `frontend/` prefix.** The package mirrors the build output's original structure (`index.html`, `assets/app.js`). The platform adds the `frontend/` prefix in exactly one place — when writing into `gameCardFrontendFiles` — so stored paths align with the existing whole-card convention (`frontend/index.html`) and the SW route key `${gameCardId}::frontend/index.html`.
- On import the manifest `entry` is stored on `manifest.frontend.entry` **with** the `frontend/` prefix added (e.g. manifest `index.html` -> stored `frontend/index.html`), matching how whole-card import lands it and how the SW resolves the entry.
- Import is an **atomic whole-replacement**: the card's existing `gameCardFrontendFiles` are deleted in the same `putLocalGameCard` transaction, then the new package's files are written. There is no incremental add/edit of individual frontend files in this scope.
- `manifest.frontend` after import is `{ kind: "packaged", entry: "frontend/" + manifest.entry, bridgeVersion }`.
- `mediaType` resolution on import: manifest `files[i].mediaType` wins; blank/missing falls back to `inferMediaType(path)`; final fallback `application/octet-stream`. Export reuses the stored `mediaType` verbatim.
- Export strips the `frontend/` prefix from stored paths when building the manifest and zip entries, and strips it from `manifest.frontend.entry` for the manifest `entry`.
- Built-in cards (`source === "builtin"`) reject import/export/clear with "请先另存为本地副本"; the UI also `:disabled` those three buttons for built-in cards.
- Clearing a packaged binding (`updatePlatformGameCardFrontend(cardId, null)`) must delete all of the card's `gameCardFrontendFiles` and clear `manifest.frontend`, not just the manifest binding.
- `putLocalGameCard` `frontendFiles` semantics: `undefined`/omitted = keep existing frontend files; `[]` = delete all of the card's frontend files inside the write transaction. Clear passes `[]`.
- The SW DB name in `public/tsian-game-card-frontend-sw.js` must equal `storage/db.ts`'s DB name (see Dexie State above).

### 4. Validation & Error Matrix

- Package missing `frontend.json` -> `FRONTEND_PACKAGE_MANIFEST_MISSING` ("Frontend package is missing frontend.json."); existing frontend untouched.
- `frontend.json` schema not `tsian.frontend-package.v1` -> `FRONTEND_PACKAGE_SCHEMA_UNSUPPORTED` ("Unsupported frontend package schema: <value>").
- Manifest `entry` not present in `files` -> `FRONTEND_PACKAGE_ENTRY_MISSING` ("Frontend package entry is not in file list: <entry>").
- Manifest `files` and actual zip entries disagree (either direction) -> `FRONTEND_PACKAGE_FILE_MISMATCH`.
- A file path is unsafe (`..`, absolute, NUL) -> `FRONTEND_PACKAGE_PATH_INVALID`.
- Export of a card with no frontend files -> `FRONTEND_EXPORT_NO_FILES`.
- Export of a card whose `manifest.frontend` is not packaged -> `FRONTEND_EXPORT_NOT_PACKAGED`.
- Import/export/clear on a built-in card -> rejected before any storage mutation.
- A failed import must never partially overwrite the existing frontend (validation runs before the `putLocalGameCard` transaction).

### 5. Good/Base/Bad Cases

- Good: upload a `.tsian-frontend.zip` with `frontend.json` + `index.html` + `assets/logo.png`; file list shows `frontend/index.html` and `frontend/assets/logo.png`, entry shows `frontend/index.html`, play window loads both via the SW.
- Good: upload a package containing `.mp3`/`.mp4`; stored mediaType is `audio/mpeg`/`video/mp4` and the SW serves those Content-Types so `<audio>`/`<video>` can decode.
- Good: export a card's frontend to `.tsian-frontend.zip`, then import that zip into another local card; the second card shows the same files, entry, and play behavior.
- Good: uploading a new package onto a card that already had a frontend removes the old files entirely (no stale leftovers).
- Good: clearing a packaged frontend leaves `gameCardFrontendFiles` empty for that card and `manifest.frontend` unset.
- Base: a fresh local card (e.g. duplicated from the built-in blank) has no packaged frontend; upload is enabled, export/clear are disabled, file list shows the empty hint.
- Bad: the frontend package manifest stores paths with the `frontend/` prefix already applied (double-prefix after import, SW route mismatch, 404).
- Bad: import writes new files without deleting the old ones (stale leftovers, ambiguous entry).
- Bad: the SW DB name diverges from `db.ts` (every packaged frontend serve returns 404 because the SW opens an empty/old database).
- Bad: built-in card frontend buttons are clickable instead of disabled.

### 6. Tests Required

- Assert upload writes files with the `frontend/` prefix and sets `manifest.frontend.entry` to `frontend/<entry>` with `bridgeVersion: "tsian.play-bridge.v1"`.
- Assert the SW serves a packaged entry and assets with correct Content-Type and body after the DB-name fix (read via `/__tsian_game_card_frontends/<cardId>/<path>`).
- Assert uploading an audio/video package stores and serves `audio/mpeg` / `video/mp4`.
- Assert re-uploading replaces (old files gone, new files only).
- Assert export -> import round-trip reproduces the same file set, entry, and mediaTypes.
- Assert clear empties `gameCardFrontendFiles` for the card and unsets `manifest.frontend`.
- Assert each error case throws the documented error and leaves the existing frontend intact.
- Assert built-in cards reject import/export/clear and the UI disables the buttons.
- Assert `npm run build:web` passes; assert whole-card import (`importGameCardPackage`) and Remote URL mode are unaffected.

### 7. Wrong vs Correct

#### Wrong — manifest paths already carry the `frontend/` prefix

```json
{
  "schema": "tsian.frontend-package.v1",
  "entry": "frontend/index.html",
  "files": [{ "path": "frontend/index.html", "mediaType": "text/html", "size": 390 }]
}
```

#### Correct — manifest paths are the raw build output; the platform adds the prefix on landing

```json
{
  "schema": "tsian.frontend-package.v1",
  "entry": "index.html",
  "bridgeVersion": "tsian.play-bridge.v1",
  "files": [{ "path": "index.html", "mediaType": "text/html", "size": 390 }]
}
```

```typescript
// Correct — single prefix-add site on import
const frontendFiles = entries.map((e) => ({
  path: `frontend/${e.path}`,
  data: e.data,
  mediaType: e.mediaType ?? inferMediaType(e.path),
}))
await putLocalGameCard({
  id: cardId,
  manifest: { ...card.manifest, frontend: { kind: "packaged", entry: `frontend/${manifest.entry}`, bridgeVersion: manifest.bridgeVersion } },
  // contentFiles undefined = leave the per-file content table untouched (frontend-package-only write)
  frontendFiles,
})
```

```typescript
// Wrong — import writes new files without clearing old ones first
await localDb.gameCardFrontendFiles.bulkPut(newFiles) // leaves stale old files
```

```javascript
// Wrong — SW hardcodes a DB name that drifts from db.ts
const DB_NAME = "tsian-agent-runtime-v6" // db.ts already moved to v7 -> every serve 404s
```

## Scenario: Default Template Card Creation Route

### 1. Scope / Trigger

- Trigger: platform-web adds a "create game card from template" entry point, treats the builtin blank card as a reusable template, or binds a packaged frontend to a freshly created local card.

### 2. Signatures

- `createDefaultPlatformGameCard(input?: { name?: string; summary?: string }): Promise<LocalGameCardRecord>` — three-step compose: (1) `copyPlatformGameCardAsLocal(BUILTIN_BLANK_GAME_CARD_ID, {...})` to clone the builtin template content into a new local card (new id, no frontend files since builtin has none), (2) re-read the copy's content rows from `gameCardContentFiles` via `listLocalGameCardContentFiles(copy.id)` and `putLocalGameCard({ manifest: {...copy.manifest, frontend: DEFAULT_FRONTEND_BINDING}, contentFiles: copyContentFiles, frontendFiles: defaultFrontendFiles(), source: "local" })` to inject the 3 default packaged frontend files + binding while preserving the copied content (full-replace branch), (3) `setPlatformActiveGameCard(record.id)` to load it.
- `DEFAULT_FRONTEND_BINDING` and `defaultFrontendFiles()` live in `storage/default-frontend-files.ts` — a packaged binding (`{ kind: "packaged", entry: "frontend/index.html", bridgeVersion: "tsian.play-bridge.v1" }`) plus 3 static frontend files (`index.html` / `style.css` / `app.js`) authored as string constants (no build pipeline; the SW serves them raw from `gameCardFrontendFiles`).

### 3. Invariants

- The builtin blank card (`source: "builtin"`) is an **invisible internal template** (task 06-21 子3 Phase A): it stays in DB as the copy source for `createDefaultPlatformGameCard` / `createDefaultEditableCard`, but is never shown to users and never used as the active card fallback. `ensureActiveGameCardId` prefers a save-bound non-builtin card → then any existing local card → and only auto-creates a fresh editable default card (`createDefaultEditableCard`) when no local card exists at all (idempotent: checks for existing local cards before creating). `ensureActiveSave` binds new saves to the active local card via `createLocalSaveFromGameCard` (never builtin). `deletePlatformGameCard` fallback picks a remaining local card or auto-creates one. `getPlatformActiveGameCard` stale-save fallback returns `null` (not builtin). `GameCardLibraryView` filters `source === "builtin"` from the card list. Builtin cards still cannot be deleted or directly mutated (GUARD references preserved).
- Creation reuses existing storage primitives (`copyPlatformGameCardAsLocal` + `putLocalGameCard` + `setPlatformActiveGameCard`); no new storage layer, no `platform.runAction` extension. Platform-level create-card actions are explicitly out of scope for this route.
- `copyPlatformGameCardAsLocal` copies content + existing frontend files + a unique id. Because the builtin template has no frontend files, step (2) is needed to attach them to the copy via a same-id `putLocalGameCard` upsert.
- Frontend files use relative references (`href="style.css"`, `src="app.js"`) which resolve under the SW virtual prefix `/__tsian_game_card_frontends/<cardId>/frontend/...`; no HTML rewriting by the SW.

### 4. Common Pitfalls

```typescript
// Wrong — trying to attach a frontend directly to the builtin card
await putLocalGameCard({ manifest: {...builtin.manifest, frontend}, contentFiles, frontendFiles, source: "builtin" })
// The builtin card is an invisible template (task 06-21 子3 Phase A); it is never
// the active card and never shown in the library. UI guards block frontend
// replacement on builtin. Always create a local copy first, then attach the
// frontend to the copy.
```

```typescript
// Wrong — skipping setPlatformActiveGameCard leaves the new card created but not loaded
const record = await putLocalGameCard({...}) // created but not active
// /play will still use the previously active card. Always load the new card after creation.
```

## Scenario: Workspace Volume Abstraction And Single Dispatch

### 1. Scope / Trigger

- Trigger: platform-web changes host-layer workspace mutation routing, adds/removes a storage backend volume, touches `platform-host/workspace-volumes.ts`, or changes the 3 entry points (`executeWorkspaceOperationForActiveSave` / `executeStudioWorkspaceOperation` / `executeLocalWorkspaceOperation`).
- Applies when adding a new `WorkspaceScope`, a new `WorkspaceVolume` implementation, or changing how a workspace mutation reaches its storage backend.

### 2. Signatures

- `WorkspaceVolume` interface (`platform-host/workspace-volumes.ts`): `{ scope, enumerate(ownerId), write(ownerId, {path, content?, data?}), delete(ownerId, pathPrefix) }` — 3 primitives; runtime computes the other 7 ops (list/glob/search/diff/validate/read/move/patch) from the enumerate snapshot.
- `WorkspaceVolumeWriteInput`: `{ path: string; content?: string; data?: Blob }` — text + binary dual-track (06-22 model), mutually exclusive; mirrors `WorkspaceOperationMutationAdapter.write` input.
- `executeWorkspaceMutation({ scope, path, content?, data?, ownerContext, operation })`: single dispatch routing `(scope, path-prefix)` → volume → `write`/`delete`.
- `resolveVolumeForScope(scope, path, ownerContext)`: volume selector; `platform-meta` scope does two-level routing (`isLocalAssistantPath` → `localAssistantVolume`, else `savePlatformMetaVolume`).
- `WorkspaceVolumeOwnerContext`: `{ cardId?, saveId? }` — card-scope volumes need `cardId`; save-scope / save-platform-meta volumes need `saveId`; `localAssistantVolume` ignores ownerId (global meta).

### 3. Contracts

- 4 physical backends are wrapped as 6 volumes (save-scoped split into two, plus a synthesized manifest volume): `CardContentVolume` (card-content, `gameCardContentFiles` per-file table, ownerId=cardId), `CardFrontendVolume` (card-frontend, `gameCardFrontendFiles` `data: Blob` required, ownerId=cardId), `ManifestVolume` (card-content scope but routed by path `game-card.json`, synthesized from `gameCards.manifest`, ownerId=cardId), `SaveRuntimeVolume` (save-runtime, `workspaceFiles` save/ paths, ownerId=saveId), `SavePlatformMetaVolume` (platform-meta save-owned, `workspaceFiles` `.tsian/` paths, ownerId=saveId), `LocalAssistantVolume` (platform-meta local-assistant, `meta` single-row JSON, ownerId ignored).
- The 3 ad-hoc routing points' non-staged mutation branches converge into `executeWorkspaceMutation`; each scope×path combination routes through exactly one volume. No ad-hoc `if/else` by scope/path-prefix/resolved-object remains in the mutation branches.
- **staged turn (transaction) paths stay in `executeWorkspaceOperationForActiveSave` upper layer, NOT in dispatch.** The transaction is "stage changes, commit at turn end" semantics, orthogonal to "which backend". Dispatch only converges non-staged direct-storage routing. Staged paths: `save-runtime` → `transaction.write`; `platform-meta` → `writePlatformFile`; `card-content`/`card-frontend` → throw "Runtime turn staging cannot mutate card-content." The `runAssistantChat` runtime agent turn `workspaceMutations` is also a staged path (uses `activeWorkspaceTransaction`), kept as-is.
- `card-frontend` scope (task 06-21 子5): `readLevel: 0, editLevel: 2` (same as card-content; runtime agents level 1 cannot edit, assistant level 4 can). `scopeForPath` adds `frontend/` → `card-frontend`; `normalizeWorkspaceScope` accepts it; `resolveStudioWorkspacePath` resolves `frontend/` → card-frontend `StudioResolvedPath`.
- `CardFrontendVolume.enumerate` is wired into `listStudioWorkspaceFilesForGameCard` and `listEffectiveWorkspaceFilesForSave` so frontend files appear in Explorer/assistant workspace. `write`/`delete` are implemented (task 06-21 子3) via `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendPathForCard` single-file APIs (per-row put + bump card `updatedAt`, no full `putLocalGameCard` rewrite). Frontend files map to `{ path, content: binaryPlaceholderText(...), binary: r.data, createdAt, updatedAt }` for media, or `{ path, content: await data.text(), createdAt, updatedAt }` for text (html/css/js/json/svg).
- `ManifestVolume` (task 06-21 子3) is a synthesized-file volume: `enumerate(cardId)` produces `game-card.json` from `JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2)`; `write` round-trips through `writeGameCardManifestFileForCard` (parse + `normalizeGameCardManifest` + force-overwrite protected fields `id`/`schema`/`frontend.bridgeVersion` + `putLocalGameCard({manifest, contentFiles: undefined})`); `delete` throws (manifest cannot be removed while the card exists). It shares `card-content` scope (editLevel 2) but `resolveVolumeForScope` routes `path === "game-card.json"` to it before `CardContentVolume`. `normalizeTemplateFiles` rejects `game-card.json` so it cannot be stored as a content file.
- Binary payload (`data?: Blob`) transparently threads through dispatch: runtime splits `request.content: string | Blob` into `textContent`/`binaryData` → adapter → dispatch `input.data` → volume.write `{ data }` → storage API. Agents read only `content` (string); binary is opaque to agents.
- `localAssistantVolume` is global meta (cross-save persistent); `resolveOwnerId` identifies it by reference (not scope, since it shares `platform-meta` scope with `savePlatformMetaVolume`) and returns empty string ownerId.
- `savePlatformMetaVolume.delete` is best-effort (returns `[pathPrefix]`, does not truly delete DB rows) matching the pre-refactor `executeLocalWorkspaceOperation` semantics; storage layer has no platform-meta prefix-delete API yet.
- **Workspace tool `scope` is invisible to the agent (task 06-22 scope auto-inference).** `WorkspaceOperationRequest.scope` is `scope?: WorkspaceScope`. `executeWorkspaceOperation` resolves scope via `resolveOperationScope(operation, requestInput)`: explicit scope wins; read ops default to `"effective"` (union view); edit ops infer scope from the path prefix via `scopeForPath` (save/→save-runtime, temp/→temp, frontend/→card-frontend, .tsian/→platform-meta, else→card-content). The agent-facing tool schemas in `tool-schemas.ts` do **not** expose `scope` as a parameter at all — it is absent from `properties`, so native function-calling APIs never tell the model the parameter exists. Tool `description` and the text-protocol prompt (`index.ts`) never mention scope. The agent only knows paths; path prefixes (`save/`, `temp/`, `frontend/`, `.tsian/`) are the user-facing concept. Adding a new scope only touches `scopeForPath` + `DEFAULT_SCOPE_ACCESS` + the `WorkspaceVolume` + `resolveVolumeForScope` — never the tool schemas or prompt. Internal callers (SDK RPC `browser-skill-script-executor.ts`, `platform-host/index.ts`, `platform-host/workspace-ops.ts`) still pass scope explicitly because they construct `WorkspaceOperationRequest` directly, not via the LLM schema. The permission boundary is preserved because `assertEditAccess` is path-based (`accessForPath`→`scopeForPath`→`DEFAULT_SCOPE_ACCESS`), independent of whether the scope came from an explicit internal arg or auto-inference; a runtime agent (level 1) writing a card-content path still hits `editLevel: 2` and is denied.

### 4. Validation & Error Matrix

- `card-content`/`card-frontend` mutation without `cardId` in ownerContext → dispatch throws "requires a cardId".
- `save-runtime`/`save-platform-meta` mutation without `saveId` in ownerContext → dispatch throws "requires a saveId".
- `localAssistantVolume` mutation without `saveId` → allowed (ownerId ignored, global meta).
- `effective` scope mutation → dispatch throws "unsupported scope" (runtime computes effective in snapshot, never calls mutations).
- `card-frontend` write/delete → `CardFrontendVolume.write/delete` (implemented in task 06-21 子3) route to `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendPathForCard`.
- `game-card.json` write → `ManifestVolume.write` → `writeGameCardManifestFileForCard`: invalid JSON or manifest schema → throws "game-card.json 内容无效：..."; builtin card manifest → throws "内置游戏卡的 manifest 不可编辑".
- `game-card.json` delete → `ManifestVolume.delete` throws "game-card.json（卡片 manifest）不能删除".
- Staged turn mutation on `card-content`/`card-frontend` → upper layer throws "Runtime turn staging cannot mutate card-content." (preserved from pre-refactor).
- Studio `resolveStudioWorkspacePath` on `frontend/` → resolves to card-frontend scope; `storagePathToStudioPath` returns path unchanged for card-frontend (no alias rewrite).

### 5. Good/Base/Bad Cases

- Good: `ManifestVolume` for `game-card.json` (task 06-21 子3) = implemented `WorkspaceVolume` + inserted into `resolveVolumeForScope` (path `game-card.json` special-cased under `card-content` scope); no changes to the 3 routing points.
- Good: a `workspace.write` with `{ scope: "card-content", path, data: Blob }` flows dispatch → `CardContentVolume.write(cardId, { path, data })` → `writeLocalGameCardContentFile` (binary store).
- Good: a `workspace.write` with `{ scope: "card-content", path: "game-card.json", content }` flows dispatch → `ManifestVolume.write` → `writeGameCardManifestFileForCard` → `putLocalGameCard({manifest})` (manifest field updated, content table untouched).
- Good: Explorer edits a `save/` file → `executeStudioWorkspaceOperation` → dispatch → `SaveRuntimeVolume.write(saveId, ...)` → `writeWorkspaceFileForSave`.
- Good: Explorer edits `frontend/index.html` → `executeStudioWorkspaceOperation` → dispatch → `CardFrontendVolume.write` → `writeLocalGameCardFrontendFile` → SW serves new content → `/play` reflects immediately (no split-brain).
- Good: Explorer edits `game-card.json` name field → `ManifestVolume.write` → manifest updated → card detail view reflects; editing `id`/`schema`/`bridgeVersion` → force-overwritten back to original values.
- Base: a runtime agent turn stages `save-runtime` writes via `transaction.write` (upper layer, not dispatch); non-staged commit path uses dispatch.
- Bad: re-introducing ad-hoc `if (scope === "...") { ... }` branches in the 3 routing points' mutation adapters instead of calling `executeWorkspaceMutation`.
- Bad: routing a staged-turn `card-content` write through dispatch (bypasses the "staging cannot mutate card-content" guard).
- Bad: adding a new storage backend without wrapping it as a `WorkspaceVolume` + registering in `resolveVolumeForScope` (mutation can't reach it).

### 6. Tests Required

- Assert all scope×path combinations from the 3 routing points route through dispatch to the correct volume (no regression vs pre-refactor).
- Assert binary files (media) thread `data` through dispatch → storage API correctly (new dimension from 06-22).
- Assert frontend files appear in `listStudioWorkspaceFilesForGameCard` / `listEffectiveWorkspaceFilesForSave` (read-only); write/delete throw the 子3 placeholder.
- Assert staged-turn paths (runtime agent turn `workspaceMutations` + `executeWorkspaceOperationForActiveSave` staged branch) are unchanged: `save-runtime` stages to transaction, `card-content` throws.
- Assert `localAssistantVolume` mutations work without a `saveId` in ownerContext.
- Assert `npm run build:web` passes.

### 7. Wrong vs Correct

#### Wrong — re-introducing ad-hoc routing in a mutation adapter

```typescript
mutations: {
  async write(writeInput) {
    if (writeInput.scope === "card-content") {
      return writeCardContentFileForActiveCard(writeInput) // bypasses dispatch
    }
    if (writeInput.scope === "save-runtime") {
      return writeWorkspaceFileForSave(saveId, ...) // bypasses dispatch
    }
    // ... more if/else
  }
}
```

#### Correct — converge non-staged branches into dispatch

```typescript
mutations: {
  async write(writeInput) {
    if (workspaceTransaction) {
      // staged turn: keep upper-layer transaction routing, NOT dispatch
      if (writeInput.scope === "save-runtime") return workspaceTransaction.write(...)
      if (writeInput.scope === "platform-meta") return workspaceTransaction.writePlatformFile(...)
      throw new Error("Runtime turn staging cannot mutate card-content.")
    }
    // non-staged: single dispatch
    return executeWorkspaceMutation({
      scope: writeInput.scope, path: writeInput.path,
      content: writeInput.content, data: writeInput.data,
      ownerContext: { saveId, cardId },
      operation: "write",
    })
  }
}
```

#### Wrong — routing staged card-content through dispatch

```typescript
if (workspaceTransaction && writeInput.scope === "card-content") {
  return executeWorkspaceMutation(...) // dispatch would reach cardContentVolume, bypassing the staging guard
}
```

#### Correct — staged card-content throws in the upper layer

```typescript
if (workspaceTransaction) {
  if (writeInput.scope === "card-content" || writeInput.scope === "card-frontend") {
    throw new Error("Runtime turn staging cannot mutate card-content.")
  }
  // save-runtime / platform-meta stay on transaction paths
}
// non-staged reaches dispatch
```

## Scenario: Skill Config Declaration And Player Overrides

### 1. Scope / Trigger

- Trigger: platform-web parses a skill's `skill.config` file, stores player config overrides, injects `tsian.config` into a `browser_script` Worker, or renders the skill config UI in the Assistant config panel.
- Applies when changing `apps/platform-web/src/agent-runtime/registry.ts` (skill.config parsing), `apps/platform-web/src/storage/skill-config-storage.ts`, `apps/platform-web/src/storage/db.ts` (`skillConfigs` table), `apps/platform-web/src/platform-host/browser-skill-script-executor.ts` (`tsian.config` injection), `apps/platform-web/src/platform-host/local-assistant.ts` (config preload + wrapper), or the skill config UI in `AssistantConfigPanel.vue`.

### 2. Signatures

- `parseSkillConfig(source: string): SkillConfigItem[]` (`agent-runtime/registry.ts`) — pure parser; `.env`-style lines → `[{ key, description, defaultValue }]`.
- `SKILL_CONFIG_FILE_PATH_PATTERN` (`agent-runtime/registry.ts`) — matches `skills/<id>/skill.config`, `agents/<agent>/skills/<id>/skill.config`, `.tsian/local/<agent>/skills/<id>/skill.config`.
- `SkillConfigItem` (`@tsian/contracts`): `{ key: string; description: string; defaultValue: string }`.
- `SkillRegistryEntry.configItems?: SkillConfigItem[]` (`@tsian/contracts`) — populated by `buildSkillRegistry` from a sibling `skill.config` file; absent when the skill declares no config.
- `LocalSkillConfigRecord` (`storage/db.ts`): `{ skillPath: string; values: string; updatedAt: number }` — `values` is `JSON.stringify(Record<string, string>)`.
- `readSkillConfig(skillFilePath: string): Promise<Record<string, string>>` / `writeSkillConfig(skillFilePath, values)` / `deleteSkillConfig(skillFilePath)` (`storage/skill-config-storage.ts`) — keyed by skill **directory** (derived from the `SKILL.md` path by stripping `/SKILL.md`).
- `RuntimeBrowserScriptExecutorRequest.configItems?: SkillConfigItem[]` (`agent-runtime/workspace-tools.ts`) — carries declared defaults from `SkillRegistryEntry` to the executor.
- `updateLocalAssistantSkillConfig(skillPath, values)` (`platform-host/local-assistant.ts`) — thin wrapper over `writeSkillConfig` for the Assistant config panel.
- `tsian.config` (Worker SDK, `browser-skill-script-executor.ts`) — `Object.freeze`'d flat object injected into the `browser_script` Worker; scripts read `config.API_KEY` etc.

### 3. Contracts

- A skill declares config by placing a `skill.config` file in its directory beside `SKILL.md`. The file is a workspace file (card-content scope): resource-manager-visible, player-editable, agent `workspace.read/write`-able, and exported with the skill package.
- `skill.config` format is `.env`-style: `#`-prefixed lines describe the *next* key; `KEY=VALUE` declares an item (VALUE always a string); blank lines clear the pending comment; other lines are ignored.
- The player overrides defaults through the Assistant config panel UI. Overrides are stored in the `skillConfigs` Dexie table keyed by skill directory, **never** in the workspace — so secrets (API keys) stay local and are never exported with a skill package. This is a registered Fileification exception (player secret overrides mirror AI provider apiKey preset locality).
- Runtime merge: `tsian.config = Object.freeze({ ...defaults, ...playerOverrides })`. Player overrides win over `skill.config` defaults. A key the player left unset uses the default. A stale saved value for a removed config key is dropped at merge time (only keys the skill currently declares survive).
- `tsian.config` is injected via the Worker `execute` message `{ type: "execute", source, input, config }`. The `config` field is optional; a skill without `configItems` yields `tsian.config = {}` (frozen empty object), so `config.API_KEY` returns `undefined` and the script handles the missing key.
- Config declarations do **not** enter agent context: `skill.config` is not injected alongside `SKILL.md`. The agent learns a skill needs config only when a `run_script` fails with a clear missing-config error (the "first error then configure" flow is intended).
- The `skill.config` file is parsed at registry build time (`buildSkillRegistry` first pass builds `directoryPath → configItems`, second pass attaches to each `SkillRegistryEntry`). `loadSkillDetail` resolves the sibling `skill.config` for a single skill path.
- DB schema: `skillConfigs: "&skillPath, updatedAt"`. DB name bumped v9→v10 (prototype destructive upgrade; old v9 store abandoned, no migration). The SW `DB_NAME` must mirror.

### 4. Validation & Error Matrix

- `skill.config` absent → skill loads normally, `configItems` undefined, UI shows no config section, `tsian.config` is `{}`.
- `skill.config` present but empty/whitespace-only → `configItems` is `[]`, no config section rendered, `tsian.config` is `{}`.
- `skill.config` with a malformed line (no `=`) → line ignored, other items parsed; registry build does not throw.
- `#` comment with no following key line → pending description discarded on the next blank/non-key line; no item produced.
- Corrupt stored JSON in `skillConfigs.values` → `readSkillConfig` degrades to `{}` (defaults apply); no throw.
- Player saved an override for a key the skill later removed → merge drops it (only declared keys survive); no stale value leaks into `tsian.config`.
- Worker `message.config` missing or non-object → `tsian.config = {}` (defensive `isRecord` guard in Worker source).

### 5. Good/Base/Bad Cases

- Good: a `web-search` skill declares `TAVILY_API_KEY=` + `MAX_RESULTS=5` in `skill.config`; the player fills `TAVILY_API_KEY` in the config panel; the skill script reads `config.TAVILY_API_KEY` (player value) and `config.MAX_RESULTS` (`"5"` default) on the next `run_script`.
- Good: a key named `TAVILY_API_KEY` renders a password-type input (auto-detected from the KEY substring), masking the secret in the UI.
- Good: the player edits `skill.config` directly in the resource manager to change `MAX_RESULTS` default to `10`; the registry re-parses on next load and the UI shows the new default.
- Base: a skill with no `skill.config` → no config section, `tsian.config = {}`, behavior unchanged.
- Base: the player has not overridden `MAX_RESULTS` → the script reads the declared default `"5"`.
- Bad: storing the player's `TAVILY_API_KEY` override in `skill.config` (workspace file) — it would be exported with the skill package and leak the secret.
- Bad: injecting the full `skill.config` source into agent context alongside `SKILL.md` — config noise pollutes every turn.
- Bad: merging a stale saved override for a key the skill no longer declares into `tsian.config`.

### 6. Tests Required

- Assert `parseSkillConfig` parses `#` comments as descriptions of the next key, `KEY=VALUE` as items, blank lines as description reset, and ignores non-key lines.
- Assert `buildSkillRegistry` attaches `configItems` from a sibling `skill.config` and leaves it absent when no `skill.config` exists.
- Assert `skill.config` is visible in the resource manager and agent `workspace.read/write`-able (it is a normal card-content workspace file).
- Assert `readSkillConfig` returns `{}` for a skill with no saved overrides and degrades to `{}` on corrupt stored JSON.
- Assert `writeSkillConfig` then `readSkillConfig` round-trips values; `deleteSkillConfig` clears them.
- Assert `tsian.config` in the Worker equals `{ ...defaults, ...playerOverrides }`, player values winning over defaults.
- Assert a skill without `configItems` produces `tsian.config = {}` and `config.ANY_KEY` is `undefined`.
- Assert a stale saved override for a removed config key is dropped at merge time.
- Assert a `skill.config` file is included in an exported skill package (declaration + defaults), but `skillConfigs` table records are NOT included.
- Assert `npm run build:contracts && npm run build:web` passes.

### 7. Wrong vs Correct

#### Wrong — storing player overrides in the workspace file

```typescript
// skill.config (workspace file) — leaked on export
TAVILY_API_KEY=sk-player-secret
```

#### Correct — defaults in `skill.config`, overrides in Dexie

```typescript
// skill.config (workspace, exported) — declaration + default only
# Tavily API key, register at https://tavily.com
TAVILY_API_KEY=

// player override (Dexie skillConfigs table, local only)
await writeSkillConfig("skills/web-search/SKILL.md", { TAVILY_API_KEY: "sk-player-secret" })
```

#### Wrong — injecting skill.config into agent context

```typescript
// registry injects skill.config content next to SKILL.md — config noise every turn
contextFiles: [skillMdFile, skillConfigFile]
```

#### Correct — config stays out of agent context; script reads tsian.config

```typescript
// Worker source — config is a frozen flat object, not a context file
const tsian = Object.freeze({
  ...,
  config: Object.freeze(isRecord(message.config) ? message.config : {})
})
// script: if (!config.TAVILY_API_KEY) throw new Error("请先配置 Tavily API key")
```

#### Wrong — merging stale overrides for removed keys

```typescript
const merged = { ...playerValues } // includes keys the skill no longer declares
```

#### Correct — only declared keys survive the merge

```typescript
function mergeSkillConfig(configItems, playerValues) {
  const merged = {}
  for (const item of configItems) merged[item.key] = item.defaultValue
  for (const [key, value] of Object.entries(playerValues)) {
    if (key in merged) merged[key] = value // stale keys dropped
  }
  return merged
}
```
