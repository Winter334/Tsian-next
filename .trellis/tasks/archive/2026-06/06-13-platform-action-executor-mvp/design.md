# Design

## Architecture

The task extends the existing action path:

```text
Agent
  -> skill_load(name)
  -> Runtime parses tsian-actions declarations
  -> Agent action_call(skill, action, input)
  -> Runtime validates loaded Skill gating
  -> Runtime validates declared action and inputSchema
  -> Runtime resolves executor
  -> platform_action executor calls injected platform capability
  -> Runtime returns structured tool observation
```

`agent-runtime` remains a pure runtime layer. It receives platform capabilities from `runAgentRuntimeTurn` and does not import platform storage or host modules.

## Executor Declaration

Skill action declarations use:

```json
{
  "executor": {
    "type": "platform_action",
    "name": "workspace-write"
  }
}
```

Rules:

- `type` is `platform_action`.
- `name` is required and maps to `PlatformActionRequest.action`.
- The already-validated action input becomes `PlatformActionRequest.params`.
- Future executor-specific config fields can be added later, but are not needed for the MVP.

## Runtime Capability Boundary

Extend `AgentRuntimeCapabilities` with an optional platform action handler:

```ts
runPlatformAction?(request: PlatformActionRequest): Promise<PlatformActionResult>
```

`workspace-tools.ts` receives the handler through `RuntimeWorkspaceToolExecutionContext`.

This keeps the boundary clear:

- `workspace-tools.ts` knows how to route an executor.
- `index.ts` knows how to pass runtime capabilities into tool execution.
- `platform-host/index.ts` knows which platform actions are safe to expose to Agent Runtime.

## Async Tool Execution

Current tool execution is synchronous because workspace read/list/search and built-in executors are local.

`platform_action` requires async execution. The implementation should:

- make executor functions return `RuntimeActionExecutorResult | Promise<RuntimeActionExecutorResult>`;
- make `executeRuntimeWorkspaceToolCalls` async;
- `await executeRuntimeWorkspaceToolCalls(...)` in `callAgentModelWithWorkspaceTools`;
- preserve synchronous behavior for built-in executors by allowing immediate return values.

## Platform-Host Adapter

`platform-host` should expose a small runtime-facing adapter instead of passing the frontend bridge object into runtime:

```ts
async function runAgentRuntimePlatformAction(
  request: PlatformActionRequest,
): Promise<PlatformActionResult> {
  // allow-list actions here
}
```

MVP recommended allow-list:

- `workspace-write`
- `workspace-delete`

Explicitly reject:

- `restore-checkpoint`
- unknown platform actions

The existing `platform.runAction` implementation can delegate to a shared helper so the frontend bridge and Agent Runtime adapter reuse the same validation and storage behavior.

## Observation Shape

On success:

```json
{
  "status": "executed",
  "skill": { "name": "relationship-maintainer", "scope": "shared" },
  "action": {
    "name": "update_character_state",
    "description": "Write the current character state file after validating the payload.",
    "hasInputSchema": true
  },
  "executor": { "type": "platform_action", "name": "workspace-write" },
  "input": {
    "path": "world/characters.json",
    "content": "{...}",
    "mediaType": "application/json"
  },
  "output": {
    "path": "world/characters.json",
    "content": "{...}",
    "mediaType": "application/json",
    "createdAt": 0,
    "updatedAt": 0
  }
}
```

On platform failure, return a tool error observation:

```json
{
  "code": "PLATFORM_ACTION_FAILED",
  "message": "Platform action failed: workspace-write",
  "details": {
    "action": "workspace-write",
    "platformError": {
      "code": "WORKSPACE_CONTENT_REQUIRED",
      "message": "Workspace file content must be a string."
    }
  }
}
```

If no handler is injected:

```json
{
  "code": "PLATFORM_ACTION_UNAVAILABLE",
  "message": "Platform action executor is not available in this runtime."
}
```

## Side Effects And Consistency

The recommended MVP directly uses existing workspace platform actions. This means writes/deletes are immediately persisted by `platform-host`.

Important implications:

- The executor result itself gives the Agent the updated object.
- Subsequent turns will see the updated workspace through storage.
- Same-turn `workspace_read` may need an in-memory refresh if the implementation wants read-after-write consistency in the same tool loop.
- Full transactional staging for workspace mutations is intentionally out of scope.

If read-after-write consistency is cheap during implementation, update the in-memory `workspaceFiles` array in the platform-host adapter after successful `workspace-write` / `workspace-delete`. Do not introduce a broad staging system in this task.

## Error Codes

New or newly used codes:

- `PLATFORM_ACTION_UNAVAILABLE`: executor type is supported but no platform action handler was injected.
- `PLATFORM_ACTION_FAILED`: platform handler returned `ok: false`.

Existing codes remain:

- `ACTION_EXECUTOR_INVALID`
- `ACTION_EXECUTOR_UNSUPPORTED`
- `ACTION_EXECUTOR_NOT_FOUND`
- `SKILL_ACTION_NOT_LOADED`
- `ACTION_NOT_FOUND`
- `ACTION_INPUT_INVALID`

## Compatibility

No backward compatibility or migration is required.

Existing Skill actions without an executor still use `builtin/validation`.
Existing `builtin/echo` behavior must remain unchanged.

## Trade-Offs

- Capability injection keeps runtime modular and follows current platform-web specs.
- Reusing `PlatformActionRequest` / `PlatformActionResult` avoids inventing a parallel action contract.
- Allow-listing platform actions keeps `restore-checkpoint` and future broad platform operations out of Agent Runtime by default.
- Direct workspace writes keep the MVP small; transactional staging should be a separate task if needed.
