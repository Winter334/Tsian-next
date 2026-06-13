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
- Missing action executor declarations use `{ type: "builtin", name: "validation" }`.
- Built-in executors are side-effect-free:
  - `validation`: returns `status: "validated"` and `output: null`.
  - `echo`: returns `status: "executed"` and echoes validated `input` as `output`.
- `platform_action` executors route through an injected `runPlatformAction` capability; `agent-runtime` must not import platform-host, bridge objects, Dexie, or storage helpers.
- `platform_action` declarations require `{ type: "platform_action", name: string }`, where `name` maps to `PlatformActionRequest.action` and validated action input becomes `params`.
- `platform-host` must allow-list Agent Runtime platform actions; current MVP allows `workspace-write` and `workspace-delete`, and does not allow `restore-checkpoint`.
- The MVP must not execute browser scripts, call remote resources, or mutate workspace/state except through allow-listed `platform_action`.
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
- Malformed action executor declarations -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
- Platform action executor declarations without a non-empty `name` -> report `ACTION_EXECUTOR_INVALID` in `skill_load` metadata and do not register that action.
- Unsupported executor types -> error observation with `ACTION_EXECUTOR_UNSUPPORTED`.
- Unknown built-in executor names -> error observation with `ACTION_EXECUTOR_NOT_FOUND`.
- `platform_action` without an injected capability -> error observation with `PLATFORM_ACTION_UNAVAILABLE`.
- `platform_action` whose injected handler returns `ok: false` -> error observation with `PLATFORM_ACTION_FAILED` and platform error details.
- Agent Runtime attempts to call a non-allow-listed platform action -> platform handler returns `AGENT_RUNTIME_PLATFORM_ACTION_UNSUPPORTED`, surfaced through `PLATFORM_ACTION_FAILED`.
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
- Good: loaded `SKILL.md` references `references/rules.md` or a full workspace path, and the Agent uses `workspace_read` only when that reference is needed.
- Good: Agent uses `workspace_list` for a directory and receives entries without file contents.
- Good: Agent uses `workspace_search` and receives previews, then explicitly reads a chosen file if full content is needed.
- Base: no tool-call block means the existing one-call-per-Agent behavior is preserved.
- Bad: injecting all `SKILL.md` contents into `agent-context` or Skill Index; this breaks progressive disclosure.
- Bad: returning a resource index from `skill_load` by default; Skill resources should be chain-loaded from `SKILL.md` instructions.
- Bad: allowing `action_call` before `skill_load`; this bypasses Skill gating.
- Bad: making built-in executors execute write/delete/script/remote behavior.
- Bad: letting Agent Runtime call broad platform actions such as checkpoint restore through `platform_action`.
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
- Assert missing platform action capability returns `PLATFORM_ACTION_UNAVAILABLE`.
- Assert injected platform action failure returns `PLATFORM_ACTION_FAILED`.
- Assert `platform-host` rejects non-allow-listed Agent Runtime platform actions such as `restore-checkpoint`.
- Assert unsupported executor types return `ACTION_EXECUTOR_UNSUPPORTED`.
- Assert unknown built-in executor names return `ACTION_EXECUTOR_NOT_FOUND`.
- Assert `action_call` before loading the Skill returns `SKILL_ACTION_NOT_LOADED`.
- Assert unknown actions return `ACTION_NOT_FOUND`.
- Assert schema-invalid action input returns `ACTION_INPUT_INVALID`.
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

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.
