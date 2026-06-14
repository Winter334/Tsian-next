# Type Safety

`platform-web` is strict TypeScript. Normalize unknown data at runtime boundaries and keep shared shapes in `@tsian/contracts`.

## Shared Contracts

- Import bridge, runtime, debug, frontend package, and state record shapes from `@tsian/contracts`.
- Import `RuntimeEngine` from `@tsian/runtime-core`.
- Do not redefine cross-package payloads in platform-web.

## Runtime Boundaries

- Treat AI responses as untrusted strings unless a later task adds structured output validation.
- Validate bridge/platform action inputs before mutating storage.
- Keep `StateWriteOperation` handling JSON-compatible and fail loudly on invalid writes.
- Convert query params at the platform-host boundary before passing to storage helpers.

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
- Assert `agent-registry` returns master and narrative entries for a new save.
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

## JSON State

- `RuntimeGlobalsMap` and state record `data` must remain JSON-compatible.
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
- Model messages may include `AGENT.md`, notes/session files, declared context files, missing context paths, lightweight skill index, recent history, stateRecords, turn number, player input, and master brief.
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
await runAgentRuntimeTurn({ userInput, recentHistory, snapshot, stateRecords }, capabilities)
```

#### Correct

```typescript
await initializeWorkspaceForSave(activeSaveId)
const workspaceFiles = await listWorkspaceFilesForSave(activeSaveId)
await runAgentRuntimeTurn({
  userInput,
  recentHistory,
  snapshot,
  stateRecords,
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
- `agent_call` arguments: `{ agentId: string, request: string, reason?: string, contextSummary?: string, expectedOutput?: string, historyMode?: "minimal" | "recent" | "scene" }`.
- `agent_call` is exposed in runtime tool instructions only when the current Agent has visible contacts and the current tool loop allows Agent calls.
- `agent_call` validates the target against the caller Agent's `contacts`; contacts are a runtime stability boundary, not a full security model.
- `agent_call` builds the target Agent's own `AgentContextEntry`, including its `AGENT.md`, notes/session, declared context files, and lightweight Skill Index.
- `agent_call` returns a structured observation containing `{ status: "completed", targetAgent, historyMode, response }`; the target Agent response does not directly become player-visible history.
- `historyMode` defaults to `recent`; concrete history window sizes remain platform policy.
- Delegated Agents may use `workspace_read`, `workspace_list`, `workspace_search`, `skill_load`, and non-`agent_call` `action_call` inside their own tool loop.
- Delegated Agents must not receive a nested `agent_call` runner for the MVP; direct nested attempts return `AGENT_CALL_UNAVAILABLE` as a normal observation.
- The root turn shares one `agent_call` budget across master and narrative steps.
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
- `agent_call` in a tool loop where Agent calls are disabled, including delegated nested attempts -> error observation with `AGENT_CALL_UNAVAILABLE`.
- `agent_call` target not found in the Agent registry -> error observation with `AGENT_CALL_TARGET_NOT_FOUND`.
- `agent_call` target exists but is not in caller contacts -> error observation with `AGENT_CALL_TARGET_NOT_CONTACT`.
- Per-turn `agent_call` budget exhausted -> error observation with `AGENT_CALL_LIMIT_EXCEEDED`.
- Delegated Agent execution failure -> error observation with `AGENT_CALL_FAILED`.
- Malformed action executor declarations -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
- Platform action executor declarations without a non-empty `name` -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
- Browser script executor declarations without a non-empty `path`, or with invalid `timeoutMs` -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
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
- Good: action with `{ "type": "platform_action", "name": "workspace-write" }` calls the injected platform action capability after gating and validation, then returns the platform result item as `output`.
- Good: action with `{ "type": "browser_script", "path": "scripts/run.js", "timeoutMs": 10000 }` runs a Skill-local script through the Tsian SDK after Skill gating and input validation.
- Good: an action writes a workspace file, then a later same-turn workspace read or browser script SDK read observes the staged file before the turn commits.
- Good: a failed turn after staged workspace writes leaves no ordinary persisted workspace file from those staged writes.
- Good: loaded `SKILL.md` references `references/rules.md` or a full workspace path, and the Agent uses `workspace_read` only when that reference is needed.
- Good: master sees `memory` in contacts, calls `agent_call`, and receives memory's continuity findings as an observation before writing its own brief.
- Good: a delegated memory Agent loads a Skill and calls a non-`agent_call` action in its own tool loop.
- Good: Agent uses `workspace_list` for a directory and receives entries without file contents.
- Good: Agent uses `workspace_search` and receives previews, then explicitly reads a chosen file if full content is needed.
- Base: no tool-call block means the existing one-call-per-Agent behavior is preserved.
- Bad: injecting all `SKILL.md` contents into `agent-context` or Skill Index; this breaks progressive disclosure.
- Bad: returning a resource index from `skill_load` by default; Skill resources should be chain-loaded from `SKILL.md` instructions.
- Bad: allowing `action_call` before `skill_load`; this bypasses Skill gating.
- Bad: exposing the full Agent registry instead of only the current Agent's contacts.
- Bad: allowing delegated Agents to recursively call `agent_call` during the MVP.
- Bad: making built-in executors execute write/delete/script/remote behavior.
- Bad: letting Agent Runtime call broad platform actions such as checkpoint restore through `platform_action`.
- Bad: making raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals supported browser script APIs in the first strong-SDK slice.
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
- Assert nested `agent_call` attempts from delegated Agents return `AGENT_CALL_UNAVAILABLE`.
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

- Trace is platform-owned workspace content: platform writes it, Agent context does not inject it by default, and normal list/search hides it.
- Trace follows checkpoint/restore because it is stored as normal Runtime Workspace files under `.tsian/traces/`.
- Successful turns include trace in the accepted workspace state before the after-turn checkpoint is created, so the checkpoint includes the trace for that branch.
- Failed turns attempt to write `turn_failed` trace if workspace files are already available, but failed-turn trace persistence must not mask the original runtime error.
- Trace must record summaries, not large raw payloads:
  - model calls: message count, output length, tool-call count;
  - Skill loads: skill name/path/scope, action count, declaration error count;
  - Agent calls: caller/target ids, target title, history mode, input/output summaries, status or error;
  - workspace tools: path/query/limit, result count, file metadata for reads, no file content;
  - action calls: skill/action/executor, input/output summaries, status or error;
  - browser scripts: script path/source size/start events and script log/trace summaries, no script source or large raw data;
  - workspace mutations: write path/mediaType/size or delete `deletedPaths`.
- `agent-runtime` still must not import Dexie, storage helpers, bridge objects, or `platform-host`; it emits trace through an injected callback.
- `platform-host` owns trace persistence through workspace storage helpers.
- `workspace_read` can still read an exact trace path for MVP; `workspace_list` and `workspace_search` hide `.tsian/traces/` by default.
- Bridge `workspace-list` and `workspace-search` also hide `.tsian/traces/` by default, with `includePlatformTraces` reserved for explicit inclusion.

### 4. Validation & Error Matrix

- Successful turn -> one valid JSONL trace file under `.tsian/traces/turns/`.
- Runtime failure after workspace is available -> failed trace is attempted and original error is rethrown.
- Trace write failure on successful turn -> fail loudly before checkpoint creation.
- Trace `data` contains non-JSON values -> collector normalizes to JSON-compatible values.
- Workspace list/search root or `.tsian` path -> trace files/directories hidden unless `includePlatformTraces` is true.

### 5. Good/Base/Bad Cases

- Good: trace records `workspace_read` path and content size without copying file content.
- Good: trace records `agent_called` for both successful delegation and structured delegation errors without storing full delegated prompts.
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
- Assert bridge and runtime workspace list/search exclude `.tsian/traces/` by default.

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.
