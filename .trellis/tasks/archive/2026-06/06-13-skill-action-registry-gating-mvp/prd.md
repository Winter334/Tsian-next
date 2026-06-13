# Skill Action Registry Gating MVP

## Goal

Let a loaded Skill unlock its declared actions for the current Agent turn, so Skill moves from prompt-only guidance toward a controlled capability package.

## User Value

- Authors can package capability guidance and action contracts together in `SKILL.md`.
- Agents only see Skill summaries by default, load Skill details on demand, and can call actions only after loading the relevant Skill.
- The platform gains a stable action gating boundary before browser scripts, remote scripts, platform actions, state writes, or `agent_call` execution are added.

## Confirmed Facts

- Runtime tool names use `snake_case`: `skill_load`, `workspace_read`, `workspace_list`, `workspace_search`.
- `skill_load(name)` resolves only against the active Agent's visible Skill Index and loads the selected `SKILL.md` content.
- `skill_load` does not return resource indexes or read Skill resource files by default.
- Workspace file tools remain read-only and are used as the third layer after `SKILL.md` chain references.
- Current runtime tool calls are textual `<tsian-tool-call>` blocks, not native provider tool calls.
- Normal Agent output remains a soft protocol; hard validation is appropriate at tool/action boundaries.

## Requirements

- Add a new runtime tool named `action_call`.
- Allow a `SKILL.md` file to declare actions in a structured fenced JSON block in the Skill entry body.
- When `skill_load` succeeds, parse the loaded `SKILL.md` for action declarations and remember them for the same Agent's current tool loop.
- `action_call` must require `{ skill, action, input }`.
- `action_call` must only succeed when the requested Skill has already been loaded by the same Agent in the current turn step.
- `action_call` must only allow actions declared by that loaded Skill.
- MVP execution is validation-only: do not run scripts, mutate workspace, call remote endpoints, or invoke platform actions.
- `action_call` success must return a structured observation describing the validated action request and an execution status such as `validated`.
- Validate action input against a small JSON-schema-like subset when an action declares `inputSchema`.
- Keep all runtime execution pure inside `apps/platform-web/src/agent-runtime`; do not import Dexie, storage helpers, bridge objects, or `platform-host`.
- Update direction docs and Trellis specs so future work follows the same action-gating contract.

## Action Declaration MVP Format

Actions are declared in `SKILL.md` body with a fenced JSON block:

````md
## Actions

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
    }
  }
]
```
````

## Acceptance Criteria

- [x] Runtime prompts list `action_call` with the new calling convention.
- [x] A model can `skill_load` a Skill and then call a declared action with `action_call`.
- [x] An action call before loading the Skill returns a structured observation error.
- [x] An unknown action on a loaded Skill returns a structured observation error.
- [x] Invalid action input returns a structured observation error.
- [x] Successful MVP action calls do not execute external code and do not mutate workspace/state.
- [x] Final `replyText` strips tool-call blocks and does not expose observations to players.
- [x] `npm run build:web` passes.

## Validation Notes

- `npm run build:web`
- `git diff --check`
- In-memory runtime probe for valid `skill_load` -> `action_call`, pre-load action rejection, unknown action rejection, schema-invalid input rejection, and final-output tool block stripping.

## Out Of Scope

- Browser script execution.
- Remote script loading or remote execution.
- Platform action executor registry.
- Workspace/state write actions.
- Persistent trace UI or debug persistence.
- Native provider tool calling.
