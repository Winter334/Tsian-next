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
- The local assistant identity and session state live in the `local-assistant-files` Dexie map (`assistant-local-files` key) as a virtual file system under `.tsian/local/assistant/`: agent identity files (agent.json/SOUL.md/AGENT.md/notes.md/skills/) are cross-session shared, while per-session agent context snapshots live at `.tsian/local/assistant/sessions/<sessionId>/context.json` (task-summary steady state, separate from the visible-messages `assistant-session:<sessionId>` Dexie key). `loadLocalAssistantFiles`/`saveLocalAssistantFiles` (merge mode) handle the map; `deleteLocalAssistantFile` removes a single entry (used by `deleteAssistantSession` to clean up the context file). The snapshot is agent-visible via `workspace_read`/`workspace_write` — see the "Assistant Cross-Turn Context Persistence" scenario in type-safety.md.
- Packaged frontend files are reusable Game Card assets stored beside game cards, not copied into save runtime data.
- Packaged frontends are served by a Service Worker (`apps/platform-web/public/tsian-game-card-frontend-sw.js`) that reads `gameCardFrontendFiles` from IndexedDB. The SW DB name **must** stay in sync with `storage/db.ts`'s `TsianLocalDb` constructor database name (currently `tsian-agent-runtime-v6`). The SW is a standalone static asset that cannot import the TS constant, so the SW file carries the same literal plus a comment pointing back to `db.ts`. Update both together whenever the database name changes; a mismatch makes every packaged frontend serve 404.
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
- `executeRuntimeWorkspaceToolCalls` (`workspace-tools.ts`) runs read-only tools in parallel within a single tool-loop round and stateful/write tools serially, to cut multi-file query latency. Parallel group (scheme A, by top-level tool name): `skill_load`, `workspace.read`/`list`/`search`/`diff`/`validate`. Serial group: `agent_call` (shared callCount/depth budget), `action_call` (kept serial as a whole — resolving its executor type needs a skill load, and its builtin cases are millisecond-fast), `workspace.patch`/`write`/`move`/`delete`. `action_call` is **not** split by executor subtype. Observations are collected in a `Map<index, observation>` and returned in original call order — the invariant `observations[i]` corresponds to `calls[i]` is preserved so the native loop can pair each with `result.toolCalls[index].id`. Parallelism is a tool-execution-layer optimization orthogonal to streaming: text-protocol turns also benefit. On abort, `Promise.all` rejects fast; already-resolved observations are kept in the map but the turn's outer catch path handles termination (partial observations are not threaded back).
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
  contentFiles: card.contentFiles,
  frontendFiles,
})
```

```typescript
// Wrong — import writes new files without clearing old ones first
await localDb.gameCardFrontendFiles.bulkPut(newFiles) // leaves stale old files
```

```javascript
// Wrong — SW hardcodes a DB name that drifts from db.ts
const DB_NAME = "tsian-agent-runtime-v5" // db.ts already moved to v6 -> every serve 404s
```
