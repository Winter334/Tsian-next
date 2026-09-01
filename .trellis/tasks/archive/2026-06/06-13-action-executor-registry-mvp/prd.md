# Action Executor Registry MVP

## Goal

Introduce an explicit action executor registry behind `action_call`, so Skill actions can be routed to a concrete executor after loaded-Skill gating and input validation.

## User Value

- Tsian gets the Web/platform equivalent of mainstream Agent frameworks' implicit `bash` / `python` / `node` executor layer.
- Skill authors can describe a business action separately from how the platform executes it.
- Future browser script, remote execution, platform action, state write, and `agent_call` executors can attach to the same boundary.

## Confirmed Facts

- `skill_load` parses `tsian-actions` fenced JSON blocks from loaded `SKILL.md`.
- `action_call` already validates that the Skill was loaded by the same Agent and that the requested action exists.
- `action_call` currently validates input only and does not execute anything.
- Runtime tool execution must stay pure inside `apps/platform-web/src/agent-runtime`; do not import Dexie, bridge objects, storage helpers, or `platform-host`.
- The project is in prototype stage, so no migration or old-format compatibility is required.

## Requirements

- Extend Skill action declarations with an optional executor reference.
- Add an action executor registry in `apps/platform-web/src/agent-runtime/workspace-tools.ts`.
- `action_call` must validate loaded Skill gating, declared action existence, and input schema before invoking an executor.
- Add a built-in `validation` executor for validation-only actions.
- Add a built-in `echo` executor that returns the validated input as structured output.
- Missing executor declarations must use built-in `validation`.
- Unsupported executor types must fail with a structured observation error.
- Unknown built-in executor names must fail with a structured observation error.
- Executor execution must be side-effect free in this MVP.
- Runtime prompts, direction docs, and Trellis specs must document executor declaration and MVP limits.

## Action Declaration MVP Format

````md
```json tsian-actions
[
  {
    "name": "example_action",
    "description": "Validate and echo a payload.",
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
  }
]
```
````

Executor MVP fields:

- `type`: required when `executor` is present; MVP supports only `"builtin"`.
- `name`: optional for `"builtin"`; defaults to `"validation"`.
- Future executor types may add their own config fields later.

## Acceptance Criteria

- [x] `skill_load` exposes action metadata including executor metadata without exposing executor internals beyond the declaration.
- [x] `action_call` invokes the built-in `validation` executor when an action has no executor.
- [x] `action_call` invokes the built-in `echo` executor and returns structured output.
- [x] Unsupported executor types return a structured observation error.
- [x] Unknown built-in executor names return a structured observation error.
- [x] Input schema validation still happens before executor invocation.
- [x] Built-in executors do not mutate workspace/state, call remote resources, or run scripts.
- [x] `npm run build:web` passes.

## Validation Notes

- `npm run build:web`
- `git diff --check`
- In-memory runtime probe for default `validation`, built-in `echo`, unsupported executor type, unknown built-in executor, and invalid input before executor execution.

## Out Of Scope

- Browser JavaScript execution.
- Remote script loading or remote HTTP execution.
- Platform action executor.
- Workspace/state write executors.
- Persistent trace storage.
- UI for browsing executor results.
