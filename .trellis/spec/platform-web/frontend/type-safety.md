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

- Good: `skill-registry` with `{ agentId: "narrative" }` returns shared skills plus `agents/narrative/skills/*/SKILL.md`.
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

## Scenario: Runtime Workspace Tool Calls

### 1. Scope / Trigger

- Trigger: Agent Runtime lets a model request read-only Runtime Workspace data during a turn.
- Applies when changing `apps/platform-web/src/agent-runtime/index.ts` or `apps/platform-web/src/agent-runtime/workspace-tools.ts`.

### 2. Signatures

- Textual tool-call block:

```md
<tsian-tool-call>
{"name":"workspace.read","arguments":{"path":"skills/example/SKILL.md"}}
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
  - `workspace.read`
  - `workspace.list`
  - `workspace.search`

### 3. Contracts

- Runtime tools are read-only and execute against the `WorkspaceFile[]` already passed into `runAgentRuntimeTurn`.
- `agent-runtime` must not import Dexie, storage helpers, bridge objects, or `platform-host`.
- Use the same workspace path rules as storage-facing APIs:
  - normalize backslashes to slashes;
  - trim leading slashes;
  - reject empty file paths, trailing slash file paths, `.`, `..`, and empty path segments;
  - allow empty directory path for root listing.
- `workspace.read` arguments: `{ path: string }`; success returns a `WorkspaceFile`.
- `workspace.list` arguments: `{ path?: string }`; success returns `{ path, entries }` with direct child `WorkspaceEntry[]`.
- `workspace.search` arguments: `{ query: string, limit?: number }`; success returns `WorkspaceSearchResult[]`; empty query returns `[]`.
- Tool observations are returned to the same Agent as a normal user message containing `<tsian-tool-observation>`.
- Final master/narrative outputs must strip tool-call blocks and must not expose tool observations to players.
- Skill details are loaded by reading the `SkillRegistryEntry.path` file with `workspace.read`, not by a dedicated `skill.load` runtime tool.

### 4. Validation & Error Matrix

- Malformed JSON block -> error observation with `TOOL_CALL_JSON_INVALID`.
- Non-object tool payload -> error observation with `TOOL_CALL_INVALID`.
- Missing or blank `name` -> error observation with `TOOL_NAME_REQUIRED`.
- Non-object `arguments` -> error observation with `TOOL_ARGUMENTS_INVALID`.
- Unknown tool name -> error observation with `UNSUPPORTED_WORKSPACE_TOOL`.
- Invalid path -> error observation with workspace path error code.
- Missing file on `workspace.read` -> error observation with `WORKSPACE_FILE_NOT_FOUND`.
- Model keeps requesting tools past the per-Agent round limit -> return stripped final text if present; otherwise throw a clear runtime error.

### 5. Good/Base/Bad Cases

- Good: master sees a Skill Index entry with `path=skills/continuity/SKILL.md`, calls `workspace.read`, receives `SKILL.md` content as observation, then returns a plain brief.
- Good: narrative reads `agents/narrative/skills/prose/SKILL.md` through the same `workspace.read` tool.
- Good: Agent uses `workspace.list` for a directory and receives entries without file contents.
- Good: Agent uses `workspace.search` and receives previews, then explicitly reads a chosen file if full content is needed.
- Base: no tool-call block means the existing one-call-per-Agent behavior is preserved.
- Bad: injecting all `SKILL.md` contents into `agent-context` or Skill Index; this breaks progressive disclosure.
- Bad: adding write/delete/script/remote execution tools to this read-only path.
- Bad: making ordinary Agent output JSON-only to support tools; ordinary output remains a soft protocol.

### 6. Tests Required

- Assert a model response containing `workspace.read` produces a second same-Agent model call with a `WorkspaceFile` observation.
- Assert shared Skill paths and Agent-local Skill paths can both be read via `workspace.read`.
- Assert `workspace.list` returns directory entries without file contents.
- Assert `workspace.search` returns scored previews and respects limit caps.
- Assert invalid JSON, unsupported tools, invalid paths, and missing files become observations, not uncaught runtime crashes.
- Assert final `replyText` does not contain `<tsian-tool-call>` markup.
- Assert no-tool turns still return the current `{ replyText, masterPlan }` shape.

### 7. Wrong vs Correct

#### Wrong

```typescript
const detail = loadSkillDetail(workspaceFiles, skill.path)
messages.push({ role: "system", content: detail.file.content })
```

#### Correct

```typescript
const calls = parseRuntimeWorkspaceToolCalls(modelText)
const observations = executeRuntimeWorkspaceToolCalls(workspaceFiles, calls)
messages.push({
  role: "user",
  content: formatRuntimeWorkspaceToolObservationMessage(observations),
})
```

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.
