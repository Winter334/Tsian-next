# Workspace Agent Runtime MVP Design

## Architecture

本任务把 workspace context 接入现有 Agent Runtime，但不重写整个 orchestration：

```text
platform-host sendMessage
  -> ensure active save
  -> listWorkspaceFilesForSave(activeSaveId)
  -> runAgentRuntimeTurn({ ..., workspaceFiles })
      -> assembleAgentContext(workspaceFiles, { agentId: "master" })
      -> call master model
      -> assembleAgentContext(workspaceFiles, { agentId: "narrative" })
      -> call narrative model
  -> save snapshot/history
  -> checkpoint
```

`platform-host` 仍是 storage 和 model-call 注入边界。`agent-runtime` 仍不直接 import Dexie、bridge 或 platform-host。

## Runtime Input

Extend `AgentRuntimeTurnInput` with:

```ts
workspaceFiles?: WorkspaceFile[]
```

`workspaceFiles` is optional only to preserve narrow testability and allow fallback behavior. The production `sendMessage` path should pass files from `listWorkspaceFilesForSave(activeSaveId)`.

## Prompt Assembly

Add local prompt assembly helpers in `apps/platform-web/src/agent-runtime/index.ts` or a nearby pure module if the file becomes crowded.

Each Agent model call should have:

- `system`: platform role guard + full `AGENT.md` content/body.
- `user`: runtime turn context:
  - current turn;
  - recent history;
  - stateRecords;
  - notes file content if present;
  - session file content if present;
  - declared context file contents;
  - missing context paths;
  - visible skill index summary/triggers/appliesTo;
  - current task input, such as player message or master brief.

The default `AGENT.md` content is intentionally short, so the runtime should keep a small platform guard to preserve current behavior:

- master must output a concise writing brief, not player-facing prose;
- narrative must output player-facing prose and hide Agent/tool/brief mechanics.

This keeps `AGENT.md` configurable while avoiding immediate regression from underspecified default files.

## Skill Index Formatting

Only include lightweight `SkillRegistryEntry` data:

- id;
- title;
- summary;
- path;
- scope / agentId;
- triggers;
- appliesTo.

Do not call `loadSkillDetail` and do not include `SKILL.md` body, resources, scripts, schemas, examples, or actions.

## Missing Context Paths

`assembleAgentContext` already records missing paths. Runtime prompt assembly should include them as diagnostic context, not throw.

This allows an Agent to know that a declared file is absent without blocking a turn.

## Fallback Strategy

Confirmed strategy:

- If an active save has an empty workspace, initialize the default Runtime Workspace before reading workspace files for the turn. This preserves older or partially-created local saves.
- If a workspace already has files but required `master` or `narrative` Agent definitions are missing, fail loudly with a clear error. Do not silently fall back to the old hardcoded prompts.
- Do not auto-recreate missing default Agent files in a non-empty workspace. A missing Agent definition is treated as a user/content configuration issue, not as a platform migration gap.

Implementation shape:

```text
sendMessage
  -> ensureActiveSave()
  -> initializeWorkspaceForSave(activeSaveId)
  -> listWorkspaceFilesForSave(activeSaveId)
  -> runAgentRuntimeTurn({ ..., workspaceFiles })
```

`initializeWorkspaceForSave` is already idempotent: it only writes defaults when the save has zero workspace files.

## Compatibility

- Keep `debugLabel: "master-agent" | "narrative-agent"` to avoid changing AI debug consumers.
- Keep two model calls and `AgentRuntimeTurnResult` shape.
- Keep stateRecords in prompt until a later workspace-state migration task.
- No storage writes are added by `agent-runtime`; checkpoint contents only change indirectly if future workspace writes happen, which is out of scope.

## Validation

- Build checks: `npm run build:web`.
- `npm run build:contracts` only if contract shapes change.
- In-memory helper/runtime probe should verify that generated messages include workspace Agent content and context files without loading skill detail.

## Rollback

Rollback by:

- removing `workspaceFiles` input;
- restoring hardcoded system prompts as the only prompt source;
- removing platform-host workspace file pass-through;
- reverting spec/doc updates.
