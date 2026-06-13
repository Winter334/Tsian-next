# Design

## Architecture

The MVP extends the existing runtime action path:

```text
skill_load
  -> parse tsian-actions declarations
  -> register actions in current Agent tool-loop state

action_call
  -> validate Skill was loaded
  -> validate action exists
  -> validate input schema
  -> resolve executor
  -> invoke executor
  -> return structured observation
```

The implementation remains in `apps/platform-web/src/agent-runtime/workspace-tools.ts` and is called by the existing tool loop in `apps/platform-web/src/agent-runtime/index.ts`.

No storage, bridge, Dexie, platform-host, or remote execution dependency should be introduced.

## Executor Reference

Action declarations may include:

```json
{
  "executor": {
    "type": "builtin",
    "name": "echo"
  }
}
```

Rules:

- Missing `executor` means `{ "type": "builtin", "name": "validation" }`.
- `executor.type` must be a non-empty string when present.
- Built-in executor `name` defaults to `validation`.
- Unsupported `type` remains parseable but fails during `action_call` with `ACTION_EXECUTOR_UNSUPPORTED`.
- Unknown built-in `name` fails during `action_call` with `ACTION_EXECUTOR_NOT_FOUND`.

## Built-In Executors

### validation

Purpose: keep the previous validation-only action behavior as a first-class executor.

Result:

```json
{
  "status": "validated",
  "output": null
}
```

### echo

Purpose: provide a visible, side-effect-free executor for tests and future examples.

Result:

```json
{
  "status": "executed",
  "output": {
    "text": "hello"
  }
}
```

The echo executor returns the validated action input as output.

## Observation Shape

`action_call` success should include:

```json
{
  "status": "executed",
  "skill": { "name": "example", "scope": "shared" },
  "action": { "name": "example_action", "description": "...", "hasInputSchema": true },
  "executor": { "type": "builtin", "name": "echo" },
  "input": { "text": "hello" },
  "output": { "text": "hello" }
}
```

## Error Codes

- `ACTION_EXECUTOR_INVALID`: declaration has malformed executor metadata.
- `ACTION_EXECUTOR_UNSUPPORTED`: executor type is syntactically valid but not supported by this runtime.
- `ACTION_EXECUTOR_NOT_FOUND`: built-in executor name is unknown.

Existing errors remain:

- `SKILL_ACTION_NOT_LOADED`
- `ACTION_NOT_FOUND`
- `ACTION_INPUT_INVALID`

## Trade-Offs

- Use built-in executors first to establish the registry contract without adding script or remote execution risk.
- Keep executor declarations inside `SKILL.md` action blocks instead of a separate registry file so Skill packages stay portable.
- Do not add shared contract types yet because runtime tool execution remains internal to `platform-web`.

## Follow-Up Path

Future tasks can add executor adapters:

- `platform_action`
- `browser_script`
- `remote_http`
- `wasm`
- `agent_call`
- `workspace_write` / `state_write`
