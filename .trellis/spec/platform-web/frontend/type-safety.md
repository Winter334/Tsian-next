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

### 2. Contracts

- Game Card packages are reusable templates, not Save Instance exports. They must not include save snapshots, save history, checkpoints, traces, or player-mutated save workspace files.
- The first package container is zip with `game-card.json`, `workspace/*`, optional `frontend/*`, and reserved `cover/*`.
- `game-card.json` uses `GameCardPackageManifest` with schema `tsian.game-card.package.v1` and embeds the authoritative `GameCardManifest`.
- Packaged frontends are built static files under `frontend/`; Tsian must not run source builds, npm install, or framework-specific bundling.
- Packaged frontend files are stored beside the reusable Game Card in `gameCardFrontendFiles`; saves created from a card do not copy those files.
- `frontend.kind === "packaged"` must run in an iframe and reuse the `tsian.play-bridge.v1` bridge. It must not run in the platform JS realm.
- Packaged frontends use a same-origin virtual resource URL backed by Service Worker/IndexedDB. The first packaged iframe sandbox is compatibility-first: `allow-scripts allow-same-origin allow-forms`. Keep `allow-same-origin` while this loader relies on Service Worker-controlled same-origin iframe clients; sandboxed opaque-origin navigations bypass the local virtual resource layer.
- The virtual resource layer should return CORS-friendly headers for module chunks and other built assets.

### 3. Validation & Error Matrix

- Missing/unsupported package schema -> reject import with a clear package error.
- Missing or malformed embedded manifest -> reject import.
- Built-in blank card id -> reject import; built-in templates are refreshed by platform seed helpers only.
- Packaged frontend without a matching entry file -> reject import.
- Absolute paths, path traversal, empty paths, NUL bytes, or unknown top-level roots -> reject import.
- Importing a package creates or updates the reusable Game Card only; it does not create a Save Instance.
- Exporting a Game Card writes manifest, workspace template files, and stored packaged frontend files only.

## Scenario: Remote Iframe Play Frontend Bridge

### 1. Scope / Trigger

- Trigger: platform-web loads a Game Card `frontend.kind === "remote"` binding or changes `src/bridge/remote-iframe-bridge.ts` / `PlayView.vue` frontend loading.

### 2. Contracts

- `PlayView.vue` remains a thin active frontend loader: wait for `waitForPlatformHostReady()`, read `getPlatformActiveGameCard()`, mount `official-default` for supported builtin bindings, or mount a sandboxed iframe for remote bindings.
- Remote frontend URLs are normalized at the iframe adapter boundary. Accept browser-loadable `http:` / `https:` URLs and relative URLs resolving to those schemes; reject dangerous or non-web schemes such as `javascript:`, `data:`, and `vbscript:` before iframe creation.
- The first iframe sandbox is compatibility-first: `allow-scripts allow-same-origin allow-forms`. Do not add top navigation, popups, downloads, or broader permissions without a new product/security decision.
- Remote bridge messages use shared `RemotePlayBridge*` contract types. Runtime validation belongs in platform-web, not in `@tsian/contracts`.
- The adapter must filter by mounted `iframe.contentWindow`, generated session id, and accepted handshake origin before dispatching requests.
- The allowed remote methods are `runtime.getRuntimeSnapshot`, `interaction.sendMessage`, `query.query`, `platform.getPlatformContext`, and `platform.runAction`.
- The default remote bridge must not expose the `debug` namespace and must reject `query.query({ resource: "ai-debug" })`. A `turn-debug-ready` notification may be sent without debug records.
- Workspace read/list/search should reuse existing platform-host query behavior. Workspace write/delete and checkpoint restore should reuse existing `platform.runAction` behavior.

### 3. Validation & Error Matrix

- Missing active Game Card -> fall back to `official-default`.
- Unsupported builtin frontend id -> show a compact error state instead of silently mounting a different frontend.
- Invalid or forbidden remote URL -> show a compact error state before iframe creation.
- Malformed remote request payload -> return a structured bridge error response when the request has a valid session/id; otherwise ignore.
- Remote `ai-debug` query -> structured forbidden error response.
- Iframe load error -> show a compact error state and do not mutate save data.

## Scenario: Runtime Workspace Registry And Detail Queries

### 1. Scope / Trigger

- Trigger: platform-web exposes cross-layer bridge query resources backed by Runtime Workspace files.
- Applies when adding or changing `agent-registry`, `agent-context`, `skill-registry`, or `skill-detail` behavior in `platform-host`.

### 2. Signatures

- `bridge.query.query<AgentRegistryEntry>({ resource: "agent-registry" })`
- `bridge.query.query<AgentContextEntry>({ resource: "agent-context", params: { agentId } })`
- `bridge.query.query<SkillRegistryEntry>({ resource: "skill-registry", params })`
- `bridge.query.query<SkillDetailEntry>({ resource: "skill-detail", params: { path } })`
- `params.agentId?: string`
- `params.includeShared?: boolean`
- `params.includeLocal?: boolean`
- `params.path?: string` for `skill-detail`; use a `SkillRegistryEntry.path` value.

### 3. Contracts

- `agent-registry` returns lightweight `AgentRegistryEntry[]` built from `agents/*/AGENT.md`.
- `agent-context` returns zero or one `AgentContextEntry` assembled from one agent's `AGENT.md`, notes/session files, visible skill index, and declared `contextPaths`.
- `skill-registry` returns lightweight `SkillRegistryEntry[]` built from `skills/*/SKILL.md` and `agents/*/skills/*/SKILL.md`.
- `skill-detail` returns zero or one `SkillDetailEntry` for a selected `SKILL.md` path.
- Default blank workspaces may include `agents/studio-assistant/AGENT.md`, assistant notes/session, a local `framework-knowledge` Skill, and `docs/tsian-framework-knowledge.md`. These are ordinary workspace files and must flow through the same registry/detail/context mechanisms as author-provided Agents and Skills.
- Registry entries include path and metadata fields only. Do not expose full skill instructions, actions, schemas, examples, scripts, or references through the registry query.
- `SkillRegistryEntry.name` and `description` are the model-facing Skill identifiers. Build them from frontmatter `name` / `description`, with compatibility fallbacks to `id` / `summary` / path-derived values.
- Keep `id`, `title`, `summary`, and `path` for compatibility with bridge/UI/debug consumers.
- Agent context skill indexes must remain lightweight `SkillRegistryEntry[]`; do not load `SKILL.md` bodies through `agent-context`.
- Skill detail entries include the selected `SKILL.md` `WorkspaceFile` content and a `SkillResourceEntry[]` resource index. Resource entries must not include file contents.
- Shared registry shapes live in `@tsian/contracts`; platform-web must not redefine them locally.
- Registry parsing is owned by `src/agent-runtime/registry.ts` and must stay pure: pass workspace files in, return entries out. It must not import Dexie tables or bridge objects.
- Skill detail loading belongs beside registry parsing in `src/agent-runtime/registry.ts` and follows the same purity rule.
- Agent context assembly belongs in `src/agent-runtime/` beside registry parsing and follows the same purity rule.

### 4. Validation & Error Matrix

- No active save -> return `{ items: [] }`.
- `agent-context` missing, blank, non-string, or unknown `params.agentId` -> return `{ items: [] }`.
- `agent-context` missing declared `contextPaths` -> return the context entry with `missingContextPaths` populated.
- `skill-detail` missing, blank, invalid, non-skill, or absent `params.path` -> return `{ items: [] }`.
- Missing or partial frontmatter -> infer safe fallbacks from path, first H1, and first body paragraph.
- Malformed frontmatter -> do not throw from the whole registry query; degrade to path/body fallbacks.
- Non-boolean `includeShared` / `includeLocal` -> treat as omitted.
- Blank or non-string `agentId` -> treat as omitted.

### 5. Good/Base/Bad Cases

- Good: `skill-registry` with `{ agentId: "narrative" }` returns shared skills plus `agents/narrative/skills/*/SKILL.md`, with model-facing `name` and `description`.
- Good: `agent-context` with `{ agentId: "narrative" }` returns narrative `AGENT.md`, narrative notes/session if present, shared skills, and narrative-local skills only.
- Good: `skill-detail` with `{ path: "skills/example/SKILL.md" }` returns the selected `SKILL.md` content and resource metadata for files under `skills/example/`.
- Base: `skill-registry` without params returns shared skills and all agent-local skills.
- Base: `skill-detail` for a valid skill with no sibling resources returns one detail entry with `resources: []`.
- Bad: registry query returns `SKILL.md` body text or parsed `actions`; this breaks progressive disclosure.
- Bad: `skill-detail` returns `references/*`, `examples/*`, `actions/*`, `schemas/*`, or `scripts/*` content by default; resource contents must be loaded separately by explicit workspace reads or a future resource query.

### 6. Tests Required

- Assert new saves include default `agents/master/AGENT.md` and `agents/narrative/AGENT.md`.
- Assert new saves include default `agents/studio-assistant/AGENT.md`, `agents/studio-assistant/skills/framework-knowledge/SKILL.md`, and `docs/tsian-framework-knowledge.md`.
- Assert `agent-registry` returns master and narrative entries for a new save.
- Assert `agent-registry` returns `studio-assistant` for a new save without changing the default master/narrative turn entrypoint.
- Assert shared and agent-local skills are discovered and sorted deterministically.
- Assert `name` / `description` prefer current Skill frontmatter and fall back to legacy `id` / `summary`.
- Assert malformed or missing frontmatter does not crash parsing.
- Assert `includeShared`, `includeLocal`, and `agentId` filtering behavior.
- Assert `skill-detail` loads shared and agent-local skill paths.
- Assert `skill-detail` rejects non-skill and missing paths.
- Assert `SkillResourceEntry` has no `content` field.
- Assert `agent-context` returns declared existing context files and missing context paths without throwing.
- Assert `agent-context` skill index does not include other agents' local skills.

### 7. Wrong vs Correct

#### Wrong

```typescript
return {
  items: files.map((file) => ({ ...parseSkill(file.content), content: file.content })),
}
```

#### Correct

```typescript
const files = await listWorkspaceFilesForSave(activeSaveId)
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

- Skill actions still route through `action_call`:

```json
{
  "name": "example_action",
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" },
  "executor": { "type": "platform_action", "name": "workspace-write" }
}
```

### 3. Contracts

- Add a platform runtime primitive only when the ability is small, stable, cross-playstyle, and requires runtime internals such as Agent registry, Skill registry, context assembly, model invocation, trace, checkpoint behavior, workspace indexes, or tool/session state.
- Keep primitives few. Current examples are `skill_load`, workspace read/list/search, `action_call`, and contacts-gated `agent_call`.
- Add a platform controlled action / executor when the ability performs side effects or needs platform execution control such as workspace writes/deletes, browser-limited script execution, remote HTTP, WASM, abort/timeout, result normalization, or frontend-data mutation.
- Add a Skill action when the ability is gameplay, world, memory, rules, narrative, style, or author-policy specific, or when it packages several primitive/controlled actions into a reusable business operation.
- Keep gameplay data structures in Runtime Workspace files, README files, and schemas. Platform code should not hardcode world-state semantics when a Skill plus workspace schema can own them.
- Do not add platform tools merely because Web lacks Bash. Bash-like breadth should be approximated through controlled executors plus reusable Skill actions, not an unbounded built-in tool list.

### 4. Validation & Error Matrix

- New runtime primitive without runtime-internal dependency -> reject in review; implement as Skill action.
- New platform action that mutates workspace/state without allow-listing and input validation -> reject in review.
- New Skill action that bypasses loaded Skill gating -> reject in review.
- New platform code that hardcodes gameplay-specific state semantics -> reject in review unless a task explicitly promotes that semantic to platform scope.
- New tool/action that can produce large raw prompt/context output -> require summary behavior, pagination, or explicit read-by-path semantics.

### 5. Good/Base/Bad Cases

- Good: `agent_call` as a contacts-gated runtime primitive, because it needs Agent registry, target context assembly, model invocation, call-depth limits, and trace.
- Good: `workspace-write` as a platform controlled action, called through a loaded Skill action after schema validation.
- Good: `relationship-maintainer` as a Skill that reads workspace schemas and calls controlled workspace writes.
- Base: a Skill action using built-in `validation` to declare a high-level business operation before a real executor exists.
- Bad: adding `update_relationship_score` as a platform runtime tool; relationship semantics belong to Skill + workspace schema.
- Bad: exposing a broad browser/remote/script executor directly as an always-visible runtime tool without Skill gating or execution controls.

### 6. Tests Required

- Assert new runtime primitives validate arguments and return structured observations on invalid input.
- Assert new platform actions are allow-listed before Agent Runtime can invoke them.
- Assert Skill actions remain unavailable until their declaring Skill is loaded.
- Assert gameplay-specific mutations flow through Skill action declarations and controlled platform actions, not direct platform semantic helpers.
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
  "executor": { "type": "platform_action", "name": "workspace-write" }
}
```

## Scenario: Workspace-Defined Agent Runtime

### 1. Scope / Trigger

- Trigger: `interaction.sendMessage` runs AIRP turns using Runtime Workspace Agent definitions.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts`, `apps/platform-web/src/agent-runtime/context.ts`, or the `sendMessage` path in `apps/platform-web/src/platform-host/index.ts`.

### 2. Signatures

- Production turn input includes `workspaceFiles: WorkspaceFile[]`.
- `runAgentRuntimeTurn(input, capabilities)` still returns `{ replyText, masterPlan }`.
- Debug labels remain `"master-agent"` and `"narrative-agent"`.

### 3. Contracts

- `platform-host` owns storage access. It must call `initializeWorkspaceForSave(activeSaveId)` before listing workspace files for a turn, then pass `listWorkspaceFilesForSave(activeSaveId)` into Agent Runtime.
- `agent-runtime` owns prompt composition. It must use `assembleAgentContext(workspaceFiles, { agentId: "master" })` and `{ agentId: "narrative" }` for the two default calls.
- Model messages may include `AGENT.md`, notes/session files, declared context files, missing context paths, lightweight skill index, recent history, turn number, player input, and master brief.
- Skill indexes inside runtime prompts must remain lightweight `SkillRegistryEntry[]`; do not call `loadSkillDetail` from the default turn path.
- `agent-runtime` must not import Dexie tables, platform bridge objects, or platform-host helpers.

### 4. Validation & Error Matrix

- Empty workspace on an active save -> `initializeWorkspaceForSave` fills defaults before runtime reads files.
- Non-empty workspace missing `agents/master/AGENT.md` -> `sendMessage` fails with a clear runtime error; do not fall back to legacy hardcoded prompts.
- Non-empty workspace missing `agents/narrative/AGENT.md` -> same as above.
- Missing declared `contextPaths` -> include missing path diagnostics in prompt context; do not fail the turn for that reason alone.
- Model returns empty narrative reply -> keep existing empty-reply error behavior.

### 5. Good/Base/Bad Cases

- Good: a new save uses `agents/master/AGENT.md` and `agents/narrative/AGENT.md` in the two model system prompts.
- Good: old local save with zero workspace files receives default workspace files before the turn.
- Base: direct unit-style calls without `workspaceFiles` may exercise legacy prompt assembly, but production `sendMessage` must pass workspace files.
- Bad: production `sendMessage` omits workspace files and silently uses hardcoded prompts.
- Bad: missing required Agent definitions are auto-recreated in a non-empty workspace, hiding user/content configuration problems.

### 6. Tests Required

- Assert `sendMessage` passes workspace files into `runAgentRuntimeTurn`.
- Assert default master/narrative Agent definitions appear in generated model messages for a new save.
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
const workspaceFiles = await listWorkspaceFilesForSave(activeSaveId)
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
{"name":"skill_load","arguments":{"name":"prose-style"}}
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
  - `skill_load`
  - `action_call`
  - `agent_call`
  - `workspace_read`
  - `workspace_list`
  - `workspace_search`

### 3. Contracts

- Runtime tools execute against the `WorkspaceFile[]` and `AgentContextEntry` already assembled inside `runAgentRuntimeTurn`.
- `agent-runtime` must not import Dexie, storage helpers, bridge objects, or `platform-host`.
- `skill_load` arguments: `{ name: string }`.
- `skill_load` resolves only against the current Agent's visible `skillIndex`.
- `skill_load` should match `SkillRegistryEntry.name` first, then fall back to `id` for compatibility.
- If a local and shared Skill share a name, prefer the current Agent's local Skill.
- `skill_load` success returns the loaded Skill's `SKILL.md` entry content and minimal metadata; it must not return a resource index or resource file contents by default.
- `skill_load` parses `tsian-actions` fenced JSON blocks from the loaded `SKILL.md` body and registers declared actions only for the same Agent's current tool loop.
- Declared Skill actions are not included in eager Skill Index or `agent-context`.
- `action_call` arguments: `{ skill: string, action: string, input?: Record<string, unknown> }`.
- `action_call` requires that the named Skill has already been loaded by the same Agent during the same tool loop.
- `action_call` validates action availability and input before invoking any executor.
- `action_call` routes to the action declaration's executor through the runtime action executor registry.
- `action_call` checks the lightweight executor-class policy before running supported executors. The default code-level policy allows `builtin`, `platform_action`, and `browser_script`; injected policy may deny them for tests or future host policy. Do not add Settings UI, localStorage persistence, runtime prompts, or per-Skill trust state for this slice.
- `action_call` may validate successful executor output when the loaded action declares optional `outputSchema`. Actions without `outputSchema` keep existing output behavior.
- `agent_call` arguments: `{ agentId: string, request: string, reason?: string, contextSummary?: string, expectedOutput?: string, historyMode?: "minimal" | "recent" | "scene" }`.
- `agent_call` is exposed in runtime tool instructions only when the current Agent has visible contacts and the current tool loop allows Agent calls.
- `agent_call` validates the target against the caller Agent's `contacts`; contacts are a runtime stability boundary, not a full security model.
- `agent_call` builds the target Agent's own `AgentContextEntry`, including its `AGENT.md`, notes/session, declared context files, and lightweight Skill Index.
- `agent_call` returns a structured observation containing `{ status: "completed", targetAgent, historyMode, metadata, response }`; the target Agent response does not directly become player-visible history.
- `historyMode` defaults to `recent`; concrete history window sizes remain platform policy.
- Agent Runtime collaboration policy is code-level/default-only for this slice: defaults are `maxCallsPerTurn=4`, `maxDepth=2`, `historyWindows={ minimal: 0, recent: 6, scene: 12 }`, and `maxToolRoundsPerAgent=3`; runtime capabilities may inject policy overrides for tests or future host-owned configuration, but there is no Settings UI, localStorage persistence, runtime prompt, or per-Agent trust state.
- Delegated Agents may use `workspace_read`, `workspace_list`, `workspace_search`, `skill_load`, `action_call` for loaded Skills, and limited nested `agent_call` inside their own tool loop.
- Limited nested `agent_call` remains contacts-gated at every hop, depth-limited by policy, and budget-limited by the shared root-turn call count. With the default `maxDepth=2`, root master/narrative steps at depth `0` may call a delegated Agent at depth `1`; that Agent may call one of its own contacts at depth `2`; Agents already at depth `2` receive `AGENT_CALL_UNAVAILABLE` with compact depth/budget metadata on direct `agent_call` attempts.
- The root turn shares one `agent_call` budget across master, narrative, and nested delegated steps.
- Missing action executor declarations use `{ type: "builtin", name: "validation" }`.
- Built-in executors are side-effect-free:
  - `validation`: returns `status: "validated"` and `output: null`.
  - `echo`: returns `status: "executed"` and echoes validated `input` as `output`.
- `platform_action` executors route through an injected `runPlatformAction` capability; `agent-runtime` must not import platform-host, bridge objects, Dexie, or storage helpers.
- `platform_action` declarations require `{ type: "platform_action", name: string }`, where `name` maps to `PlatformActionRequest.action` and validated action input becomes `params`.
- `platform-host` must allow-list Agent Runtime platform actions; current MVP allows `workspace-write` and `workspace-delete`, and does not allow `restore-checkpoint`.
- Inside `interaction.sendMessage`, Agent Runtime `workspace-write` / `workspace-delete` run against a staged Runtime Workspace transaction. Same-turn tools and scripts must see staged writes/deletes, but ordinary workspace mutations persist only when the turn succeeds.
- Successful turns commit the staged workspace final state atomically with accepted snapshot/history and after-turn checkpoint creation. Failed or aborted turns discard ordinary staged mutations.
- Ordinary Agent/Skill workspace mutations must reject `.tsian/*` targets. `.tsian/*` is platform-owned metadata space for trace/checkpoint/index/cache behavior.
- Frontend bridge `platform.runAction` workspace writes/deletes remain immediate platform actions and are not part of the Agent Runtime turn transaction.
- `browser_script` executors route through an injected `runBrowserScript` capability; `agent-runtime` must not import platform-host, bridge objects, Dexie, storage helpers, or Worker code.
- `browser_script` declarations require `{ type: "browser_script", path: string, timeoutMs?: number }`; `path` resolves relative to the declaring Skill directory and must stay under that directory.
- Controlled async executors have bounded timeout/abort behavior. `timeoutMs` must be positive and must not exceed the platform maximum.
- The first browser script capability profile is a strong Tsian SDK, not raw browser/internal access. Scripts can use SDK workspace read/list/search/write/delete, SDK fetch where browser policy permits, structured log/trace, timeout/abort, and JSON-compatible input/output.
- The first browser script slice must not expose raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals as supported script APIs. Worker hard limits still apply, and this is a third-party trust boundary rather than a guarantee that arbitrary third-party code is safe.
- `action_call` success returns a structured observation with `status`, `executor`, `input`, and `output`.
- `outputSchema` uses the same lightweight JSON-compatible type vocabulary as `inputSchema`: `array`, `boolean`, `integer`, `null`, `number`, `object`, and `string`. For object outputs, `required` and property `type` checks are supported; unsupported JSON Schema keywords are ignored.
- `SKILL.md` action declarations use a fenced JSON block whose info string includes `tsian-actions`:
  ````md
  ```json tsian-actions
  [
    {
      "name": "example_action",
      "description": "Validate an example action payload.",
      "inputSchema": {
        "type": "object",
        "required": ["text"],
        "properties": {
          "text": { "type": "string" }
        }
      },
      "outputSchema": {
        "type": "object",
        "required": ["text"],
        "properties": {
          "text": { "type": "string" }
        }
      },
      "executor": {
        "type": "builtin",
        "name": "echo"
      }
    },
    {
      "name": "write_world_note",
      "description": "Write a workspace file through an allow-listed platform action.",
      "inputSchema": {
        "type": "object",
        "required": ["path", "content"],
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" },
          "mediaType": { "type": "string" }
        }
      },
      "executor": {
        "type": "platform_action",
        "name": "workspace-write"
      }
    },
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
    }
  ]
  ```
  ````
- Runtime prompts should display Skill Index entries as `name/description/triggers/applicability` and should not default to exposing `path=...`.
- Use `workspace_read/workspace_list/workspace_search` for third-layer files only: files explicitly referenced by the loaded `SKILL.md`, world data, memory, README files, or other current-task context.
- Use the same workspace path rules as storage-facing APIs:
  - normalize backslashes to slashes;
  - trim leading slashes;
  - reject empty file paths, trailing slash file paths, `.`, `..`, and empty path segments;
  - allow empty directory path for root listing.
- `workspace_read` arguments: `{ path: string }`; success returns a `WorkspaceFile`.
- `workspace_list` arguments: `{ path?: string }`; success returns `{ path, entries }` with direct child `WorkspaceEntry[]`.
- `workspace_search` arguments: `{ query: string, limit?: number }`; success returns `WorkspaceSearchResult[]`; empty query returns `[]`.
- Tool observations are returned to the same Agent as a normal user message containing `<tsian-tool-observation>`.
- Final master/narrative outputs must strip tool-call blocks and must not expose tool observations to players.

### 4. Validation & Error Matrix

- Malformed JSON block -> error observation with `TOOL_CALL_JSON_INVALID`.
- Non-object tool payload -> error observation with `TOOL_CALL_INVALID`.
- Missing or blank `name` -> error observation with `TOOL_NAME_REQUIRED`.
- Non-object `arguments` -> error observation with `TOOL_ARGUMENTS_INVALID`.
- Unknown tool name -> error observation with `UNSUPPORTED_WORKSPACE_TOOL`.
- Missing or blank `skill_load.arguments.name` -> error observation with `SKILL_NAME_REQUIRED`.
- Unknown or invisible Skill name -> error observation with `SKILL_NOT_FOUND`.
- Ambiguous Skill name after local/shared priority -> error observation with `SKILL_NAME_AMBIGUOUS` and lightweight candidates.
- Missing `SKILL.md` after registry resolution -> error observation with `SKILL_DETAIL_NOT_FOUND`.
- Missing or blank `action_call.arguments.skill` -> error observation with `ACTION_SKILL_REQUIRED`.
- Missing or blank `action_call.arguments.action` -> error observation with `ACTION_NAME_REQUIRED`.
- `action_call.arguments.input` non-object -> error observation with `ACTION_INPUT_INVALID`.
- `action_call` before the Skill is loaded -> error observation with `SKILL_ACTION_NOT_LOADED`.
- `action_call` for an undeclared action on a loaded Skill -> error observation with `ACTION_NOT_FOUND`.
- `action_call` with schema-invalid input -> error observation with `ACTION_INPUT_INVALID`.
- Missing or blank `agent_call.arguments.agentId` -> error observation with `AGENT_CALL_TARGET_REQUIRED`.
- Missing or blank `agent_call.arguments.request` -> error observation with `AGENT_CALL_REQUEST_REQUIRED`.
- Invalid `agent_call.arguments.historyMode` -> error observation with `AGENT_CALL_HISTORY_MODE_INVALID`.
- `agent_call` without an active Agent context -> error observation with `AGENT_CALL_CONTEXT_REQUIRED`.
- `agent_call` in a tool loop where Agent calls are unavailable, including attempts beyond the collaboration depth limit -> error observation with `AGENT_CALL_UNAVAILABLE` and compact caller/target/depth/budget metadata when available.
- `agent_call` target not found in the Agent registry -> error observation with `AGENT_CALL_TARGET_NOT_FOUND`.
- `agent_call` target exists but is not in caller contacts -> error observation with `AGENT_CALL_TARGET_NOT_CONTACT`.
- Per-turn `agent_call` budget exhausted -> error observation with `AGENT_CALL_LIMIT_EXCEEDED`.
- Delegated Agent execution failure -> error observation with `AGENT_CALL_FAILED`.
- Malformed action executor declarations -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
- Platform action executor declarations without a non-empty `name` -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
- Browser script executor declarations without a non-empty `path`, or with invalid `timeoutMs` -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
- Malformed action `outputSchema` declarations -> report `ACTION_OUTPUT_SCHEMA_INVALID` in `skill_load` metadata and do not register that action.
- Executor denied by lightweight policy -> error observation with `ACTION_EXECUTOR_DISABLED` and compact policy metadata; no AIRP-turn UI prompt.
- Unsupported executor types -> error observation with `ACTION_EXECUTOR_UNSUPPORTED`.
- Unknown built-in executor names -> error observation with `ACTION_EXECUTOR_NOT_FOUND`.
- Controlled executor timeout -> error observation with `ACTION_EXECUTOR_TIMEOUT`.
- Controlled executor abort -> error observation with `ACTION_EXECUTOR_ABORTED`.
- `platform_action` without an injected capability -> error observation with `PLATFORM_ACTION_UNAVAILABLE`.
- `platform_action` whose injected handler returns `ok: false` -> error observation with `PLATFORM_ACTION_FAILED` and platform error details.
- `browser_script` without an injected capability -> error observation with `BROWSER_SCRIPT_UNAVAILABLE`.
- Missing browser script file -> error observation with `BROWSER_SCRIPT_NOT_FOUND`.
- Browser script path outside the declaring Skill directory -> error observation with `BROWSER_SCRIPT_PATH_INVALID`.
- Browser script failure, SDK failure, Worker failure, or Worker message failure -> structured error observation with a `BROWSER_SCRIPT_*` code.
- Successful executor output that fails declared `outputSchema` -> error observation with `ACTION_OUTPUT_INVALID` and output summary metadata, not raw large output payloads.
- Agent Runtime attempts to call a non-allow-listed platform action -> platform handler returns `AGENT_RUNTIME_PLATFORM_ACTION_UNSUPPORTED`, surfaced through `PLATFORM_ACTION_FAILED`.
- Agent/Skill attempts to write or delete `.tsian/*` through ordinary `workspace-write`, `workspace-delete`, or browser script SDK workspace mutation -> structured workspace error observation.
- Runtime turn fails or aborts after staged ordinary workspace writes -> persisted workspace state remains equivalent to the pre-turn accepted state, except for host-owned failed trace diagnostics.
- Malformed `tsian-actions` blocks in `SKILL.md` -> report declaration errors in `skill_load` metadata without failing the whole Skill load.
- Invalid path -> error observation with workspace path error code.
- Missing file on `workspace_read` -> error observation with `WORKSPACE_FILE_NOT_FOUND`.
- Model keeps requesting tools past the per-Agent round limit -> return stripped final text if present; otherwise throw a clear runtime error.

### 5. Good/Base/Bad Cases

- Good: master sees a Skill Index entry named `continuity`, calls `skill_load`, receives `SKILL.md` entry content as observation, then returns a plain brief.
- Good: narrative loads `prose-style` with `skill_load`; if an agent-local and shared Skill share that name, the narrative-local Skill wins.
- Good: loaded `SKILL.md` declares `tsian-actions`; the same Agent can call one declared action with `action_call` and receives a structured executor observation.
- Good: action without an executor declaration uses built-in `validation`.
- Good: action with `{ "type": "builtin", "name": "echo" }` returns the validated input as `output`.
- Good: action with `outputSchema` validates successful executor output before returning a success observation.
- Good: action with `{ "type": "platform_action", "name": "workspace-write" }` calls the injected platform action capability after gating and validation, then returns the platform result item as `output`.
- Good: action with `{ "type": "browser_script", "path": "scripts/run.js", "timeoutMs": 10000 }` runs a Skill-local script through the Tsian SDK after Skill gating and input validation.
- Good: an injected policy disables `browser_script` and `action_call` returns `ACTION_EXECUTOR_DISABLED` as a normal failed observation without prompting the player.
- Good: an action writes a workspace file, then a later same-turn workspace read or browser script SDK read observes the staged file before the turn commits.
- Good: a failed turn after staged workspace writes leaves no ordinary persisted workspace file from those staged writes.
- Good: loaded `SKILL.md` references `references/rules.md` or a full workspace path, and the Agent uses `workspace_read` only when that reference is needed.
- Good: master sees `memory` in contacts, calls `agent_call`, and receives memory's continuity findings as an observation before writing its own brief.
- Good: a delegated memory Agent loads a Skill, calls a non-`agent_call` action, or calls one of its own contact Agents when depth and budget policy allow it.
- Good: Agent uses `workspace_list` for a directory and receives entries without file contents.
- Good: Agent uses `workspace_search` and receives previews, then explicitly reads a chosen file if full content is needed.
- Base: no tool-call block means the existing one-call-per-Agent behavior is preserved.
- Bad: injecting all `SKILL.md` contents into `agent-context` or Skill Index; this breaks progressive disclosure.
- Bad: returning a resource index from `skill_load` by default; Skill resources should be chain-loaded from `SKILL.md` instructions.
- Bad: allowing `action_call` before `skill_load`; this bypasses Skill gating.
- Bad: exposing the full Agent registry instead of only the current Agent's contacts.
- Bad: allowing delegated Agents to call arbitrary non-contact Agents, exceed the shared root-turn budget, or exceed the policy depth limit.
- Bad: making built-in executors execute write/delete/script/remote behavior.
- Bad: letting Agent Runtime call broad platform actions such as checkpoint restore through `platform_action`.
- Bad: making raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals supported browser script APIs in the first strong-SDK slice.
- Bad: adding player-facing trust prompts, Settings toggles, or per-Skill trust records to the first lightweight executor policy slice.
- Bad: treating `outputSchema` as full JSON Schema support before the runtime explicitly implements it.
- Bad: making ordinary Agent output JSON-only to support tools; ordinary output remains a soft protocol.

### 6. Tests Required

- Assert a model response containing `skill_load` produces a second same-Agent model call with loaded `SKILL.md` content.
- Assert shared Skills and Agent-local Skills can both be loaded by `name`.
- Assert local/shared duplicate Skill names prefer the current Agent's local Skill.
- Assert `skill_load` does not return a resource index by default.
- Assert `skill_load` registers actions declared in a `tsian-actions` fenced JSON block.
- Assert `action_call` succeeds after loading the declaring Skill and routes through built-in executors.
- Assert an action without executor uses `validation` and returns `status: "validated"`.
- Assert an action with built-in `echo` returns `status: "executed"` and echoes validated input as `output`.
- Assert malformed `outputSchema` declarations report `ACTION_OUTPUT_SCHEMA_INVALID` during `skill_load`.
- Assert actions without `outputSchema` keep existing output behavior.
- Assert actions with `outputSchema` validate executor output and return `ACTION_OUTPUT_INVALID` on mismatch without storing raw large output in trace.
- Assert injected executor policy can return `ACTION_EXECUTOR_DISABLED` for supported executors.
- Assert default executor policy allows existing `builtin`, `platform_action`, and `browser_script` behavior.
- Assert `platform_action` sends `{ action: executor.name, params: input }` to the injected handler only after loaded Skill gating and input schema validation pass.
- Assert `platform_action/workspace-write` and `workspace-delete` stage ordinary Runtime Workspace mutations during `interaction.sendMessage` and commit only on successful turns.
- Assert failed or aborted turns discard ordinary staged workspace mutations.
- Assert ordinary Agent/Skill workspace mutations under `.tsian/*` fail structurally.
- Assert frontend bridge `platform.runAction` workspace write/delete remains immediate.
- Assert missing platform action capability returns `PLATFORM_ACTION_UNAVAILABLE`.
- Assert injected platform action failure returns `PLATFORM_ACTION_FAILED`.
- Assert `platform-host` rejects non-allow-listed Agent Runtime platform actions such as `restore-checkpoint`.
- Assert unsupported executor types return `ACTION_EXECUTOR_UNSUPPORTED`.
- Assert unknown built-in executor names return `ACTION_EXECUTOR_NOT_FOUND`.
- Assert invalid `browser_script` declarations report `ACTION_EXECUTOR_INVALID` during `skill_load`.
- Assert `browser_script` runs a Skill-local script through the injected runner only after Skill loading and input validation.
- Assert `browser_script` can use SDK workspace read/list/search/write/delete against the staged workspace view and keeps workspace mutation trace/synchronization.
- Assert `browser_script` timeout and abort return structured observations.
- Assert `browser_script` paths outside the declaring Skill directory are rejected.
- Assert `action_call` before loading the Skill returns `SKILL_ACTION_NOT_LOADED`.
- Assert unknown actions return `ACTION_NOT_FOUND`.
- Assert schema-invalid action input returns `ACTION_INPUT_INVALID`.
- Assert current Agents with contacts see `agent_call` instructions listing only visible contacts.
- Assert current Agents without contacts do not get encouraged to use `agent_call`, and direct calls return structured errors.
- Assert valid `agent_call` invokes the target contact Agent with its own context and returns the response as observation.
- Assert non-contact and missing target `agent_call` attempts return structured errors without model calls.
- Assert a delegated Agent can perform one nested `agent_call` to its own contact when depth and budget allow it.
- Assert nested `agent_call` attempts beyond `maxDepth` return `AGENT_CALL_UNAVAILABLE` with structured depth/budget metadata.
- Assert invalid `historyMode` is rejected and omitted `historyMode` defaults to `recent`.
- Assert delegated Agents can still use workspace tools, `skill_load`, and non-`agent_call` `action_call`.
- Assert per-turn `agent_call` budget is shared across master and narrative steps.
- Assert successful built-in action calls do not mutate workspace/state and do not execute scripts.
- Assert successful `platform_action` calls mutate workspace/state only through allow-listed platform actions.
- Assert missing Skill names become structured observations, not uncaught runtime crashes.
- Assert a loaded `SKILL.md` can chain to `workspace_read` for referenced resources.
- Assert `workspace_list` returns directory entries without file contents.
- Assert `workspace_search` returns scored previews and respects limit caps.
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

- Raw AIRP history turn files live under `history/turns/turn-000001.json`.
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
- Raw history must not store model prompts, master briefs, tool observations, trace events, delegated Agent intermediate outputs, or hidden debug data.
- Store raw history at turn granularity, not as a monolithic all-history JSONL file, so workspace search can return matching individual turns.
- Keep raw history separate from `.tsian/traces/`; trace is platform debug material and normal workspace list/search hides it by default.
- Enhanced AIRP memory such as timelines, summaries, world facts, character state, relationships, vector indexes, or semantic retrieval are derived workspace projections and belong to Skills, Agents, or content-specific conventions.
- Do not add a platform-owned gameplay memory schema when implementing raw history writeback.
- Direct future manual correction of a raw turn file is acceptable; do not add an amendment/revision overlay unless a future task explicitly chooses it.
- Successful raw history writes are staged as ordinary Runtime Workspace files and committed atomically with accepted snapshot/history and after-turn checkpoint creation.
- Failed or aborted turns must not leave ordinary raw history records.
- Existing `saveHistory` and snapshots remain the current chat display source; raw workspace history intentionally duplicates the player-facing exchange for runtime memory/feedstock use.

### 4. Validation & Error Matrix

- Successful turn -> `history/turns/turn-000001.json` exists and includes exactly one user and one assistant message for that turn.
- Aborted turn before final acceptance -> no raw history turn file is written.
- Agent Runtime failure -> no raw history turn file is written.
- Later successful-turn commit failure -> no partial raw history / snapshot / checkpoint state is accepted.
- Existing saves -> no backfill required; they start writing per-turn raw history on future successful turns.

### 5. Good/Base/Bad Cases

- Good: `workspace_search({ query: "lantern" })` returns a matching `history/turns/turn-000012.json` file preview.
- Good: a memory Skill reads raw turn files and creates `world/characters.json` or `memory/facts.jsonl` as derived, correctable projections.
- Base: current UI chat history still reads `saveHistory` while Agent/Skill context can inspect workspace raw history when needed.
- Bad: writing all history into `history/conversation.jsonl` only; workspace search can no longer identify the matching turn cleanly.
- Bad: adding automatic timeline/current-summary maintenance as part of raw history persistence.
- Bad: treating raw history as low-quality fallback and replacing it with derived summaries as the only source record.
- Bad: hiding raw turn files under `.tsian/`; they are ordinary gameplay memory feedstock, not platform trace.

### 6. Tests Required

- Assert successful turns write one raw history JSON file in the same successful-turn commit captured by checkpoint creation.
- Assert raw history content includes player input and final assistant output.
- Assert raw history content omits prompts, master brief, trace events, tool observations, and delegated Agent outputs.
- Assert workspace list/read/search can surface individual raw turn files.
- Assert failed or aborted turns do not persist raw history files.

## Scenario: Agent Session Transcript And Skill-Triggered Maintenance

### 1. Scope / Trigger

- Trigger: successful Agent Runtime turns persist Agent-facing transcripts or a loaded Skill action applies notes/timeline/summary maintenance.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts`, `apps/platform-web/src/platform-host/index.ts`, `apps/platform-web/src/storage/workspace.ts`, default Skill files, or successful-turn persistence.

### 2. Signatures

- Agent transcripts live under `agents/<agent>/session.jsonl`.
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
- Valid maintenance writes are limited to `agents/<agent>/notes.md`, `history/timeline.md`, `memory/summaries/current.md`, and `memory/summaries/long-term.md`.
- Empty `writes` is a valid explicit no-op maintenance decision.
- Invalid maintenance plans become structured action/script observations and trace summaries; they must not mutate ordinary workspace files.
- `.tsian/*` remains host-owned platform metadata and is never a valid ordinary maintenance target.
- New saves include the official maintenance Skill and the official workspace-assistant substrate. Existing non-empty saves receive missing official default files through a versioned default workspace upgrade that preserves same-path user files and does not recreate those files after the upgrade marker is current.

### 4. Validation & Error Matrix

- Successful no-tool turn -> master and narrative session JSONL records are appended.
- Successful `agent_call` -> the delegated Agent also receives its own session JSONL records.
- Successful turn with no maintenance action -> no notes/timeline/summary maintenance mutation is synthesized.
- Loaded maintenance Skill plus valid plan -> approved target files are written through the staged workspace transaction.
- Loaded maintenance Skill plus empty plan -> action returns no-op and no maintenance files are mutated.
- Invalid schema, invalid path, invalid mode, non-string content/reason, oversized content, or `.tsian/*` target -> action observation is an error and no maintenance writes are applied.
- Existing save with workspaceVersion below current -> missing official maintenance Skill, workspace-assistant, and framework-knowledge files are created, existing same-path files are preserved, and manifest advances.
- Existing save with current workspaceVersion -> deleted official maintenance Skill files are not recreated on every turn.

### 5. Good/Base/Bad Cases

- Good: a successful turn with master, narrative, and a delegated memory Agent appends JSONL records under each participating Agent's own directory.
- Good: memory Agent loads `memory-maintenance`, calls `apply_maintenance_plan`, and writes `memory/summaries/current.md` through the staged browser-script SDK.
- Good: an empty maintenance plan returns no-op output and does not mutate notes/timeline/summary files.
- Base: a successful turn with no loaded maintenance Skill still appends session transcripts and raw history, but produces no enhanced memory file updates.
- Bad: platform-host runs memory maintenance after every turn without a Skill action.
- Bad: Runtime Trace stores full Agent prompt/message arrays instead of only summary events.
- Bad: default workspace upgrade overwrites a user-authored `skills/memory-maintenance/SKILL.md`, `agents/studio-assistant/AGENT.md`, or `docs/tsian-framework-knowledge.md`.

### 6. Tests Required

- Assert transcript JSONL lines parse and include Agent-facing messages/output/tool material.
- Assert failed or aborted turns leave no ordinary transcript or maintenance writes.
- Assert transcript staging creates `session.jsonl` for custom Agents that participate.
- Assert maintenance action is unavailable until the declaring Skill is loaded.
- Assert default maintenance Skill is discoverable through `skill-registry`, loadable through `skill_load`, and runs through `browser_script`.
- Assert valid maintenance plans write only allowed paths and invalid plans write nothing.
- Assert default workspace upgrade is non-overwriting and manifest-gated for official Skills, workspace-assistant files, and framework knowledge docs.

### 7. Wrong vs Correct

#### Wrong

```typescript
await runMemoryMaintenanceEveryTurn()
await writeWorkspaceFileForSave(saveId, {
  path: "memory/summaries/current.md",
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
- Ordinary `workspace_read`, `workspace_list`, and `workspace_search` must not expose `.tsian/*`, including exact trace paths.
- Bridge `workspace-read`, `workspace-list`, and `workspace-search` must not provide an ordinary opt-in flag for `.tsian/*`; use dedicated resources such as `runtime-diagnostics` for Agent-facing facts and future debug/management resources for raw metadata.

### 4. Validation & Error Matrix

- Successful turn -> one valid JSONL trace file under `.tsian/traces/turns/`.
- Runtime failure after workspace is available -> failed trace is attempted and original error is rethrown.
- Trace write failure on successful turn -> fail loudly before checkpoint creation.
- Trace `data` contains non-JSON values -> collector normalizes to JSON-compatible values.
- Workspace read/list/search root or `.tsian` path -> no platform metadata contents are exposed.

### 5. Good/Base/Bad Cases

- Good: trace records `workspace_read` path and content size without copying file content.
- Good: trace records `agent_called` for both successful delegation and structured delegation errors without storing full delegated prompts.
- Good: trace records `action_executor_policy_checked` with executor metadata and policy source/reason but no action input or script source.
- Good: trace records `action_called` for `platform_action` plus a `workspace_mutation` event for `workspace-write`.
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
- Assert `workspace-write` / `workspace-delete` platform actions produce `workspace_mutation`.
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
- Bad: exposing diagnostics to ordinary master/narrative prompts by default.

### 6. Tests Required

- Assert `runtime-diagnostics` returns failed/anomalous summaries by default.
- Assert `includeHealth` returns compact successful-turn health summaries.
- Assert summary facts preserve raw error codes/messages and add only lightweight source/entity normalization.
- Assert summaries omit full prompts, full model outputs, file contents, script source, provider internals, bridge internals, storage internals, API keys, and `.tsian/*` related paths.
- Assert malformed trace lines are bounded facts/counts rather than thrown errors.
- Assert no derived diagnostic workspace files are written.

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.
