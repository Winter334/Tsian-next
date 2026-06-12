# Skill Detail Workspace Read MVP Design

## Scope

This task lets runtime Agents request read-only Runtime Workspace files during a model turn. Skill detail loading becomes a natural use of the same workspace tools:

```text
Agent sees lightweight Skill Index
  -> Agent decides a skill is relevant
  -> Agent calls workspace.read with the SKILL.md path from the index
  -> Runtime returns the file as an observation
  -> Agent continues the same master or narrative step with the loaded detail
```

The task does not introduce a dedicated `skill.load` tool. `skill-detail` remains available as a bridge query for UI or external callers, but the live Agent path reads files through the virtual workspace abstraction.

## Architecture

### Runtime Boundary

`platform-host` remains responsible for:

- ensuring an active save;
- initializing the workspace when needed;
- reading all workspace files for the turn;
- injecting model-call capability into `runAgentRuntimeTurn`.

`agent-runtime` remains pure:

- accepts `workspaceFiles?: WorkspaceFile[]`;
- assembles prompts;
- parses tool-call blocks from model text;
- executes read-only tools against the in-memory `workspaceFiles`;
- performs additional model calls when observations need to be returned.

No Dexie, bridge, platform-host, or storage imports should enter `agent-runtime`.

### Tool Protocol

Because `AiChatMessage` currently supports only `system | user | assistant` string messages and the OpenAI-compatible adapter sends only `{ model, messages }`, MVP uses a textual tool-call block:

```md
<tsian-tool-call>
{"name":"workspace.read","arguments":{"path":"skills/example/SKILL.md"}}
</tsian-tool-call>
```

The parser should accept one or more blocks in a single assistant response. Each block must contain valid JSON with:

```ts
{
  name: "workspace.list" | "workspace.read" | "workspace.search"
  arguments?: Record<string, unknown>
}
```

Later native tool calling can map provider tool calls into the same internal `RuntimeToolCall` type, leaving workspace tool execution and observations unchanged.

### Available Tools

`workspace.read`

- Input: `{ path: string }`
- Output on success: selected `WorkspaceFile` with content.
- Output on missing file: structured error observation.
- Path normalization must reject blank paths, trailing slash file paths, empty segments, `.`, and `..`.

`workspace.list`

- Input: `{ path?: string }`
- Output: entries directly under the directory path.
- Directory path may be empty/root.
- Entries should include `path`, `name`, `kind`, and lightweight file/directory metadata.

`workspace.search`

- Input: `{ query: string, limit?: number }`
- Output: search results with `path`, `name`, `mediaType`, `updatedAt`, `score`, and `preview`.
- Empty query returns an empty result observation.
- Limit should be capped.

These tools are read-only. They can read Skill files, Skill resources, README files, world files, memory summaries, and any other workspace file visible in the save.

### Tool Loop

Introduce a helper around each Agent model step:

```text
call model with base messages + tool instructions
  -> if no tool-call block, return cleaned final text
  -> if tool-call block exists:
       execute valid read-only workspace calls
       append assistant response and user observation message
       call same Agent again
       repeat until no tool calls or max rounds reached
```

Recommended MVP constants:

- `MAX_TOOL_ROUNDS_PER_AGENT = 2`
- execute all valid calls found in a round;
- invalid calls produce error observations instead of throwing;
- abort signal is checked before and after model calls and before each tool round.

When max rounds are reached and the model still emits tool-call blocks, strip tool-call blocks from the candidate final text. If nothing remains, throw a clear runtime error for that agent.

### Prompt Changes

The workspace Agent context already includes:

- full `AGENT.md`;
- notes/session;
- declared context files;
- missing context paths;
- visible Skill Index with `path`.

Add a compact tool instruction section:

- tools are optional;
- use them only when more workspace context is needed;
- to load a Skill, call `workspace.read` with the `path` shown in the Skill Index;
- final master/narrative output must not include tool-call blocks, tool observations, or implementation details.

The existing platform guards should remain:

- master outputs a concise brief;
- narrative outputs player-facing prose.

### Data Flow

```text
platform-host.interaction.sendMessage
  -> initializeWorkspaceForSave(activeSaveId)
  -> listWorkspaceFilesForSave(activeSaveId)
  -> runAgentRuntimeTurn({ workspaceFiles, ... }, { callModel })
      -> runAgentStep(master)
          -> model
          -> optional workspace tool observations
          -> model final brief
      -> runAgentStep(narrative)
          -> model
          -> optional workspace tool observations
          -> model final reply
  -> save runtime snapshot/history
  -> checkpoint
```

### Compatibility

- No contract change is required for MVP if tool calls remain internal to `agent-runtime`.
- Existing `skill-detail` bridge query stays unchanged.
- Existing frontend bridge `workspace-read/list/search` stays unchanged.
- Existing no-tool responses should produce the same shape of master plan and narrative reply.
- AI debug will naturally record additional chat calls when tools are used, using the same `debugLabel`.

### Trade-Offs

- Textual tool blocks are less robust than provider-native tool calling, but they match the current adapter and keep the implementation provider-agnostic.
- Using workspace tools instead of `skill.load` keeps Skill, README, world data, memory, and resources under one mental model.
- A small max-round loop is enough for Skill detail loading because the Agent already sees the `SKILL.md` path in the Skill Index. Larger exploration loops can wait until action execution and trace support exist.

## Rollback

The change is isolated to prompt/runtime orchestration:

- remove tool parser/executor helpers;
- remove tool instruction text from Agent prompts;
- restore direct `capabilities.callModel(buildMasterMessages(...))` and direct narrative call.
