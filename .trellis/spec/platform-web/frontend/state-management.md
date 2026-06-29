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
- **Assistant skill seed + merge strategy**: factory skills are seeded as string constants (SKILL.md + optional scripts) into the map. The assistant config's `skills.enabled` is the whitelist — non-empty `enabled` short-circuits registry discovery, so every factory skill name MUST be listed there or it won't appear in the Skill Index. On load, missing default keys are filled in (only fills, never overwrites user edits) and the merged map is persisted. This ensures new factory skills reach existing users without a manual reset.
- Packaged frontend files are reusable Game Card assets stored beside game cards, not copied into save runtime data. They are served by a Service Worker that reads from IndexedDB. The SW DB name **must** stay in sync with `db.ts`'s database name — the SW is a standalone static asset that cannot import the TS constant, so it carries the same literal plus a comment pointing back to `db.ts`. Update both together; a mismatch makes every packaged frontend serve 404.
- **Skill config overrides**: `skillConfigs` table stores player-saved skill config overrides keyed by skill directory + updatedAt. Overrides never enter the workspace and never travel with an exported skill package — only the `skill.config` declaration + defaults do. This mirrors AI provider apiKey preset locality and is a registered Fileification exception (see `guides/data-fileification-principle.md`).
- Built-in game cards may be refreshed by platform seed helpers when their source is `builtin` and their content/manifest is stale. This refresh updates reusable card content; existing saves see the updated content through the effective workspace layer.
- Checkpoints store turn number and save runtime files. They do not snapshot card-owned content.

## Runtime State

- `platform-host/index.ts` owns assembling the effective workspace from card content plus save runtime data, running Agent Runtime turns, persisting successful turns, checkpoint creation, and rollback on failure. Turn number is derived from turn files (`getMaxTurnFromTurnFiles`); there is no in-memory snapshot state.
- `interaction.sendMessage` should not persist partial user/assistant messages when the Agent Runtime turn fails.

## Scenario: Browser AI Provider Config And Secrets

### Scope / Trigger

- When platform-web changes browser AI provider configuration, env fallback behavior, model fetching, Agent Runtime model-call config resolution, Game Card package import/export, or bridge/query payloads that might expose platform secrets.

### Contracts

- Browser AI provider presets are platform-local player secrets stored under localStorage key `tsian-platform-config`. Presets currently support only OpenAI-compatible APIs: `baseUrl`, `apiKey`, provider default model, fetched model IDs, and model parameters.
- Model parameters are provider-local settings. Supported request fields include `max_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `reasoning_effort`, and custom JSON-object request params. `contextWindow` is saved as model capability/budget metadata only until a token-counting prompt-truncation task implements enforcement.
- `toolCallMode: "native" | "text"` is a **required** field on the model config and the resolved config. No `auto` mode. It selects how the Agent Runtime asks the model to invoke tools: `native` uses API-native function calling (structured text/tool-call boundaries); `text` uses the legacy text-embedding protocol and is the conservative default. Prototype-period destructive update: a model missing/invalid `toolCallMode` is dropped (no migration fallback); save validation throws on an invalid value; new models default to `text`; the env fallback config defaults to `text`.
- `streaming: boolean` is a field on the model config and the resolved config. Streaming is **native-mode only**: `toolCallMode === "text"` always forces `streaming: false` (validation enforces this; the UI switch is disabled under text). Missing/invalid `streaming` on stored data is defaulted from `toolCallMode` at read time (native → true, text → false) rather than dropping the model — unlike `toolCallMode`, `streaming` has a safe default. The native call closure streams only when an `onDelta` callback is set (entry agent, not delegated) **and** the resolved config's `streaming` is true; this lets a player opt out of streaming for endpoints that answer `200 + text/event-stream` with an error body instead of a real SSE stream.
- Custom request params must be a JSON object and must not override runtime-owned/protected fields such as `model`, `messages`, `stream`, `apiKey`, `baseUrl`, or `headers`.
- `getBrowserAiConfig()` returns only the resolved active runtime config needed for a model call (provider identity/name, `baseUrl`, `apiKey`, `model`, normalized parameters). When no complete local provider is active, it may fall back to complete `VITE_AI_*` environment values.
- Existing old localStorage shape `{ chat: { baseUrl, apiKey, model } }` is compatibility input and should normalize into a local OpenAI-compatible provider.
- API keys must not be written into Game Card manifests, packages, Runtime Workspace files, frontend bridge payloads, debug summaries, or visible non-password UI summaries.
- Per-Agent provider selection stores **only a provider preset id reference** (`providerPresetId?: string`) on Agent config. The preset (with `apiKey`/`baseUrl`) stays in platform-local localStorage and is never distributed with game-card content.
- Resolution order for every model call: Agent-selected preset -> platform-global active provider -> `VITE_AI_*` environment defaults. Both the AIRP play turn and the desktop Assistant chat turn must resolve the active Agent's provider config in their `callModel` closure and pass it as `config` only when non-null (omit the key otherwise so the global fallback applies).
- The local Assistant agent participates in the same registry and the same provider selection/resolution path as card Agents.
- The Studio snapshot exposes only `{ id, name }` preset options (no credentials) so the dropdown can list saved presets without leaking keys.
- Distributing a game card with a `providerPresetId` set must resolve gracefully: the preset id is unlikely to exist in the recipient's localStorage, so resolution falls back to their global active provider without crashing.
- Future account-system work may manage identity or sync UX, but must not move API credentials into distributable Game Card or Agent content.

### Validation & Error Matrix

- Missing/blank local provider fields plus incomplete env fallback -> config resolves `null`.
- Malformed localStorage JSON -> ignore stored config and fall back to environment defaults.
- Old `chat` shape -> normalize as one local provider (no manual migration).
- Model fetch with blank base URL / blank API key -> throw a clear local error before network fetch.
- Model fetch HTTP error -> surface provider error message when present, otherwise status-based error.
- Model fetch returns no usable IDs -> surface an error and preserve the provider's existing default model.
- Numeric model parameter outside range / invalid custom params JSON / protected custom key -> saving fails with a clear field-specific error.
- Stored model config missing/invalid `toolCallMode` -> model dropped (destructive); a preset left with zero models is caught by the "at least one model" validation.
- `toolCallMode` other than `native`/`text` at save time -> validation throws.
- `streaming === true` while `toolCallMode === "text"` at save time -> validation throws.
- Per-Agent `providerPresetId` blank/whitespace or no longer exists -> resolves `null` -> falls back to the global active provider without crashing.

## Scenario: Current Game Card And Active Save State

### Scope / Trigger

- When platform-web changes Game Card loading, desktop app context, Play frontend resolution, Workspace/Studio views, or active save selection.

### Contracts

- The desktop has one currently loaded Game Card and a separate active Save Instance, both stored in `meta`.
- Desktop apps (Play, Studio, Assistant, Game entrypoints) use the current Game Card by default and must not add their own ordinary card picker.
- Save-scoped runtime work must use the active save's own `gameCardId` when composing an effective workspace (not the current Game Card).
- Selecting or creating a save updates the current Game Card to that save's card. Opening/loading a Game Card may update the current Game Card without requiring a save.
- If no current Game Card is stored, platform initialization may derive one from the active save, first save, or built-in blank card.

### Validation & Error Matrix

- Stored current Game Card id does not exist -> initialize/fall back to an existing card.
- `setPlatformActiveGameCard` receives an unknown card id -> throw a clear error.
- Active save belongs to a different card than the current Game Card -> Studio may show card-only content, but save-scoped runtime operations must still use the save's card.
- No active save -> Play/Runtime save-scoped queries may show empty or not-configured states; Studio registry views should still read current card content.

## Bridge State

- Bridge payloads must stay framework-neutral and serializable.
- `debug.onTurnDebugReady` is a notification to re-read debug/query resources, not a data transport.
- Remote iframe frontend state is per-mount: the adapter owns the generated bridge session id, accepted iframe origin, and message listener cleanup. Do not persist bridge session ids in Dexie or workspace files.
- Remote iframe workspace writes/deletes call `platform.runAction` immediately against `save/...`. They are not part of the Agent Runtime staged transaction used inside `interaction.sendMessage`.
- Streaming text deltas flow through an internal `Set`-based pub/sub module. Do not reuse it as a general event bus. The AIRP turn wires the runtime `onDelta` to emit deltas; the remote iframe bridge subscribes and forwards each as a `turn-delta` bridge event. The desktop Assistant chat path does not emit `turn-delta` (it is in-process, not bridged) — it threads `onDelta` directly into the view. Platform only provides the channel; how the play frontend renders (typewriter, folding, thought/final split) is the game frontend's responsibility.
- Tool process events (`turn-round-end` + `turn-tool`) extend the same pub/sub. `turn-round-end` `{ turn, round, kind: "thought" | "final" }` fires after every native model-call round so the play frontend can classify the round's delta text (thought = `tool_calls` finish, final = `stop` finish). `turn-tool` `{ turn, round, callId, name, status, output? }` fires before/after each workspace tool executes (`loading` → `success`/`failed`; `running` is not emitted). Both events are **native-mode only**: text-protocol turns and delegated `agent_call` targets do not emit them. The desktop Assistant chat path threads `onTool` straight into the view (not bridged).
- `executeRuntimeWorkspaceToolCalls` splits a tool-loop round into three groups to cut multi-file query latency while keeping stateful writes ordered. Tool names are short primitives (`read`/`list`/`search`/`glob`/`diff`/`write`/`move`/`delete` + `use_skill`/`run_script`/`agent_call`); the legacy `workspace.<op>` prefix was removed (the `browser_script` SDK RPC wire protocol still uses `workspace.<op>` strings and is a separate path). Parallel group (read-only, stateless): `use_skill`, `read`/`list`/`search`/`glob`/`diff`. `agent_call` group: multiple `agent_call`s in the same round run concurrently (each is a delegated tool loop, but they are independent). Serial group: `write`/`move`/`delete`, `run_script` (side effects + bounded timeout), and unparseable calls. `patch`/`validate` tools were removed (the underlying operations are retained for the editor save flow and the SDK). Observations are collected keyed by original call index and returned in original call order so the native loop can pair each with its tool-call id. Parallelism is a tool-execution-layer optimization orthogonal to streaming: text-protocol turns also benefit.
- Desktop Assistant streaming UI: push an empty reactive assistant placeholder before the await, append deltas into it, and reconcile with the final reply text after. Deltas are buffered in a queue and released on `requestAnimationFrame` (typewriter throttling) so a token burst does not thrash the renderer. Auto-scroll during streaming only scrolls when the user is pinned to the bottom; a user scrolling up freezes auto-scroll and surfaces the jump-to-bottom affordance — never yank the view. A "stop generating" button aborts the turn's `AbortController`; on abort, keep the partial text and append a `（已停止）` marker, or drop the placeholder if nothing streamed. Persistence runs only after the await resolves — never persist half-streamed text mid-flight. Tool process lines (native-mode only) render transient status rows during the turn and are cleared in `finally` — they are not persisted; only the final reply survives.
- **Play frontend turn rendering (timeline model)**: turn files use schema `tsian.airp.history.turn.v2` with a single ordered `timeline: TurnTimelineItem[]` array (user → interim/thought/tool process items → assistant with stats → options), replacing the old split `messages + processNodes + stats` structure. `TurnTimelineItem` is a discriminated union with `kind` field (`user | assistant | interim | thought | tool | options`). The array order is the real occurrence order — renderers iterate items and don't need to understand `round` semantics or assemble `user → [processNodes block] → assistant`. `renderSessionHistory` and the streaming path (`beginTurn` + `renderProcessNodes` + `finalizeTurn`) both render from the same timeline model. `turn-completed` does in-place DOM correction via `finalizeTurn` (no `reloadHistory` rebuild needed since the timeline model makes rebuild order-correct too, but in-place is more efficient). `reloadHistory` is for reload/checkpoint-restore only. Story options are persisted as `{kind:"options",items}` in the timeline — reload restores them naturally from the turn file, not just from the runtime `turn-options` event. `ask` nodes (ask_user interaction) are NOT in `TurnTimelineItem` — they exist only in the in-memory `AssistantTimelineNode` and are flattened to `interim` text at the persistence boundary. `TurnProcessNode` was deleted; the collector produces `TurnTimelineItem` directly. No backward compatibility for v1 turn files (parse returns null).

## Avoid

- Do not add compatibility migrations unless explicitly requested.
- Do not store AI/runtime state only in component refs when it must survive navigation.
- Do not reintroduce events/archives as platform-owned required memory tables.

## Scenario: Frontend Package Import/Export

### Scope / Trigger

- When platform-web changes standalone frontend package (`.tsian-frontend.zip`) import/export, the frontend-package manifest shape, packaged frontend file path conventions, media-type mapping, or the frontend tab UI.

### Contracts

- A frontend package is a focused, frontend-only distribution unit, distinct from the whole-card package. Whole-card import is unchanged and still brings frontends in; the frontend package only replaces the frontend portion of an already-existing card.
- Package structure: root `frontend.json` manifest with `entry`, `bridgeVersion`, and `files: [{ path, mediaType, size }]`; build-output files placed at their manifest `path`.
- **Manifest `path` values do NOT carry the `frontend/` prefix.** The package mirrors the build output's original structure. The platform adds the `frontend/` prefix in exactly one place — when writing into storage — so stored paths align with the existing whole-card convention and the SW route key. On import the manifest `entry` is stored with the `frontend/` prefix added, matching how whole-card import lands it and how the SW resolves the entry.
- Import is an **atomic whole-replacement**: the card's existing frontend files are deleted in the same transaction, then the new package's files are written. There is no incremental add/edit of individual frontend files in this scope.
- `mediaType` resolution on import: manifest `files[i].mediaType` wins; blank/missing falls back to path inference; final fallback `application/octet-stream`. Export reuses the stored `mediaType` verbatim.
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

- The builtin blank card (`source: "builtin"`) is an **invisible internal template**: it stays in DB as the copy source for default-card creation, but is never shown to users and never used as the active card fallback. Active-card resolution prefers a save-bound non-builtin card → then any existing local card → and only auto-creates a fresh editable default card when no local card exists at all (idempotent: checks for existing local cards before creating). New saves bind to the active local card (never builtin). Card-delete fallback picks a remaining local card or auto-creates one. The library view filters builtin cards from the list. Builtin cards still cannot be deleted or directly mutated.
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
- **Workspace tool `scope` is invisible to the agent.** `executeWorkspaceOperation` resolves scope: explicit scope wins; read ops default to `effective` (union view); edit ops infer scope from the path prefix via `scopeForPath` (save/→save-runtime, temp/→temp, frontend/→card-frontend, .tsian/→platform-meta, else→card-content). The agent-facing tool schemas do **not** expose `scope` as a parameter at all; tool descriptions and the text-protocol prompt never mention scope. The agent only knows paths; path prefixes are the user-facing concept. Adding a new scope only touches `scopeForPath` + `DEFAULT_SCOPE_ACCESS` + the `WorkspaceVolume` + `resolveVolumeForScope` — never the tool schemas or prompt. Internal callers still pass scope explicitly because they construct requests directly. The permission boundary is preserved because `assertEditAccess` is path-based, independent of whether scope came from an explicit arg or auto-inference.
- `move` is the only mutation that may write to a different scope than the source path. It resolves `fromScope = scopeForPath(path)` and `toScope = scopeForPath(targetPath)`, finds source files in `fromScope`, writes moved files through `toScope`, then deletes the source prefix through `fromScope`. The request's explicit `scope` only selects/validates the source; it must never force the target write/delete back into the source volume. Host adapters must pass through `writeInput.scope`/`deleteInput.scope` and provide both owner IDs when a Studio card-content move targets a save slot.
- `copy` shares `move`'s source/target scope resolution and directory-prefix traversal, but only writes targets and never deletes the source. It rejects if any target file already exists; callers that want overwrite semantics must add that contract explicitly instead of overloading `copy` silently.
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
