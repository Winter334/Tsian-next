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

## Scenario: Game Card Package And Packaged Frontend

### 1. Scope / Trigger

- Trigger: platform-web imports/exports `*.tsian-card.zip`, changes `src/storage/game-card-packages.ts`, changes packaged frontend storage, or loads `frontend.kind === "packaged"` in `PlayView.vue`.

### 2. Signatures

- `GameCardManifest.frontend?: GameCardFrontendBinding`
- `LocalGameCardRecord.contentFiles: GameCardContentFile[]`
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

- `PlayView.vue` remains a thin active frontend loader: wait for `waitForPlatformHostReady()`, read `getPlatformActiveGameCard()`, then mount a sandboxed iframe for remote or packaged bindings.
- `PlayView.vue` must not mount same-realm built-in game UI. If the active Game Card has no frontend, show a compact not-configured error state.
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

## Scenario: Card Content And Save Runtime Effective Workspace

### 1. Scope / Trigger

- Trigger: platform-web creates saves, imports/exports Game Cards, lists Runtime Workspace files, runs Agent Runtime turns, commits workspace mutations, checkpoints, or restores checkpoints.

### 2. Signatures

- `LocalGameCardRecord.contentFiles: GameCardContentFile[]`
- `LocalWorkspaceFileRecord.path` stores save runtime files only: `save/...` and platform-owned `.tsian/...`.
- Runtime reads use `listEffectiveWorkspaceFilesForSave(saveId, card)` and receive card content plus selected save runtime data.
- Runtime commits use `saveRuntimeFilesFromEffectiveWorkspace(files)` before replacing `workspaceFiles`.

### 3. Contracts

- Game Card content owns Agents, Skills, schemas, rules, docs, frontend definitions, manifest metadata, and frontend binding. The assistant agent identity is platform-local under `.tsian/local/assistant/`, not Game Card content.
- Save runtime data owns dialogue/history, generated entities, maps, relationships, memory summaries, frontend view state, Agent notes/session transcripts, and `.tsian` diagnostics for one playthrough.
- Effective workspace composition is deterministic: card content appears at its card path, active save runtime data appears under `save/`, and `.tsian/` is visible in the resource manager (C-drive model) but remains hidden from ordinary Agent/Skill/frontend read/list/search APIs (actor level 4 required).
- Game Card content must not define `save/...` or `.tsian/...`.
- Ordinary Agent/Skill/frontend workspace writes and deletes must target `save/...`; platform writes may target `save/...` or `.tsian/...`.
- Checkpoints snapshot and restore save runtime files only. Restored checkpoints continue to use current Game Card content.

### 4. Validation & Error Matrix

- Card content path under `save/...` or `.tsian/...` -> reject card write/import.
- Ordinary workspace write/delete outside `save/...` -> `WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED`.
- Ordinary workspace write/delete under `.tsian/...` -> `WORKSPACE_PLATFORM_METADATA_FORBIDDEN`.
- Platform runtime write outside `save/...` or `.tsian/...` -> `WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED`.
- Effective workspace read/list/search -> hides `.tsian/...` and can surface both card content and `save/...` files.

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
const workspaceFiles = card.contentFiles.map((file) =>
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
- Good: `relationship-maintainer` as a Skill that reads workspace schemas and calls controlled workspace writes (either top-level `workspace.write` for single ops, or a `browser_script` for multi-step).
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
  - `workspace.diff`
  - `workspace.patch`
  - `workspace.write`
  - `workspace.move`
  - `workspace.delete`
  - `workspace.validate`
- Agent platform tool groups from `AgentRegistryEntry.platformTools`:
  - `agent_call`
  - `workspace_read`
  - `workspace_write`

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
- `buildEnabledToolSchemas` reuses the same gating as the text-protocol prompt (`AGENT_PLATFORM_TOOL_NAMES`, `platformToolEnabled`, contacts + `allowAgentCall`): `use_skill`/`run_script` always; `agent_call` only with contacts + `agent_call` enabled; workspace read tools under `workspace_read`; workspace write/delete/move/validate under `workspace_write`. Tool `description` text is declarative (what it does + key parameter constraints), not tutorial-style.
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
- `workspace_write` maps to generic `workspace.diff`, `workspace.patch`, `workspace.write`, `workspace.move`, `workspace.delete`, and `workspace.validate`.
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
- `agent_call` arguments: `{ agentId: string, request: string, reason?: string, contextSummary?: string, expectedOutput?: string, historyMode?: "minimal" | "recent" | "scene" }`.
- `agent_call` is exposed in runtime tool instructions only when the current Agent has visible contacts, the current tool loop allows Agent calls, and the current Agent's platform tool config enables `agent_call`.
- `agent_call` validates the target against the caller Agent's `contacts`; contacts are a runtime stability boundary, not a full security model.
- `agent_call` builds the target Agent's own `AgentContextEntry`, including its `AGENT.md`, optional `SOUL.md`, notes/session, declared context files, and filtered lightweight Skill Index.
- `agent_call` returns a structured observation containing `{ status: "completed", targetAgent, historyMode, metadata, response }`; the target Agent response does not directly become player-visible history.
- `historyMode` defaults to `recent`; concrete history window sizes remain platform policy.
- Agent Runtime collaboration policy is code-level/default-only for this slice: defaults are `maxDepth=2`, `historyWindows={ minimal: 0, recent: 6, scene: 12 }`; runtime capabilities may inject policy overrides for tests or future host-owned configuration, but there is no Settings UI, localStorage persistence, runtime prompt, or per-Agent trust state. The tool loop has **no per-Agent round limit** and `agent_call` has **no per-turn call-count limit** — termination relies on `finishReason: stop`, abort, and the turn token-budget fallback (`ContextBudgetExhaustedError` after one in-turn context compression). `callCount` is retained as a diagnostic counter (trace metadata) but no longer gates execution. `maxDepth=2` remains as the recursion safety net (prevents unbounded agent_call nesting; token budget cannot bound recursion depth). See the "Turn Token Budget And In-Turn Compression" and "Parallel agent_call Within A Round" scenarios.
- Delegated Agents derive their own runtime permissions from the target Agent's `agent.json`; the caller Agent's permissions must not leak into the target Agent step.
- Delegated Agents may use their own exposed generic workspace operations, `use_skill`/`run_script` for activated Skills, and limited nested `agent_call` inside their own tool loop.
- Limited nested `agent_call` remains contacts-gated at every hop and depth-limited by policy. There is no per-turn call-count budget (`maxCallsPerTurn` was removed); agent_call frequency is bounded by the turn token budget, not a count cap. With the default `maxDepth=2`, the root entry agent at depth `0` may call a delegated Agent at depth `1`; that Agent may call one of its own contacts at depth `2`; Agents already at depth `2` receive `AGENT_CALL_UNAVAILABLE` with compact depth metadata on direct `agent_call` attempts.
- The root turn shares one `agent_call` budget across the entry agent and nested delegated steps.
- Action executor declarations MUST specify `{ type: "browser_script", path: string, timeoutMs?: number }`. Missing executor or non-`browser_script` types (`builtin`/`platform_action`/`workspace_operation`) are rejected with `ACTION_EXECUTOR_INVALID` at parse time and reported in registry `actionDeclarationErrors`.
- `browser_script` executors route through an injected `runBrowserScript` capability; `agent-runtime` must not import platform-host, bridge objects, Dexie, storage helpers, or Worker code.
- `browser_script` declarations require `{ type: "browser_script", path: string, timeoutMs?: number }`; `path` resolves relative to the declaring Skill directory and must stay under that directory.
- Controlled async executors have bounded timeout/abort behavior. `timeoutMs` must be positive and must not exceed the platform maximum.
- The first browser script capability profile is a strong Tsian SDK, not raw browser/internal access. Scripts can use SDK workspace read/list/search/diff/patch/write/move/delete/validate, SDK fetch where browser policy permits, structured log/trace, timeout/abort, and JSON-compatible input/output. Multi-step workspace orchestration (read -> transform -> write) is written as a `browser_script` that chains SDK calls; the model invokes it with one `run_script` call.
- The first browser script slice must not expose raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals as supported script APIs. Worker hard limits still apply, and this is a third-party trust boundary rather than a guarantee that arbitrary third-party code is safe.
- Generic workspace operations pass two hard gates: the operation must be exposed in the current runtime context, and the actor level must satisfy the target read/edit level. Missing or invalid Agent `workspaceAccess.level` in `agent.json` defaults to `1`.
- Browser script SDK workspace methods must receive the same current Agent context and exposed workspace operations as the top-level workspace tools. A `browser_script` must not perform an operation that the Agent's `workspace_read` / `workspace_write` groups disabled.
- Inside `interaction.sendMessage`, save-runtime workspace mutations run against a staged Runtime Workspace transaction. Same-turn tools and scripts must see staged writes/deletes, but ordinary workspace mutations persist only when the turn succeeds.
- Successful turns commit the staged workspace final state atomically with accepted snapshot/history and after-turn checkpoint creation. Failed or aborted turns discard ordinary staged mutations.
- Ordinary Agent/Skill workspace mutations must reject `.tsian/*` targets. `.tsian/*` is platform-owned metadata space for trace/checkpoint/index/cache behavior.
- Frontend bridge `platform.runAction` generic workspace actions such as `workspace.write`, `workspace.patch`, and `workspace.delete` remain immediate platform actions and are not part of the Agent Runtime turn transaction. (The Agent Runtime's `runPlatformAction` action-executor capability was removed in the tool/skill decouple task; the frontend bridge channel is independent and unchanged.)
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
- `workspace.read` arguments: `{ scope: "effective" | "card-content" | "save-runtime" | "platform-meta", path: string }`; success returns a `WorkspaceFile`.
- `workspace.list` arguments: `{ scope: "...", path?: string }`; success returns `{ path, entries }` with direct child `WorkspaceEntry[]`.
- `workspace.search` arguments: `{ scope: "...", query: string, limit?: number }`; success returns `WorkspaceSearchResult[]`; empty query returns `[]`.
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
- Turn token budget reached a second time after one in-turn context compression (or budget reached when no `agentContextSnapshot` is available to compress) -> return the last round's stripped text if present; otherwise throw `ContextBudgetExhaustedError`, surfaced as a soft "上下文已满" prompt in AssistantView (keeps already-streamed thought, not a hard error). The first budget crossing triggers `compressContext` on the narrative span (tool interactions are preserved). No per-Agent round limit exists.

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
- Good: Agent uses `workspace.search` and receives previews, then explicitly reads a chosen file if full content is needed.
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
- Assert `browser_script` can use SDK workspace read/list/search/diff/patch/write/move/delete/validate against the staged workspace view and keeps workspace mutation trace/synchronization.
- Assert `browser_script` timeout and abort return structured observations.
- Assert `browser_script` paths outside the declaring Skill directory are rejected.
- Assert generic `workspace.write/patch/delete` stage ordinary save-runtime workspace mutations during `interaction.sendMessage` and commit only on successful turns.
- Assert failed or aborted turns discard ordinary staged workspace mutations.
- Assert ordinary Agent/Skill workspace mutations under `.tsian/*` fail structurally.
- Assert frontend bridge `platform.runAction` generic workspace write/patch/delete remains immediate (independent of the removed Agent Runtime `runPlatformAction` executor).
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
- Assert `workspace.search` returns scored previews and respects limit caps.
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
- Good: trace records `action_called` for a `browser_script` `run_script` that performs workspace writes, plus a `workspace_mutation` event for `workspace.patch` or `workspace.write` issued from the script's SDK calls.
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
- Assert `workspace.write` / `workspace.patch` / `workspace.delete` platform actions produce `workspace_mutation`.
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

## Scenario: Turn Token Budget And In-Turn Compression

### 1. Scope / Trigger

- Trigger: Agent Runtime tool loops estimate runtime message tokens before each model call and compress the narrative span when the budget is crossed.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts` (tool loops, `WorkspaceToolLoopOptions`, `runAgentRuntimeTurn` context-update assembly), `apps/platform-web/src/agent-runtime/context-lifecycle.ts` (`estimateRuntimeMessagesTokens`, `ContextBudgetExhaustedError`), or `AssistantView.vue` budget-exhausted catch handling.

### 2. Signatures

- `WorkspaceToolLoopOptions.agentContextSnapshot?: AgentContextSnapshot` — mutable object reference; in-turn compression updates it in place (`Object.assign`).
- `WorkspaceToolLoopOptions.contextTokenBudget?: number` — already-resolved budget (model `contextWindow` or `256k` default).
- `WorkspaceToolLoopOptions.compressCallModel?: CompressCallModel` — reuse `capabilities.callModel`.
- `estimateRuntimeMessagesTokens(messages: RuntimeChatMessage[]): number` — native loop token estimate, including `toolCalls` name + JSON-stringified `arguments` and tool observation content.
- `estimateAiChatMessagesTokens(messages: AiChatMessage[]): number` — text loop token estimate (tool observations are serialized into user content).
- `ContextBudgetExhaustedError extends Error` — `name: "ContextBudgetExhaustedError"`, message "上下文已满，无法继续本轮探索。请开始新会话或精简对话。".
- Trace event `context_compressed_in_turn` (ok, data: `{ round, beforeTokens, budget, triggerThreshold }`).

### 3. Contracts

- The tool loop has **no per-Agent round limit**. `AgentRuntimeCollaborationPolicy` no longer defines `maxToolRoundsPerAgent`. Termination conditions are: `finishReason === "stop"` / `toolCalls.length === 0`; abort (`AbortError`); and the turn token-budget fallback.
- Before every model call (including round 0), the active loop estimates runtime-message tokens. When tokens exceed `budget * CONTEXT_COMPRESS_TRIGGER_RATIO` (0.85), the loop takes the first crossing as: compress the narrative span via `compressContext` (reuse the lifecycle module; compress only the narrative summary + recent turns, preserve all tool interactions), `Object.assign` the result into `agentContextSnapshot`, mark `compressedThisTurn = true`, and `splice`-replace the narrative span in the runtime messages (`locateHistorySpan` + `replaceHistorySpan`). The loop then continues.
- Only the **entry-agent steady-state path** (an `agentContextSnapshot` was injected) performs in-turn compression. Delegated `agent_call` targets and the `最近对话：` fallback path have no injectable snapshot and skip compression; they still run the budget fallback so the loop always terminates.
- A second budget crossing (or any budget crossing when compression is unavailable) is the fallback C: return the last round's stripped text if present (`completed` transcript); otherwise throw `ContextBudgetExhaustedError`.
- In-turn compression is allowed at most once per turn. A second crossing never recompresses.
- `runAgentRuntimeTurn` threads `agentContextSnapshot` (the turn-start-compressed snapshot, a mutable reference), `contextTokenBudget` (already resolved), and `compressCallModel` (`capabilities.callModel`) into the tool options. After the loop, if the snapshot `updatedAt` changed (in-turn compression occurred), `contextUpdate.compressedContext` carries the in-turn compressed snapshot; otherwise it carries the turn-start compression result. The host `stageAgentContextFile` persists it unchanged.
- AssistantView catch recognizes `ContextBudgetExhaustedError` by `error.name` (no runtime-internal import). On that error: keep already-streamed thought, append a soft `_（上下文已满，请开始新会话或精简对话）_` note when content exists (or set the content to the soft prompt when empty), `persistCurrentSession()`, and **do not** set `errorMessage` or pop the placeholder. This is a non-failure halt symmetric with the abort branch. `ContextCompressionFailedError` (turn-start compression failure) still routes to the `errorMessage` branch.

### 4. Validation & Error Matrix

- Budget crossing when `agentContextSnapshot` is available and not yet compressed this turn -> compress narrative span, continue loop, emit `context_compressed_in_turn`.
- Budget crossing a second time in the same turn -> return last stripped text if present, otherwise throw `ContextBudgetExhaustedError`.
- Budget crossing when no `agentContextSnapshot` is available (delegated / fallback path) -> same as second crossing (no compression attempted).
- `compressContext` failure during in-turn compression -> propagates `ContextCompressionFailedError` (unchanged behavior).
- `ContextBudgetExhaustedError` in AssistantView -> soft prompt, keep streamed thought, no `errorMessage`.
- Tool interactions are never compressed out of the runtime messages; only the narrative summary + recent turns are compressed.

### 5. Good/Base/Bad Cases

- Good: a 6-round exploration (list -> read -> list -> read) completes without any round-limit error and returns a final reply.
- Good: when accumulated tool interactions push tokens past 85% mid-turn, the narrative span is compressed once, tool interactions are preserved, the model continues without re-exploring, and `context_compressed_in_turn` is traced.
- Good: a second budget crossing returns the last streamed thought with a soft note, or throws `ContextBudgetExhaustedError` shown as the soft prompt.
- Base: ordinary short turns never estimate past the threshold and never compress.
- Base: turn-start compression (lifecycle module) and in-turn compression are independent checks; either, both, or neither may run.
- Bad: reintroducing a per-Agent round limit as a termination condition.
- Bad: compressing tool interactions instead of the narrative span.
- Bad: allowing more than one in-turn compression per turn.
- Bad: setting `errorMessage` or popping the placeholder on `ContextBudgetExhaustedError`.

### 6. Tests Required

- Assert the tool loop runs beyond 4 rounds without a round-limit error when the model keeps requesting tools.
- Assert a first budget crossing compresses the narrative span (tool interactions preserved) and the loop continues.
- Assert a second budget crossing returns last stripped text or throws `ContextBudgetExhaustedError`.
- Assert delegated/fallback paths never attempt in-turn compression but still run the budget fallback.
- Assert AssistantView shows the soft prompt for `ContextBudgetExhaustedError` without setting `errorMessage` or popping the placeholder.
- Assert in-turn compressed snapshot is carried through `contextUpdate.compressedContext` for host persistence.

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

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.
