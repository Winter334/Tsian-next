# name-based skill.load MVP Design

## Scope

This task changes Skill detail loading from:

```text
Skill Index exposes path
  -> Agent calls workspace.read(path)
```

to:

```text
Skill Index exposes name/description/triggers
  -> Agent calls skill.load(name)
  -> Runtime resolves visible Skill and returns SKILL.md entry content
  -> SKILL.md tells Agent when to read references/examples/scripts/schemas
  -> Agent uses workspace.read/list/search only when those resources are actually needed
```

The previous workspace tools remain useful as third-layer resource readers.

## Architecture

### Runtime Boundary

Keep the same boundary as the previous runtime tool task:

- `platform-host` loads `workspaceFiles` and injects `callModel`.
- `agent-runtime` parses tool-call blocks and executes tools against in-memory runtime context.
- `agent-runtime` must not import Dexie, bridge objects, platform-host, or storage helpers.

### Contracts

Extend shared Skill shapes additively:

```ts
interface SkillRegistryEntry {
  id: string
  name: string
  title: string
  description: string
  summary: string
  path: string
  scope: SkillRegistryScope
  agentId?: string
  triggers: string[]
  appliesTo: string[]
  updatedAt: number
}
```

Compatibility:

- Keep `id`, `title`, `summary`, and `path` for existing bridge/UI/debug consumers.
- Add `name` and `description` for model-facing Skill semantics.
- Build `name` from frontmatter `name`, fallback to `id`, fallback to path directory name.
- Build `description` from frontmatter `description`, fallback to `summary`, fallback to first body paragraph.
- `path` remains available to platform/bridge detail queries, but runtime prompt should not expose it by default.

### Tool Protocol

Keep textual tool blocks for MVP:

```md
<tsian-tool-call>
{"name":"skill.load","arguments":{"name":"prose-style"}}
</tsian-tool-call>
```

Supported runtime tools after this task:

- `skill.load`
- `workspace.read`
- `workspace.list`
- `workspace.search`

Later native provider tool calling should map into the same internal tool-call executor.

### Runtime Tool Context

Workspace tools only need `workspaceFiles`.

`skill.load` additionally needs the current `AgentContextEntry`, because it should load only Skills visible to the active Agent:

```ts
interface RuntimeToolExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext: AgentContextEntry
}
```

The model loop should call the same executor for each Agent step with that Agent's context. Legacy no-workspace fallback still skips tool execution.

### Skill Resolution

Input:

```ts
{ name: string }
```

Resolution rules:

1. Trim `name`; blank or non-string -> `SKILL_NAME_REQUIRED`.
2. Match against `agentContext.skillIndex`.
3. Prefer exact `skill.name`.
4. Fallback to exact `skill.id` for compatibility with existing skills.
5. If multiple matches exist:
   - prefer entries with `scope === "agent-local"` and `agentId === agentContext.agent.id`;
   - if exactly one remains, load it;
   - otherwise return `SKILL_NAME_AMBIGUOUS` with lightweight candidates.
6. If none match, return `SKILL_NOT_FOUND`.
7. Internally load the selected `SKILL.md` workspace file.
8. If the file cannot be loaded, return `SKILL_DETAIL_NOT_FOUND`.

Agent never needs to see path/ref for second-layer loading. Third-layer resource paths should be discovered from the loaded `SKILL.md` instructions when the Skill author references them.

### Skill Detail Observation

`skill.load` success observation should include:

```ts
{
  registry: {
    name,
    title,
    description,
    triggers,
    appliesTo
  },
  file: {
    mediaType,
    content,
    updatedAt
  }
}
```

The observation should not include a resource index by default. `SKILL.md` is the entry document; it should tell the Agent which `references/`, `examples/`, `schemas/`, `actions/`, or `scripts/` files to read and under what condition. This keeps the second layer lean and makes resource access chain-driven.

Resource contents and resource indexes must not be included by default.

### Prompt Changes

Update `formatSkillIndex`:

- Show `name`, `description`, `triggers`, `appliesTo/applicability`.
- Do not show `path` by default.
- Do not show `id` unless needed as legacy compatibility; MVP should keep model-facing output name-first.

Update tool instructions:

- Use `skill.load` for Skill detail.
- Use `workspace.read/list/search` only when the loaded `SKILL.md` or current task asks for specific files, resources, references, examples, schemas, scripts, world data, memory, or README files.
- Final output must not include tool blocks or observation details.

### Compatibility

- Existing `skill-registry` bridge query can continue returning `path`, `id`, `title`, and `summary`.
- Existing `skill-detail` query remains path-based for UI/debug/external bridge consumers.
- Existing workspace tool calls continue to work.
- Existing `SKILL.md` files that use `id` but not `name` still load through fallback.

### Data Flow

```text
runAgentRuntimeTurn
  -> assembleAgentContext(master)
  -> run model step with runtime tools
      -> model emits skill.load(name)
      -> executor resolves name in master skillIndex
      -> loadSkillDetail(workspaceFiles, selected.path)
      -> observation returned
      -> model returns master brief
  -> assembleAgentContext(narrative)
  -> same flow for narrative
```

### Trade-Offs

- Adding `name/description` while keeping `id/summary` avoids a breaking contract migration.
- Hiding path from the runtime prompt saves tokens and reduces model exposure to storage details.
- Keeping path-based `skill-detail` query avoids unnecessary bridge churn.
- Built-in local/shared priority is simpler for Agent behavior, while ambiguity errors preserve debuggability for unusual duplicate setups.

## Rollback

- Remove `skill.load` handling from runtime tools.
- Restore Skill Index prompt to path-based display.
- Keep workspace read/list/search as before.
- If contracts are extended, reverting only the added optional display fields is low risk because existing fields remain intact.
