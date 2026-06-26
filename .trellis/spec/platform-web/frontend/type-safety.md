# Type Safety

`platform-web` is strict TypeScript. Normalize unknown data at runtime boundaries and keep shared shapes in `@tsian/contracts`.

## Shared Contracts

- Import bridge, runtime, debug, frontend package, workspace, Agent, Skill, and diagnostic shapes from `@tsian/contracts`.
- Import `RuntimeEngine` from `@tsian/runtime-core`.
- Do not redefine cross-package payloads in platform-web.

## Runtime Boundaries

- Treat AI responses as untrusted strings unless a later task adds structured output validation.
- Validate bridge/platform action inputs before mutating storage.
- Keep workspace write/delete inputs normalized at platform-host or storage boundaries and fail loudly on invalid writes.
- Convert query params at the platform-host boundary before passing to storage helpers.

## Module Resolution

- `tsconfig` uses `moduleResolution: "Bundler"`. Under this mode TypeScript does not auto-append `.vue` when resolving a path alias, so importing a `.vue` SFC requires the **explicit `.vue` suffix**: `import Foo from "@/components/Foo.vue"`. An extensionless `from "@/components/Foo"` compiles in Vite (Rollup resolves it) but fails `vue-tsc` with `TS2307: Cannot find module`. This is a split between the bundler and the type-checker — always include the `.vue` suffix in SFC imports. (Plain `.ts` module imports stay extensionless; `Bundler` resolution handles those.)

## Scenario: Game Card Package And Packaged Frontend

### 1. Scope / Trigger

- Trigger: platform-web imports/exports `*.tsian-card.zip`, changes `src/storage/game-card-packages.ts`, changes packaged frontend storage, or loads `frontend.kind === "packaged"` in `PlayView.vue`.

### 2. Signatures

- `GameCardManifest.frontend?: GameCardFrontendBinding`
- Card content files live in the `gameCardContentFiles` Dexie table (per-file rows keyed `${gameCardId}::${path}`), not on `LocalGameCardRecord`. Read views (`getLocalGameCard` / `listLocalGameCards` / `putLocalGameCard`) return `LocalGameCardView`, which extends `LocalGameCardRecord` with an optional preloaded `coverContentFile` for sync cover rendering.
- `GameCardFrontendBinding = { kind: "remote"; url; bridgeVersion } | { kind: "packaged"; entry; bridgeVersion }`
- `GameCardPackageManifest.manifest: GameCardManifest`
- `GameCardPackageManifest.frontendFiles?: GameCardPackageFileEntry[]`

### 3. Contracts

- Game Card packages are reusable card-content packages, not Save Instance exports. They must not include save snapshots, save history, checkpoints, traces, or player-mutated save runtime files.
- The first package container is zip with `game-card.json`, card-owned content under `workspace/*`, optional `frontend/*`, and reserved `cover/*`.
- `game-card.json` uses `GameCardPackageManifest` with schema `tsian.game-card.package.v1` and embeds the authoritative `GameCardManifest`.
- `GameCardManifest.summary` is the single player-facing intro field. Do not add or persist a parallel Game Card `description`; legacy imported package manifests may fold old `description` into `summary` only when `summary` is missing or blank.
- `GameCardManifest.id` and `GameCardManifest.version` remain package/runtime metadata, but ordinary player-facing UI should not expose them as editable fields.
- `GameCardManifest.frontend` is optional. A frontend-less Game Card is reusable card content, not a playable card.
- When provided, `frontend` must be `remote` or `packaged`. Same-realm `builtin` game frontends are not supported.
- Packaged frontends are built static files under `frontend/`; Tsian must not run source builds, npm install, or framework-specific bundling.
- Packaged frontend files are stored beside the reusable Game Card in `gameCardFrontendFiles`; saves created from a card do not copy those files or card content files.
- `frontend.kind === "packaged"` must run in an iframe and reuse the `tsian.play-bridge.v1` bridge. It must not run in the platform JS realm.
- Packaged frontends use a same-origin virtual resource URL backed by Service Worker/IndexedDB. The first packaged iframe sandbox is compatibility-first: `allow-scripts allow-same-origin allow-forms`. Keep `allow-same-origin` while this loader relies on Service Worker-controlled same-origin iframe clients; sandboxed opaque-origin navigations bypass the local virtual resource layer.
- The virtual resource layer should return CORS-friendly headers for module chunks and other built assets.

### 4. Validation & Error Matrix

- Missing/unsupported package schema -> reject import with a clear package error.
- Missing or malformed embedded manifest -> reject import.
- Legacy embedded manifest with blank/missing `summary` and non-empty `description` -> import by storing that text as `summary`, then omit `description` from future storage/export.
- Built-in blank card id -> reject import; built-in templates are refreshed by platform seed helpers only.
- `frontend.kind === "builtin"` -> reject import/write with a clear unsupported frontend-kind error.
- Missing frontend -> allow import/write, but `/play` must show a not-configured error until a remote or packaged frontend is configured.
- Packaged frontend without a matching entry file -> reject import.
- Absolute paths, path traversal, empty paths, NUL bytes, or unknown top-level roots -> reject import.
- Importing a package creates or updates the reusable Game Card only; it does not create a Save Instance.
- Importing card content under reserved `workspace/save/*` or `workspace/.tsian/*` must fail; those roots are runtime/platform-owned in effective workspaces.
- Exporting a Game Card writes manifest, card content files, and stored packaged frontend files only.

### 5. Good/Base/Bad Cases

- Good: a package with `frontend.kind === "packaged"` includes `frontend/index.html` and lists that file in `frontendFiles`.
- Good: a package with `frontend.kind === "remote"` omits `frontendFiles` and uses a browser-loadable URL.
- Base: a package omits `frontend`; it imports as non-playable card content.
- Base: a legacy package includes `description`; after import/export the Game Card uses only `summary`.
- Bad: a package uses `frontend.kind === "builtin"` or includes save snapshots/checkpoints.
- Bad: ordinary UI exposes Game Card `id`, `version`, or a second `description` text area.

### 6. Tests Required

- Assert package import accepts missing frontend.
- Assert legacy package import folds `description` into `summary` when needed and export omits `description`.
- Assert package import rejects `builtin` frontend kind.
- Assert packaged frontend entries must exist under `frontend/`.
- Assert package export omits save runtime data.

### 7. Wrong vs Correct

#### Wrong

```json
{ "frontend": { "kind": "builtin", "id": "legacy-default" } }
```

#### Correct

```json
{ "frontend": { "kind": "packaged", "entry": "frontend/index.html", "bridgeVersion": "tsian.play-bridge.v1" } }
```

## Scenario: Remote Iframe Play Frontend Bridge

### 1. Scope / Trigger

- Trigger: platform-web loads a Game Card `frontend.kind === "remote"` binding or changes `src/bridge/remote-iframe-bridge.ts` / `PlayView.vue` frontend loading.

### 2. Signatures

- `GameCardManifest.frontend?: GameCardFrontendBinding`
- `mountRemoteIframeFrontend(container, { url, bridge, title, sandbox?, onLoad, onError })`
- `resolvePackagedFrontendUrl({ gameCardId, entry }): Promise<string>`

### 3. Contracts

- `PlayView.vue` remains a thin active frontend loader: wait for `waitForPlatformHostReady()`, read `getPlatformActiveGameCard()`, then mount a sandboxed iframe for remote or packaged bindings. As of task `06-24-game-launcher-saves`, PlayView first resolves the active card into a phase: `launcher` (render `<GameLauncherPanel>` for save select/create/rename/delete, then mount on continue), `unplayable-guide` (active card has no playable frontend — show guidance with links to My Apps / card detail), or `playing` (mount the frontend). The launcher UI lives in `components/play/GameLauncherPanel.vue`; PlayView itself only routes phases and reuses the existing frontend mount logic — it does not inline save-list business UI.
- `PlayView.vue` must not mount same-realm built-in game UI. If the active Game Card has no playable frontend, show the unplayable-guide phase (not an error state) with links to load a different card or configure a frontend.
- Remote frontend URLs are normalized at the iframe adapter boundary. Accept browser-loadable `http:` / `https:` URLs and relative URLs resolving to those schemes; reject dangerous or non-web schemes such as `javascript:`, `data:`, and `vbscript:` before iframe creation.
- The first iframe sandbox is compatibility-first: `allow-scripts allow-same-origin allow-forms`. Do not add top navigation, popups, downloads, or broader permissions without a new product/security decision.
- Remote bridge messages use shared `RemotePlayBridge*` contract types. Runtime validation belongs in platform-web, not in `@tsian/contracts`.
- The adapter must filter by mounted `iframe.contentWindow`, generated session id, and accepted handshake origin before dispatching requests.
- The allowed remote methods are `runtime.getRuntimeSnapshot`, `interaction.sendMessage`, `query.query`, `platform.getPlatformContext`, and `platform.runAction`.
- The default remote bridge must not expose the `debug` namespace and must reject `query.query({ resource: "ai-debug" })`. A `turn-debug-ready` notification may be sent without debug records.
- Workspace read/list/search should reuse existing platform-host query behavior. Workspace write/delete and checkpoint restore should reuse existing `platform.runAction` behavior.

### 4. Validation & Error Matrix

- Missing active Game Card or missing frontend binding -> show a compact not-configured error state.
- Unsupported persisted frontend kind, including stale `builtin` records -> show a compact unsupported frontend error state instead of silently mounting a different frontend.
- Invalid or forbidden remote URL -> show a compact error state before iframe creation.
- Malformed remote request payload -> return a structured bridge error response when the request has a valid session/id; otherwise ignore.
- Remote `ai-debug` query -> structured forbidden error response.
- Iframe load error -> show a compact error state and do not mutate save data.

### 5. Good/Base/Bad Cases

- Good: a card with `frontend.kind === "remote"` loads through `mountRemoteIframeFrontend`.
- Good: a card with `frontend.kind === "packaged"` resolves a Service Worker-backed virtual URL and loads through the same iframe bridge.
- Base: a built-in blank card has no `frontend`; it can seed workspaces and saves, but `/play` reports that no game frontend is configured.
- Bad: `PlayView.vue` imports a game UI module directly and passes the object bridge into the same JS realm.
- Bad: package import accepts `frontend.kind === "builtin"`.

### 6. Tests Required

- Assert remote frontend bindings still resolve and mount.
- Assert packaged frontend bindings validate their `frontend/` entry and mount through iframe bridge.
- Assert frontend-less cards produce a not-configured `/play` error.
- Assert stale/unsupported `builtin` frontend records do not mount same-realm UI.

### 7. Wrong vs Correct

#### Wrong

```typescript
const frontend = activeCard?.manifest.frontend ?? { kind: "builtin", id: "legacy-default" }
```

#### Correct

```typescript
const frontend = activeCard?.manifest.frontend
if (!frontend) {
  setMissingFrontendError(activeCard?.manifest.name)
  return
}
```

## Scenario: Runtime Workspace Registry And Detail Queries

### 1. Scope / Trigger

- Trigger: platform-web exposes cross-layer bridge query resources backed by Runtime Workspace files.
- Applies when adding or changing `agent-registry`, `agent-context`, `skill-registry`, or `skill-detail` behavior in `platform-host`.

### 2. Signatures

- `bridge.query.query<AgentRegistryEntry>({ resource: "agent-registry" })`
- `bridge.query.query<AgentContextEntry>({ resource: "agent-context", params: { agentId } })`
- `bridge.query.query<SkillRegistryEntry>({ resource: "skill-registry", params })`
- `bridge.query.query<SkillDetailEntry>({ resource: "skill-detail", params: { path } })`
- `AgentConfig` card file path: `agents/<agent>/agent.json`
- `AgentRegistryEntry.configPath` points to `agent.json`; `AgentRegistryEntry.path` points to the required SOP file `AGENT.md`.
- `params.agentId?: string`
- `params.includeShared?: boolean`
- `params.includeLocal?: boolean`
- `params.path?: string` for `skill-detail`; use a `SkillRegistryEntry.path` value.

### 3. Contracts

- `agent-registry` returns lightweight `AgentRegistryEntry[]` built from `agents/*/agent.json`; each entry is valid only when the same directory also has a required card-owned `AGENT.md` SOP file.
- `AgentRegistryEntry` includes `configPath`, `path`, `enabledSkills`, `disabledSkills`, `platformTools`, `workspaceAccess`, and declared `contextPaths`. `defaultSkills` remains a compatibility field in the shared shape, but new Agent config must use `agent.json.skills`.
- `agent-context` returns zero or one `AgentContextEntry` assembled from one agent's card-owned `AGENT.md`, optional card-owned `SOUL.md`, save runtime notes/session files, visible skill index, and `contextPaths` declared in `agent.json`.
- `skill-registry` returns lightweight `SkillRegistryEntry[]` built from `skills/*/SKILL.md` and `agents/*/skills/*/SKILL.md`.
- `skill-detail` returns zero or one `SkillDetailEntry` for a selected `SKILL.md` path.
- Default blank Game Card content may include `agents/<agent>/agent.json`, `agents/<agent>/AGENT.md`, `agents/<agent>/SOUL.md`, `agents/studio-assistant/agent.json`, a local `framework-knowledge` Skill, and `docs/tsian-framework-knowledge.md`; default save runtime data includes assistant notes/session under `save/agents/studio-assistant/`.
- Registry entries include path, metadata, and lightweight `SkillActionSummary[]` (name + description + `browser_script` executor type) only. Do not expose full skill instructions, full action declarations (inputSchema/outputSchema/executor path), schemas, examples, scripts, or references through the registry query.
- `SkillRegistryEntry.name` and `description` are the model-facing Skill identifiers. Build them from frontmatter `name` / `description`, with compatibility fallbacks to `id` / `summary` / path-derived values.
- Keep `id`, `title`, `summary`, and `path` for compatibility with bridge/UI/debug consumers.
- Agent context skill indexes must remain lightweight `SkillRegistryEntry[]`; do not load `SKILL.md` bodies through `agent-context`.
- Agent context skill indexes are filtered through the selected Agent's `agent.json.skills` enablement: `disabledSkills` always removes matching Skills; non-empty `enabledSkills` allows only matching Skills; otherwise compatibility defaults come from `defaultSkills`, `appliesTo`, shared Skills without `appliesTo`, and selected-Agent-local Skills.
- Skill detail entries include the selected `SKILL.md` `WorkspaceFile` content and a `SkillResourceEntry[]` resource index. Resource entries must not include file contents.
- Shared registry shapes live in `@tsian/contracts`; platform-web must not redefine them locally.
- Registry parsing is owned by `src/agent-runtime/registry.ts` and must stay pure: pass workspace files in, return entries out. It must not import Dexie tables or bridge objects.
- Skill detail loading belongs beside registry parsing in `src/agent-runtime/registry.ts` and follows the same purity rule.
- Agent context assembly belongs in `src/agent-runtime/` beside registry parsing and follows the same purity rule.

### 4. Validation & Error Matrix

- No active save -> return `{ items: [] }`.
- Missing `agent.json`, malformed `agent.json`, non-object `agent.json`, or missing adjacent `AGENT.md` -> omit that Agent from `agent-registry`.
- `agent-context` missing, blank, non-string, or unknown `params.agentId` -> return `{ items: [] }`.
- `agent-context` missing `SOUL.md` -> return the context entry without `soulFile`; existing cards remain valid.
- `agent-context` missing declared `contextPaths` -> return the context entry with `missingContextPaths` populated.
- `skill-detail` missing, blank, invalid, non-skill, or absent `params.path` -> return `{ items: [] }`.
- Missing or partial Skill frontmatter -> infer safe Skill fallbacks from path, first H1, and first body paragraph.
- Malformed Skill frontmatter -> do not throw from the whole registry query; degrade to path/body fallbacks.
- Non-boolean `includeShared` / `includeLocal` -> treat as omitted.
- Blank or non-string `agentId` -> treat as omitted.

### 5. Good/Base/Bad Cases

- Good: `skill-registry` with `{ agentId: "narrative" }` returns shared skills plus `agents/narrative/skills/*/SKILL.md`, with model-facing `name` and `description`.
- Good: `agent-context` with `{ agentId: "narrative" }` resolves narrative from `agents/narrative/agent.json`, returns narrative `AGENT.md`, optional `SOUL.md`, narrative notes/session if present, and only Skills enabled for narrative.
- Good: disabling `memory-maintenance` in `agents/narrative/agent.json` removes it from narrative `agent-context.skillIndex`.
- Good: `skill-detail` with `{ path: "skills/example/SKILL.md" }` returns the selected `SKILL.md` content and resource metadata for files under `skills/example/`.
- Base: `skill-registry` without params returns shared skills and all agent-local skills.
- Base: an Agent without `SOUL.md`, `enabledSkills`, or `disabledSkills` still loads through safe defaults when `agent.json` and `AGENT.md` exist.
- Base: `skill-detail` for a valid skill with no sibling resources returns one detail entry with `resources: []`.
- Bad: treating `AGENT.md` frontmatter as the Agent configuration source; Agent machine configuration belongs in `agent.json`.
- Bad: registry query returns `SKILL.md` body text or full parsed action declarations (inputSchema/outputSchema/executor path); this breaks progressive disclosure. Lightweight `SkillActionSummary` (name + description + `browser_script` executor type) IS allowed in `SkillRegistryEntry.actions` so the model can see which actions a Skill offers before `use_skill`.
- Bad: `skill-detail` returns `references/*`, `examples/*`, `actions/*`, `schemas/*`, or `scripts/*` content by default; resource contents must be loaded separately by explicit workspace reads or a future resource query.

### 6. Tests Required

- Assert new saves include default `agents/master/agent.json`, `agents/master/AGENT.md`, `agents/narrative/agent.json`, and `agents/narrative/AGENT.md`.
- Assert default built-in card content includes `agents/master/SOUL.md`, `agents/narrative/SOUL.md`, `agents/memory/SOUL.md`, and `agents/studio-assistant/SOUL.md`.
- Assert new saves include default `agents/studio-assistant/agent.json`, `agents/studio-assistant/AGENT.md`, `agents/studio-assistant/skills/framework-knowledge/SKILL.md`, and `docs/tsian-framework-knowledge.md`.
- Assert `agent-registry` returns the default Agent entries for a new save.
- Assert `agent-registry` returns `configPath` as `agents/<agent>/agent.json` while `path` remains `agents/<agent>/AGENT.md`.
- Assert malformed `agent.json` and Agent directories missing `AGENT.md` do not crash registry parsing and are omitted.
- Assert `agent-registry` returns `studio-assistant` for a new save without changing the default turn entrypoint.
- Assert shared and agent-local skills are discovered and sorted deterministically.
- Assert `name` / `description` prefer current Skill frontmatter and fall back to legacy `id` / `summary`.
- Assert malformed or missing Skill frontmatter does not crash parsing.
- Assert `includeShared`, `includeLocal`, and `agentId` filtering behavior.
- Assert `skill-detail` loads shared and agent-local skill paths.
- Assert `skill-detail` rejects non-skill and missing paths.
- Assert `SkillResourceEntry` has no `content` field.
- Assert `agent-context` returns declared existing context files and missing context paths without throwing.
- Assert `agent-context` skill index does not include other agents' local skills.
- Assert `agent-context` includes `soulFile` when `SOUL.md` exists and omits it when missing.
- Assert `agent-context.skillIndex` excludes Skills listed in `disabledSkills`.
- Assert non-empty `enabledSkills` narrows visible Skills to matching id/name/title/path-derived ids.

### 7. Wrong vs Correct

#### Wrong

```typescript
return {
  items: files.map((file) => ({ ...parseSkill(file.content), content: file.content })),
}
```

#### Correct

```typescript
const activeCard = await getPlatformActiveGameCard()
const files = activeCard
  ? await listEffectiveWorkspaceFilesForSave(activeSaveId, activeCard)
  : []
return {
  items: buildSkillRegistry(files, { agentId, includeShared, includeLocal }),
}
```

#### Wrong

```typescript
return {
  items: [{ file, resources: files.filter((item) => item.path.startsWith(skillDir)) }],
}
```

#### Correct

```typescript
const detail = loadSkillDetail(files, path)
return {
  items: detail ? [detail] : [],
}
```

## Workspace State

- `RuntimeGlobalsMap` and workspace JSON file content should remain JSON-compatible when a local convention declares JSON data.
- Structured state belongs in Runtime Workspace files documented by README, schema, Agent, or Skill conventions; do not add a platform-owned table or universal record model for gameplay state.
- Do not loosen contract fields to `unknown` to hide caller bugs.

## Workspace Binary Storage And mediaType Removal

- `WorkspaceFile` / `WorkspaceEntry` / `WorkspaceSearchResult` / `WorkspaceOperationRequest` / `SkillResourceEntry` no longer carry `mediaType`. Derive it at consumption points via `inferMediaTypeFromPath(path, { fallback })` (`apps/platform-web/src/lib/media-type.ts`). The zip manifest entries (`GameCardPackageFileEntry.mediaType`, `FrontendPackageFileEntry.mediaType`, `GameCardContentFile.mediaType?`) remain external format contracts and are populated from path inference on export.
- `WorkspaceFile` carries `content: string` (text files) plus optional `binary?: Blob` (media files, mutually exclusive with meaningful content). `WorkspaceOperationRequest.content` is `string | Blob`. Storage records (`LocalWorkspaceFileRecord`, `LocalGameCardContentFileRecord`) mirror this with `content: string` + `data?: Blob`.
- Binary files surface `content` as a placeholder string (`binaryPlaceholderText(blob, path)` → `[binary file: <type>, <size> bytes — 不可读取为文本]`), NOT empty string — this prevents agents from misjudging binary files as empty. **Multimodal image support (task 06-22-assistant-attachments)**: `workspace_read` on an image binary now returns `imageBase64` (base64 string) + `imageMimeType` with `isBinaryPlaceholder: false`, instead of the placeholder. The agent runtime extracts these into `ContentPart { type: "image" }` and injects them as a separate user message (native) or appends to the user `ContentPart[]` (text) — **never** as text in the JSON observation (base64 as text would explode the context window). `WorkspaceFile.imageMimeType` marks image files; `WorkspaceReadResult.imageBase64` carries the encoded data.
- **Multimodal ContentPart type (task 06-22-assistant-attachments)**: `ContentPart = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string }` (base64, no data URL prefix). `AiChatMessage.content` and `RuntimeChatMessage` user/system `content` are widened to `string | ContentPart[]`. assistant/tool role `content` stays `string` (multimodal only occurs in user input). Each provider adapter has a content builder: `buildOpenAiContent` (→ `image_url` data URL), `buildClaudeContent` (→ `image` source base64), `buildGeminiParts` (→ `inlineData`). `contentToTextPreview` safely degrades `ContentPart[]` to text for debug/logging. `normalizeMessages` preserves `attachments` field on `ConversationMessageRecord`. Token estimation (`estimateAiChatMessagesTokens`/`estimateRuntimeMessagesTokens`) uses `messageContentToText` to extract text parts (images are not counted by char length — providers count image tokens by resolution).
- `mediaType` is never stored on internal records. The Service Worker reads `file.data.type` (Blob's built-in type) instead of a stored `mediaType` field. Covers are stored as Blob (File/Blob) via `writeLocalGameCardContentFile({ data })`, not base64 data URIs; `getGameCardCoverUrl` returns `URL.createObjectURL(coverContentFile.data)`.
- DB name bumps (e.g. `tsian-agent-runtime-v10` → `v11`) are breaking changes with no migration (prototype project). The Service Worker `DB_NAME` must mirror `db.ts`. `inferWorkspaceMediaType` is a thin wrapper over `inferMediaTypeFromPath` with `text/plain` fallback; package/frontend code uses the raw function with `application/octet-stream` fallback.
- Agent-facing workspace read APIs were strengthened (not broken): `workspace.read` now returns `WorkspaceReadResult` (a superset of `WorkspaceFile` — old consumers reading `path`/`content`/`updatedAt` are unaffected, new consumers gain `totalLines`/`returnedLines`/`offset`/`truncated`/`isBinaryPlaceholder`), and `workspace.search` adds `matches`/`matchesTruncated` while keeping `preview`. Agents still read `file.content` (string) only for text files. `searchWorkspaceFiles`/`validateWorkspaceFile` skip binary files. `move` carries `binary` through to the target.
- **Game card manifest fileification (task 06-21 子3)**: `game-card.json` is a synthesized workspace file (not stored as a content row) injected into `listStudioWorkspaceFilesForGameCard` + `listEffectiveWorkspaceFilesForSave` + `executeStudioWorkspaceOperation` card branch's `cardScopedFiles` as `{ path: "game-card.json", content: JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2), createdAt, updatedAt }`. Writing it routes through `ManifestVolume` (`resolveVolumeForScope` special-cases `path === "game-card.json"` under `card-content` scope) → `writeGameCardManifestFileForCard`: JSON parse + `normalizeGameCardManifest` (exported from `game-card-packages.ts`, throws `GameCardPackageError` on invalid) + force-overwrite protected fields (`id` = card's DB id, `schema` = `GAME_CARD_MANIFEST_SCHEMA`, `frontend.bridgeVersion` = `tsian.play-bridge.v1`) → `putLocalGameCard({manifest, contentFiles: undefined})` (content table untouched). `normalizeTemplateFiles` rejects `game-card.json` so it cannot be stored as a content file. Builtin card manifest is read-only (throws on write attempt). This is distinct from the zip package `game-card.json` (which uses `GameCardPackageManifest` schema `tsian.game-card.package.v1` and embeds the authoritative `GameCardManifest`) — the workspace synthesized file is `GameCardManifest` directly (schema `tsian.game-card.v1`).
- **Card frontend single-file write APIs (task 06-21 子3)**: `writeLocalGameCardFrontendFile(cardId, {path, data})` / `deleteLocalGameCardFrontendFile(cardId, path)` / `deleteLocalGameCardFrontendPathForCard(cardId, pathPrefix)` mirror the content-file API pattern (per-row put/delete + bump card `updatedAt` in the same transaction, no full `putLocalGameCard` rewrite). `CardFrontendVolume.write` wraps text `content` into a Blob via `writeLocalGameCardFrontendFile` and returns a `WorkspaceFile` matching enumerate's text/media split. These fill the placeholder throws left by task 06-21 子5.
- **Workspace tool `scope` auto-inference, invisible to agent (task 06-22 scope auto-inference)**: `WorkspaceOperationRequest.scope` is optional (`scope?: WorkspaceScope`). `executeWorkspaceOperation` resolves it via `resolveOperationScope(operation, requestInput)` — explicit scope wins; read ops default to `"effective"`; edit ops infer from path via `scopeForPath`. The agent-facing tool schemas in `tool-schemas.ts` do **not** expose `scope` in `properties` at all (the enum constant `WORKSPACE_SCOPE_ENUM` was removed); tool `description` and the text-protocol prompt never mention scope. `RuntimeWorkspaceToolCall.arguments.scope` is read defensively (`typeof === "string"` guard in `emitWorkspaceToolTrace`) for back-compat with any stale caller. Internal callers (`browser-skill-script-executor.ts`, `platform-host/index.ts`, `workspace-ops.ts`) always pass scope explicitly, so the optional type does not weaken the internal contract. Permission enforcement is path-based (`assertEditAccess`→`accessForPath`→`scopeForPath`→`DEFAULT_SCOPE_ACCESS`), so auto-inference does not change the actor-level boundary.

## Scenario: Card Content And Save Runtime Effective Workspace

### 1. Scope / Trigger

- Trigger: platform-web creates saves, imports/exports Game Cards, lists Runtime Workspace files, runs Agent Runtime turns, commits workspace mutations, checkpoints, or restores checkpoints.

### 2. Signatures

- Card content files are stored per-file in `gameCardContentFiles` (keyed `${gameCardId}::${path}`), not embedded in `LocalGameCardRecord`. Consumers receive `LocalGameCardView` (extends `LocalGameCardRecord` with optional preloaded `coverContentFile`) from `getLocalGameCard` / `listLocalGameCards` / `putLocalGameCard`; use `listLocalGameCardContentFiles(cardId)` for the full list and `readLocalGameCardContentFile(cardId, path)` for a single file.
- `LocalWorkspaceFileRecord.path` stores save runtime files only: `save/...` and platform-owned `.tsian/...`.
- Runtime reads use `listEffectiveWorkspaceFilesForSave(saveId, card)` and receive card content plus selected save runtime data.
- Runtime commits use `saveRuntimeFilesFromEffectiveWorkspace(files)` before replacing `workspaceFiles`.

### 3. Contracts

- Game Card content owns Agents, Skills, schemas, rules, docs, frontend definitions, manifest metadata, and frontend binding. The assistant agent identity is platform-local under `.tsian/local/assistant/`, not Game Card content.
- Save runtime data owns dialogue/history, generated entities, maps, relationships, memory summaries, frontend view state, Agent notes/session transcripts, and `.tsian` diagnostics for one playthrough.
- Effective workspace composition is deterministic: card content appears at its card path, active save runtime data appears under `save/`, and `.tsian/` is visible in the resource manager (C-drive model) but remains hidden from ordinary Agent/Skill/frontend read/list/search APIs (actor level 4 required).
- Game Card content must not define `save/...` or `.tsian/...`.
- **Two distinct actor classes share the workspace operation path, distinguished by actor level (not by turn vs. non-turn):**
  - **Runtime game agents** (the agents defined in a card's `agents/`, running during a play turn): default `workspaceAccess.level` is `1` (`DEFAULT_AGENT_ACCESS_LEVEL`, registry.ts). `card-content` scope `editLevel` is `2`, so `assertEditAccess` rejects their card-content writes with `WORKSPACE_EDIT_ACCESS_DENIED` before any mutation runs. They can only write `save-runtime` (editLevel 1). This is the intended permission gate — runtime game agents must not mutate card content during play.
  - **Desktop assistant** (the platform management assistant at `.tsian/local/assistant/`): default `workspaceAccess.level` is `4` (highest, `local-assistant-files.ts`), resolved via `agentContext.agent.workspaceAccess.level` in the runtime turn path and via `resolveLocalAssistantActorLevel()` in the `executePlatformAction` path. At level 4 it passes `assertEditAccess` for all scopes (`card-content`: 2, `save-runtime`: 1, `platform-meta`: 4), so it can manage every resource-manager-visible path — the user's right hand, including its own definition.
- **Card-content writes bypass the save transaction, not the permission gate.** When the desktop assistant writes `card-content` during a runtime turn, the non-staged branch of `executeWorkspaceOperationForActiveSave`'s `mutations.write` routes the write through `executeWorkspaceMutation` (dispatch) → `CardContentVolume` → `writeLocalGameCardContentFile` (per-file content table) — **not** `activeWorkspaceTransaction.write`, because the save transaction only accepts `save/...` paths (`assertOrdinarySaveRuntimeMutationPath` throws `WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED` otherwise). Card content is not part of save checkpoints (checkpoints snapshot save-runtime only), so routing it around the save transaction is correct. `assertEditAccess` (run by `executeWorkspaceOperation` before the mutation) is the sole authority gate — it already blocks runtime game agents (level 1 < 2) and admits the assistant (level 4 ≥ 2). Never route card-content mutations through the save transaction; that is a semantic contradiction (accepting the scope but delegating to a transaction that rejects its paths). See the "Workspace Volume Abstraction And Single Dispatch" scenario in state-management.md.
- **"Visible = editable = manageable" principle**: if a path is visible in the resource manager, the user can edit it (via the Studio editor) and the desktop assistant can manage it (via `workspace_write`/`workspace_delete` at its configured actor level). There is no "visible but assistant cannot touch" gray zone — the resource manager's visibility is the contract for both human and assistant editability. This includes the assistant managing its own definition (`.tsian/local/assistant/agent.json` and identity files). See also the [Data Fileification Principle](../../guides/data-fileification-principle.md).
- Checkpoints snapshot and restore save runtime files only. Restored checkpoints continue to use current Game Card content.

### 4. Validation & Error Matrix

- Card content path under `save/...` or `.tsian/...` -> reject card write/import.
- Runtime game agent (level 1) workspace write/delete on `card-content` -> `WORKSPACE_EDIT_ACCESS_DENIED` (editLevel 2 required; `assertEditAccess` in `executeWorkspaceOperation` rejects before mutation). They can only write `save-runtime` (editLevel 1).
- Runtime game agent workspace write/delete under `.tsian/...` without actor level 4 -> `WORKSPACE_PLATFORM_METADATA_FORBIDDEN`.
- Desktop assistant workspace write/delete denied when its configured `workspaceAccess.level` < the target scope's `editLevel` (`card-content`: 2, `save-runtime`: 1, `platform-meta`: 4) -> `WORKSPACE_EDIT_ACCESS_DENIED`. With the default level 4 it can write all three scopes; the level is resolved from `agentContext.agent.workspaceAccess.level` (runtime turn path) or `resolveLocalAssistantActorLevel()` (`executePlatformAction` path), never hardcoded.
- Effective workspace read/list/search -> hides `.tsian/...` and can surface both card content and `save/...` files.
- **Never hardcode `actorLevel` for the desktop assistant path** — a hardcoded value short-circuits `resolveWorkspaceActorLevel`'s fallback chain and silently overrides the user's configured `workspaceAccess.level`. Always pass `actorLevel: await resolveLocalAssistantActorLevel()` (undefined when config is missing, so the default applies). This was a real bug: `executePlatformAction` hardcoded `actorLevel: 1`, making the assistant's configured level 4 unreachable.
- **Never route `card-content` mutations through `activeWorkspaceTransaction`** (the save transaction). The save transaction's `assertOrdinarySaveRuntimeMutationPath` only accepts `save/...`, so routing card-content there throws `WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED` — a semantic contradiction (accepting the scope but delegating to a transaction that rejects its paths). The non-staged branch of `executeWorkspaceOperationForActiveSave`'s `mutations` must route `card-content` write/delete through `executeWorkspaceMutation` (dispatch → `CardContentVolume` → per-file content table). The `runAssistantChat` runtime agent turn's `workspaceMutations` is a staged path that keeps `card-content` throws in the upper layer (see "Workspace Volume Abstraction And Single Dispatch" in state-management.md). `assertEditAccess` is the sole authority gate and already blocks runtime game agents.

### 5. Good/Base/Bad Cases

- Good: editing `agents/master/AGENT.md` on the Game Card affects existing saves on the next effective workspace read.
- Good: a turn writes `save/history/turns/turn-000001.json` and checkpoints that save runtime file.
- Base: a frontend-less blank card has content but no playable frontend binding.
- Bad: save creation copies `agents/*` or `skills/*` into `workspaceFiles`.
- Bad: checkpoint restore rolls back Game Card content.

### 6. Tests Required

- Assert save creation seeds runtime files under `save/...` without copying card content.
- Assert effective workspace registry/detail queries see card Agents/Skills and active save runtime files.
- Assert ordinary runtime writes outside `save/...` fail.
- Assert commit/checkpoint persistence filters out card content and keeps save runtime data.

### 7. Wrong vs Correct

#### Wrong

```typescript
const cardFiles = await listLocalGameCardContentFiles(card.id)
const workspaceFiles = cardFiles.map((file) =>
  createLocalWorkspaceFileRecord(saveId, file),
)
```

#### Correct

```typescript
const effectiveFiles = await listEffectiveWorkspaceFilesForSave(saveId, card)
const runtimeFiles = saveRuntimeFilesFromEffectiveWorkspace(effectiveFiles)
```

## Scenario: Runtime Tool Boundary Classification

### 1. Scope / Trigger

- Trigger: platform-web adds or changes Agent Runtime tools, action executors, platform actions, or Skill action conventions.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts`, `apps/platform-web/src/agent-runtime/workspace-tools.ts`, `apps/platform-web/src/platform-host/index.ts`, `apps/platform-web/src/storage/workspace.ts`, default workspace files, or Skill action declarations.

### 2. Signatures

- Runtime tool call shape remains:

```typescript
interface RuntimeWorkspaceToolCall {
  name: string
  arguments: Record<string, unknown>
}
```

- Skill actions route through `run_script`, which only executes `browser_script` actions:

```json
{
  "name": "example_action",
  "description": "Run a trusted Skill-local browser script through the Tsian SDK.",
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" },
  "executor": {
    "type": "browser_script",
    "path": "scripts/run.js",
    "timeoutMs": 10000
  }
}
```

> After the tool/skill decouple task, `browser_script` is the **only** supported action executor. `builtin`, `platform_action`, and `workspace_operation` executor types are rejected at parse time (`ACTION_EXECUTOR_INVALID`) and registry build (reported in `actionDeclarationErrors`). Single workspace operations use the top-level `workspace.read/write/...` tools directly; multi-step workspace orchestration is written as a `browser_script` that chains SDK calls.

### 3. Contracts

- Add a platform runtime primitive only when the ability is small, stable, cross-playstyle, and requires runtime internals such as Agent registry, Skill registry, context assembly, model invocation, trace, checkpoint behavior, workspace indexes, or tool/session state.
- Keep primitives few. Current examples are `use_skill` (declare intent + framework injects full SKILL.md next round), `run_script` (execute a Skill's `browser_script` action), generic workspace operations exposed as `workspace.read/list/search/...`, and contacts-gated `agent_call`.
- Add a platform controlled action / executor when the ability performs side effects or needs platform execution control such as scoped workspace mutation, browser-limited script execution, remote HTTP, WASM, abort/timeout, result normalization, or frontend-data mutation.
- Add a Skill action when the ability is gameplay, world, memory, rules, narrative, style, or author-policy specific, or when it packages several primitive/controlled actions into a reusable business operation.
- Keep gameplay data structures in Runtime Workspace files, README files, and schemas. Platform code should not hardcode world-state semantics when a Skill plus workspace schema can own them.
- Do not add platform tools merely because Web lacks Bash. Bash-like breadth should be approximated through controlled executors plus reusable Skill actions, not an unbounded built-in tool list.

### 4. Validation & Error Matrix

- New runtime primitive without runtime-internal dependency -> reject in review; implement as Skill action.
- New platform action that mutates workspace/state without allow-listing and input validation -> reject in review.
- New Skill action that bypasses `use_skill` activation gating -> reject in review.
- New Skill action declaring a non-`browser_script` executor (`builtin`/`platform_action`/`workspace_operation`) -> reject in review; only `browser_script` is supported.
- New platform code that hardcodes gameplay-specific state semantics -> reject in review unless a task explicitly promotes that semantic to platform scope.
- New tool/action that can produce large raw prompt/context output -> require summary behavior, pagination, or explicit read-by-path semantics.

### 5. Good/Base/Bad Cases

- Good: `agent_call` as a contacts-gated runtime primitive, because it needs Agent registry, target context assembly, model invocation, call-depth limits, and trace.
- Good: a Skill action with a `browser_script` executor that chains workspace SDK reads/writes inside the script to orchestrate a multi-step business operation.
- Good: `relationship-maintainer` as a Skill that reads workspace schemas and calls controlled workspace writes (either top-level `write` for single ops, or a `browser_script` for multi-step).
- Base: a Skill action declaring `browser_script` for a single read+transform+write flow; the model uses `run_script` once instead of repeated top-level tool calls.
- Bad: adding `update_relationship_score` as a platform runtime tool; relationship semantics belong to Skill + workspace schema.
- Bad: a Skill action declaring a `workspace_operation` or `builtin` executor; these types are no longer supported — use `browser_script` or guide the model to top-level workspace tools.
- Bad: exposing a broad browser/remote/script executor directly as an always-visible runtime tool without Skill gating or execution controls.

### 6. Tests Required

- Assert new runtime primitives validate arguments and return structured observations on invalid input.
- Assert new platform actions are allow-listed before Agent Runtime can invoke them.
- Assert Skill actions remain unavailable until their declaring Skill is activated via `use_skill`.
- Assert Skill actions declaring non-`browser_script` executors are rejected with `ACTION_EXECUTOR_INVALID` and reported in registry `actionDeclarationErrors`.
- Assert gameplay-specific mutations flow through Skill `browser_script` actions and top-level workspace tools, not direct platform semantic helpers.
- Assert trace records the primitive/action boundary without storing large raw payloads by default.

### 7. Wrong vs Correct

#### Wrong

```typescript
RUNTIME_WORKSPACE_TOOL_NAMES.updateRelationship = "update_relationship_score"
```

#### Correct

```json
{
  "name": "update_relationship_score",
  "description": "Update relationship state according to this world's schema.",
  "inputSchema": { "type": "object" },
  "executor": {
    "type": "browser_script",
    "path": "scripts/update_relationship.js",
    "timeoutMs": 10000
  }
}
```

## Scenario: Workspace-Defined Agent Runtime

### 1. Scope / Trigger

- Trigger: `interaction.sendMessage` runs AIRP turns using Runtime Workspace Agent definitions.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts`, `apps/platform-web/src/agent-runtime/context.ts`, or the `sendMessage` path in `apps/platform-web/src/platform-host/index.ts`.

### 2. Signatures

- Production turn input includes `workspaceFiles: WorkspaceFile[]`.
- `runAgentRuntimeTurn(input, capabilities)` returns `{ replyText, agentSessionTranscripts }`. The input includes `agentId` to specify the entry agent.
- Debug labels use `"entry-agent"` for the entry agent and `agent:<id>` for delegated agents.

### 3. Contracts

- `platform-host` owns storage access. It must initialize the save runtime defaults, assemble `listEffectiveWorkspaceFilesForSave(activeSaveId, activeCard)`, then pass that effective workspace into Agent Runtime.
- `agent-runtime` owns prompt composition. It uses `assembleAgentContext(workspaceFiles, { agentId: input.agentId })` for the single entry agent call. The entry agent orchestrates other agents through `agent_call` as directed by its AGENT.md, SOUL.md, and contacts configuration.
- Model messages may include `AGENT.md`, optional `SOUL.md`, notes/session files, declared context files, missing context paths, filtered lightweight skill index, recent history, turn number, and player input.
- Skill indexes inside runtime prompts must remain lightweight `SkillRegistryEntry[]`; do not call `loadSkillDetail` from the default turn path.
- `agent-runtime` must not import Dexie tables, platform bridge objects, or platform-host helpers.

### 4. Validation & Error Matrix

- Empty save runtime data on an active save -> `initializeWorkspaceForSave` fills `save/...` defaults before runtime reads files.
- Effective workspace missing the entry agent definition -> `sendMessage` fails with a clear runtime error; do not fall back to legacy hardcoded prompts.

- Effective workspace missing `agents/<agent>/SOUL.md` -> continue without `soulFile`; this is compatibility input, not a runtime error.
- Missing declared `contextPaths` -> include missing path diagnostics in prompt context; do not fail the turn for that reason alone.
- Model returns empty reply -> keep existing empty-reply error behavior.

### 5. Good/Base/Bad Cases

- Good: a new save uses the entry agent AGENT.md plus optional SOUL.md in the model system prompt. The entry agent may contact other agents through agent_call.
- Good: old local save with zero runtime files receives default `save/...` files before the turn.
- Base: production `sendMessage` must pass workspace files; there are no legacy fallback prompts.
- Bad: production `sendMessage` omits workspace files and silently uses hardcoded prompts.
- Bad: missing required Agent definitions are auto-recreated in a non-empty workspace, hiding user/content configuration problems.

### 6. Tests Required

- Assert `sendMessage` passes workspace files into `runAgentRuntimeTurn`.
- Assert the entry agent definition appears in generated model messages for a new save.
- Assert missing declared context paths are included as diagnostics.
- Assert skill detail contents are not included unless a future task explicitly loads them.
- Assert missing required Agent definitions in a non-empty workspace fail clearly.

### 7. Wrong vs Correct

#### Wrong

```typescript
await runAgentRuntimeTurn({ userInput, recentHistory, snapshot }, capabilities)
```

#### Correct

```typescript
await initializeWorkspaceForSave(activeSaveId)
const activeCard = await getPlatformActiveGameCard()
const workspaceFiles = activeCard
  ? await listEffectiveWorkspaceFilesForSave(activeSaveId, activeCard)
  : []
await runAgentRuntimeTurn({
  userInput,
  recentHistory,
  snapshot,
  workspaceFiles,
}, capabilities)
```

## Scenario: Runtime Agent Tool Calls

### 1. Scope / Trigger

- Trigger: Agent Runtime lets a model request Skill detail or read-only Runtime Workspace data during a turn.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts` or `apps/platform-web/src/agent-runtime/workspace-tools.ts`.

### 2. Signatures

- Textual tool-call block:

```md
<tsian-tool-call>
{"name":"use_skill","arguments":{"name":"prose-style"}}
</tsian-tool-call>
```

- Internal parsed shape:

```typescript
interface RuntimeWorkspaceToolCall {
  name: string
  arguments: Record<string, unknown>
}
```

- Supported tool names:
  - `use_skill`
  - `run_script`
  - `agent_call`
  - `workspace.read`
  - `workspace.list`
  - `workspace.search`
  - `workspace.semantic_search`
  - `workspace.diff`
  - `workspace.write`
  - `workspace.edit`
  - `workspace.move`
  - `workspace.delete`
  - `workspace.validate`
- Agent platform tool groups from `AgentRegistryEntry.platformTools`:
  - `agent_call`
  - `workspace_read`
  - `workspace_write`
  - `workspace_semantic_search`

- Native function-calling tool schema (`agent-runtime/tool-schemas.ts`):

```typescript
interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
function buildEnabledToolSchemas(options: {
  enabledPlatformTools: AgentPlatformToolName[]
  allowAgentCall: boolean
  visibleContacts: AgentRegistryEntry[]
}): ToolSchema[]
```

- Native model-call result (`runtime-host/ai.ts`):

```typescript
interface NativeToolCall { id: string; name: string; arguments: Record<string, unknown> }
type RuntimeChatMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string; toolCalls?: NativeToolCall[] }
  | { role: "tool"; toolCallId: string; content: string }
interface ModelCallResult { text: string; toolCalls: NativeToolCall[]; raw: string; finishReason: "stop" | "tool_calls" }
```

### 3. Contracts

- Runtime tools execute against the `WorkspaceFile[]` and `AgentContextEntry` already assembled inside `runAgentRuntimeTurn`.
- `agent-runtime` must not import Dexie, storage helpers, bridge objects, or `platform-host`.
- The Agent Runtime supports two tool-call modes, selected per model via `BrowserAiModelConfig.toolCallMode` (threaded into `BrowserAiConfig.toolCallMode` and the `AgentRuntimeCapabilities.toolCallMode` field):
  - `text` (default): the legacy `<tsian-tool-call>` text-embedding protocol. `callModel` returns `Promise<string>`; the tool loop parses calls with `parseRuntimeWorkspaceToolCalls` and threads observations back as user messages. This path is unchanged.
  - `native`: API-native function calling. The runtime dispatches `callAgentModelWithWorkspaceToolsNative` only when `capabilities.toolCallMode === "native"` and the host provides `callModelNative`. `callModelNative(messages: RuntimeChatMessage[], options, tools: ToolSchema[]): Promise<ModelCallResult>` sends the provider's native `tools` field and structured messages (assistant `toolCalls` + `tool` observation role with `toolCallId`), and returns a structured `ModelCallResult`. `executeRuntimeWorkspaceToolCalls` is reused unchanged: `NativeToolCall[]` are wrapped into `ParsedRuntimeWorkspaceToolCall` (`nativeToolCallsToParsed`) so tool execution stays single-implementation.
- `buildEnabledToolSchemas` reuses the same gating as the text-protocol prompt (`AGENT_PLATFORM_TOOL_NAMES`, `platformToolEnabled`, contacts + `allowAgentCall`): `use_skill`/`run_script` always; `ask_user` under the `ask_user` platform tool (assistant default on, game agents default off — default state derived per-agent by `defaultPlatformToolsForAgent` in `permissions.ts`, not a single `DEFAULT_AGENT_PLATFORM_TOOLS` array); `agent_call` only with contacts + `agent_call` enabled; workspace read tools under `workspace_read`; workspace write/delete/move/validate under `workspace_write`. Tool `description` text is declarative (what it does + key parameter constraints), not tutorial-style.
- `buildWorkspaceToolInstructions` branches on `toolCallMode`: native mode removes the `<tsian-tool-call>` format teaching (the API owns tool-call formatting) and tells the model to use the provided function tools; text mode keeps the existing format teaching unchanged.
- Provider adapters (`runtime-host/ai.ts`) extend `ProviderAdapter` with `buildNativeRequestBody(config, messages, tools)` and `extractNativeResult(payload): ModelCallResult`. OpenAI/DeepSeek use `tools:[{type:"function",function:{...}}]`, `role:"tool"`+`tool_call_id`, parse `choices[0].message.{content,tool_calls}`+`finish_reason`. Gemini uses `tools:[{functionDeclarations}]`, `functionCall`/`functionResponse` parts, parses `candidates[0].content.parts[]`+`finishReason`. Claude uses `tools:[{name,description,input_schema}]`, `tool_use`/`tool_result` blocks, parses `content[]`+`stop_reason`. `generateAssistantReplyNative` mirrors `generateAssistantReply`'s fetch/debug structure.
- Streaming (SSE) is native-mode only and lives in a parallel `streamAssistantReplyNative(messages, options): Promise<ModelCallResult>` plus five adapter methods: `buildStreamUrl`, `buildStreamRequestBody`, `extractStreamDelta`, `extractStreamToolCalls`, `extractStreamFinish`. OpenAI/Claude inject `stream: true` after the custom-params merge (so a user `stream` value cannot override the adapter); Gemini switches the URL to `:streamGenerateContent?alt=sse` and leaves the body unchanged. Claude SSE is event-based: the stream loop maintains `currentEvent` and dispatches `content_block_delta`/`content_block_start`(tool_use)/`input_json_delta`/`message_delta` to the right extractor. OpenAI tool-call arguments stream incrementally keyed by `index`; Gemini `functionCall` arrives complete. The stream loop pushes every text delta to `onDelta` (thought-round text included — there is no `onReset`; the whole turn streams) and accumulates tool calls in the background. A non-`text/event-stream` response falls back to one-shot `response.json()` + `extractNativeResult` (no `onDelta`). `config/ai.ts` `PROTECTED_CUSTOM_REQUEST_KEYS` no longer includes `"stream"` because the adapter owns it.
- The streaming `onDelta` signature chain is `(delta, round) => void` end to end: `AgentRuntimeTurnInput.onDelta` (entry callback from UI/host) → `AgentRuntimeModelCallOptions.onDelta` + `round` (the native loop sets `round` per iteration) → `streamAssistantReplyNative` `onDelta(delta, round)`. Delegated `agent_call` targets are built without `onDelta`, so their `callModelNative` closure takes the `!options.onDelta` branch and uses the non-streaming `generateAssistantReplyNative` — only the entry agent streams to the UI.
- `AiChatMessage` (contracts) is unchanged. `RuntimeChatMessage` is an internal type; debug/transcript records downgrade tool observations to `AiChatMessage` (tool role -> user + `[tool:id]` observation text).
- The `toolCallMode` capability field is resolved once per turn from the entry/local-assistant agent's model config and drives the whole turn's dispatch. Delegated `agent_call` targets resolve their own model config inside the `callModelNative` closure via `options.agentId`; if their model is `text` while the turn is `native`, the turn's native dispatch still applies (single-turn mode assumption — configure all contacted Agents' models consistently for now).
- Effective runtime permissions are derived from the current Agent's `agent.json` via `AgentRegistryEntry.platformTools` and `AgentRegistryEntry.workspaceAccess`.
- `use_skill` and `run_script` remain available by default because Skill installation/enablement is player/card-author controlled. Skill executor side effects still obey the current Agent's platform workspace permissions.
- `agent_call` is advertised and executable only when the current Agent's `agent_call` platform tool is enabled and normal contact/depth/budget checks also allow it.
- `workspace_read` maps to generic `workspace.list`, `workspace.search`, and `workspace.read`.
- `workspace_write` maps to generic `workspace.diff`, `workspace.write`, `workspace.edit`, `workspace.move`, `workspace.delete`, and `workspace.validate`.
- `use_skill` arguments: `{ name: string }`.
- `use_skill` resolves only against the current Agent's visible `skillIndex`.
- `use_skill` must not activate a Skill that exists on disk but was removed from the current Agent's `skillIndex` by `disabledSkills` or a non-matching non-empty `enabledSkills` list.
- `use_skill` should match `SkillRegistryEntry.name` first, then fall back to `id` for compatibility.
- If a local and shared Skill share a name, prefer the current Agent's local Skill.
- `use_skill` is the B-scheme two-step flow's first step: it declares intent, parses `tsian-actions` fenced JSON blocks from the `SKILL.md` body, and registers declared actions into the current tool loop's session state. Its observation returns only a lightweight confirmation `{ skill, activated: true, actions: [{ name, description, executorType, executable }], actionDeclarationErrors? }` — it must NOT return the full `SKILL.md` content, a resource index, or resource file contents.
- After a round in which `use_skill` activated new skills, the framework injects each newly-activated skill's full `SKILL.md` as an extra user message (after that round's tool observations, before the next model call). Injection is de-duplicated via `RuntimeWorkspaceToolSessionState.injectedSkillPaths` so repeated `use_skill` on the same skill does not re-inject. The model sees the full SKILL.md in the next round's context without spending a tool-result round on it.
- `use_skill` is parallel-safe (only mutates session state, not workspace) and listed in `PARALLEL_TOOL_NAMES`.
- Declared Skill action summaries (name + description + `browser_script` executor type) are parsed at registry build time into `SkillRegistryEntry.actions` so the model can see which actions a Skill offers before `use_skill`. Full action declarations (inputSchema/outputSchema/executor path) are NOT in the eager Skill Index or `agent-context` — progressive disclosure is preserved.
- `run_script` arguments: `{ skill: string, script: string, input?: Record<string, unknown> }`. `script` is the action name returned by `use_skill`.
- `run_script` requires that the named Skill has already been activated via `use_skill` by the same Agent during the same tool loop; otherwise `SKILL_NOT_ACTIVATED`.
- `run_script` validates action availability, executor type (`browser_script` only — otherwise `ACTION_NOT_BROWSER_SCRIPT`), and input before invoking the executor.
- `run_script` routes to the action's `browser_script` executor through `executeSkillAction`, which resolves the script path relative to the declaring Skill directory and runs it via the injected `runBrowserScript` capability.
- `run_script` checks the lightweight executor-class policy before running. The default code-level policy allows `browser_script`; injected policy may deny it for tests or future host policy (subtask 4 wires the actual host policy). Do not add Settings UI, localStorage persistence, runtime prompts, or per-Skill trust state for this slice.
- `run_script` may validate successful executor output when the action declares optional `outputSchema`. Actions without `outputSchema` keep existing output behavior.
- `run_script` is kept serial (not in `PARALLEL_TOOL_NAMES`) because `browser_script` has side effects and a bounded timeout.
- `agent_call` arguments: `{ agentId: string, request: string, reason?: string, contextSummary?: string, expectedOutput?: string, historyMode?: "minimal" | "recent" | "scene", timeoutMs?: number }`. `timeoutMs` is the optional per-call timeout quota in ms (defaults to 300000); on elapsed, the call aborts softly and returns `AGENT_CALL_FAILED` with `{ timeout: true, taskTimeoutMs }` details.
- `agent_call` is exposed in runtime tool instructions only when the current Agent has visible contacts, the current tool loop allows Agent calls, and the current Agent's platform tool config enables `agent_call`.
- `agent_call` validates the target against the caller Agent's `contacts`; contacts are a runtime stability boundary, not a full security model.
- `agent_call` builds the target Agent's own `AgentContextEntry`, including its `AGENT.md`, optional `SOUL.md`, notes/session, declared context files, and filtered lightweight Skill Index.
- `agent_call` returns a structured observation containing `{ status: "completed", targetAgent, historyMode, metadata, response }`; the target Agent response does not directly become player-visible history.
- `historyMode` defaults to `recent`; concrete history window sizes remain platform policy.
- Agent Runtime collaboration policy is code-level/default-only for this slice: defaults are `maxDepth=2`, `historyWindows={ minimal: 0, recent: 6, scene: 12 }`; runtime capabilities may inject policy overrides for tests or future host-owned configuration, but there is no Settings UI, localStorage persistence, runtime prompt, or per-Agent trust state. The tool loop has **no per-Agent round limit** and `agent_call` has **no per-turn call-count limit** — termination relies on `finishReason: stop`, abort, and the mode-specific budget fallback. **Master (narrative mode)**: `ContextBudgetExhaustedError` after one in-turn narrative compression. **Delegated `agent_call` targets (task mode)**: multi-compress + `TaskTimeoutError` (timeout fallback) + `TaskCompressionStalledError` (stall early-exit), with `ContextBudgetExhaustedError` as the "nothing left to compress" fallback. `callCount` is retained as a diagnostic counter (trace metadata) but no longer gates execution. `maxDepth=2` remains as the recursion safety net (prevents unbounded agent_call nesting; token budget cannot bound recursion depth). See the "Turn Token Budget And In-Turn Compression (Narrative + Task modes)" and "Parallel agent_call Within A Round" scenarios.
- Delegated Agents derive their own runtime permissions from the target Agent's `agent.json`; the caller Agent's permissions must not leak into the target Agent step.
- Delegated Agents may use their own exposed generic workspace operations, `use_skill`/`run_script` for activated Skills, and limited nested `agent_call` inside their own tool loop.
- Limited nested `agent_call` remains contacts-gated at every hop and depth-limited by policy. There is no per-turn call-count budget (`maxCallsPerTurn` was removed); agent_call frequency is bounded by the turn token budget, not a count cap. With the default `maxDepth=2`, the root entry agent at depth `0` may call a delegated Agent at depth `1`; that Agent may call one of its own contacts at depth `2`; Agents already at depth `2` receive `AGENT_CALL_UNAVAILABLE` with compact depth metadata on direct `agent_call` attempts.
- The root turn shares one `agent_call` budget across the entry agent and nested delegated steps.
- Action executor declarations MUST specify `{ type: "browser_script", path: string, timeoutMs?: number }`. Missing executor or non-`browser_script` types (`builtin`/`platform_action`/`workspace_operation`) are rejected with `ACTION_EXECUTOR_INVALID` at parse time and reported in registry `actionDeclarationErrors`.
- `browser_script` executors route through an injected `runBrowserScript` capability; `agent-runtime` must not import platform-host, bridge objects, Dexie, storage helpers, or Worker code.
- `browser_script` declarations require `{ type: "browser_script", path: string, timeoutMs?: number }`; `path` resolves relative to the declaring Skill directory and must stay under that directory.
- Controlled async executors have bounded timeout/abort behavior. `timeoutMs` must be positive and must not exceed the platform maximum.
- The first browser script capability profile is a strong Tsian SDK, not raw browser/internal access. Scripts can use SDK workspace read/list/search/glob/diff/patch/write/move/delete/validate, SDK fetch where browser policy permits, structured log/trace, timeout/abort, and JSON-compatible input/output. Multi-step workspace orchestration (read -> transform -> write) is written as a `browser_script` that chains SDK calls; the model invokes it with one `run_script` call. SDK `tsian.workspace` methods mirror the top-level workspace tools and must pass the same Agent `workspace_read`/`workspace_write` exposure gates via `executeWorkspaceOperation` — they must not bypass the operation allow-list or actor-level checks.
- The first browser script slice must not expose raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals as supported script APIs. Worker hard limits still apply, and this is a third-party trust boundary rather than a guarantee that arbitrary third-party code is safe.
- Generic workspace operations pass two hard gates: the operation must be exposed in the current runtime context, and the actor level must satisfy the target read/edit level. Missing or invalid Agent `workspaceAccess.level` in `agent.json` defaults to `1`. **Exception — desktop assistant**: its actor level is resolved live from `.tsian/local/assistant/agent.json` by `resolveLocalAssistantActorLevel` (default `4`), not from the runtime agent context, because it is the platform management assistant rather than a runtime game agent. The `executePlatformAction` path must never hardcode `actorLevel` — see the Validation & Error Matrix above.
- Browser script SDK workspace methods must receive the same current Agent context and exposed workspace operations as the top-level workspace tools. A `browser_script` must not perform an operation that the Agent's `workspace_read` / `workspace_write` groups disabled.
- Inside `interaction.sendMessage`, save-runtime workspace mutations run against a staged Runtime Workspace transaction. Same-turn tools and scripts must see staged writes/deletes, but ordinary workspace mutations persist only when the turn succeeds.
- Successful turns commit the staged workspace final state atomically with accepted snapshot/history and after-turn checkpoint creation. Failed or aborted turns discard ordinary staged mutations.
- Ordinary Agent/Skill workspace mutations must reject `.tsian/*` targets. `.tsian/*` is platform-owned metadata space for trace/checkpoint/index/cache behavior.
- Frontend bridge `platform.runAction` generic workspace actions such as `workspace.write` and `workspace.delete` remain immediate platform actions and are not part of the Agent Runtime turn transaction. (The Agent Runtime's `runPlatformAction` action-executor capability was removed in the tool/skill decouple task; the frontend bridge channel is independent and unchanged.)
- `run_script` success returns a structured observation with `status`, `executor`, `input`, and `output`.
- `outputSchema` uses the same lightweight JSON-compatible type vocabulary as `inputSchema`: `array`, `boolean`, `integer`, `null`, `number`, `object`, and `string`. For object outputs, `required` and property `type` checks are supported; unsupported JSON Schema keywords are ignored.
- `SKILL.md` action declarations use a fenced JSON block whose info string includes `tsian-actions`:
  ````md
  ```json tsian-actions
  [
    {
      "name": "run_skill_script",
      "description": "Run a trusted Skill-local browser script through the Tsian SDK.",
      "inputSchema": {
        "type": "object"
      },
      "outputSchema": {
        "type": "object"
      },
      "executor": {
        "type": "browser_script",
        "path": "scripts/run.js",
        "timeoutMs": 10000
      }
    },
    {
      "name": "write_world_note",
      "description": "Orchestrate a read-merge-write of world notes via a Skill-local browser script.",
      "inputSchema": {
        "type": "object",
        "required": ["content"],
        "properties": {
          "content": { "type": "string" }
        }
      },
      "executor": {
        "type": "browser_script",
        "path": "scripts/write_note.js",
        "timeoutMs": 10000
      }
    }
  ]
  ```
  ````
- `browser_script` is the only supported executor type. `builtin`, `platform_action`, and `workspace_operation` declarations are rejected at parse time. For single workspace read/write, the model uses the top-level `workspace.read`/`workspace.write` tools directly; a `browser_script` is for multi-step orchestration or script-only logic.
- Runtime prompts should display Skill Index entries as `name/description/triggers/applicability` (plus parsed `actions` summaries) and should not default to exposing `path=...`.
- Use `workspace.read/workspace.list/workspace.search` for third-layer files only: files explicitly referenced by the injected `SKILL.md`, world data, memory, README files, or other current-task context.
- Use the same workspace path rules as storage-facing APIs:
  - normalize backslashes to slashes;
  - trim leading slashes;
  - reject empty file paths, trailing slash file paths, `.`, `..`, and empty path segments;
  - allow empty directory path for root listing.
- `workspace.read` arguments: `{ scope: "effective" | "card-content" | "save-runtime" | "platform-meta", path: string, offset?: number, limit?: number }`; success returns a `WorkspaceReadResult` (superset of `WorkspaceFile` carrying line-slice metadata `totalLines`/`returnedLines`/`offset`/`truncated`/`isBinaryPlaceholder`). Omit `offset`/`limit` to return the whole file; the metadata fields still report total lines so the agent can decide whether to page. Binary files return the placeholder `content` untouched with `isBinaryPlaceholder: true` — do not slice them.
- `workspace.list` arguments: `{ scope: "...", path?: string }`; success returns `{ path, entries }` with direct child `WorkspaceEntry[]`.
- `workspace.search` arguments: `{ scope: "...", query?: string, pattern?: string, limit?: number, contextLines?: number, ignoreCase?: boolean }`; success returns `WorkspaceSearchResult[]` where each file entry carries a `matches: WorkspaceSearchMatch[]` array (each match has `lineNumber`/`line`/`contextBefore`/`contextAfter`/`match`), a `matchesTruncated` flag, and a back-compat `preview` of the first match. `query` (substring) and `pattern` (regex) are mutually exclusive — passing both throws `WORKSPACE_QUERY_PATTERN_MUTEX`; passing neither returns `[]`. `query` defaults to case-insensitive (legacy behavior), `pattern` defaults to case-sensitive (regex convention); `ignoreCase` overrides either default. Per-file matches are capped at `MAX_MATCHES_PER_FILE` (50) with `matchesTruncated: true`; `limit` still caps the returned file count. Binary files skip content matching but remain visible on path matches with `matches: []`. The legacy `preview` field is kept for trace/debug consumers; new consumers read `matches`.
- `workspace.diff/patch/write/move/delete/validate` use the shared `WorkspaceOperationRequest` shape from `@tsian/contracts`.
- Tool observations are returned to the same Agent as a normal user message containing `<tsian-tool-observation>`.
- Final entry agent output must strip tool-call blocks and must not expose tool observations to players.

### 4. Validation & Error Matrix

- Malformed JSON block -> error observation with `TOOL_CALL_JSON_INVALID`.
- Non-object tool payload -> error observation with `TOOL_CALL_INVALID`.
- Missing or blank `name` -> error observation with `TOOL_NAME_REQUIRED`.
- Non-object `arguments` -> error observation with `TOOL_ARGUMENTS_INVALID`.
- Unknown tool name -> error observation with `UNSUPPORTED_WORKSPACE_TOOL`.
- Missing or blank `use_skill.arguments.name` -> error observation with `SKILL_NAME_REQUIRED`.
- Unknown or invisible Skill name -> error observation with `SKILL_NOT_FOUND`.
- Ambiguous Skill name after local/shared priority -> error observation with `SKILL_NAME_AMBIGUOUS` and lightweight candidates.
- Missing `SKILL.md` after registry resolution -> error observation with `SKILL_DETAIL_NOT_FOUND`.
- Missing or blank `run_script.arguments.skill` -> error observation with `ACTION_SKILL_REQUIRED`.
- Missing or blank `run_script.arguments.script` -> error observation with `ACTION_NAME_REQUIRED`.
- `run_script.arguments.input` non-object -> error observation with `ACTION_INPUT_INVALID`.
- `run_script` before the Skill is activated -> error observation with `SKILL_NOT_ACTIVATED`.
- `run_script` for an undeclared action on an activated Skill -> error observation with `ACTION_NOT_FOUND`.
- `run_script` for an action whose executor is not `browser_script` -> error observation with `ACTION_NOT_BROWSER_SCRIPT` (workspace operations should use the top-level workspace tools, or a `browser_script` that orchestrates them).
- `run_script` with schema-invalid input -> error observation with `ACTION_INPUT_INVALID`.
- Missing or blank `agent_call.arguments.agentId` -> error observation with `AGENT_CALL_TARGET_REQUIRED`.
- Missing or blank `agent_call.arguments.request` -> error observation with `AGENT_CALL_REQUEST_REQUIRED`.
- Invalid `agent_call.arguments.historyMode` -> error observation with `AGENT_CALL_HISTORY_MODE_INVALID`.
- `agent_call` without an active Agent context -> error observation with `AGENT_CALL_CONTEXT_REQUIRED`.
- `agent_call` in a tool loop where Agent calls are unavailable, including disabled Agent platform tool config or attempts beyond the collaboration depth limit -> error observation with `AGENT_CALL_UNAVAILABLE` and compact caller/target/depth/budget metadata when available.
- `agent_call` target not found in the Agent registry -> error observation with `AGENT_CALL_TARGET_NOT_FOUND`.
- `agent_call` target exists but is not in caller contacts -> error observation with `AGENT_CALL_TARGET_NOT_CONTACT`.
- `agent_call` beyond the recursion depth limit (`maxDepth`) -> error observation with `AGENT_CALL_UNAVAILABLE` with compact depth/budget metadata. There is **no per-turn call-count limit** — `callCount` is a diagnostic counter only; agent_call frequency is bounded by the turn token budget, not a count cap.
- Delegated Agent execution failure -> error observation with `AGENT_CALL_FAILED`.
- Action executor declaration missing, or with a non-`browser_script` type (`builtin`/`platform_action`/`workspace_operation`) -> `ACTION_EXECUTOR_INVALID` at parse time; reported in `use_skill` observation `actionDeclarationErrors` and registry `actionDeclarationErrors`; that action is not registered.
- Browser script executor declarations without a non-empty `path`, or with invalid `timeoutMs` -> `ACTION_EXECUTOR_INVALID`; reported in `use_skill` observation `actionDeclarationErrors`; that action is not registered.
- Malformed action `outputSchema` declarations -> `ACTION_OUTPUT_SCHEMA_INVALID`; reported in `use_skill` observation `actionDeclarationErrors`; that action is not registered.
- Executor denied by lightweight policy -> error observation with `ACTION_EXECUTOR_DISABLED` and compact policy metadata; no AIRP-turn UI prompt.
- Unsupported executor types reaching `executeSkillAction` (legacy-registered non-`browser_script`) -> error observation with `ACTION_EXECUTOR_UNSUPPORTED`.
- Controlled executor timeout -> error observation with `ACTION_EXECUTOR_TIMEOUT`.
- Controlled executor abort -> error observation with `ACTION_EXECUTOR_ABORTED`.
- Unexposed workspace operation -> error observation with `WORKSPACE_OPERATION_NOT_EXPOSED`.
- Workspace operation from generic tools or browser script SDK whose read/write group is disabled -> error observation with `WORKSPACE_OPERATION_NOT_EXPOSED`.
- Actor level below target read/edit level -> error observation with `WORKSPACE_READ_ACCESS_DENIED` or `WORKSPACE_EDIT_ACCESS_DENIED`.
- `browser_script` without an injected capability -> error observation with `BROWSER_SCRIPT_UNAVAILABLE`.
- Missing browser script file -> error observation with `BROWSER_SCRIPT_NOT_FOUND`.
- Browser script path outside the declaring Skill directory -> error observation with `BROWSER_SCRIPT_PATH_INVALID`.
- Browser script failure, SDK failure, Worker failure, or Worker message failure -> structured error observation with a `BROWSER_SCRIPT_*` code.
- Successful executor output that fails declared `outputSchema` -> error observation with `ACTION_OUTPUT_INVALID` and output summary metadata, not raw large output payloads.
- Agent/Skill attempts to write or delete `.tsian/*` without level `4` through generic workspace operations or browser script SDK workspace mutation -> structured workspace error observation.
- Runtime turn fails or aborts after staged ordinary workspace writes -> persisted workspace state remains equivalent to the pre-turn accepted state, except for host-owned failed trace diagnostics.
- Malformed `tsian-actions` blocks in `SKILL.md` -> report declaration errors in `use_skill` observation `actionDeclarationErrors` and registry `actionDeclarationErrors` without failing the whole Skill activation.
- Invalid path -> error observation with workspace path error code.
- Missing file on `workspace.read` -> error observation with `WORKSPACE_FILE_NOT_FOUND`.
- **Narrative mode**: turn token budget reached a second time after one in-turn narrative compression (or budget reached when no `agentContextSnapshot` is available to compress) -> return the last round's stripped text if present; otherwise throw `ContextBudgetExhaustedError`, surfaced as a soft "上下文已满" prompt in AssistantView (keeps already-streamed thought, not a hard error). The first budget crossing triggers `compressContext` on the narrative span (tool interactions are preserved). No per-Agent round limit exists.
- **Task mode** (delegated + assistant): budget crossing -> timeout check (`TaskTimeoutError` if elapsed) -> `compressTaskContext` on the tool-interaction span (multi-compress, no count cap) -> stall early-exit (`TaskCompressionStalledError` if yield < 10%) -> `ContextBudgetExhaustedError` when nothing left to compress. All three surface as soft prompts in AssistantView (delegated: `AGENT_CALL_FAILED` observation with timeout/stalled details). See the "Turn Token Budget And In-Turn Compression (Narrative + Task modes)" scenario.

### 5. Good/Base/Bad Cases

- Good: the entry agent sees a Skill Index entry named `continuity`, calls `use_skill`, receives a lightweight activation confirmation (not the full SKILL.md), the framework injects the full SKILL.md next round, then the agent returns its final reply.
- Good: narrative activates `prose-style` with `use_skill`; if an agent-local and shared Skill share that name, the narrative-local Skill wins.
- Good: activated `SKILL.md` declares `tsian-actions`; the same Agent can call one declared `browser_script` action with `run_script` and receives a structured executor observation.
- Good: action with `outputSchema` validates successful executor output before returning a success observation.
- Good: action with `{ "type": "browser_script", "path": "scripts/run.js", "timeoutMs": 10000 }` runs a Skill-local script through the Tsian SDK after `use_skill` activation and input validation.
- Good: a `browser_script` chains `tsian.workspace.read` -> transform -> `tsian.workspace.write` to orchestrate a multi-step business operation; the model invokes it with one `run_script` call.
- Good: an injected policy disables `browser_script` and `run_script` returns `ACTION_EXECUTOR_DISABLED` as a normal failed observation without prompting the player.
- Good: a `browser_script` writes a workspace file, then a later same-turn workspace read or browser script SDK read observes the staged file before the turn commits.
- Good: a failed turn after staged workspace writes leaves no ordinary persisted workspace file from those staged writes.
- Good: injected `SKILL.md` references `references/rules.md` or a full workspace path, and the Agent uses `workspace.read` only when that reference is needed.
- Good: the entry agent sees `memory` in contacts, calls `agent_call`, and receives memory's continuity findings as an observation before writing its final reply.
- Good: a delegated memory Agent activates a Skill, calls a non-`agent_call` `run_script`, or calls one of its own contact Agents when its own `agent.json` permissions plus depth and budget policy allow it.
- Good: an Agent with `workspace_read` enabled and `workspace_write` disabled can list/search/read context, but generic workspace writes and `browser_script` SDK writes return `WORKSPACE_OPERATION_NOT_EXPOSED`.
- Good: Agent uses `workspace.list` for a directory and receives entries without file contents.
- Good: Agent uses `workspace.search` and receives per-file match lists (line numbers + matched lines + optional context), then explicitly reads a chosen file if full content is needed.
- Base: no tool-call block means the existing one-call-per-Agent behavior is preserved.
- Bad: injecting all `SKILL.md` contents into `agent-context` or the eager Skill Index; this breaks progressive disclosure (only `SkillActionSummary` belongs in the index).
- Bad: returning the full `SKILL.md` content or a resource index from `use_skill`; the observation is a lightweight confirmation, and the full text is injected by the framework next round.
- Bad: allowing `run_script` before `use_skill`; this bypasses Skill activation gating.
- Bad: a Skill action declaring `builtin`, `platform_action`, or `workspace_operation` executor; only `browser_script` is supported — use top-level workspace tools for single ops or a `browser_script` for orchestration.
- Bad: exposing the full Agent registry instead of only the current Agent's contacts.
- Bad: allowing delegated Agents to call arbitrary non-contact Agents or exceed the policy depth limit. (There is no per-turn call-count budget to exceed; the turn token budget bounds volume.)
- Bad: letting `browser_script` SDK workspace methods bypass an Agent-level disabled `workspace_read` or `workspace_write` group.
- Bad: making raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals supported browser script APIs in the first strong-SDK slice.
- Bad: adding player-facing trust prompts, Settings toggles, or per-Skill trust records to the first lightweight executor policy slice.
- Bad: treating `outputSchema` as full JSON Schema support before the runtime explicitly implements it.
- Bad: making ordinary Agent output JSON-only to support tools; ordinary output remains a soft protocol.

### 6. Tests Required

- Assert a model response containing `use_skill` activates the Skill, returns a lightweight confirmation (not the full SKILL.md), and the framework injects the full SKILL.md as a user message in the next round.
- Assert shared Skills and Agent-local Skills can both be activated by `name`.
- Assert local/shared duplicate Skill names prefer the current Agent's local Skill.
- Assert `use_skill` returns `SKILL_NOT_FOUND` for a Skill disabled for the current Agent even when the `SKILL.md` file exists.
- Assert `use_skill` observation does not return the full `SKILL.md` content or a resource index.
- Assert `use_skill` registers actions declared in a `tsian-actions` fenced JSON block and lists them in the observation.
- Assert repeated `use_skill` on the same Skill does not re-inject the full SKILL.md (de-duplicated via `injectedSkillPaths`).
- Assert `run_script` succeeds after activating the declaring Skill and routes through the `browser_script` executor.
- Assert malformed `outputSchema` declarations report `ACTION_OUTPUT_SCHEMA_INVALID` during `use_skill`.
- Assert actions without `outputSchema` keep existing output behavior.
- Assert actions with `outputSchema` validate executor output and return `ACTION_OUTPUT_INVALID` on mismatch without storing raw large output in trace.
- Assert injected executor policy can return `ACTION_EXECUTOR_DISABLED` for `browser_script`.
- Assert default executor policy allows `browser_script`.
- Assert `browser_script` runs a Skill-local script through the injected runner only after `use_skill` activation and input validation.
- Assert `browser_script` can use SDK workspace read/list/search/diff/edit/write/move/delete/validate against the staged workspace view and keeps workspace mutation trace/synchronization.
- Assert `browser_script` timeout and abort return structured observations.
- Assert `browser_script` paths outside the declaring Skill directory are rejected.
- Assert generic `workspace.write/edit/delete` stage ordinary save-runtime workspace mutations during `interaction.sendMessage` and commit only on successful turns.
- Assert failed or aborted turns discard ordinary staged workspace mutations.
- Assert ordinary Agent/Skill workspace mutations under `.tsian/*` fail structurally.
- Assert frontend bridge `platform.runAction` generic workspace write/edit/delete remains immediate (independent of the removed Agent Runtime `runPlatformAction` executor).
- Assert unsupported/legacy executor types (`builtin`/`platform_action`/`workspace_operation`) return `ACTION_EXECUTOR_INVALID` at parse time and are reported in `actionDeclarationErrors`.
- Assert `run_script` for a non-`browser_script` action returns `ACTION_NOT_BROWSER_SCRIPT`.
- Assert invalid `browser_script` declarations report `ACTION_EXECUTOR_INVALID` during `use_skill`.
- Assert `run_script` before `use_skill` returns `SKILL_NOT_ACTIVATED`.
- Assert unknown actions return `ACTION_NOT_FOUND`.
- Assert schema-invalid action input returns `ACTION_INPUT_INVALID`.
- Assert current Agents with contacts see `agent_call` instructions listing only visible contacts.
- Assert current Agents without contacts or with disabled `agent_call` do not get encouraged to use `agent_call`, and direct calls return structured errors.
- Assert valid `agent_call` invokes the target contact Agent with its own context and returns the response as observation.
- Assert delegated `agent_call` uses the target Agent's own `platformTools`, `workspaceAccess`, Skill enablement, and prompt shaping.
- Assert non-contact and missing target `agent_call` attempts return structured errors without model calls.
- Assert a delegated Agent can perform one nested `agent_call` to its own contact when depth and budget allow it.
- Assert nested `agent_call` attempts beyond `maxDepth` return `AGENT_CALL_UNAVAILABLE` with structured depth/budget metadata.
- Assert invalid `historyMode` is rejected and omitted `historyMode` defaults to `recent`.
- Assert delegated Agents can still use workspace tools, `use_skill`/`run_script`, according to their own Agent permissions.
- Assert nested `agent_call` is bounded by `maxDepth` across the entry agent and nested delegated steps (no per-turn call-count budget exists; `callCount` is diagnostic only).
- Assert disabled `workspace_read` omits read/list/search prompt examples and direct generic read/list/search calls return `WORKSPACE_OPERATION_NOT_EXPOSED`.
- Assert disabled `workspace_write` omits write examples and direct generic diff/patch/write/move/delete/validate calls return `WORKSPACE_OPERATION_NOT_EXPOSED`.
- Assert browser script SDK workspace calls cannot bypass disabled Agent workspace tool groups.
- Assert successful `browser_script` `run_script` calls that do not invoke SDK workspace mutations do not mutate workspace/state outside the script.
- Assert successful workspace mutations flow through the generic workspace operation layer.
- Assert missing Skill names become structured observations, not uncaught runtime crashes.
- Assert a loaded `SKILL.md` can chain to `workspace.read` for referenced resources.
- Assert `workspace.list` returns directory entries without file contents.
- Assert `workspace.search` returns per-file match lists with line numbers and respects `limit` (file count) and `MAX_MATCHES_PER_FILE` (per-file) caps.
- Assert invalid JSON, unsupported tools, invalid paths, and missing files become observations, not uncaught runtime crashes.
- Assert final `replyText` does not contain `<tsian-tool-call>` markup.
- Assert no-tool turns still return the current `{ replyText, masterPlan }` shape.

### 7. Wrong vs Correct

#### Wrong

```typescript
return `- ${skill.id}: ${skill.summary} path=${skill.path}`
```

#### Correct

```typescript
const calls = parseRuntimeWorkspaceToolCalls(modelText)
const observations = await executeRuntimeWorkspaceToolCalls({
  workspaceFiles,
  agentContext,
  runPlatformAction,
}, calls)
messages.push({
  role: "user",
  content: formatRuntimeWorkspaceToolObservationMessage(observations),
})
```

#### Correct

```typescript
return `- ${skill.name}: ${skill.description}`
```

## Scenario: Native AIRP History Writeback

### 1. Scope / Trigger

- Trigger: `interaction.sendMessage` persists player-facing AIRP history into Runtime Workspace.
- Applies when changing the successful-turn persistence path in `apps/platform-web/src/platform-host/index.ts` or default workspace history files in `apps/platform-web/src/storage/workspace.ts`.

### 2. Signatures

- Raw AIRP history turn files live under `save/history/turns/turn-000001.json`.
- Each successful turn writes one `application/json` workspace file.
- File content uses schema string `tsian.airp.history.turn.v1`.
- The minimum file shape is:

```typescript
interface RawAirpHistoryTurnRecord {
  schema: "tsian.airp.history.turn.v1"
  turn: number
  createdAt: string
  source: {
    kind: "agent-runtime"
    masterAgentId: "master"
    narrativeAgentId: "narrative"
  }
  messages: ConversationMessageRecord[]
}
```

### 3. Contracts

- Raw AIRP history is the native fallback memory substrate: complete, reliable, minimally interpreted, and checkpoint-scoped.
- Raw history stores only the player input and final assistant narrative output for a successful turn.
- Raw history must not store model prompts, tool observations, trace events, delegated Agent intermediate outputs, or hidden debug data.
- Store raw history at turn granularity, not as a monolithic all-history JSONL file, so workspace search can return matching individual turns.
- Keep raw history separate from `.tsian/traces/`; trace is platform debug material and normal workspace list/search hides it by default.
- Enhanced AIRP memory such as timelines, summaries, world facts, character state, relationships, vector indexes, or semantic retrieval are derived workspace projections and belong to Skills, Agents, or content-specific conventions.
- Do not add a platform-owned gameplay memory schema when implementing raw history writeback.
- Direct future manual correction of a raw turn file is acceptable; do not add an amendment/revision overlay unless a future task explicitly chooses it.
- Successful raw history writes are staged as ordinary Runtime Workspace files and committed atomically with accepted snapshot/history and after-turn checkpoint creation.
- Failed or aborted turns must not leave ordinary raw history records.
- Existing `saveHistory` and snapshots remain the current chat display source; raw workspace history intentionally duplicates the player-facing exchange for runtime memory/feedstock use.

### 4. Validation & Error Matrix

- Successful turn -> `save/history/turns/turn-000001.json` exists and includes exactly one user and one assistant message for that turn.
- Aborted turn before final acceptance -> no raw history turn file is written.
- Agent Runtime failure -> no raw history turn file is written.
- Later successful-turn commit failure -> no partial raw history / snapshot / checkpoint state is accepted.
- Existing saves -> no backfill required; they start writing per-turn raw history on future successful turns.

### 5. Good/Base/Bad Cases

- Good: `workspace.search({ scope: "effective", query: "lantern" })` returns a matching `save/history/turns/turn-000012.json` file preview.
- Good: a memory Skill reads raw turn files and creates `world/characters.json` or `memory/facts.jsonl` as derived, correctable projections.
- Base: current UI chat history still reads `saveHistory` while Agent/Skill context can inspect workspace raw history when needed.
- Bad: writing all history into `history/conversation.jsonl` only; workspace search can no longer identify the matching turn cleanly.
- Bad: adding automatic timeline/current-summary maintenance as part of raw history persistence.
- Bad: treating raw history as low-quality fallback and replacing it with derived summaries as the only source record.
- Bad: hiding raw turn files under `.tsian/`; they are ordinary gameplay memory feedstock, not platform trace.

### 6. Tests Required

- Assert successful turns write one raw history JSON file in the same successful-turn commit captured by checkpoint creation.
- Assert raw history content includes player input and final assistant output.
- Assert raw history content omits prompts, trace events, tool observations, and delegated Agent outputs.
- Assert workspace list/read/search can surface individual raw turn files.
- Assert failed or aborted turns do not persist raw history files.

## Scenario: Agent Session Transcript And Skill-Triggered Maintenance

### 1. Scope / Trigger

- Trigger: successful Agent Runtime turns persist Agent-facing transcripts or an activated Skill action applies notes/timeline/summary maintenance.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts`, `apps/platform-web/src/platform-host/index.ts`, `apps/platform-web/src/storage/workspace.ts`, default Skill files, or successful-turn persistence.

### 2. Signatures

- Agent transcripts live under `save/agents/<agent>/session.jsonl`.
- Each JSONL line uses schema string `tsian.agent.session.transcript.v1`.
- Runtime returns transcript records as plain data; `platform-host` appends them to workspace files during successful-turn staging.
- The default maintenance Skill lives at `skills/memory-maintenance/SKILL.md` and declares `apply_maintenance_plan`.
- Maintenance plans use schema string `tsian.runtime.maintenance.plan.v1` with `writes: [{ path, mode: "replace", content, reason }]`.

### 3. Contracts

- Session transcripts are Agent-facing replay/debug substrate, not platform operational logs.
- Transcript records may include model messages sent to the Agent, injected context snapshots inside those messages, model output, parsed tool calls, tool observations, Agent id/path/title, debug label, model-call index, round, status, timestamp, and turn.
- Transcript records must exclude storage internals such as Dexie ids, hidden transaction snapshots, and full trace payloads not returned to the Agent.
- Session transcript writes are append-only for this slice. Do not segment, trim, compress, or archive them here.
- Session transcript writes are staged after Agent Runtime succeeds and committed atomically with raw history, trace, snapshot/history, and checkpoint.
- Failed or aborted turns must discard ordinary session transcript writes.
- Enhanced memory maintenance does not run automatically every turn. It runs only when an Agent loads a Skill that declares an action and calls that action.
- The official maintenance Skill uses the existing `browser_script` executor and Tsian SDK workspace writes. Do not add a maintenance-specific platform action unless a future task explicitly revises this contract.
- Valid maintenance writes are limited to `save/agents/<agent>/notes.md`, `save/history/timeline.md`, `save/memory/summaries/current.md`, and `save/memory/summaries/long-term.md`.
- Empty `writes` is a valid explicit no-op maintenance decision.
- Invalid maintenance plans become structured action/script observations and trace summaries; they must not mutate ordinary workspace files.
- `.tsian/*` remains host-owned platform metadata and is never a valid ordinary maintenance target.
- New saves include the official maintenance Skill and the official workspace-assistant substrate. Existing non-empty saves receive missing official default files through a versioned default workspace upgrade that preserves same-path user files and does not recreate those files after the upgrade marker is current.

### 4. Validation & Error Matrix

- Successful no-tool turn -> entry agent session JSONL record is appended.
- Successful `agent_call` -> the delegated Agent also receives its own session JSONL records.
- Successful turn with no maintenance action -> no notes/timeline/summary maintenance mutation is synthesized.
- Loaded maintenance Skill plus valid plan -> approved target files are written through the staged workspace transaction.
- Loaded maintenance Skill plus empty plan -> action returns no-op and no maintenance files are mutated.
- Invalid schema, invalid path, invalid mode, non-string content/reason, oversized content, or `.tsian/*` target -> action observation is an error and no maintenance writes are applied.
- Existing save with runtime workspaceVersion below current -> missing official save runtime files are created, existing same-path files are preserved, and manifest advances.
- Existing save with current runtime workspaceVersion -> deleted official save runtime files are not recreated on every turn.

### 5. Good/Base/Bad Cases

- Good: a successful turn with the entry agent and a delegated memory Agent appends JSONL records under each participating Agent's own directory.
- Good: memory Agent loads `memory-maintenance`, calls `apply_maintenance_plan`, and writes `save/memory/summaries/current.md` through the staged browser-script SDK.
- Good: an empty maintenance plan returns no-op output and does not mutate notes/timeline/summary files.
- Base: a successful turn with no loaded maintenance Skill still appends session transcripts and raw history, but produces no enhanced memory file updates.
- Bad: platform-host runs memory maintenance after every turn without a Skill action.
- Bad: Runtime Trace stores full Agent prompt/message arrays instead of only summary events.
- Bad: default runtime upgrade overwrites a user-authored `save/agents/memory/notes.md` or `save/memory/summaries/current.md`.

### 6. Tests Required

- Assert transcript JSONL lines parse and include Agent-facing messages/output/tool material.
- Assert failed or aborted turns leave no ordinary transcript or maintenance writes.
- Assert transcript staging creates `session.jsonl` for custom Agents that participate.
- Assert maintenance action is unavailable until the declaring Skill is loaded.
- Assert default maintenance Skill is discoverable through `skill-registry`, activatable through `use_skill`, and runs through `browser_script` via `run_script`.
- Assert valid maintenance plans write only allowed paths and invalid plans write nothing.
- Assert default workspace upgrade is non-overwriting and manifest-gated for official Skills, workspace-assistant files, and framework knowledge docs.

### 7. Wrong vs Correct

#### Wrong

```typescript
await runMemoryMaintenanceEveryTurn()
await writeWorkspaceFileForSave(saveId, {
  path: "save/memory/summaries/current.md",
  content: summary,
})
```

#### Correct

```typescript
const result = await runAgentRuntimeTurn(input, {
  runBrowserScript: createBrowserSkillScriptRunner({ workspaceTransaction }),
})
stageAgentSessionTranscriptFiles(
  workspaceTransaction,
  result.agentSessionTranscripts,
)
```

#### Correct

```json
{
  "name": "apply_maintenance_plan",
  "executor": {
    "type": "browser_script",
    "path": "scripts/apply-maintenance-plan.js"
  }
}
```

## Scenario: Runtime Trace Persistence

### 1. Scope / Trigger

- Trigger: Agent Runtime emits turn/tool/action trace and platform-host persists it into Runtime Workspace.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts`, `apps/platform-web/src/agent-runtime/workspace-tools.ts`, `apps/platform-web/src/agent-runtime/trace.ts`, `apps/platform-web/src/platform-host/index.ts`, or `apps/platform-web/src/storage/workspace.ts`.

### 2. Signatures

- Trace files live under `.tsian/traces/turns/turn-000001.jsonl`.
- Failed turn trace files may use `.tsian/traces/turns/turn-000001-failed-<timestamp>.jsonl`.
- Each line is one JSON object with `type`, `timestamp`, `turn`, optional `agentId`, optional `debugLabel`, optional `ok`, and optional `data`.
- Runtime trace event input may accept unknown data, but the collector must normalize persisted `data` to JSON-compatible values.

### 3. Contracts

- Trace is platform-owned workspace content: platform writes it, Agent context does not inject it by default, and ordinary workspace read/list/search hides it as part of `.tsian/*` metadata.
- Trace follows checkpoint/restore because it is stored as normal Runtime Workspace files under `.tsian/traces/`.
- Successful turns include trace in the accepted workspace state before the after-turn checkpoint is created, so the checkpoint includes the trace for that branch.
- Failed turns attempt to write `turn_failed` trace if workspace files are already available, but failed-turn trace persistence must not mask the original runtime error.
- Trace must record summaries, not large raw payloads:
  - model calls: message count, output length, tool-call count;
  - Skill loads: skill name/path/scope, action count, declaration error count;
  - Agent calls: caller/target ids, target title, history mode, input/output summaries, status or error;
  - workspace tools: path/query/limit, result count, file metadata for reads, no file content;
  - action executor policy checks: skill/action/executor metadata and compact allow/deny reason/source, no action input or script content;
  - action calls: skill/action/executor, input/output summaries, status or error;
  - browser scripts: script path/source size/start events and script log/trace summaries, no script source or large raw data;
  - workspace mutations: write path/mediaType/size or delete `deletedPaths`.
- `agent-runtime` still must not import Dexie, storage helpers, bridge objects, or `platform-host`; it emits trace through an injected callback.
- `platform-host` owns trace persistence through explicit platform-owned workspace storage helpers.
- Ordinary generic workspace reads must not expose `.tsian/*` unless the actor has platform-meta read level. Use dedicated resources such as `runtime-diagnostics` for Agent-facing facts and future debug/management resources for raw metadata.

### 4. Validation & Error Matrix

- Successful turn -> one valid JSONL trace file under `.tsian/traces/turns/`.
- Runtime failure after workspace is available -> failed trace is attempted and original error is rethrown.
- Trace write failure on successful turn -> fail loudly before checkpoint creation.
- Trace `data` contains non-JSON values -> collector normalizes to JSON-compatible values.
- Workspace read/list/search root or `.tsian` path -> no platform metadata contents are exposed.

### 5. Good/Base/Bad Cases

- Good: trace records `workspace.read` path and content size without copying file content.
- Good: trace records `agent_called` for both successful delegation and structured delegation errors without storing full delegated prompts.
- Good: trace records `action_executor_policy_checked` with executor metadata and policy source/reason but no action input or script source.
- Good: trace records `action_called` for a `browser_script` `run_script` that performs workspace writes, plus a `workspace_mutation` event for `workspace.write` or `workspace.edit` issued from the script's SDK calls.
- Good: trace records `script_log` summaries for `browser_script` start/log/fetch events and `workspace_mutation` for SDK writes/deletes.
- Good: restoring an earlier checkpoint removes later trace files for the discarded branch.
- Base: a no-tool turn still records turn, agent step, and model call summary events.
- Bad: persisting full prompt/message arrays into `.tsian/traces` by default.
- Bad: allowing ordinary workspace search to surface trace noise to Agents.
- Bad: importing storage helpers into `agent-runtime` to persist trace directly.

### 6. Tests Required

- Assert successful turns write valid JSONL trace before checkpoint creation.
- Assert failed turns include a `turn_failed` event when trace persistence is available.
- Assert model call summary events omit full prompt/messages.
- Assert `agent_called` events include caller/target summary data and omit full prompt/messages.
- Assert workspace read trace omits file content.
- Assert `workspace.write` / `workspace.edit` / `workspace.delete` platform actions produce `workspace_mutation`.
- Assert `browser_script` SDK logs/fetch summaries emit `script_log` without script source or large raw payloads.
- Assert bridge and runtime workspace read/list/search exclude or reject `.tsian/*`.

## Scenario: Agent-Facing Runtime Diagnostics

### 1. Scope / Trigger

- Trigger: platform-web exposes compact Agent-facing diagnostics derived from Runtime Trace files.
- Applies when changing `packages/contracts/src/runtime.ts`, `apps/platform-web/src/agent-runtime/diagnostics.ts`, `apps/platform-web/src/platform-host/index.ts`, or trace event fields consumed by diagnostics.

### 2. Signatures

- Bridge query resource: `runtime-diagnostics`.
- Query shape: `RuntimeDiagnosticsQueryParams` with optional `turn`, `limit`, `lookbackTurns`, and `includeHealth`.
- Result shape: `RuntimeDiagnosticSummary[]`.
- Diagnostic summaries use schema string `tsian.runtime.diagnostic.v1`.

### 3. Contracts

- Diagnostics are an on-demand query view over `.tsian/traces/turns/*.jsonl`; do not persist derived diagnostic workspace files.
- `runtime-diagnostics` returns one summary per trace file / turn attempt, not one top-level item per raw trace event.
- Default behavior prioritizes failed/anomalous traces. Successful-turn health summaries are returned only when `includeHealth` is true or an exact `turn` query requests them.
- Summaries are facts-only. Do not add platform-authored repair suggestions, probable-cause narratives, or hardcoded `nextChecks`.
- Lightweight normalization is allowed for runtime-area identification: `source`, `eventType`, raw `code`/`message`, Agent id/debug label, Skill/action/tool/executor names, and directly related workspace paths.
- Related paths must come from direct trace facts such as Agent ids, Skill paths, script paths, workspace read/write/delete paths, or session files. Drop `.tsian/*` paths from Agent-facing `relatedPaths`.
- Diagnostics must stay bounded: result limit, lookback window, per-summary fact limit, related path limit, and message/details previews.
- Malformed trace lines must not crash the whole query; return compact trace parse facts or counts.
- `agent-runtime/diagnostics.ts` must stay pure: pass `WorkspaceFile[]` in and return `RuntimeDiagnosticSummary[]` out. It must not import Dexie, storage helpers, bridge objects, or `platform-host`.
- `platform-host` owns the bridge query wiring: active save lookup, workspace initialization, file listing, query param normalization, and delegation to the pure builder.
- Do not add `runtime-diagnostics` as a default live-turn Agent tool or prompt instruction.

### 4. Validation & Error Matrix

- No active save -> query returns `{ items: [] }`.
- No trace files -> query returns `{ items: [] }`.
- Failed trace file -> query returns a failed summary with raw error code/message facts when present.
- Successful trace with `includeHealth` false and no anomalies -> omitted from default results.
- Successful trace with `includeHealth` true -> compact health summary only; no raw event stream.
- Trace with malformed JSONL line -> query still returns valid summaries and records malformed-line facts/counts.
- Trace paths or details under `.tsian/*` -> omitted from `relatedPaths`.

### 5. Good/Base/Bad Cases

- Good: `runtime-diagnostics` maps an `ACTION_OUTPUT_INVALID` action trace to `source: "action"`, Skill/action names, raw code/message, executor label, and related Skill/script paths.
- Good: a failed turn exposes `turn_failed` / `agent_step_failed` facts without full prompts, full model output, or tool observations.
- Good: a successful turn health summary includes Agent ids, Skill/action names, mutation counts/paths, and call counts.
- Base: exact `turn` queries can return successful-turn health even when `includeHealth` is omitted.
- Bad: writing `.tsian/diagnostics/*.json` as derived state for this slice.
- Bad: returning raw JSONL trace lines through `runtime-diagnostics`.
- Bad: adding repair suggestions such as "rewrite this Skill" to platform diagnostics.
- Bad: exposing diagnostics to ordinary entry agent prompts by default.

### 6. Tests Required

- Assert `runtime-diagnostics` returns failed/anomalous summaries by default.
- Assert `includeHealth` returns compact successful-turn health summaries.
- Assert summary facts preserve raw error codes/messages and add only lightweight source/entity normalization.
- Assert summaries omit full prompts, full model outputs, file contents, script source, provider internals, bridge internals, storage internals, API keys, and `.tsian/*` related paths.
- Assert malformed trace lines are bounded facts/counts rather than thrown errors.
- Assert no derived diagnostic workspace files are written.

## Scenario: Turn Token Budget And In-Turn Compression (Narrative + Task modes)

### 1. Scope / Trigger

- Trigger: Agent Runtime tool loops estimate runtime message tokens before each model call and compress when the budget is crossed. Two compression modes exist (`RuntimeCompressionMode`): `narrative` (master) and `task` (delegated `agent_call` targets + desktop assistant).
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts` (tool loops, `WorkspaceToolLoopOptions`, `RuntimeCompressionMode`, `locateTaskInteractionSpan`, `runAgentRuntimeTurn` context-update assembly, `createAgentCallRunner` timeout/compression threading), `apps/platform-web/src/agent-runtime/context-lifecycle.ts` (`estimateRuntimeMessagesTokens`, `compressTaskContext`, `ContextBudgetExhaustedError`, `TaskTimeoutError`, `TaskCompressionStalledError`, task compression constants), `apps/platform-web/src/agent-runtime/workspace-tools.ts` (`RuntimeAgentCallArguments.timeoutMs`), `apps/platform-web/src/agent-runtime/tool-schemas.ts` (agent_call schema `timeoutMs`), `apps/platform-web/src/platform-host/index.ts` (`runAssistantChat` task mode + timeout, `interaction.sendMessage` narrative mode), or `AssistantView.vue` budget-exhausted/timeout/stalled catch handling.

### 2. Signatures

- `RuntimeCompressionMode = "narrative" | "task"` — selects compression behavior in the tool loop. `narrative` = master story compression (one-shot + `ContextBudgetExhaustedError`); `task` = delegated/assistant task compression (multi-compress + timeout fallback + stall early-exit).
- `WorkspaceToolLoopOptions.compressionMode: RuntimeCompressionMode` — required; drives the compression branch in both native and text tool loops.
- `WorkspaceToolLoopOptions.agentContextSnapshot?: AgentContextSnapshot` — narrative mode only; mutable object reference; in-turn compression updates it in place (`Object.assign`). Task mode does not use it (task agents have no cross-turn snapshot).
- `WorkspaceToolLoopOptions.contextTokenBudget?: number` — already-resolved budget (model `contextWindow` or `256k` default). Shared by both modes.
- `WorkspaceToolLoopOptions.compressCallModel?: CompressCallModel` — reuse `capabilities.callModel`. Shared by both modes.
- `WorkspaceToolLoopOptions.taskStartedAt?: number` — task mode only; wall-clock start (`Date.now()`) for timeout check.
- `WorkspaceToolLoopOptions.taskTimeoutMs?: number` — task mode only; timeout quota in ms (defaults to `DEFAULT_TASK_TIMEOUT_MS` = 300000).
- `AgentRuntimeTurnInput.compressionMode?: RuntimeCompressionMode` — entry path mode; defaults to `"narrative"`. Host passes `"task"` for the desktop assistant, `"narrative"` (or omits) for master.
- `AgentRuntimeTurnInput.timeoutMs?: number` — task mode timeout quota; only effective when `compressionMode === "task"`. Narrative mode ignores it.
- `RuntimeAgentCallArguments.timeoutMs?: number` — optional per-call timeout for delegated `agent_call` targets; defaults to `DEFAULT_TASK_TIMEOUT_MS` when omitted.
- `estimateRuntimeMessagesTokens(messages: RuntimeChatMessage[]): number` — native loop token estimate, including `toolCalls` name + JSON-stringified `arguments` and tool observation content.
- `estimateAiChatMessagesTokens(messages: AiChatMessage[]): number` — text loop token estimate (tool observations are serialized into user content).
- `compressTaskContext<T>(messages, interactionSpan, oldSummary, callModel, options): Promise<TaskCompressionResult<T>>` — task compression: slices the tool-interaction span, keeps the recent `TASK_KEEP_RECENT_TOOL_ROUNDS` (5) rounds, summarizes earlier rounds into one `{ role: "user", content: "已完成工作摘要：..." }` message. Does not depend on `AgentContextSnapshot`; the summary text lives only within the turn (no persistence). (Assistant cross-turn persistence is a separate snapshot-layer mechanism — see the "Assistant Cross-Turn Context Persistence" scenario.)
- `locateTaskInteractionSpan(messages, mode: "native" | "text"): { start, end }` — locates the tool-interaction span by scanning backward from the end, skipping tool-interaction message shapes (native: `role: "tool"` / `assistant` with `toolCalls`; text: `user` with `<tsian-tool-observation>` / `assistant` with `<tsian-tool-call>`). Returns `{-1, -1}` when no tool interaction exists.
- `ContextBudgetExhaustedError extends Error` — `name: "ContextBudgetExhaustedError"`, message "上下文已满，无法继续本轮探索。请开始新会话或精简对话。". Shared by both modes as the "nothing left to compress" fallback.
- `TaskTimeoutError extends Error` — `name: "TaskTimeoutError"`, message includes elapsed seconds. Task mode timeout fallback (soft halt).
- `TaskCompressionStalledError extends Error` — `name: "TaskCompressionStalledError"`, message "上下文持续膨胀且压缩无效，已中止。请精简任务或拆分子任务。". Task mode stall early-exit (compression yield < `TASK_COMPRESSION_STALL_RATIO` = 0.1).
- Trace event `context_compressed_in_turn` (ok, data: `{ round, beforeTokens, budget, triggerThreshold, mode, ...afterTokens? }`). `mode` is `"narrative"` or `"task"`; `afterTokens` is task-mode only.
- Constants: `DEFAULT_TASK_TIMEOUT_MS = 300_000`, `TASK_KEEP_RECENT_TOOL_ROUNDS = 5`, `TASK_COMPRESSION_STALL_RATIO = 0.1`.

### 3. Contracts

- The tool loop has **no per-Agent round limit**. `AgentRuntimeCollaborationPolicy` no longer defines `maxToolRoundsPerAgent`. Termination conditions are: `finishReason === "stop"` / `toolCalls.length === 0`; abort (`AbortError`); and the mode-specific budget fallback.
- Before every model call (including round 0), the active loop estimates runtime-message tokens. When tokens exceed `budget * CONTEXT_COMPRESS_TRIGGER_RATIO` (0.85), the loop branches on `compressionMode`:

  **Narrative mode (master, tool-token-budget R2 unchanged):**
  - First crossing: compress the narrative span via `compressContext` (reuse the lifecycle module; compress only the narrative summary + recent turns, preserve all tool interactions), `Object.assign` the result into `agentContextSnapshot`, mark `compressedThisTurn = true`, and `splice`-replace the narrative span in the runtime messages (`locateHistorySpan` + `replaceHistorySpan`). The loop then continues.
  - Only the **entry-agent steady-state path** (an `agentContextSnapshot` was injected) performs in-turn narrative compression. The `最近对话：` fallback path has no injectable snapshot and skips compression; it still runs the budget fallback.
  - A second budget crossing (or any crossing when narrative compression is unavailable) is the fallback C: return the last round's stripped text if present (`completed` transcript); otherwise throw `ContextBudgetExhaustedError`.
  - In-turn narrative compression is allowed at most once per turn. A second crossing never recompresses.
  - Turn-start snapshot compression (R3, lifecycle module) runs in **both** modes: narrative mode compresses the story span (default `COMPRESSION_SYSTEM_PROMPT`); task mode compresses the assistant task-dialog snapshot (`ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` + 用户/助手 labels). This is the snapshot layer (cross-turn `AgentContextSnapshot`), independent of the in-turn tool-interaction compression below. Task mode delegates/assistants with no injected snapshot (delegated `agent_call` targets) fall back to `createInitialAgentContext` and typically skip turn-start compression (empty snapshot).

  **Task mode (delegated `agent_call` targets + desktop assistant):**
  - Every crossing is a compression attempt (no `compressedThisTurn` cap; multi-compress unlimited). Before compressing, check elapsed time: `Date.now() - taskStartedAt > taskTimeoutMs` → throw `TaskTimeoutError`.
  - Locate the tool-interaction span via `locateTaskInteractionSpan`. If no span (`start < 0`) → fallback C (return last stripped text / throw `ContextBudgetExhaustedError`).
  - Call `compressTaskContext` with the span + prior `taskSummary` (null on first compression). If `result.compressed === false` (early span empty, tool interactions ≤ `TASK_KEEP_RECENT_TOOL_ROUNDS`) → fallback C.
  - After compression, compare `beforeTokens` vs `afterTokens`. If `(before - after) / before < TASK_COMPRESSION_STALL_RATIO` (0.1) → throw `TaskCompressionStalledError` (stall early-exit, do not burn budget waiting for timeout).
  - Update `runtimeMessages`/`nextMessages` to `result.messages`, update `taskSummary` to `result.summary`, emit `context_compressed_in_turn` with `mode: "task"` + `afterTokens`, continue the loop.
  - Task compression never touches `agentContextSnapshot` (task agents' in-turn tool-interaction compression is separate from the cross-turn snapshot). The in-turn summary text lives only within the turn. The **assistant** now has cross-turn snapshot persistence (see "Assistant Cross-Turn Context Persistence" scenario): the host injects the persisted snapshot as `agentContext` and writes back `contextUpdate` (append turn + compression result) to the virtual file. **Delegated `agent_call` targets** have no cross-turn persistence (turn-internal only); their `contextUpdate` is not persisted by the host.

- **Timeout fallback (task mode only):** `createAgentCallRunner` (delegated) and `runAssistantChat` (assistant) each create an independent `AbortController` + `setTimeout(() => abort("task-timeout"), taskTimeoutMs)`, merged with the user-abort signal via `AbortSignal.any` into a composite signal threaded into the tool loop. On timeout, the catch block re-surfaces `TaskTimeoutError` (delegated: wrapped as `AGENT_CALL_FAILED` observation with `{ timeout: true, taskTimeoutMs }` details so master can distinguish; assistant: thrown to AssistantView). Master (`interaction.sendMessage`) does **not** create a timeout controller — narrative mode relies on one-shot compression + user abort; a timeout would mis-kill narrative deep thought.
- `runAgentRuntimeTurn` threads `compressionMode` (from `input.compressionMode ?? "narrative"`), `agentContextSnapshot` (narrative only, mutable reference), `contextTokenBudget`, `compressCallModel`, and task-mode `taskStartedAt`/`taskTimeoutMs` into the tool options. After the loop, narrative-mode `contextUpdate.compressedContext` carries the in-turn compressed snapshot if `updatedAt` changed; task mode leaves `compressedContext` undefined (the assistant snapshot's turn-start compression result is carried via `compressedContext` when the entry path compressed it — the host writes it back to the virtual file).
- AssistantView catch recognizes `ContextBudgetExhaustedError`, `TaskTimeoutError`, and `TaskCompressionStalledError` by `error.name` (no runtime-internal import). All three route to the same soft-halt branch (symmetric with abort): keep already-streamed thought, append a soft `_（…）_` note when content exists (or set content to the soft prompt when empty), `persistCurrentSession()`, and **do not** set `errorMessage` or pop the placeholder. `ContextCompressionFailedError` (turn-start compression failure) still routes to the `errorMessage` branch.

### 4. Validation & Error Matrix

- Narrative budget crossing when `agentContextSnapshot` is available and not yet compressed this turn -> compress narrative span, continue loop, emit `context_compressed_in_turn` with `mode: "narrative"`.
- Narrative budget crossing a second time in the same turn -> return last stripped text if present, otherwise throw `ContextBudgetExhaustedError`.
- Narrative budget crossing when no `agentContextSnapshot` is available (fallback path) -> same as second crossing (no compression attempted).
- Task budget crossing -> check timeout; if elapsed throw `TaskTimeoutError`; else locate tool-interaction span, compress via `compressTaskContext`, check stall; if compressed continue loop (emit `context_compressed_in_turn` with `mode: "task"` + `afterTokens`); if not compressed or no span -> fallback C.
- Task timeout elapsed (delegated) -> `AGENT_CALL_FAILED` observation with `{ timeout: true, taskTimeoutMs }`; master continues its own loop.
- Task timeout elapsed (assistant) -> `TaskTimeoutError` -> AssistantView soft prompt "任务超时，已中止".
- Task compression stall (yield < 10%) -> `TaskCompressionStalledError` -> delegated: `AGENT_CALL_FAILED` with `{ stalled: true }`; assistant: soft prompt "上下文持续膨胀且压缩无效，已中止".
- `compressContext` failure during narrative in-turn compression -> propagates `ContextCompressionFailedError` (unchanged behavior).
- `compressTaskContext` failure (model call fails or empty summary) -> throws `ContextCompressionFailedError` (reused, same semantics).
- `ContextBudgetExhaustedError` / `TaskTimeoutError` / `TaskCompressionStalledError` in AssistantView -> soft prompt, keep streamed thought, no `errorMessage`.
- Tool interactions are never compressed in narrative mode; task mode compresses only the tool-interaction span (framework messages + recent N rounds preserved).
- Master (`interaction.sendMessage`) passes `compressionMode: "narrative"` and no `timeoutMs`; master behavior is unchanged from tool-token-budget R2.

### 5. Good/Base/Bad Cases

- Good: a 6-round exploration (list -> read -> list -> read) completes without any round-limit error and returns a final reply.
- Good: narrative mode — when accumulated tool interactions push tokens past 85% mid-turn, the narrative span is compressed once, tool interactions are preserved, the model continues without re-exploring, and `context_compressed_in_turn` (mode: narrative) is traced.
- Good: task mode — a delegated memory agent reading 10 files triggers task compression mid-turn, early tool interactions are summarized into one "已完成工作摘要" user message, recent 5 rounds preserved, the agent continues and returns its conclusion.
- Good: task mode — multi-compress: a long task triggers compression 2+ times, each time summarizing earlier rounds, until completion or fallback.
- Good: task timeout — `agent_call(memory, timeoutMs=10000)` on a long task aborts at 10s, master receives `AGENT_CALL_FAILED` with `{ timeout: true }`, master continues its own loop.
- Good: task stall — reading a huge single file pushes tokens up, compression yields <10%, `TaskCompressionStalledError` aborts early without waiting for timeout.
- Good: a second narrative budget crossing returns the last streamed thought with a soft note, or throws `ContextBudgetExhaustedError` shown as the soft prompt.
- Base: ordinary short turns never estimate past the threshold and never compress (either mode).
- Base: turn-start narrative compression (lifecycle module) and in-turn compression are independent checks; task mode skips turn-start narrative compression.
- Bad: reintroducing a per-Agent round limit as a termination condition.
- Bad: compressing tool interactions in narrative mode (only the narrative span is compressed there).
- Bad: allowing more than one in-turn narrative compression per turn.
- Bad: capping task-mode compression count (task mode is multi-compress, bounded by timeout + stall, not count).
- Bad: adding a timeout to master (narrative mode) — would mis-kill narrative deep thought.
- Bad: persisting **delegated** task-mode compression summaries (delegated `agent_call` targets have no cross-turn persistence; only the desktop assistant has snapshot persistence via the virtual file — see "Assistant Cross-Turn Context Persistence").
- Bad: setting `errorMessage` or popping the placeholder on `ContextBudgetExhaustedError` / `TaskTimeoutError` / `TaskCompressionStalledError`.

### 6. Tests Required

- Assert the tool loop runs beyond 4 rounds without a round-limit error when the model keeps requesting tools.
- Assert a first narrative budget crossing compresses the narrative span (tool interactions preserved) and the loop continues.
- Assert a second narrative budget crossing returns last stripped text or throws `ContextBudgetExhaustedError`.
- Assert narrative fallback paths never attempt in-turn compression but still run the budget fallback.
- Assert task budget crossing compresses the tool-interaction span (framework + recent 5 rounds preserved, earlier rounds summarized into one user message) and the loop continues.
- Assert task mode allows multiple compressions in one turn (no `compressedThisTurn` cap).
- Assert task timeout throws `TaskTimeoutError` (assistant) / `AGENT_CALL_FAILED` with timeout details (delegated).
- Assert task compression stall (yield < 10%) throws `TaskCompressionStalledError`.
- Assert task mode with no tool-interaction span or non-compressible early span falls back to `ContextBudgetExhaustedError`.
- Assert `agent_call` accepts optional `timeoutMs` and threads it to the delegated timeout controller (default 300s when omitted).
- Assert AssistantView shows the soft prompt for `ContextBudgetExhaustedError` / `TaskTimeoutError` / `TaskCompressionStalledError` without setting `errorMessage` or popping the placeholder.
- Assert narrative in-turn compressed snapshot is carried through `contextUpdate.compressedContext` for host persistence; task mode leaves it undefined.
- Assert master (`interaction.sendMessage`) behavior is unchanged (narrative mode, no timeout).

## Scenario: Parallel agent_call Within A Round

### 1. Scope / Trigger

- Trigger: a single tool-loop round issues multiple `agent_call` tool calls, or any `agent_call` tool call needs its process visible upstream.
- Applies when changing `apps/platform-web/src/agent-runtime/workspace-tools.ts` (`executeRuntimeWorkspaceToolCalls` grouping), `apps/platform-web/src/agent-runtime/index.ts` (`WorkspaceToolLoopOptions`, `createAgentCallRunner` event threading, `AgentRuntimeTurnInput`/`AgentRuntimeModelCallOptions` event signatures), `apps/platform-web/src/streaming-events.ts`, `apps/platform-web/src/bridge/remote-iframe-bridge.ts`, or `packages/contracts/src/bridge.ts` (`RemotePlayBridgeEventPayload`).

### 2. Signatures

- `AgentRuntimeCollaborationPolicy` no longer defines `maxCallsPerTurn`. `callCount` is retained on `AgentCallTurnState` as a diagnostic counter (trace metadata) but does not gate execution. `maxDepth=2` remains the recursion safety net.
- `AgentRuntimeTurnInput.onDelta?: (agentId: string, delta: string, round: number) => void`
- `AgentRuntimeTurnInput.onRoundEnd?: (agentId: string, round: number, finishReason: "stop" | "tool_calls") => void`
- `AgentRuntimeTurnInput.onTool?: (agentId: string, round: number, callId: string, name: string, status: "loading" | "running" | "success" | "failed", output?: string) => void`
- `AgentRuntimeModelCallOptions` mirrors the same three signatures.
- `emitTurnDelta(agentId, delta, turn, round)` / `emitTurnRoundEnd(agentId, turn, round, kind)` / `emitTurnTool(agentId, turn, round, callId, name, status, output?)` — `agentId` is the first parameter on the streaming-events bus.
- `RemotePlayBridgeEventPayload` `turn-delta` / `turn-round-end` / `turn-tool` variants include `agentId: string`.

### 3. Contracts

- `executeRuntimeWorkspaceToolCalls` splits tool calls into three groups: a parallel group (read-only, stateless tools in `PARALLEL_TOOL_NAMES`), an `agentCallGroup` (all `agent_call` calls in the round), and a serial group (writes, `run_script`, unparseable calls). The parallel group runs first via `Promise.all`, then the agent-call group via `Promise.all`, then the serial group in original order. Observations are collected in a Map keyed by the original call index so the returned array stays aligned with `calls` (native loop pairs by `result.toolCalls[index].id`).
- Multiple `agent_call` calls in the same round run concurrently. `agent_call` is NOT in `PARALLEL_TOOL_NAMES` (it runs a delegated tool loop with workspace writes, nested agent_call, and shared `callCount`); it has its own group because same-round agent_calls are independent of each other.
- The serial group runs after the agent-call group so delegated workspace writes are visible to this round's serial writes.
- `run_script` stays serial (side effects + bounded timeout); it is not in `PARALLEL_TOOL_NAMES` and not in the agent-call group.
- `agent_call` observations travel the tool-observation channel (`formatRuntimeWorkspaceToolObservationMessage`); they are NOT wrapped as narrative user messages (would pollute the story span and break `compressContext`).
- Parallel `agent_call` targets each run in **task compression mode** with independent timeout + compression state: each `createAgentCallRunner` closure creates its own `timeoutController` + `setTimeout` (its own `taskTimeoutMs`, from `agentCall.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS`), its own `taskStartedAt`, its own `taskSummary` accumulator, and its own compression count. Parallel delegated agents compress their own messages independently and time out independently — one agent's compression/timeout does not affect another's. Observations (completed / `AGENT_CALL_FAILED` with timeout/stalled) return aligned to the original call index. See the "Turn Token Budget And In-Turn Compression (Narrative + Task modes)" scenario.
- `callCount += 1` is atomic under JS single-threaded async interleaving; `agentCallDepth` is passed by value (caller-depth snapshot), so parallel agent_calls do not share depth state. No locking is required.
- Workspace writes from parallel agent_calls land in the shared staged transaction array; last-write-wins by path (same semantics as serial). Parallel execution does not introduce a new conflict model; typical delegated agents write different paths (memory vs state).
- There is no per-turn `agent_call` count limit. `maxCallsPerTurn` was removed (same rationale as removing `maxToolRoundsPerAgent`: the turn token budget bounds total volume). `maxDepth=2` remains to prevent unbounded recursion (token budget cannot bound recursion depth).
- Event sinks `onDelta`/`onRoundEnd`/`onTool` carry `agentId` as the first parameter, identifying the emitting agent. The entry agent emits with its own id (e.g. `master`); a delegated `agent_call` target emits with the target agent id (e.g. `memory`). The native tool loop binds `agentId` from `agentContext.agent.id` at emit time. The text-protocol loop does not emit these events (delegated text-protocol agents stay silent, unchanged).
- `createAgentCallRunner` threads `input.onDelta`/`input.onRoundEnd`/`input.onTool` into the delegated call options so the delegated agent's process is visible upstream. Only the native loop emits; delegated agents in text mode remain silent.
- The host's `callModelNative` closure adapts the runtime's `(agentId, delta, round)` onDelta to the lower-level `streamAssistantReplyNative` `(delta, round)` by binding `options.agentId`. `ai.ts` does not know about `agentId`.
- The streaming-events bus forwards `agentId` to subscribers; `remote-iframe-bridge` includes `agentId` in `turn-delta`/`turn-round-end`/`turn-tool` event payloads so game frontends can distinguish parallel delegated agents.
- AssistantView (desktop assistant) accepts the `agentId` parameter on its `onDelta`/`onTool` callbacks for signature uniformity but does not use it (single-agent view); its rendering is unchanged.
- `round` in a delegated event is that delegated agent's own tool-loop round, not the entry agent's round. Subscribers distinguish agents by `agentId`, not by comparing `round` across agents. `turn` remains the master turn.

### 4. Validation & Error Matrix

- Multiple `agent_call` in one round -> run concurrently; observations aligned to original call index.
- Single `agent_call` in one round -> runs in the agent-call group (Promise.all of one element) equivalent to serial; behavior unchanged except events now carry `agentId`.
- `agent_call` beyond `maxDepth` -> `AGENT_CALL_UNAVAILABLE` with compact depth/budget metadata (unchanged).
- No `AGENT_CALL_LIMIT_EXCEEDED` — the per-turn call-count limit was removed.
- `run_script` mixed with `agent_call` in one round -> `run_script` runs in the serial group after the agent-call group.
- Workspace write conflict between parallel agent_calls -> last-write-wins in the staged transaction (no conflict detection).
- Delegated native-mode agent -> emits `onDelta`/`onRoundEnd`/`onTool` with target agent id; delegated text-mode agent -> silent (unchanged).
- Abort -> shared `input.signal` cancels all parallel agent_calls (each `callModelNative` checks the signal).

### 5. Good/Base/Bad Cases

- Good: master issues `agent_call(memory)` + `agent_call(state)` in one round; both run concurrently, the game frontend renders two tool-process streams distinguished by `agentId`, wait time is shorter than serial, observations return aligned to call order.
- Good: master issues a single `agent_call(memory)`; it runs as a one-element Promise.all, behavior matches the pre-change serial path (events now carry `agentId="memory"`).
- Good: a delegated memory agent tries a nested `agent_call` at depth 2 -> `AGENT_CALL_UNAVAILABLE`; it continues its own loop with the error observation.
- Base: a round with only read tools and no `agent_call` -> parallel group only, agent-call group empty, serial group empty.
- Base: desktop assistant chat -> single agent, `agentId` ignored by AssistantView, rendering unchanged.
- Bad: reintroducing a per-turn `agent_call` count limit (the turn token budget bounds volume).
- Bad: wrapping `agent_call` observations as narrative user messages (breaks story/tool layering and `compressContext`).
- Bad: putting `agent_call` in `PARALLEL_TOOL_NAMES` (it is not a read-only stateless tool).
- Bad: making `ai.ts` aware of `agentId` (the host closure adapts the signature; `ai.ts` stays low-level).
- Bad: blocking the entry agent across turns on a delegated agent (cross-turn background agents are out of scope under the current blocking-turn model).

### 6. Tests Required

- Assert multiple `agent_call` in one round run concurrently (event timestamps interleave / wait time < serial).
- Assert observations return aligned to the original call order (Map-by-index).
- Assert single `agent_call` behaves as before (serial-equivalent) except events carry `agentId`.
- Assert `run_script` stays serial and runs after the agent-call group.
- Assert nested `agent_call` beyond `maxDepth` returns `AGENT_CALL_UNAVAILABLE`.
- Assert no `AGENT_CALL_LIMIT_EXCEEDED` is ever thrown (count limit removed).
- Assert delegated native-mode events carry the target agent id; text-mode delegated agents stay silent.
- Assert bridge `turn-delta`/`turn-round-end`/`turn-tool` payloads include `agentId`.
- Assert abort cancels all parallel agent_calls.
- Assert master turn token-budget fallback (`ContextBudgetExhaustedError`) is not regressed.

## Scenario: Assistant Cross-Turn Context Persistence

### 1. Scope / Trigger

- Trigger: the desktop assistant persists its agent context snapshot across turns/loads, or changes `apps/platform-web/src/agent-runtime/context-lifecycle.ts` (assistant constants, `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`, parametrized `createEmptyAgentContext`/`createInitialAgentContext`/`parseAgentContext`/`compressContext`), `apps/platform-web/src/agent-runtime/index.ts` (entry turn-start compression guard/mode selection), `apps/platform-web/src/platform-host/index.ts` (`runAssistantChat` snapshot read/stage, `AssistantChatInput.sessionId`, `readAssistantContextFromFiles`/`nextAssistantTurnNumber`/`stageAssistantContextFile`), `apps/platform-web/src/storage/local-assistant-files.ts` (`assistantContextPath`/`deleteLocalAssistantFile`), `apps/platform-web/src/storage/assistant-conversations.ts` (`deleteAssistantSession` context cleanup), or `AssistantView.vue` (`sessionId` threading).
- Applies when changing the assistant context snapshot lifecycle, schema, storage path, compression prompt, or session-delete cleanup.

### 2. Signatures

- `AgentContextSnapshot` (contracts) is shared by master and assistant. `schema: "tsian.agent.context.v1" | "tsian.assistant.context.v1"`; `agentId: string` (master=`"master"`, assistant=`"assistant"`); `saveId: string` (master=saveId, assistant=sessionId). Type relaxation is backward-compatible (`"master"` is a `string` subtype; master values stay legal).
- `ASSISTANT_CONTEXT_SCHEMA = "tsian.assistant.context.v1"`, `ASSISTANT_CONTEXT_AGENT_ID = "assistant"` — assistant snapshot markers (context-lifecycle.ts).
- `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` — task-dialog summary style (用户请求 + 助手工作/结论), distinct from master's `COMPRESSION_SYSTEM_PROMPT` (narrative梗概) and turn-internal `TASK_COMPRESSION_SYSTEM_PROMPT` (tool-interaction log).
- `createEmptyAgentContext(saveId, options?: { schema?, agentId? })` / `createInitialAgentContext(saveId, recentHistory, currentTurn, options?)` / `parseAgentContext(content, saveId, options?)` — parametrized; defaults to master values (backward-compatible). Assistant passes `{ schema: ASSISTANT_CONTEXT_SCHEMA, agentId: ASSISTANT_CONTEXT_AGENT_ID }`.
- `compressContext(context, threshold, callModel, options)` — `CompressCallOptions` extended with optional `systemPrompt?` / `userLabel?` / `assistantLabel?`; defaults to master narrative style. Assistant passes the task-summary prompt + 用户/助手 labels.
- `assistantContextPath(sessionId): string` — returns `.tsian/local/assistant/sessions/<sessionId>/context.json` (virtual file path inside the local-assistant-files Dexie map).
- `deleteLocalAssistantFile(path): Promise<void>` — removes a single file from the local-assistant-files Dexie map (saveLocalAssistantFiles is merge-only). Only handles `.tsian/local/assistant/` prefix paths.
- `AssistantChatInput.sessionId: string` — required; host reads/writes the session's context snapshot at this path.
- `readAssistantContextFromFiles(files, sessionId): AgentContextSnapshot | null` — finds the snapshot in already-loaded `localAssistantFiles` (zero extra IO); null when absent.
- `nextAssistantTurnNumber(snapshot): number` — `max(maxRecentTurn, lastCompressedTurn ?? 0) + 1`; fixes the turn=1-always bug so `lastCompressedTurn` dedup works.
- `stageAssistantContextFile(workspaceTransaction, input)` — appends the turn + compression result to the snapshot and writes it into `workspaceTransaction` (piggybacks `commitAssistantWorkspaceFiles` → `saveLocalAssistantFiles` merge).

### 3. Contracts

- The desktop assistant persists a per-session agent context snapshot as a **virtual file** at `.tsian/local/assistant/sessions/<sessionId>/context.json`. This lives in the `local-assistant-files` Dexie map (`assistant-local-files` key), the same map that stores agent identity files (agent.json/SOUL.md/AGENT.md). The `sessions/` subdirectory separates session state from cross-session identity. The snapshot is agent-visible: the assistant can `workspace_read`/`workspace_list`/`workspace_write` it —契合"平台数据收录到文件系统、用桌面 agent 管理"的产品哲学.
- Multi-session isolation: each session has its own `sessions/<sessionId>/context.json`; switching sessions does not cross-contaminate context. This is why the path is per-session, not a single shared `.tsian/local/assistant/context.json`.
- The snapshot is separate from visible messages (`assistant-session:<sessionId>` Dexie key, UI display, max 200). Visible messages are the UI display layer; the snapshot is the agent context steady-state layer. This mirrors master's `saveHistory` vs `agents/master/context.json` separation.
- `runAssistantChat` turn-start: `loadLocalAssistantFiles()` (already called) returns the map including the session's context file; `readAssistantContextFromFiles` finds it (zero extra IO). When absent (legacy session created before this feature), `createInitialAgentContext(sessionId, history, 1, { schema, agentId })` reconstructs recentTurns from visible-message history (no summary). `nextAssistantTurnNumber` derives the next turn from the snapshot; the host sets `snapshot.state.turn = nextTurn - 1` so `currentRuntimeTurnNumber` returns `nextTurn` (fixing the prior turn=1-always bug that broke `lastCompressedTurn` dedup). The host injects `agentContext` + `contextTokenBudget` (resolved from the assistant model config's `contextWindow`) into `runAgentRuntimeTurn`.
- Entry turn-start compression (lifecycle R3) runs in **both** modes (guard widened from narrative-only). Task mode (assistant) compresses the snapshot with `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` + 用户/助手 labels; narrative mode (master) uses defaults (unchanged). This snapshot compression is independent of in-turn `compressTaskContext` (tool-interaction span): the former compresses the cross-turn `AgentContextSnapshot` (summary + recentTurns); the latter compresses the current turn's messages.
- `runAssistantChat` turn-end (success path only): `stageAssistantContextFile` appends the turn's user+assistant to the snapshot (or uses `contextUpdate.compressedContext` when turn-start compression ran) and **directly calls `saveLocalAssistantFiles`** to persist the context virtual file. It does **not** go through `RuntimeWorkspaceTransaction` — `.tsian/local/` paths have no entry in the save transaction layer (both `assertOrdinarySaveRuntimeMutationPath` and `assertPlatformSaveRuntimeMutationPath` reject `.tsian/local/`: the former forbids `.tsian/`, the latter's `isSaveRuntimePersistencePath` excludes `.tsian/local/` as local-only non-checkpoint data). The direct `saveLocalAssistantFiles` merge is the correct local-basket channel, consistent with `executeLocalWorkspaceOperation` (resource manager) and `commitAssistantWorkspaceFiles` (identity files).
- Turn failure (abort/timeout/stall/error): the catch path calls `activeWorkspaceTransaction.discard()` and does **not** call `stageAssistantContextFile` — the snapshot on disk stays at its turn-start state (symmetric to master's turn-failure discard). Since `.tsian/local/` writes bypass the transaction, there is no staged local write to discard; the direct-`saveLocalAssistantFiles` only runs on the success path.
- **Assistant `workspace.write`/`workspace.delete` tool routing for `.tsian/local/`**: `runAssistantChat`'s `workspaceMutations.write`/`delete` route `isLocalAssistantPath` writes/deletes **directly to `saveLocalAssistantFiles`/`deleteLocalAssistantFile`** (bypass `RuntimeWorkspaceTransaction`), so the assistant agent's level-4 write permission to `.tsian/` actually lands in the local basket. Non-`isLocalAssistantPath` `platform-meta` writes still go through `writePlatformFile` (e.g. `.tsian/diagnostics/`). This closes the gap where the permission layer (level 4 ≥ editLevel 4) allowed the write but the transaction layer rejected `.tsian/local/`. The assistant can thus manage its own context virtual file and other `.tsian/local/assistant/` data via workspace tools — file-system visibility哲学.
- **Three-layer write routing for the assistant** (level 4): `card-content` (editLevel 2) → `workspaceTransaction.write` → `commitAssistantWorkspaceFiles` → `updateCardContentFilesForCard` (edits the mounted card, the "挂载的硬盘" model — swap card swaps data); `save-runtime` (editLevel 1) → `workspaceTransaction.write` → `commitAssistantWorkspaceFiles` → `replaceWorkspaceFilesForSave` (edits the save); `platform-meta` + `isLocalAssistantPath` → direct `saveLocalAssistantFiles`/`deleteLocalAssistantFile` (local basket, not in save transaction/checkpoint/distribute). Runtime card agents (level 1) cannot reach `.tsian/` (readLevel 4 / editLevel 4) at all — the permission layer blocks them, so they never hit the local-basket routing.
- Session delete (`deleteAssistantSession`) calls `deleteLocalAssistantFile(assistantContextPath(id))` to clean up the context virtual file alongside the visible-messages key (no orphan data).
- `AgentContextSnapshot.saveId` is reused as sessionId for assistant snapshots (locating is by file path, not by this field; `compressContext`/`appendTurnToContext` only pass it through).
- Cross-load recovery: `loadLocalAssistantFiles` restores the Dexie map (including `sessions/<id>/context.json`) on browser refresh/reopen; the next turn's `readAssistantContextFromFiles` recovers the snapshot — the assistant does not lose context across loads.
- Master is unaffected: master's `agents/master/context.json` path, `readAgentContextFromWorkspace`/`stageAgentContextFile`, narrative compression prompt, and `interaction.sendMessage` path are unchanged. Type relaxation (`agentId: string`, `schema` union) is backward-compatible — master values remain legal.

### 4. Validation & Error Matrix

- No context virtual file for a session (new or legacy) -> `readAssistantContextFromFiles` returns null -> `createInitialAgentContext` reconstructs from visible-message history -> turn proceeds, snapshot written at turn-end.
- Corrupted context virtual file (invalid JSON / wrong shape) -> `parseAgentContext` falls back to `createEmptyAgentContext` (assistant schema/agentId) -> turn proceeds with empty snapshot.
- Turn failure -> snapshot on disk unchanged (no append of the failed turn).
- Session delete -> both visible-messages key and context virtual file removed (no orphan).
- Master turn -> unchanged (narrative mode, `agents/master/context.json`, default compression prompt).
- `AssistantChatInput` without `sessionId` -> TypeScript compile error (required field).

### 5. Good/Base/Bad Cases

- Good: assistant multi-turn dialog -> each turn appends to `sessions/<id>/context.json`; closing/reopening the browser restores context (assistant remembers prior work).
- Good: long dialog -> snapshot token exceeds 85% -> turn-start compression summarizes early turns into a task summary, recent 5 turns preserved, snapshot stays bounded.
- Good: multiple sessions A/B -> each has its own `sessions/<A>/context.json` and `sessions/<B>/context.json`; switching A↔B injects the right snapshot, no cross-contamination.
- Good: assistant uses `workspace_read .tsian/local/assistant/sessions/<id>/context.json` to inspect its own context (file-system visibility哲学).
- Good: deleting a session removes both the visible-messages Dexie key and the context virtual file.
- Base: a legacy session (created before this feature) with visible messages but no context file -> first turn reconstructs recentTurns from history, subsequent turns persist normally.
- Base: a fresh session -> empty snapshot, first turn writes the initial context file.
- Bad: storing the assistant snapshot at a single shared `.tsian/local/assistant/context.json` (would cross-contaminate sessions).
- Bad: storing the assistant snapshot in a separate Dexie key invisible to workspace tools (breaks file-system visibility哲学).
- Bad: master's `agents/master/context.json` path or narrative compression prompt changing (master must be unaffected).
- Bad: writing the context file on turn failure (must discard, symmetric to master).
- Bad: leaving the context virtual file behind when deleting a session (orphan data).

### 6. Tests Required

- Assert assistant multi-turn dialog persists `sessions/<id>/context.json` with increasing turn numbers and appended recentTurns.
- Assert closing/reopening the browser restores the assistant context (snapshot recovered from the virtual file).
- Assert long-dialog compression triggers turn-start snapshot compression (task-summary prompt), summary rolls forward, recentTurns stays bounded to 5.
- Assert multi-session isolation: sessions A and B keep separate snapshots; switching does not cross-contaminate.
- Assert `workspace_read .tsian/local/assistant/sessions/<id>/context.json` returns the snapshot (agent-visible virtual file).
- Assert session delete removes both the visible-messages key and the context virtual file (no orphan).
- Assert legacy session migration: visible messages without a context file reconstruct recentTurns on first turn.
- Assert turn failure (abort/timeout) does not append the failed turn to the snapshot.
- Assert master narrative compression + `agents/master/context.json` persistence is unchanged.
- Assert turn numbers increase monotonically across turns (not stuck at 1) and `lastCompressedTurn` dedup works.
- Assert `npm run build:contracts && npm run build:web` passes.

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.

## Scenario: Play Bridge Event Payload Type Alignment

### 1. Scope / Trigger

- Trigger: platform-web changes `RemotePlayBridgeEventPayload` (contracts `bridge.ts`), the `remote-iframe-bridge` event-forwarding code, or the streaming-events `turn-delta`/`turn-round-end` `kind` taxonomy.

### 2. Contract

- `turn-delta` event payload carries `kind: "reasoning" | "content"` (the streaming-text classification from `TurnDeltaKind` in `streaming-events.ts`). The payload member in `RemotePlayBridgeEventPayload` **must** include this `kind` field — the bridge forwards it verbatim from `subscribeTurnDelta`.
- `turn-round-end` event payload carries `kind: "thought" | "final"` (`TurnRoundEndKind`). These are distinct `kind` enums on distinct event payloads — do not conflate them.
- The two `kind` fields are separate from the message-envelope `kind` (`hello|ready|request|response|event`). When touching event payloads, verify the union member shape matches what `remote-iframe-bridge.ts` actually posts.

### 3. Common Pitfall

```typescript
// Wrong — RemotePlayBridgeEventPayload turn-delta member omits kind
| { agentId: string; delta: string; turn: number; round: number }
// remote-iframe-bridge posts { agentId, delta, turn, round, kind: "reasoning"|"content" }
// -> TS2322: Type 'TurnDeltaKind' not assignable to '"thought" | "final"'
// (the only kind-bearing union member is turn-round-end's, causing a positional mismatch)
```

The fix: add `kind: "reasoning" | "content"` to the `turn-delta` union member so the contract reflects the actual emitted payload shape.

## Scenario: Assistant Frontend Inspection Tool (inspect_frontend)

### 1. Scope / Trigger

- Trigger: platform-web adds or changes the `inspect_frontend` platform tool, the `createFrontendInspector` capability, the `MountRemoteIframeFrontendOptions.onSessionId` callback, or the inspection bridge/session-lifecycle in `platform-host/frontend-inspector.ts`.
- Applies when changing `apps/platform-web/src/agent-runtime/workspace-tools.ts` (inspect types/dispatch), `apps/platform-web/src/agent-runtime/tool-schemas.ts` (inspect schema gating), `apps/platform-web/src/platform-host/frontend-inspector.ts` (inspector factory), `apps/platform-web/src/bridge/remote-iframe-bridge.ts` (`onSessionId` callback), or `apps/platform-web/src/platform-host/assistant-chat.ts` (capability injection).

### 2. Signatures

- Tool name: `inspect_frontend` (registered in `AgentPlatformToolName` via `AGENT_PLATFORM_TOOL_NAMES.inspectFrontend`).
- Capability: `AgentRuntimeCapabilities.runInspectFrontend?(input: InspectFrontendInput): Promise<InspectFrontendResult>` — types live in `agent-runtime/workspace-tools.ts` (NOT `platform-host`), so agent-runtime never reverse-depends on platform-host.
- Inspector factory: `createFrontendInspector(): (input: InspectFrontendInput) => Promise<InspectFrontendResult>` in `platform-host/frontend-inspector.ts`.
- Bridge callback: `MountRemoteIframeFrontendOptions.onSessionId?: (sessionId: string) => void` — pure additive optional callback; PlayView does not pass it, zero behavior change for `/play`.
- Input: `InspectFrontendInput` — `{ send?, actions?, observeBetween?, refresh?, wait?, runtime?, screenshot? }`. No `cardId` (inspector reads `getPlatformActiveGameCard()` internally).
- Result: `InspectFrontendResult` — `{ ok, cardId, entry, structure, diagnostics, timeline?, actionSnapshots?, fileLineMap?, diff?, truncated?, error? }`.

### 3. Contracts

- **Special-tool registration touches 9 files** (mirrors `agent_call`): `contracts/runtime.ts` (`AgentPlatformToolName`), `agent-runtime/permissions.ts` (`AGENT_PLATFORM_TOOL_NAMES` + default-state derivation via `defaultPlatformToolsForAgent`), `agent-runtime/registry.ts` (allow-set), `agent-runtime/workspace-tools.ts` (tool name + types + context field + normalize + dispatch), `agent-runtime/tool-schemas.ts` (schema + `buildEnabledToolSchemas` gating), `agent-runtime/index.ts` (`AgentRuntimeCapabilities` + two-loop threading + `buildWorkspaceToolInstructions` text example), `storage/local-assistant-files.ts` (`defaultAssistantConfig().platformTools.enabled`), `platform-host/frontend-inspector.ts` (new file), `platform-host/assistant-chat.ts` (capability injection). **UI switch definitions** live in the shared `agent-runtime/tool-controls.ts` (`PLATFORM_TOOL_CONTROL_GROUPS`) — both `AssistantConfigPanel.vue` and `StudioView.vue` import this single source, so adding a tool there surfaces it as a toggle in both panels. Default enablement per agent type is derived in `permissions.ts`, not hardcoded in UI arrays.
- **Inspect types live in agent-runtime** (`workspace-tools.ts`), not platform-host. This respects the spec rule "agent-runtime must not import platform-host." The implementation (orchestration logic) lives in platform-host and imports the types — never the reverse.
- **Loading reuse**: inspector calls `resolvePackagedFrontendUrl({gameCardId, entry})` + `mountRemoteIframeFrontend(hiddenContainer, {bridge, sandbox, onBridgeReady, onSessionId})` — 1:1 mirror of PlayView packaged mount. Does NOT reimplement mounting.
- **Dedicated bridge** (`createInspectionBridge`): implements `PlayFrontendBridge` with its own `interaction.sendMessage` → `runEphemeralTurn`. Must NOT use `playFrontendBridge` (it `ensureActiveSave()` + broadcasts streaming to player frontend + uses module-level `previousTurnController` that aborts player turns). `query` reuses `getBaseBridge().query` (read-only, no side effects). `platform.runAction` returns unavailable. No `debug` bridge.
- **Ephemeral save isolation**: `runEphemeralTurn` uses `createLocalSaveFromGameCard(card)` (does NOT set active, does NOT emit savesChanged), its own `AbortController` (NOT the module-level `previousTurnController`), does NOT call `commitSuccessfulRuntimeTurnForSave`, and `deleteLocalSave(save.id)` in `finally`. Workspace files use `listEffectiveWorkspaceFilesForSave(save.id, card)` (storage export), NOT `listEffectiveWorkspaceFilesForActiveSave`. Capabilities (`callModel`/`callModelNative`/`toolCallMode`/`runBrowserScript`/`workspaceMutations`/`emitTrace`) must mirror `platform-host/index.ts` sendMessage path completely — missing any one causes master agent tool-call failures.
- **send bypasses mount's request path**: inspector calls `bridge.interaction.sendMessage` directly (not via frontend RPC request). Mount's `turn-completed` `postEvent` is bound to the request-response path (`remote-iframe-bridge.ts` `handleRemoteRequest`), so mount will NOT forward `turn-completed` for inspector-driven turns. Inspector must self-postMessage a `turn-completed` event to `iframe.contentWindow` with the `sessionId` from `onSessionId` so the frontend's `onEvent("turn-completed")` → `renderMessages` fires and DOM renders message bubbles.
- **Streaming delta forwarding** still works via mount's `subscribeTurnDelta`/`subscribeTurnRoundEnd`/`subscribeTurnTool` bus subscriptions (independent of request path), but only after handshake (`acceptedOrigin` set). Inspector must guard `bridgeReady` before `send` — if handshake hasn't completed, `postEvent`'s `if (!acceptedOrigin) return` swallows all delta events and the turn runs blind to the frontend.
- **Collection is parent-window-side**: inspector reads `iframe.contentDocument` and hijacks `iframe.contentWindow`'s `onerror`/`unhandledrejection`/`console` (same-origin required — `allow-same-origin` sandbox). Does NOT require frontend cooperation — blank/broken frontends that never send `ready` can still be diagnosed via DOM empty-state + resource 404 inference.
- **`renderedText` after send/refresh is snapshot-sourced**, not DOM-sourced: inspector reads `ephemeralSnapshot.state.messages` to populate `renderedText`, bypassing unreliable frontend render timing. `domSummary` still reads real DOM (with a `microTick` buffer). This dual approach ensures `renderedText` is always populated after a turn even if DOM rendering is slow.
- **DOM serialization** (`serializeDom`): limits depth (8), skips empty text nodes, truncates long attributes. For `HTMLInputElement`/`HTMLTextAreaElement`/`HTMLSelectElement`, reads `.value` and injects as `__value="..."` virtual attribute (because `.value` is a JS property, not a DOM attribute, and won't appear in `attributes` iteration).
- **Single-session serial**: module-level `currentSession` — new inspect call disposes previous hidden iframe first. `disposeCurrentSession` also resets `ephemeralSnapshot` and `ephemeralSaveId` (bridge closure references module-level `ephemeralSnapshot`; not resetting causes cross-call state leakage where a previous turn's messages appear in the next inspect's initial DOM). `lastInspectSnapshot` (diff baseline) is intentionally preserved across calls (design §9).
- **diff baseline**: module-level `lastInspectSnapshot` retains the previous inspect's `structure` + `diagnostics.errors`. First inspect has no diff (no prior baseline). Cross-card inspect pollutes the baseline (not bucketed by cardId) — known boundary, acceptable for MVP since inspector only checks the active card.
- **Deferred options**: `runtime:"mock"` and `screenshot:true` return not-supported errors (interface reserved, not implemented in v1).

### 4. Validation & Error Matrix

- No active game card → `INSPECT_FRONTEND_NO_ACTIVE_CARD`.
- Active card frontend missing or `kind !== "packaged"` → `INSPECT_FRONTEND_NOT_PACKAGED` (with `cardId` + `frontendKind` details).
- `send` with `wait !== "turn-completed"` → `INSPECT_FRONTEND_SEND_WAIT_MISMATCH` (send requires waiting for turn completion to collect timeline).
- `send` when `bridgeReady` is false (handshake timeout) → `INSPECT_FRONTEND_BRIDGE_NOT_READY` (delta events would be swallowed by `acceptedOrigin=null` guard; turn would run blind to frontend).
- `runtime:"mock"` → `INSPECT_FRONTEND_MOCK_UNSUPPORTED`.
- `screenshot:true` → `INSPECT_FRONTEND_SCREENSHOT_UNSUPPORTED`.
- DOM action selector not found → `INSPECT_SELECTOR_NOT_FOUND` (thrown as `PlatformActionError` shape from `applyAction`).
- Large results (timeline > 200 entries, actionSnapshots > 50, domSummary at limit) → `truncated: true`.

### 5. Good/Base/Bad Cases

- Good: `inspect_frontend({send:{message:"你好"}, wait:"turn-completed"})` runs a master turn on an ephemeral save, returns timeline + renderedText (snapshot-sourced) + domSummary (with message bubbles after self-postMessage turn-completed), and the ephemeral save is deleted without touching player saves/active pointer/list UI.
- Good: `inspect_frontend({actions:[{type:"type",selector:"#input",text:"测试"},{type:"click",selector:"#send"}],observeBetween:true})` simulates player input, returns stepwise DOM snapshots.
- Good: `inspect_frontend({refresh:true})` pulls the latest snapshot via `bridge.runtime.getRuntimeSnapshot`.
- Base: `inspect_frontend()` with no args loads the active card's packaged frontend and returns structure + diagnostics only.
- Bad: defining `InspectFrontendInput`/`InspectFrontendResult` in `platform-host/frontend-inspector.ts` and importing them into `agent-runtime` — this reverse-depends agent-runtime on platform-host, violating the layer boundary.
- Bad: using `playFrontendBridge` for the inspection iframe — it `ensureActiveSave()` (mutates player active pointer) and uses module-level `previousTurnController` (aborts player in-flight turns).
- Bad: calling `bridge.interaction.sendMessage` before `bridgeReady` — delta events swallowed by `acceptedOrigin=null`, frontend never receives streaming, turn runs blind.

### 6. Tests Required

- Assert `inspect_frontend` appears in assistant enabled tool schemas when `platformTools.enabled` includes it.
- Assert `inspect_frontend()` loads active card packaged frontend, returns `ok:true` + `cardId` + `entry` + structure + diagnostics.
- Assert blank/broken frontend (no ready / JS crash / resource 404) yields specific diagnostic causes, not generic "load failed".
- Assert `send` runs a master turn on an ephemeral save, returns timeline with turn-delta/turn-completed, and the ephemeral save is deleted after (player saves/active pointer/list UI unchanged).
- Assert `send` when `bridgeReady` is false returns `INSPECT_FRONTEND_BRIDGE_NOT_READY`.
- Assert `actions` with `observeBetween` returns stepwise snapshots.
- Assert `refresh` pulls latest snapshot.
- Assert `send` + `actions` compose.
- Assert error stack line numbers map to source files via `fileLineMap`.
- Assert second inspect result contains `diff` against the first.
- Assert consecutive inspects dispose the previous hidden iframe (single session at a time).
- Assert `disposeCurrentSession` resets `ephemeralSnapshot` (no cross-call state leakage).
- Assert `runtime:"mock"` and `screenshot:true` return not-supported.
- Assert vue-tsc passes; `build:web` + `build:contracts` pass.

### 7. Wrong vs Correct

#### Wrong — inspect types in platform-host, imported by agent-runtime

```typescript
// platform-host/frontend-inspector.ts
export interface InspectFrontendInput { ... }
// agent-runtime/workspace-tools.ts
import type { InspectFrontendInput } from "../platform-host/frontend-inspector"
// -> reverse-depends agent-runtime on platform-host; violates layer boundary
```

#### Correct — inspect types in agent-runtime, imported by platform-host

```typescript
// agent-runtime/workspace-tools.ts (alongside RuntimeAgentCallArguments)
export interface InspectFrontendInput { ... }
export type RuntimeInspectFrontendRunner = (input: InspectFrontendInput) => Promise<InspectFrontendResult>
// platform-host/frontend-inspector.ts
import type { InspectFrontendInput, InspectFrontendResult } from "../agent-runtime/workspace-tools"
```

#### Wrong — send without bridgeReady guard, delta events swallowed

```typescript
await waitForBridgeReadyOrTimeout(() => bridgeReady, 5000)
// no guard — proceeds to send even if bridgeReady is false
await bridge.interaction.sendMessage({ content: input.send.message })
// mount's postEvent("turn-delta") hits `if (!acceptedOrigin) return` -> all deltas swallowed
// frontend never receives streaming -> DOM stays blank -> domSummary empty
```

#### Correct — guard bridgeReady before send

```typescript
await waitForBridgeReadyOrTimeout(() => bridgeReady, 5000)
if (input.send && input.wait === "turn-completed" && !bridgeReady) {
  return failed("INSPECT_FRONTEND_BRIDGE_NOT_READY", "...")
}
await bridge.interaction.sendMessage({ content: input.send.message })
// acceptedOrigin is set -> mount forwards deltas -> frontend renders streaming
```

#### Wrong — not resetting ephemeralSnapshot on dispose, cross-call leakage

```typescript
function disposeCurrentSession(): void {
  if (currentSession) { currentSession.dispose(); currentSession = null }
  // ephemeralSnapshot still holds previous turn's messages
  // next inspect's frontend calls getRuntimeSnapshot() -> gets stale messages -> renders them
}
```

#### Correct — reset ephemeral state on dispose

```typescript
function disposeCurrentSession(): void {
  if (currentSession) { currentSession.dispose(); currentSession = null }
  ephemeralSnapshot = createEmptyRuntimeSnapshot()
  ephemeralSaveId = undefined
  // lastInspectSnapshot (diff baseline) intentionally preserved
}
```

## Scenario: Save-Runtime Semantic Search

### 1. Scope / Trigger

- Trigger: platform-web adds or changes save-runtime semantic retrieval, embedding config, the `embeddingIndex` Dexie table, or the `semantic_search` workspace operation.
- Applies when changing `apps/platform-web/src/agent-runtime/semantic-index/*`, `apps/platform-web/src/config/ai.ts` (embeddingConfig), `apps/platform-web/src/storage/db.ts` (embeddingIndex), `apps/platform-web/src/platform-host/index.ts` (turn commit enqueue), or `apps/platform-web/src/storage/saves.ts` (GC).

### 2. Signatures

- `WorkspaceOperationName += "semantic_search"` (read-only, same tier as `search`).
- `WorkspaceOperationRequest += semanticQuery?: string, typeFilter?: WorkspaceSemanticType`.
- `WorkspaceSemanticType = "turn" | "agent-notes" | "memory-summary"`.
- `WorkspaceSearchResult += semanticType?: WorkspaceSemanticType, turn?: number` (cosine similarity reuses `score`; no separate `semanticScore`).
- `AgentPlatformToolName += "workspace_semantic_search"` (independent granularity, not folded into `workspace_read`).
- `BrowserEmbeddingConfig = { enabled, baseUrl, apiKey, model, dimensions }` — independent section in `tsian-platform-config`, parallel to chat `providerTypes`, no `kind` field (MVP openai-compatible only).
- `LocalEmbeddingIndexRecord` in `embeddingIndex` table, keyed `[scope+ownerId]`.
- `resolveEmbeddingConfig(): BrowserEmbeddingConfig | null` — strict: enabled && baseUrl && apiKey && model && dimensions all satisfied, else null (index growth off).
- `semanticSearch(input, scope): Promise<WorkspaceSearchResult[]>` — never throws (empty index / API failure → `[]`).

### 3. Contracts

- **Why native, not Skill**: access face (semantic-index reads Dexie + workspace volumes in-process), permission propagation (`assertOperationExposed` + per-agent tool exposure is native), GC tied to save lifecycle. NOT "write-path bottleneck free increment" — that argument was invalidated: play-time writes (raw turn + maintenance) all go through staged transaction → `commitSuccessfulRuntimeTurnForSave` → direct `localDb.workspaceFiles.put`, bypassing `executeWorkspaceMutation`. A write hook on that dispatch is dead code for the main corpus.
- **Correctness source = cheap staleness check, not write hooks.** Search-time and turn-commit-time staleness compares `file.updatedAt` vs indexed `fileUpdatedAt`; stale/missing files get re-embedded. This covers all write paths (staged commit, direct volume, card import, studio edit) — losing only freshness, never correctness.
- **Proactive enqueue lives at turn commit** (`commitSuccessfulRuntimeTurnForSave` return, in `platform-host/index.ts`), not on `executeWorkspaceMutation`. The commit is the real play-time write bottleneck. Enqueue is fire-and-forget (does not block the turn; turn is already persisted).
- **`executeWorkspaceMutation` has NO embedding hook.** Studio / non-turn writes are covered by search-time staleness; do not add a hook there (YAGNI — it is dead code for the main corpus).
- **Two-switch decoupling**: embedding capability (control panel `embeddingConfig`, platform-global) vs tool exposure (agent.json `platformTools`, per-agent). Four quadrants (tool × data) are all legal, no error. The two chains meet only at tool execution, best-effort (empty result, not pre-gate throw).
- **Corpus三分**: raw turn (`save/history/turns/*.json`) — one file one chunk, `玩家：{user}\n叙事：{assistant}` direct join; agent condensed (`save/agents/*/notes.md`, `save/memory/summaries/*`) — markdown split by `##`/`###`/paragraph; JSON state (`save/world/`, `save/state/`, `save/frontend/`) — skipped (literal search suffices). Preprocessing belongs to agent/Skill; indexing belongs to native; the two are never done in the same place.
- **No reranker / no query-rewrite LLM pass**: the consumer is the per-turn agent already running; small-K candidates with preview let it self-rerank + `workspace.read` for full text — the already-paid agent inference does the reranker's job.
- **No entity tags / no entityFilter**: cut (narrow benefit surface, no gain on the main corpus raw turn, covered by agent self-select). type pre-filter is the only filter (free, solves cross-type semantic pollution).
- **embeddingConfig is an independent section, not folded into chat provider**: chat's `BrowserAiModelConfig` fields (toolCallMode/streaming/7 sampling params/contextWindow/reasoningEffort) are meaningless for embedding, and `toolCallMode` is a required validation — folding would force dummy values or validation branches. No `kind` field (MVP openai-compatible only; other protocols added when needed). `dimensions` is required (hard constraint for vector storage + cosine; wrong value = silent bug; player looks it up from model spec).
- **MVP openai-compatible only**: `POST {baseUrl}/embeddings`, body `{model, input: string[]}`, response `data[].embedding`, auth `Authorization: Bearer {apiKey}`. No protocol inference, no Gemini-native skeleton (YAGNI — add when needed).
- **GC**: `deleteLocalSave` drops `(save-runtime, saveId)` embeddings via `localDb.embeddingIndex.where("[scope+ownerId]").equals(["save-runtime", saveId]).delete()`. Storage-layer direct (no cross-layer call into agent-runtime).
- **ownerId propagation**: `AgentRuntimeCapabilities.semanticSearchOwnerId` (host injects `activeSaveId`) → `RuntimeWorkspaceToolExecutionContext.semanticSearchOwnerId` → `WorkspaceOperationExecutionContext.semanticSearchOwnerId` → `executeWorkspaceOperation` semantic_search branch. Runtime layer intentionally does not hold the real saveId (see `createInitialAgentContext` comment); it is threaded as a capability.
- **DB name bump v10 → v11** (rename-and-reset convention: `this.version(1)` reset, no migration, old store abandoned). `public/tsian-game-card-frontend-sw.js` `DB_NAME` must mirror. `embeddingIndex: "&id, [scope+ownerId], path, type, updatedAt"`.
- **retrieval agent default config** (`storage/workspace.ts` embedded constants, not disk files): `platformTools.enabled` includes `workspace_semantic_search`; AGENT.md adds semantic-vs-literal guidance. `DEFAULT_WORKSPACE_VERSION` bump + `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` carries `agents/retrieval/agent.json` + `agents/retrieval/AGENT.md` so existing saves upgrade.

### 4. Validation & Error Matrix

- embeddingConfig not configured / incomplete (incl. missing dimensions) → `resolveEmbeddingConfig` returns null → index does not grow, `semantic_search` returns `[]` (no throw). Agent falls back to literal `search`.
- Embedding API failure (network / dimension mismatch) → `embed` throws, `semanticSearch` catches → returns `[]`; embed-queue drops the job (staleness re-discovers it next search).
- Index empty for an owner → `semantic_search` returns `[]`, no throw.
- Tool enabled but data absent → `[]`; tool absent but data present → background indexing legal; both absent → all off. Four quadrants legal.
- `semantic_search` without `semanticSearchOwnerId` in context (non-save scenario) → returns `[]`, no throw.
- Save deletion → corresponding `embeddingIndex` records dropped (GC).
- Malformed raw turn JSON → chunker skips that file (no index crash); add log/trace for observability.
- `typeFilter` narrows corpus; omit to search all kinds.

### 5. Good/Base/Bad Cases

- Good: retrieval agent uses `semantic_search` for distant events (player says "灯塔的事", text says "她走向海边那座塔"), reads the chosen candidate via `read`, returns refined findings to master.
- Good: `semantic_search` returns empty (index not built / nothing relevant) → retrieval falls back to `search` for exact wording.
- Good: turn commit proactively enqueues stale embeddings; next search sees a fresh index without waiting.
- Base: embeddingConfig disabled by default; the whole system behaves as before (zero impact) until the player configures it.
- Bad: hanging an embedding write hook on `executeWorkspaceMutation` — play-time writes bypass it (staged → commit), so it is dead code for the main corpus.
- Bad: adding `semanticScore` separate from `score` for "possible mixed result sorting" — MVP retrieval calls two tools separately, never mixes; the separate field is YAGNI.
- Bad: adding entity tags / `entityFilter` plumbing — narrow benefit, no gain on raw turn (the main corpus), covered by agent self-select.
- Bad: folding embeddingConfig into chat provider structure — meaningless field coupling + validation branch pollution.

### 6. Tests Required

- Assert `semantic_search` op is read-only, actor-level read protected.
- Assert empty index / API failure → `[]`, no throw; agent falls back to literal search.
- Assert `embeddingIndex` partitioned by `(scope, ownerId)`; save deletion drops records.
- Assert corpus三分: raw turn one-chunk, markdown by section, JSON skipped.
- Assert `type` pre-filter works (querying settings hits summary not turn).
- Assert embeddingConfig default off; incomplete (incl. missing dimensions) → index does not grow, tool returns `[]`.
- Assert two-switch independence: four quadrants (tool × data) all legal.
- Assert turn commit enqueues asynchronously, does not block turn; API failure does not throw to agent.
- Assert staleness: file `updatedAt` newer than vector `updatedAt` → next search re-embeds.
- Assert retrieval agent has `semantic_search`; master does not (delegates to retrieval).
- Assert result reuses `WorkspaceSearchResult` shell + metadata; retrieval refine behavior unchanged.
- Assert existing saves upgrade to retrieval's new tool config + AGENT.md via `DEFAULT_WORKSPACE_VERSION` bump.

### 7. Wrong vs Correct

#### Wrong — write hook on the bypassed dispatch

```typescript
// executeWorkspaceMutation write branch
if (resolveEmbeddingConfig()) {
  embedQueue.enqueue({ scope, ownerId, path, operation: "embed" })
}
```

#### Correct — proactive enqueue at turn commit

```typescript
await commitSuccessfulRuntimeTurnForSave(activeSaveId, { ... })
if (resolveEmbeddingConfig()) {
  const saveRuntimeFiles = workspaceTransaction
    .finalWorkspaceFiles()
    .filter((file) => file.path.startsWith("save/"))
  void enqueueStaleEmbeddings(activeSaveId, saveRuntimeFiles)
}
```

#### Wrong — folding embedding into chat provider

```typescript
// reusing BrowserAiModelConfig with dummy toolCallMode for embedding
modelConfig: { id: "embed-model", toolCallMode: "text", streaming: false, parameters: {...} }
```

#### Correct — independent section

```typescript
embeddingConfig: { enabled: true, baseUrl, apiKey, model, dimensions }
// resolveEmbeddingConfig() strict check; no chat validation branches touched
```

## Scenario: Turn-Tool Event Output And Tool Process Display

### 1. Scope / Trigger

- Trigger: platform-web changes `turn-tool` event payload, `summarizeToolObservationOutput`/`buildToolOutput` in `workspace-tools.ts`, tool-card rendering in `default-frontend-files.ts` or `AssistantView.vue`, or `TurnToolOutput` in `@tsian/contracts`.
- Applies when changing how tool-call process data flows from runtime to UI.

### 2. Signatures

- `TurnToolOutput` (contracts/bridge.ts): `string | { type: "agent_call"; targetAgent: { id; title; summary? }; response; status: "completed" | "failed"; error?: { code; message } }`.
- `buildToolOutput(call, observation): TurnToolOutput | undefined` (workspace-tools.ts) — replaces the old `summarizeToolObservationOutput` (which truncated to 500 chars). No truncation; UI owns display/length policy.
- `turn-tool` event payload `output?: TurnToolOutput` (was `output?: string`).
- `onTool` signatures across `streaming-events.ts`, `workspace-tools.ts`, `agent-runtime/index.ts`, `assistant-chat.ts`, `useAssistantTimeline.ts` all use `output?: TurnToolOutput`.

### 3. Contracts

- **Two independent paths from the same observation**: (1) model path via `formatRuntimeWorkspaceToolObservationMessage` — full `JSON.stringify(observations)`, fed back to the model, **never truncated, never touched by UI display changes**; (2) UI path via `buildToolOutput` → `onTool` → `turn-tool` event — for display only, does not enter model context.
- **Truncation lives in UI, not runtime.** `buildToolOutput` returns complete output. The default game frontend and desktop assistant decide whether to display, fold, or length-limit. The old `TURN_TOOL_OUTPUT_MAX_LENGTH` (500) constant and `summarizeToolObservationOutput` are removed.
- **agent_call structured output**: `buildToolOutput` detects `call.name === "agent_call"` and extracts `{type:"agent_call", targetAgent:{title,...}, response, status}` instead of `JSON.stringify`-ing the whole result object. `response` is the delegated agent's final natural-language reply (player-readable), passed complete.
- **agent_call failure**: `buildToolOutput` returns `{type:"agent_call", status:"failed", error:{code,message}, targetAgent:{id:"",title:""}, response:""}`.
- **Ordinary tools**: `buildToolOutput` returns `JSON.stringify(result)` (or `String(result)`) complete, no truncation. The default game frontend and desktop assistant **do not render ordinary tool output** — only tool name + success/failed status icon. This is a product decision (structured output is not player-readable), not a technical limitation.
- **Process zone cross-turn retention (default game frontend only)**: `turnProcessLog` (in-memory array in `default-frontend-files.ts` app.js) accumulates completed turns' process nodes (`thought`/`tool`/`interim`). `handleSnapshot` renders a `process-history-zone` before the snapshot messages. `finalizeTurn` pushes `turnState.timeline` into `turnProcessLog` before `renderMessages` runs. **Not persisted** — page reload / save reload clears it (only snapshot正文 remains). The desktop assistant already had this via `msg.timeline` reactive array + `finalize()` fold-only.
- **`TurnToolOutput` is a discriminated union**: frontends branch on `typeof output === "string"` (ordinary) vs `typeof output === "object" && output.type === "agent_call"` (agent_call). Old remote frontends receiving an object output worst-case skip rendering it (no string match) — does not break RPC responses. Contract version stays `tsian.play-bridge.v1` (tolerant superset extension).
- Runtime validation of `turn-tool` output belongs in platform-web (`buildToolOutput`), not in `@tsian/contracts` (contracts only defines the type).

### 4. Validation & Error Matrix

- `buildToolOutput` with `call === undefined` (parse error) → `isAgentCall` false → ordinary branch → `observation.result === undefined` → returns `undefined` (failed tool card shows status only).
- agent_call success with missing `result.targetAgent` / `result.response` → degrades to empty strings (never throws).
- agent_call failure (`observation.ok === false`) → structured `{type:"agent_call", status:"failed", error}`.
- `JSON.stringify(result)` throws (cyclic) → ordinary branch catch → returns `undefined`.

### 5. Good/Base/Bad Cases

- Good: agent_call tool card shows delegated agent's title + full response (player can judge what the sub-agent did).
- Good: ordinary tool card shows only tool name + ✓/✗ (no structured output noise).
- Good: after turn-completed, tool cards remain visible in process-history-zone; next turn's cards append below.
- Base: page reload clears `turnProcessLog`; only snapshot正文 remains (方案 A, no cross-load persistence).
- Bad: truncating `response` in `buildToolOutput` (UI must own length policy, not runtime).
- Bad: touching `formatRuntimeWorkspaceToolObservationMessage` to change model-facing output (separate path; see `docs/active/tool-result-structure-followup.md` for that tech debt).

### 6. Tests Required

- Assert `buildToolOutput` for agent_call success returns `{type:"agent_call", targetAgent:{title,...}, response, status:"completed"}` with full `response` (no truncation).
- Assert `buildToolOutput` for agent_call failure returns `{type:"agent_call", status:"failed", error}`.
- Assert `buildToolOutput` for ordinary tool returns `string` (full, no `…(已截断)` marker).
- Assert `formatRuntimeWorkspaceToolObservationMessage` is unchanged (model path intact).
- Assert default frontend `turnProcessLog` is not persisted (no localStorage/IndexedDB write).

### 7. Wrong vs Correct

#### Wrong — truncating in runtime

```typescript
function buildToolOutput(call, observation): TurnToolOutput | undefined {
  const text = JSON.stringify(observation.result)
  return text.length > 500 ? text.slice(0, 500) + "…(已截断)" : text  // BAD: UI can't show full
}
```

#### Correct — UI owns length policy

```typescript
function buildToolOutput(call, observation): TurnToolOutput | undefined {
  // runtime: complete output, no truncation
  if (isAgentCall) { return { type: "agent_call", targetAgent, response, status } }
  return typeof observation.result === "string" ? observation.result : JSON.stringify(observation.result)
}
// frontend: agentCallDisplay(node.output)?.response with max-h-40 overflow-auto
```

#### Wrong — rendering ordinary tool output

```typescript
if (node.type === "tool" && node.output) { body.textContent = String(node.output).slice(0, 500) }
// BAD: shows JSON noise for read/list/search; agent_call response buried in JSON
```

#### Correct — branch by output type

```typescript
if (node.type === "tool") {
  const ac = agentCallDisplay(node.output)  // null for ordinary tools
  if (ac) { body.textContent = ac.response }  // agent_call: player-readable
  // ordinary: no body output, only status icon in head
}
```

