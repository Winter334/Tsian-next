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
- Current active tables are `meta`, `gameCards`, `gameCardContentFiles`, `gameCardFrontendFiles`, `saves`, `checkpoints`, `workspaceFiles`, `assistantAttachments`, `skillConfigs`, and `embeddingIndex`.
- **Assistant attachments**: `assistantAttachments` table stores attachment Blobs keyed by id/sessionId/createdAt. Attachments are per-session temp files at VFS path `temp/<sessionId>/<name>`. Image attachments carry `binary` + mime type and are sent to LLMs as multimodal content parts (base64 image blocks). Text attachments have their content read and injected as message text. Storing returns an `AttachmentRef` (path + metadata, no Blob); refs persist on user messages. Session delete cascades attachment cleanup; orphan cleanup runs on App startup (7-day stale + no live session). `WorkspaceScope "temp"` (readLevel 0, editLevel 4) routes `temp/` paths; the temp volume wraps the table with full enumerate/write/delete support — agents manage temp files via `workspace_write`/`workspace_delete`, and the assistant-chat mutations adapter syncs write/delete results back into the runtime staged snapshot so same-turn read/edit sees the changes (temp bypasses the save transaction, which would otherwise leave stagedFiles stale).
- Game cards own reusable content files (Agents, Skills, rules, schemas, docs, assistant metadata, optional frontend bindings). Content files are stored **per-file** (keyed `${gameCardId}::${path}`), not as an embedded array on the card row. A single file write touches one row + bumps the card's `updatedAt`; it does not rewrite the whole card. A metadata-only write leaves the content table untouched; an array write does a full replace inside the transaction (import/copy/seed). Read views return a view that extends the record with an optional preloaded `coverContentFile` so the sync render path can resolve the cover without an async table query.
- Saves are playthrough slots linked to `gameCardId` / `gameCardVersion`; `workspaceFiles` stores only save runtime data mounted at `save/...` plus host-owned `.tsian/...` metadata.
- The local assistant identity and session state live in the `local-assistant-files` Dexie map as a virtual file system under `.tsian/local/assistant/`: agent identity files are cross-session shared, while per-session agent context snapshots live at `.tsian/local/assistant/sessions/<sessionId>/context.json` (task-summary steady state, separate from the visible-messages Dexie key). The map is merge-only on save (never deletes); single-entry removal handles explicit cleanup. The snapshot is agent-visible via `workspace_read`/`workspace_write` — see the "Assistant Cross-Turn Context Persistence" scenario in type-safety.md.
- **Assistant skill seed + merge strategy**: factory skills are seeded as string constants (SKILL.md + optional scripts) into the map. The assistant config's `skills.enabled` is the whitelist — non-empty `enabled` short-circuits registry discovery, so every factory Skill path (`.tsian/local/assistant/skills/<id>/SKILL.md`) MUST be listed there or it won't appear in the Skill Index. On load, missing default keys are filled in (only fills, never overwrites user edits) and the merged map is persisted. This ensures new factory skills reach existing users without a manual reset. **Manual knowledge refresh exception**: the Assistant config panel may expose an explicit user-triggered "更新助手知识" action that overwrites only official `.tsian/local/assistant/skills/framework-knowledge/**` files and removes known obsolete official reference files. That action must not modify `.tsian/local/assistant/AGENT.md`, `SOUL.md`, `notes.md`, `agent.json`, model/permission config, user custom Tool/Skill files, or current Game Card `docs/`. **Exception: user-installed assistant replacement packages may intentionally replace the assistant definition and `skills/` directory.** That flow must call a replace helper that sets a persisted skip-factory-skill-merge marker; after that, `loadLocalAssistantFiles()` may still fill non-skill base defaults such as `notes.md`, but must not silently re-add factory `skills/**` after the replacement, or it would violate the user's selected package contents. Regular `saveLocalAssistantFiles()` remains merge-only and must not delete paths.
- Packaged frontend files are reusable Game Card assets stored beside game cards, not copied into save runtime data. They are served by a Service Worker that reads from IndexedDB. The SW DB name **must** stay in sync with `db.ts`'s database name — the SW is a standalone static asset that cannot import the TS constant, so it carries the same literal plus a comment pointing back to `db.ts`. Update both together; a mismatch makes every packaged frontend serve 404.
- **Skill config overrides**: `skillConfigs` table stores player-saved skill config overrides keyed by skill directory + updatedAt. Overrides never enter the workspace and never travel with an exported skill package — only the `skill.config` declaration + defaults do. This mirrors AI provider apiKey preset locality and is a registered Fileification exception (see `guides/data-fileification-principle.md`).
- Built-in game cards may be refreshed by platform seed helpers when their source is `builtin` and their content/manifest is stale. This refresh updates reusable card content; existing saves see the updated content through the effective workspace layer.
- Checkpoints store turn number and save runtime files. They do not snapshot card-owned content.

## Runtime State

- `platform-host/index.ts` owns assembling the effective workspace from card content plus save runtime data, running Agent Runtime turns, persisting successful turns, checkpoint creation, and rollback on failure. Turn number is derived from turn files (`getMaxTurnFromTurnFiles`); there is no in-memory snapshot state.
- `interaction.sendMessage` should not persist partial user/assistant messages when the Agent Runtime turn fails.

## Scenario: Browser AI Provider Config And Secrets

### 1. Scope / Trigger

- Trigger: platform-web changes browser AI provider configuration, provider/model parameter schema, env fallback behavior, model fetching, Agent Runtime model-call config resolution, Settings model-test UI, Game Card package import/export, or bridge/query payloads that might expose platform secrets.

### 2. Signatures

- `BrowserAiProviderType.kind` is the source of truth for protocol mapping: `"openai-compatible" | "openai-responses" | "gemini" | "claude" | "deepseek"`.
- `BrowserAiModelParameters` is nested: `common: { contextWindow, maxOutputTokens, temperature, topP }` plus `provider: { openaiCompatible?, openaiResponses?, deepseek?, gemini?, claude? }`.
- Provider branches carry protocol knobs and branch-local `customRequestParamsText`: OpenAI/DeepSeek penalties + reasoning, Responses reasoning, Gemini generation/thinking/schema fields, Claude service tier + extended-thinking fields.
- `resolveBrowserAiConfigFromProviderPreset(provider, kind, modelId?)` builds a runtime config from an in-memory Settings draft for model ping.
- `normalizeBrowserAiProviderBaseUrl(input)` performs minimal provider-agnostic URL cleanup for chat providers: trim, add `https://` when no scheme is present, remove trailing slashes, and strip obvious endpoint suffixes (`/models`, `/chat/completions`, `/responses`, `/messages`, `/embeddings`).
- `fetchBrowserAiProviderModels({ baseUrl, apiKey, kind })` fetches model ids for Settings; Gemini uses `{ models, nextPageToken }`, while OpenAI-compatible / Responses / DeepSeek / Claude use the generic `{ data }` or bare-array extraction.
- `probeAssistantNativeToolCalling(config)` sends one non-streaming native tool-call probe with a harmless `tsian_tool_probe` schema and returns `{ ok, message }` without executing workspace tools or persisting results.
- `getBrowserAiProviderPresetModels(providerId)` reads `contextWindow` from `parameters.common.contextWindow`.

### 3. Contracts

- Provider presets are platform-local player secrets. API keys must not be written into Game Card manifests, packages, Runtime Workspace files, bridge payloads, debug summaries, or visible non-password UI summaries.
- Presets are grouped by provider type; models do not store their own provider kind. Runtime adapters select the active provider branch by the owning `BrowserAiProviderType.kind` and ignore inactive branches.
- `contextWindow` is local capability/budget metadata and must not be sent to providers.
- Common request fields map per adapter, then active provider-branch fields map to provider-native names (`reasoning_effort`, `reasoning.effort`, `generationConfig.*`, Claude `thinking`, etc.).
- Custom request params are provider-branch-local. There is no shared model-level custom JSON field. Runtime-owned fields must be protected and/or overwritten after merge (`model`, messages/input/contents, stream/tools, auth/header/baseUrl, provider-owned request keys, Responses `store`/conversation fields, Claude `thinking`, etc.).
- `toolCallMode: "native" | "text"` is required on model config and resolved config. New models default to `text`; stored models missing/invalid `toolCallMode` are dropped during normalization.
- `streaming: boolean` lives on model config and resolved config. Both native and text protocol paths can stream when the endpoint supports SSE; the switch is explicit and preserved. Text-mode streaming accumulates raw text and parses tool-call blocks at round end.
- Resolution order for every model call: Agent-selected preset -> platform-global active provider -> complete `VITE_AI_*` environment defaults. AIRP play turns and desktop Assistant chat turns pass the resolved config only when non-null.
- Per-Agent provider selection stores only `providerPresetId?: string` on Agent config. The preset including `apiKey`/`baseUrl` stays platform-local and is never distributed with game-card content.
- Settings model ping uses an in-memory draft config, forces non-streaming chat, and surfaces pass/fail text in the UI.
- Settings native tool-call probe is a separate manual model-level test. It forces `toolCallMode: "native"` and `streaming: false` for the probe call only, sends exactly one harmless probe tool, never executes workspace tools, never auto-switches the model's saved `toolCallMode`, and never persists the probe result.
- Chat provider base URL normalization is intentionally minimal and provider-agnostic. Do not guess official roots or middleman protocol variants; only trim, add a missing `https://`, strip trailing slash, and remove obvious endpoint suffixes. If the remaining URL is wrong, the connectivity/model/tool tests should surface the provider error.
- Gemini model-list fetch follows `nextPageToken` and filters out entries whose `supportedGenerationMethods` exists and lacks `generateContent`; entries without that field are kept for proxy compatibility.

### 4. Validation & Error Matrix

- Missing/blank local provider fields plus incomplete env fallback -> config resolves `null`.
- Malformed local provider config -> normalize defensively; prototype-period incompatible flat model parameters are not migrated into branches.
- Stored model config missing/invalid `toolCallMode` -> model dropped; a preset left with zero models is caught by validation.
- `toolCallMode` other than `native`/`text` at save time -> validation throws.
- Model fetch with blank base URL / blank API key -> throw a clear local error before network fetch.
- Chat provider base URL entered as a bare host or copied endpoint -> normalize to a provider-agnostic API root by adding `https://`, removing trailing slashes, and stripping known endpoint suffixes only; do not add provider-specific paths such as Gemini `/v1beta`.
- Gemini model-list item with `supportedGenerationMethods` missing -> keep it (proxy compatibility).
- Gemini model-list item with `supportedGenerationMethods` present but without `generateContent` -> hide it from chat model selection.
- Settings native tool-call probe returns no tool call -> show a failure suggesting text-compatible mode; do not mutate saved model config.
- Settings native tool-call probe provider rejects `tools` / `tool_choice` / `toolConfig` -> surface the provider error as a tool-call-parameter failure; do not execute or emulate tools locally.
- Settings native tool-call probe auth/network failure -> show the failure in the test result only; no persistence side effects.
- Common numeric model parameter outside range -> validation throws with a field-specific error.
- Active provider custom JSON is invalid, not an object, or tries to override protected runtime fields -> validation/runtime request build throws with a clear error.
- Gemini `responseSchemaText` non-empty but invalid JSON object -> fail before sending the request.
- Claude `thinkingMode === "enabled"` with missing budget, budget `< 1024`, or budget `>= maxOutputTokens` -> validation/request build throws before provider call.
- Per-Agent `providerPresetId` blank/whitespace or no longer exists -> resolves `null` -> falls back to the global active provider without crashing.
- Distributing a game card with a `providerPresetId` set -> recipient without that preset falls back gracefully; credentials are not exported.

### 5. Good/Base/Bad Cases

- Good: OpenAI Responses maps `parameters.common.maxOutputTokens` -> `max_output_tokens`, `parameters.provider.openaiResponses.reasoningEffort` -> `reasoning.effort`, and keeps `store: false` after custom JSON merge.
- Good: A player pastes `https://proxy.example.com/v1/chat/completions`; Settings stores/uses `https://proxy.example.com/v1` without trying to infer whether the proxy is OpenAI-compatible or Gemini-native.
- Good: Gemini `/models` returns both `embedContent`-only and `generateContent` models; Settings only offers `generateContent` entries for chat.
- Good: Native tool-call probe returns `tsian_tool_probe`; Settings reports native tool support but does not save any capability field.
- Base: Inactive provider branches may be populated because the UI creates defaults; runtime reads only the branch selected by `BrowserAiProviderType.kind`.
- Bad: Provider base URL normalization rewrites an unknown middleman path to an official provider root or adds `/v1beta` because the selected kind is Gemini.
- Bad: Treating a successful model-list fetch or ordinary chat ping as proof that native tool calling works.
- Bad: Persisting `nativeToolCallSupported` / last probe status on the model config without a new schema decision.
- Good: Claude defaults to `thinkingMode: "disabled"`, so unsupported models do not receive a `thinking` object unless the user enables advanced thinking.
- Base: Inactive provider branches may be populated because the UI creates defaults; runtime reads only the branch selected by `BrowserAiProviderType.kind`.
- Bad: A request builder reads old top-level `parameters.reasoningEffort` or reads the OpenAI-compatible branch for a Responses preset.
- Bad: Custom JSON is shared at `parameters.customRequestParamsText` or can override `messages`, `tools`, `stream`, `store`, `thinking`, `model`, or auth fields.

### 6. Tests Required

- `npm run build:web` after any platform-web provider config/runtime/UI change.
- For request-builder changes, assert or manually inspect that each provider maps common + active-branch fields correctly and that runtime-owned keys survive custom JSON.
- For Settings UI changes, verify add/edit windows round-trip nested `common` and active provider branch values, hide irrelevant provider controls, and show model ping pass/fail.
- For Settings native tool-call probe changes, verify the probe is manual, model-level, non-streaming, native-mode-only for the probe call, and does not persist state or auto-switch `toolCallMode`.
- For provider model-list changes, verify Gemini pagination and `generateContent` filtering while OpenAI-compatible `{ data: [...] }` extraction still works.
- For provider config normalization changes, verify missing old flat parameter fields normalize to defaults rather than being migrated.

### 7. Wrong vs Correct

#### Wrong

```ts
if (model.providerKind === "openai-responses") {
  body.reasoning = { effort: model.parameters.reasoningEffort }
}
```

#### Correct

```ts
const provider = providerParamsForKind(config.parameters, config.kind)
// Adapter narrows the branch it owns, then maps to provider-native names.
```

#### Wrong

```ts
// Do not infer provider roots for unknown middlemen.
const baseUrl = kind === "gemini" ? `${host}/v1beta` : `${host}/v1`
```

#### Correct

```ts
const baseUrl = normalizeBrowserAiProviderBaseUrl(input)
// Only trims, adds https://, removes trailing slash, and strips known endpoint suffixes.
```

#### Wrong

```ts
// Chat ping success does not prove native tool support.
await generateAssistantReply([{ role: "user", content: "Reply OK" }], { config })
model.nativeToolCallSupported = true
```

#### Correct

```ts
const result = await probeAssistantNativeToolCalling({ ...config, toolCallMode: "native", streaming: false })
// Display result in Settings only; do not persist it to BrowserAiModelConfig.
```

## Scenario: Current Game Card And Active Save State

### Scope / Trigger

- When platform-web changes Game Card loading, desktop app context, Play frontend resolution, Workspace/Studio views, or active save selection.

### Contracts

- The desktop may have zero or one currently loaded Game Card and a separate active Save Instance, both stored in `meta`.
- Platform shell views may enter a no-card state; card-dependent apps (Play, Studio, Assistant, Game entrypoints, card workspace mutations) must lock or fail loudly with a clear "load a game card first" message instead of creating a default card implicitly.
- Desktop apps (Play, Studio, Assistant, Game entrypoints) use the current Game Card by default and must not add their own ordinary card picker.
- Save-scoped runtime work must use the active save's own `gameCardId` when composing an effective workspace or resolving `runtime.entrypoints.playerTurn` (not the current Game Card).
- Selecting or creating a save updates the current Game Card to that save's card. Opening/loading a Game Card may update the current Game Card without requiring a save.
- Platform initialization and active-card query APIs validate/clear stale ids only; they must not auto-create or auto-load a default Game Card. Default card creation happens only from explicit user actions such as "创建游戏".

### Validation & Error Matrix

- Stored current Game Card id does not exist -> clear the active Game Card id and surface no-card shell state.
- `setPlatformActiveGameCard` receives an unknown card id -> throw a clear error.
- Active save belongs to a different card than the current Game Card -> Studio may show card-only content, but save-scoped runtime operations must still use the save's card.
- No current Game Card -> Play/Studio/Assistant and card-scope workspace mutations are locked or fail loud; My Apps / Market / platform settings remain usable.
- No active save -> Play/Runtime save-scoped queries may show empty or not-configured states; Studio registry views should still read current card content when a current card is loaded.

### Save/Card Version Confirmation

#### 1. Scope / Trigger

- Trigger: changing save selection, Game Card package install/overwrite, or any UI that starts a save against a currently installed Game Card.
- Purpose: Game Cards are runtime dependencies for saves. Same-id card overwrites do not delete saves, but existing saves will run against the current installed card content unless the user explicitly keeps/installs another card version.

#### 2. Signatures

- Save record field: `LocalSaveRecord.gameCardVersion?: string` records the Game Card version that this save has been created with or explicitly confirmed against.
- Current card field: `LocalGameCardRecord.manifest.version` is the installed Game Card version used for comparison.
- Platform mutation: `updatePlatformSaveGameCardVersion(saveId: string, gameCardVersion: string): Promise<LocalSaveRecord>` updates the save's confirmed card version and emits `SAVES_CHANGED_EVENT` after success.
- Storage mutation: `updateLocalSaveGameCardVersion(saveId: string, gameCardVersion: string): Promise<LocalSaveRecord>` performs the Dexie write only and must not emit UI/platform events.

#### 3. Contracts

- Compare versions as trimmed strings. Do not infer semver ordering; equality means confirmed, inequality means confirmation required.
- Missing/blank `save.gameCardVersion` is an unknown old save and requires confirmation before starting.
- Confirming a save against the current card version updates only `gameCardVersion`; it must not change `updatedAt` or save runtime files.
- The confirmation gate belongs before frontend mount / save start, not inside the play frontend. Canceling must leave the user in the launcher and must not call `selectPlatformSave` / mount the frontend.
- Same-id Game Card overwrite from the Market must warn about affected saves, but must not delete saves and must not batch-update their `gameCardVersion`. Each affected save confirms independently on first continue.

#### 4. Validation & Error Matrix

- `save.gameCardVersion?.trim() === card.manifest.version.trim()` -> continue without prompt.
- `save.gameCardVersion` missing/blank -> show unknown-version confirmation before continuing.
- Trimmed save version differs from trimmed card version -> show old-version confirmation before continuing.
- Player cancels confirmation -> do not update the save and do not start the frontend.
- Player confirms, but save update fails -> surface the error, do not start the frontend.
- Storage update receives a blank target version -> throw a clear local error.
- Storage update receives an unknown save id -> throw a clear local error.

#### 5. Good/Base/Bad Cases

- Good: A save created on card `1.0.0` sees local card `1.1.0`; launcher marks it as old, prompts once, updates `gameCardVersion` to `1.1.0`, then starts play.
- Base: A save already confirmed on `1.1.0` starts immediately when the installed card is still `1.1.0`.
- Bad: Market overwrite silently changes local card content and then the old save starts without any warning.
- Bad: Market overwrite preemptively rewrites every affected save's `gameCardVersion`, hiding which saves the player has actually reviewed.

#### 6. Tests Required

- Run `npm run build:web` after changing this flow.
- Verify launcher badge and confirmation for missing and mismatched `gameCardVersion`.
- Verify cancel blocks frontend mount and leaves `gameCardVersion` unchanged.
- Verify confirm updates `gameCardVersion`, preserves `updatedAt`, emits save refresh through platform-host, and allows start.
- Verify same-id Market overwrite warning mentions affected saves but does not delete saves or update their versions.

#### 7. Wrong vs Correct

#### Wrong

```ts
// Silent dependency switch: old saves run new card content without user confirmation.
await selectPlatformSave(save.id)
await mountActiveFrontend()
```

#### Correct

```ts
if ((save.gameCardVersion?.trim() ?? "") !== card.manifest.version.trim()) {
  const confirmed = await confirm({ message: "继续后会使用当前本地游戏卡运行。" })
  if (!confirmed) return
  await updatePlatformSaveGameCardVersion(save.id, card.manifest.version)
}
await selectPlatformSave(save.id)
await mountActiveFrontend()
```

### Market Resource Version Authority

#### 1. Scope / Trigger

- Trigger: changing Market upload, package replacement, package install, or server-side Market `resourceVersion` handling.
- Purpose: players must see one version for a downloadable resource. The Market display version, update checks, and installed package version must not drift.

#### 2. Signatures

- Market response field: `MarketPackage.resourceVersion` is a package-version index for display/listing/update checks.
- Game Card package version: `game-card.json -> manifest.version`.
- Agent / Skill / Tool package version: `resource-package.json -> version`.
- Upload/export option: Market upload UI passes the player-entered `版本` into package export so the zip manifest carries that version.

#### 3. Contracts

- `resourceVersion` must mirror the uploaded package manifest version. It is not independent editable metadata.
- Initial upload persists the parsed package version.
- Metadata-only publish edits preserve the existing `resourceVersion`.
- Replacement upload persists the replacement package version.
- Client multipart `version` fields must not override package manifest versions on the server.
- Game Card install prompts should inspect the downloaded package and use its real manifest id/version for overwrite and save-impact checks; do not trust historical Market metadata when making local install decisions.
- Player-facing UI may show/edit a simple `版本` field during upload/replacement, but must not explain internal manifest/resourceVersion mechanics.

#### 4. Validation & Error Matrix

- Upload package version `0.1.0` with form version `9.9.9` -> Market response `resourceVersion === "0.1.0"`.
- Metadata-only edit with form version `9.9.9` -> existing `resourceVersion` unchanged.
- Replacement package version `2.0.0` with form version `9.9.9` -> Market response `resourceVersion === "2.0.0"`.
- Upload/replacement UI receives blank version -> block locally with `版本不能为空。` before exporting.

#### 5. Good/Base/Bad Cases

- Good: Upload a Game Card with version `0.2.0`; the generated zip manifest, Market `v0.2.0`, and local card version after successful upload all match.
- Base: Edit title/summary/tags only; the Market version remains unchanged.
- Bad: Edit a published package's version field without replacing the package, so Market shows `v1.1.0` while downloads still install `v1.0.0`.
- Bad: Game Card overwrite warning uses stale `pkg.resourceVersion` instead of the downloaded package's manifest version.

#### 6. Tests Required

- Run `npm run build:web` after Market frontend changes.
- Run platform-server Market tests after server upload/update changes.
- Verify Game Card install warning uses downloaded package id/version.
- Verify metadata-only edit cannot change version.

#### 7. Wrong vs Correct

#### Wrong

```ts
await marketApi.upload(blob, { resourceType: "game_card", version: "9.9.9" })
// Server stores 9.9.9 even if game-card.json still says 0.1.0.
```

#### Correct

```ts
const blob = await exportPlatformGameCardPackage(cardId, { version: "0.1.0" })
await marketApi.upload(blob, { resourceType: "game_card" })
// Server indexes the version parsed from game-card.json.
```

## Bridge State

- Bridge payloads must stay framework-neutral and serializable.
- `debug.onTurnDebugReady` is a notification to re-read debug/query resources, not a data transport.
- Remote iframe frontend state is per-mount: the adapter owns the generated bridge session id, accepted iframe origin, and message listener cleanup. Do not persist bridge session ids in Dexie or workspace files.
- Remote iframe workspace writes/deletes call `platform.runAction` immediately against `save/...`. They are not part of the Agent Runtime staged transaction used inside `interaction.sendMessage`.
- Streaming text deltas flow through internal `Set`-based pub/sub modules. Do not reuse them as a general event bus. Formal player turns resolve their entry Agent from the save-bound Game Card manifest (`runtime.entrypoints.playerTurn`) and wire runtime `onDelta` to `turn-delta`; direct frontend Agent invocations wire runtime `onDelta` to `agent-invocation` events keyed by `invocationId`. The desktop Assistant chat path does not emit bridge turn/invocation events (it is in-process, not bridged) — it threads `onDelta` directly into the view. Platform only provides the channels; how a play frontend renders (typewriter, folding, thought/final split, per-invocation panels) is the game frontend's responsibility.
- Tool process events extend the same explicit-channel pattern. Formal turns use `turn-round-end` + `turn-tool`. Direct `invokeAgent` calls use `agent-invocation` payload variants `round-end` + `tool`. `turn-round-end` `{ turn, round, kind: "thought" | "final" }` fires after every model-call round so the play frontend can classify the round's delta text (thought = `tool_calls` finish, final = `stop` finish). Tool events fire before/after each workspace tool executes (`loading` → `success`/`failed`; `running` is not emitted). Direct invocation events carry `invocationId` instead of `turn`; delegated `agent_call` targets keep the same `invocationId` and set `agentId` to the actual emitting Agent.
- `executeRuntimeWorkspaceToolCalls` splits a tool-loop round into three groups to cut multi-file query latency while keeping stateful writes ordered. Tool names are short primitives (`read`/`list`/`search`/`glob`/`diff`/`write`/`move`/`delete` + `use_skill`/`run_script`/`agent_call`); the legacy `workspace.<op>` prefix was removed (the `browser_script` SDK RPC wire protocol still uses `workspace.<op>` strings and is a separate path). Parallel group (read-only, stateless): `use_skill`, `read`/`list`/`search`/`glob`/`diff`. `agent_call` group: multiple `agent_call`s in the same round run concurrently (each is a delegated tool loop, but they are independent). Serial group: `write`/`move`/`delete`, `run_script` (side effects + bounded timeout), and unparseable calls. `patch`/`validate` tools were removed (the underlying operations are retained for the editor save flow and the SDK). Observations are collected keyed by original call index and returned in original call order so the native loop can pair each with its tool-call id. Parallelism is a tool-execution-layer optimization orthogonal to streaming: text-protocol turns also benefit.
- Desktop Assistant streaming UI: push an empty reactive assistant placeholder before the await, append deltas into it, and reconcile with the final reply text after. Deltas are buffered in a queue and released on `requestAnimationFrame` (typewriter throttling) so a token burst does not thrash the renderer. Auto-scroll during streaming only scrolls when the user is pinned to the bottom; a user scrolling up freezes auto-scroll and surfaces the jump-to-bottom affordance — never yank the view. A "stop generating" button aborts the turn's `AbortController`; on abort, keep the partial text and append a `（已停止）` marker, or drop the placeholder if nothing streamed. Persistence runs only after the await resolves — never persist half-streamed text mid-flight. Tool process lines render transient status rows during the turn for both native and Text Tool Protocol modes and are cleared in `finally`; persisted process history comes from the runtime-collected timeline/tool records, not from transient UI rows.
- **Play frontend turn rendering (timeline model)**: turn files use schema `tsian.airp.history.turn.v2` with a single ordered `timeline: TurnTimelineItem[]` array (user → interim/thought/tool process items → assistant with stats, plus legacy options when reading older turns), replacing the old split `messages + processNodes + stats` structure. `TurnTimelineItem` is a discriminated union with `kind` field (`user | assistant | interim | thought | tool | options`), where `options` is a legacy/backcompat item rather than a platform-owned requirement for new turns. The array order is the real occurrence order — renderers iterate items and don't need to understand `round` semantics or assemble `user → [processNodes block] → assistant`. `renderSessionHistory` and the streaming path (`beginTurn` + `renderProcessNodes` + `finalizeTurn`) both render from the same timeline model. `turn-completed` does in-place DOM correction via `finalizeTurn` (no `reloadHistory` rebuild needed since the timeline model makes rebuild order-correct too, but in-place is more efficient). `reloadHistory` is for reload/checkpoint-restore only. Historical story options may be present as `{kind:"options",items}` in the timeline and reload should keep restoring them for old saves; new gameplay/front-end markers should be parsed by the game frontend/default frontend, not by platform-host. `ask` nodes (ask_user interaction) are NOT in `TurnTimelineItem` — they exist only in the in-memory `AssistantTimelineNode` and are flattened to `interim` text at the persistence boundary. `TurnProcessNode` was deleted; the collector produces `TurnTimelineItem` directly. No backward compatibility for v1 turn files (parse returns null).

## Avoid

- Do not add compatibility migrations unless explicitly requested.
- Do not store AI/runtime state only in component refs when it must survive navigation.
- Do not reintroduce events/archives as platform-owned required memory tables.

## Scenario: invokeAgent AgentInvocation Streaming

### 1. Scope / Trigger

- Trigger: changing platform-host `interaction.invokeAgent`, `streaming-events.ts`, remote iframe bridge forwarding, or play-bridge SDK subscriptions for direct Agent invocations.

### 2. Signatures

- Host callback wiring: runtime `onDelta(agentId, delta, round, kind)`, `onRoundEnd(agentId, round, finishReason)`, and `onTool(agentId, round, callId, name, status, output?)` map to `AgentInvocationEvent` payloads.
- Bridge event: `agent-invocation` with `AgentInvocationEvent` payload.
- SDK subscription: `tsian.onAgentInvocation((event) => ...)`.

### 3. Contracts

- `send` remains the formal turn entry and emits `turn-*` events plus `turn-completed`.
- `invokeAgent` emits `agent-invocation` events and resolves a final response; it does not emit `turn-completed` or append formal player history.
- Each direct invocation has one `invocationId`; all started/delta/round/tool/completed/failed events for that call carry it.
- Delegated `agent_call` activity inside the invocation uses the same `invocationId`; event `agentId` identifies the actual emitting Agent.
- Keep the event bus dedicated and local to streaming/invocation events. Do not introduce a generic EventBus abstraction.

### 4. Validation & Error Matrix

- Runtime throws before target Agent call -> emit `failed` with the generated/supplied `invocationId`, then reject the Promise.
- Model/tool streaming enabled -> emit `delta` events with text content.
- Tool execution -> emit `tool` loading/success/failed with `output` when available.
- Invocation success -> emit `completed` after workspace commit and resolve `{ invocationId, response }`.
- Invocation failure after partial stream -> emit `failed`, discard the staged transaction, and reject.

### 5. Good/Base/Bad Cases

- Good: UI creates an invocation-local draft buffer keyed by `invocationId`, appends `delta` events, shows tool progress, then reconciles with `response`.
- Base: UI ignores streaming and just awaits `invokeAgent`; final `response` still works.
- Bad: UI stores partial streamed invocation content as durable history before the Promise resolves.

### 6. Tests Required

- Run `npm run build:contracts` when contracts are changed.
- Run `npm run build:web` for platform-web/bridge/SDK changes.
- Verify `send` still streams via `turn-delta` and completes via `turn-completed`.
- Verify `invokeAgent` streams via `agent-invocation` and does not pollute the formal turn timeline.

### 7. Wrong vs Correct

#### Wrong

```ts
// Reusing formal turn callbacks for a direct Agent task makes UI state ambiguous.
tsian.onMessage((delta) => appendStageManagerDraft(delta.delta))
await tsian.invokeAgent("stage-manager", prompt)
```

#### Correct

```ts
const invocationId = crypto.randomUUID()
const off = tsian.onAgentInvocation((event) => {
  if (event.invocationId !== invocationId) return
  if (event.type === "delta") appendStageManagerDraft(event.delta)
})
try {
  await tsian.invokeAgent("stage-manager", prompt, { invocationId })
} finally {
  off()
}
```

### Setup Wizard Streaming Patterns

The setup wizard (`useSetupState`) consumes `onAgentInvocation` in two distinct ways, both gated by `invocationId`:

**Step 4 dialog — streaming text render**: accumulate `delta` (`kind: "content"`) into a `playSetupStreamingText` ref and render via a **lightweight streaming text block** (serif + fade-in), NOT `NarrativeMessage`. `NarrativeMessage` is designed for settled messages (option-block cleanup, full layout); rendering half-formed `[[options]]` mid-stream breaks layout. On `completed`, `handleAgentResponse` clears the streaming buffer and pushes the full text as a `NarrativeMessage` — streaming and settled are two separate renders. Filter delegated `agent_call` deltas (`agentId !== orchestrator`) — the orchestrator's output is the player-facing text; delegated agents are感知 via `tool` events (`name: "agent_call"`).

**Step 2 understanding — event-driven stage text**: map `tool` events to player-facing stage labels via `mapToolToStage`, using **monotonic progression** (`Math.max(current, mapped)`) so read/write alternation doesn't make stage text flicker backward. Do NOT show tool names (too IDE-like) or `delta` text (spoilers — understanding is modeling, not player-facing narrative). The magic-circle animation stays CSS-driven; the old `STAGE_INTERVAL` time-guess is removed.

**Heartbeat transition**: `onAgentInvocation` is the single channel for both setup paths; the legacy `onAgentActivity` / `agent-activity` heartbeat was removed across contracts, play-bridge, platform-host, and the bridge event bus once the wizard migrated to `onAgentInvocation`. Do not reintroduce it.

## Scenario: Frontend Packages Import/Export

### Scope / Trigger

- When platform-web changes standalone frontend package (`.tsian-frontend.zip`) import/export, the frontend-package manifest shape, packaged frontend file path conventions, media-type mapping, or the frontend tab UI.

### Contracts

- A frontend package is a focused, frontend-only distribution unit, distinct from the whole-card package. Whole-card import is unchanged and still brings frontends in; the frontend package only replaces the frontend portion of an already-existing card.
- Package structure: root `frontend.json` manifest with `entry`, `bridgeVersion`, and `files: [{ path, mediaType, size }]`; build-output files placed at their manifest `path`.
- **Manifest `path` values do NOT carry the `frontend/` prefix.** The package mirrors the build output's original structure. The platform adds the `frontend/` prefix in exactly one place — when writing into storage — so stored paths align with the existing whole-card convention and the SW route key. On import the manifest `entry` is stored with the `frontend/` prefix added, matching how whole-card import lands it and how the SW resolves the entry.
- Import is an **atomic whole-replacement**: the card's existing frontend files are deleted in the same transaction, then the new package's files are written. There is no incremental add/edit of individual frontend files in this scope.
- `mediaType` resolution on import: manifest `files[i].mediaType` wins; blank/missing falls back to path inference; final fallback `application/octet-stream`. The resolved type is stored in the file Blob's built-in `type` (not a Dexie column). Export reuses a meaningful `Blob.type` verbatim and only falls back to central path inference when the Blob type is blank or generic octet-stream.
- Export strips the `frontend/` prefix from stored paths when building the manifest and zip entries.
- Built-in cards reject import/export/clear with "请先另存为本地副本"; the UI disables those three buttons for built-in cards.
- Clearing a packaged binding must delete all of the card's frontend files and clear the manifest binding, not just the manifest. `putLocalGameCard` `frontendFiles` semantics: `undefined`/omitted = keep existing; `[]` = delete all inside the write transaction. Clear passes `[]`.
- The SW DB name must equal `db.ts`'s DB name (see Dexie State above).

### Validation & Error Matrix

- Package missing `frontend.json` -> manifest-missing error; existing frontend untouched.
- `frontend.json` schema unsupported -> schema-unsupported error.
- Manifest `entry` not present in `files` -> entry-missing error.
- Manifest `files` and actual zip entries disagree -> file-mismatch error.
- Unsafe file path (`..`, absolute, NUL) -> path-invalid error.
- Export of a card with no frontend files / non-packaged frontend -> corresponding export error.
- Import/export/clear on a built-in card -> rejected before any storage mutation.
- A failed import must never partially overwrite the existing frontend (validation runs before the transaction).

## Scenario: Default Template Card Creation Route

### Scope / Trigger

- When platform-web adds a "create game card from template" entry point, treats the builtin blank card as a reusable template, or binds a packaged frontend to a freshly created local card.

### Invariants

- The builtin blank card (`source: "builtin"`) is an **invisible internal template**: it stays in DB as the copy source for default-card creation, but is never shown to users and never used as the active card fallback. Active-card resolution validates the stored current-card id and may return no current card; it must not select an arbitrary card or create a fresh editable default card implicitly. New saves bind to the active local card (never builtin). Card-delete fallback picks a remaining local card or clears the current-card pointer when none remain. The library view filters builtin cards from the list. Builtin cards still cannot be deleted or directly mutated.
- Creation reuses existing storage primitives (copy + put + set-active); no new storage layer, no `platform.runAction` extension. Platform-level create-card actions are explicitly out of scope for this route.
- Because the builtin template has no frontend files, attaching a default frontend to the copy requires a same-id upsert after the initial copy (copy content + unique id first, then inject frontend files + binding).
- Default frontend files are static string constants (no build pipeline); the SW serves them raw. They use relative references which resolve under the SW virtual prefix; no HTML rewriting by the SW.

### Common Pitfalls

- Do not attach a frontend directly to the builtin card — it is an invisible template, never the active card, never shown in the library, and UI guards block frontend replacement on it. Always create a local copy first, then attach the frontend to the copy.
- Do not skip loading the new card after creation — a created-but-not-active card means `/play` still uses the previously active card.

## Scenario: Workspace Volume Abstraction And Single Dispatch

### Scope / Trigger

- When platform-web changes host-layer workspace mutation routing, adds/removes a storage backend volume, or changes how a workspace mutation reaches its storage backend. Applies when adding a new `WorkspaceScope`, a new `WorkspaceVolume` implementation, or changing the 3 entry points' mutation routing.

### Contracts

- 4 physical backends are wrapped as 6 volumes (save-scoped split into two, plus a synthesized manifest volume): card-content (per-file content table, ownerId=cardId), card-frontend (frontend files, `data: Blob` required, ownerId=cardId), manifest (card-content scope but routed by path `game-card.json`, synthesized from the card manifest, ownerId=cardId), save-runtime (save/ paths, ownerId=saveId), save-platform-meta (.tsian/ save-owned paths, ownerId=saveId), local-assistant (platform-meta local-assistant, single-row JSON, ownerId ignored).
- The 3 ad-hoc routing points' non-staged mutation branches converge into a single dispatch; each scope×path combination routes through exactly one volume. No ad-hoc `if/else` by scope/path-prefix remains in the mutation branches.
- **Staged turn (transaction) paths stay in the upper layer, NOT in dispatch.** The transaction is "stage changes, commit at turn end" semantics, orthogonal to "which backend". Dispatch only converges non-staged direct-storage routing. Staged paths: `save-runtime` → transaction write; `platform-meta` → writePlatformFile; `card-content`/`card-frontend` → throw "Runtime turn staging cannot mutate card-content." The runtime agent turn `workspaceMutations` is also a staged path, kept as-is.
- `card-frontend` scope: `readLevel: 0, editLevel: 2` (same as card-content; runtime agents level 1 cannot edit, assistant level 4 can). Path prefix `frontend/` → card-frontend scope.
- Card-frontend `enumerate` is wired into studio/effective workspace listings so frontend files appear in Explorer/assistant workspace. `write`/`delete` use single-file APIs (per-row put + bump card `updatedAt`, no full card rewrite). Frontend files map to binary placeholder + `binary: Blob` for media, or text content for text files (html/css/js/json/svg).
- `ManifestVolume` is a synthesized-file volume: `enumerate` produces `game-card.json` from the normalized manifest; `write` round-trips through parse + normalize + force-overwrite protected fields (`id`/`schema`/`frontend.bridgeVersion`) + persist manifest (content table untouched); `delete` throws (manifest cannot be removed while the card exists). It shares `card-content` scope (editLevel 2) but the volume selector routes `path === "game-card.json"` to it before the content volume. Template normalization rejects `game-card.json` so it cannot be stored as a content file.
- Binary payload (`data?: Blob`) transparently threads through dispatch: runtime splits request content into text/binary → adapter → dispatch → volume write → storage API. Agents read only `content` (string); binary is opaque to agents.
- `localAssistantVolume` is global meta (cross-save persistent); it is identified by reference (not scope, since it shares `platform-meta` scope with the save-platform-meta volume) and returns empty string ownerId.
- `savePlatformMetaVolume.delete` is best-effort (returns the path prefix, does not truly delete DB rows) — storage layer has no platform-meta prefix-delete API yet.
- **Workspace tool `scope` is invisible to the agent.** `scopeForPath(path)` is the **single source of truth** for scope — the only path-to-scope derivation in the codebase (host's former duplicate `scopeForPlatformWorkspacePath` was merged into it, temp branch included). `executeWorkspaceOperation` resolves scope: an explicit operation-level `scope` is now an **optional defensive constraint only** — when a concrete scope is passed and is not `effective`, the runtime asserts `pathMatchesScope(path, scope)` and rejects on mismatch, but **mutation routing always uses `scopeForPath(path)`**, never the operation-level `scope`. Read ops default to `effective` (union view); edit ops infer `pathScope = scopeForPath(path)` for the mutation `input.scope`. `effective`/omitted skips the assertion (cross-scope). The agent-facing tool schemas do **not** expose `scope` at all; tool descriptions and the text-protocol prompt never mention scope. The agent only knows paths; path prefixes are the user-facing concept. Adding a new scope only touches `scopeForPath` + `DEFAULT_SCOPE_ACCESS` + the `WorkspaceVolume` + `resolveVolumeForScope` — never the tool schemas or prompt. Internal callers still pass scope explicitly because they construct requests directly. The permission boundary is preserved because `assertEditAccess` is path-based, independent of whether scope came from an explicit arg or path inference.
- **mutation `ownerContext` is filled by the host adapter closure per `input.scope`, not by the runtime.** `WorkspaceOperationMutationAdapter`'s `write`/`delete` inputs now carry an `ownerContext: WorkspaceVolumeOwnerContext` field; the runtime passes an empty `{}` placeholder (it does not know cardId/saveId), and each host adapter closure rebuilds the real ownerContext from `input.scope`: card-content/card-frontend → `cardId` (active card or studio-scoped cardId), save-runtime/save-platform-meta → `saveId`, temp → sessionId, local-assistant → ownerId ignored. `WorkspaceVolumeOwnerContext` was promoted to `@tsian/contracts` (it is a cross-layer contract consumed by both agent-runtime's adapter type and the volume dispatch layer); `workspace-volumes.ts` re-exports it to keep downstream imports stable. Host helpers: `resolveOwnerContextForScope` (async, local — fetches active cardId) and `resolveStudioOwnerContextForScope` (sync, studio — cardId/saveId already in scope). **Do not stamp the target's saveId onto a card-scope delete** — the source delete uses `fromScope`, so its ownerContext must be derived from `fromScope`, not `toScope`/`targetResolvedPath` (this was hazard 4; `resolveOwnerId` happened to ignore saveId for card-scope, masking it).
- `move` is the only mutation that may write to a different scope than the source path. It resolves `fromScope = scopeForPath(path)` and `toScope = scopeForPath(targetPath)`, finds source files in `fromScope`, writes moved files through `toScope` (ownerContext from `toScope`), then deletes the source prefix through `fromScope` (ownerContext from `fromScope`). The request's explicit `scope` only validates the source via `pathMatchesScope(fromPath, scope)`; it must never force the target write/delete back into the source volume. The public routers `movePlatformWorkspacePath`/`copyPlatformWorkspacePath` branch on whether the operation **crosses stores** (`fromIsTsian !== toIsTsian`), not on `targetCardId ?? cardId` — the latter misrouted same-card `.tsian` ops to crossRoot, which forbids save paths and rejected legitimate ops. Cross-scope legality is enforced by `assertEditAccess(fromPath)` + `assertEditAccess(toPath)` against each path's own editLevel (level-1 agents can write save-runtime but are blocked from card-content(2)/platform-meta(4)); this cross-scope editLevel difference is a feature, not relaxed by the refactor.
- `copy` shares `move`'s source/target scope resolution and directory-prefix traversal, but only writes targets and never deletes the source. It rejects if any target file already exists; callers that want overwrite semantics must add that contract explicitly instead of overloading `copy` silently.
- **Known gap (unfixed, out of this refactor's scope):** `copyWorkspacePath`'s target-exists check uses `findScopedFile(files, toScope, nextPath)` where `files` is the caller-provided snapshot. In the studio card-content branch, `cardScopedFiles` contains only card-content + card-frontend + manifest — **not save-runtime**. A card-content → save-runtime copy inside Studio is not blocked by `assertCompatibleStudioMove` (which only guards save↔save slot mismatch), so the target-exists check runs against a snapshot that cannot see save-runtime targets and may silently overwrite an existing save file. The studio save-runtime branch uses `listEffectiveWorkspaceFilesForSave` (full union) and is not affected. Fix path: either include save-runtime files in the card-content branch snapshot, or load the toScope slice for the target-exists check.
- Assistant-chat mutations that bypass `RuntimeWorkspaceTransaction` (card-content, `.tsian/local/assistant/**`, temp) must also update `activeWorkspaceTransaction.workspaceFiles` in memory. Otherwise a `move` can persist correctly but same-turn `list`/`glob`/`read` observes the stale turn-start snapshot and falsely reports the target missing or source still present.

### Validation & Error Matrix

- `card-content`/`card-frontend` mutation without `cardId` -> dispatch throws "requires a cardId".
- `save-runtime`/`save-platform-meta` mutation without `saveId` -> dispatch throws "requires a saveId".
- `localAssistantVolume` mutation without `saveId` -> allowed (ownerId ignored, global meta).
- `effective` scope mutation -> dispatch throws "unsupported scope" (runtime computes effective in snapshot, never calls mutations).
- `game-card.json` write -> manifest volume: invalid JSON/schema -> throws "game-card.json 内容无效：…"; builtin card manifest -> throws "内置游戏卡的 manifest 不可编辑".
- `game-card.json` delete -> throws "game-card.json（卡片 manifest）不能删除".
- Staged turn mutation on `card-content`/`card-frontend` -> upper layer throws "Runtime turn staging cannot mutate card-content."
- Studio path resolution on `frontend/` -> resolves to card-frontend scope; no alias rewrite.
- `move({ path: "world/foo.md", targetPath: ".tsian/save/foo.md" })` at actorLevel 4 -> writes platform-meta then deletes card-content.
- `copy({ path: "skills/foo", targetPath: ".tsian/local/assistant/skills/foo" })` at actorLevel 4 -> writes all matching target files and keeps the source files.
- `move({ path: "world/foo.md", targetPath: "save/save-01/foo.md" })` in Studio -> writes the resolved save-runtime path using that save slot's `saveId`, then deletes card-content.
- Assistant-chat `move({ path: "skills/foo/SKILL.md", targetPath: ".tsian/local/assistant/skills/foo/SKILL.md" })` -> writes local-assistant, syncs the target into `workspaceFiles`, deletes card-content, and prunes the source from `workspaceFiles` before any same-turn verification tools run.
- `move` between two different Studio save aliases -> throws `WORKSPACE_MOVE_SAVE_SLOT_MISMATCH`.
- Operation-level `scope` passed as a concrete value that does not match `scopeForPath(path)` -> throws `WORKSPACE_SCOPE_PATH_MISMATCH` (defensive constraint; the assertion is skipped when scope is `effective` or omitted). Mutation routing still uses `scopeForPath(path)`, so a matching explicit scope is redundant but allowed.
- `move`/`copy` where `assertEditAccess(toPath)` fails the toScope editLevel (e.g. level-1 agent writing to card-content(2) or platform-meta(4)) -> throws the edit-access error. Cross-scope move/copy is only blocked by this path-based permission, never by a "from/to scope must match" rule (that rule was removed).

## Scenario: Skill Config Declaration And Player Overrides

### Scope / Trigger

- When platform-web parses a skill's `skill.config` file, stores player config overrides, injects `tsian.config` into a `browser_script` Worker, or renders the skill config UI.

### Contracts

- A skill declares config by placing a `skill.config` file in its directory beside `SKILL.md`. The file is a workspace file (card-content scope): resource-manager-visible, player-editable, agent `workspace.read/write`-able, and exported with the skill package.
- `skill.config` format is `.env`-style: `#`-prefixed lines describe the *next* key; `KEY=VALUE` declares an item (VALUE always a string); blank lines clear the pending comment; other lines are ignored.
- The player overrides defaults through the Assistant config panel UI. Overrides are stored in the `skillConfigs` Dexie table keyed by skill directory, **never** in the workspace — so secrets (API keys) stay local and are never exported with a skill package. This is a registered Fileification exception (player secret overrides mirror AI provider apiKey preset locality).
- Runtime merge: `tsian.config = Object.freeze({ ...defaults, ...playerOverrides })`. Player overrides win over `skill.config` defaults. A key the player left unset uses the default. A stale saved value for a removed config key is dropped at merge time (only keys the skill currently declares survive).
- `tsian.config` is injected via the Worker execute message. The `config` field is optional; a skill without `configItems` yields `tsian.config = {}` (frozen empty object), so `config.API_KEY` returns `undefined` and the script handles the missing key.
- Config declarations do **not** enter agent context: `skill.config` is not injected alongside `SKILL.md`. The agent learns a skill needs config only when a `run_script` fails with a clear missing-config error (the "first error then configure" flow is intended).
- The `skill.config` file is parsed at registry build time (first pass builds directory→configItems, second pass attaches to each Skill Index entry). Skill detail loading resolves the sibling `skill.config` for a single skill path.
- DB schema: `skillConfigs` keyed by skillPath + updatedAt. DB name bumps are destructive (prototype; old store abandoned, no migration). The SW `DB_NAME` must mirror.

### Validation & Error Matrix

- `skill.config` absent -> skill loads normally, `configItems` undefined, no config section, `tsian.config = {}`.
- `skill.config` empty/whitespace-only -> `configItems` is `[]`, no config section, `tsian.config = {}`.
- `skill.config` with a malformed line (no `=`) -> line ignored, other items parsed; registry build does not throw.
- `#` comment with no following key line -> pending description discarded on the next blank/non-key line; no item produced.
- Corrupt stored JSON in overrides -> read degrades to `{}` (defaults apply); no throw.
- Player saved an override for a key the skill later removed -> merge drops it (only declared keys survive); no stale value leaks into `tsian.config`.
- Worker `message.config` missing or non-object -> `tsian.config = {}` (defensive guard in Worker source).

## Scenario: Skill Index Presentation And SKILL.md Injection

### Scope / Trigger

- When changing `formatSkillIndex` (Skill Index shown in system prompt before `use_skill`) or `formatActivatedSkillMessageBody` (SKILL.md content injected after `use_skill`).

### Skill Index (pre-use_skill)

`formatSkillIndex` emits one line per visible Skill in the system prompt: `- name: description` (+ `triggers=...` if present). It does **not** list:
- `scope` (`local`/`shared`) — internal path-resolution info, irrelevant to agent decisions.
- `actions` list — action names + `inputSchema` are only useful after `use_skill` when the full SKILL.md is injected. Listing them pre-activation wastes system-prompt tokens every round.
- `appliesTo` — the agent learns applicability from the SKILL.md content post-activation.

### SKILL.md Injection (post-use_skill)

`use_skill` returns the **full SKILL.md content** (`content` field) and each action's `inputSchema` directly in the tool observation. The agent sees the Skill text + script parameters in the same round it calls `use_skill`, and can call `run_script` / `test_skill_script` immediately in the next round — no extra round spent waiting for framework injection. The skill path is marked in `injectedSkillPaths` so `collectActivatedSkillContents` skips it (no duplicate injection next round).

`formatActivatedSkillMessageBody` is retained as a compatibility fallback for any path that doesn't go through the new observation-based injection. When it does run, it injects the full SKILL.md as a user message with no truncation. Rationale: Skills are card-template-authored, carefully designed, and length-controlled. Truncation risks losing the `tsian-actions` JSON block's `inputSchema` — the agent would not know script parameters, a hard-to-detect failure. The old 6000/2000-char truncation was removed.

### Convention: Skill Description Authoring

Skill `description` fields should state what the agent can accomplish by activating the Skill — one sentence. Avoid:
- Implementation status notes ("当前模板不声明执行脚本") — useless to the agent.
- Subject-name prefixes ("资料员按..."→"按...") — the Skill is already bound to an agent.
- Frontend rendering details ("可被前端投影到状态栏") — the agent doesn't need to know how its output is consumed.
- Trigger conditions ("当 X 时") — these belong in the `triggers` frontmatter field, not `description`.

