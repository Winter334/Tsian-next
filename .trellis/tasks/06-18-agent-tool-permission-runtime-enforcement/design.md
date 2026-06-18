# Design: Agent Tool Permission Runtime Enforcement

## Scope

This task does two tightly-coupled things:

1. Replace Agent frontmatter configuration with `agents/<agent>/agent.json`.
2. Add real per-Agent controls for platform-provided runtime tools and workspace permissions.

Skill loading and Skill action execution remain default-allowed in this slice because players choose which Skills to install or create.

The design must preserve the previous Studio rule: do not expose editable controls unless Agent Runtime actually enforces them.

## Current Behavior

- Agent discovery currently depends on `agents/<agent>/AGENT.md`.
- Agent registry parses simple frontmatter scalars and lists from `AGENT.md`.
- `AGENT.md` currently mixes machine-readable config with Agent prompt/instruction prose.
- Studio manages Agent selection and Skill enablement by writing frontmatter list fields.
- Runtime prompt instructions always describe `skill_load`, `action_call`, optional `agent_call`, and generic workspace read/list/search examples.
- Generic workspace operations are gated by:
  - exposed operation list;
  - Agent actor level from `workspaceAccess.level`, defaulting to `1`.
- Runtime capabilities already support host-injected `actionExecutorPolicy`, `exposedWorkspaceOperations`, and `workspaceMutations`.
- Platform-host does not yet derive those capabilities from per-Agent configuration.
- Skill `workspace_operation` executors currently add their declared operation to the exposed operation list for that action path, so Agent-level tool disablement needs an additional hard gate if write access can be disabled.

## Target File Layout

New Agent directories use:

```text
agents/<agent>/
  agent.json
  AGENT.md
  SOUL.md
  skills/
```

Responsibilities:

- `agent.json`: canonical machine-readable Agent configuration for Studio and Runtime.
- `AGENT.md`: required Agent SOP/instruction file, including role, responsibilities, collaboration style, and prompt-facing procedures.
- `SOUL.md`: durable identity, work style, and expression preferences.
- `skills/`: Agent-local Skills.

Prototype-stage breaking change:

- Do not keep old `AGENT.md` frontmatter compatibility.
- Default card content should be rewritten to the new layout.
- Old cards without `agent.json` may fail Agent discovery until updated.
- Agents without `AGENT.md` are invalid; `agent.json` does not contain SOP/prompt prose.

## Agent JSON Model

Recommended MVP shape:

```json
{
  "id": "master",
  "title": "Master Agent",
  "summary": "Coordinates the AIRP turn.",
  "contacts": ["narrative", "memory"],
  "contextPaths": ["world/canon.md"],
  "skills": {
    "enabled": ["memory-maintenance"],
    "disabled": []
  },
  "platformTools": {
    "enabled": ["agent_call", "workspace_read", "workspace_write"],
    "disabled": []
  },
  "workspaceAccess": {
    "level": 1
  }
}
```

Notes:

- Use JSON, not JSONC, for predictable parsing and export/import behavior.
- Keep Skill enablement in `agent.json`; the existing Studio Skills UI becomes a JSON config editor through platform-host helpers.
- Keep platform tool groups in `agent.json`.
- Keep `workspaceAccess.level` in `agent.json`.
- Unknown fields may be preserved by read/modify/write helpers when practical, but Runtime only depends on known fields.

## Player-Facing Tool Groups

MVP controls platform-provided capabilities:

- `agent_call`: whether this Agent may ask contacted Agents for help.
- `workspace_read`: whether this Agent may use generic workspace list/search/read tools.
- `workspace_write`: whether this Agent may use platform workspace mutation capabilities such as diff/patch/write/move/delete/validate.

Skill entry points stay available by default:

- `skill_load`
- `action_call`

Skill enablement remains controlled by the existing Skills UI. A disabled Skill cannot be loaded, and an action still requires the Skill to be loaded during the same tool loop.

## Workspace Authority

Workspace authority continues to use the existing level model, but the source moves from `AGENT.md` frontmatter to `agent.json`.

Level meaning comes from the current workspace operation gates:

- `0`: read-only card/save content.
- `1`: can edit save-runtime content.
- `2`: can edit card-content if host mutation policy allows it.
- `4`: platform-meta authority.

The Studio UI should present this as simple permission levels, not as raw security jargon.

## Runtime Capability Derivation

Add pure helpers that derive an effective permission profile from `AgentRegistryEntry` plus optional runtime defaults:

```ts
interface AgentPlatformToolPermissions {
  enabledTools: Set<AgentPlatformToolName>
  workspaceActorLevel: number
  exposedWorkspaceOperations: WorkspaceOperationName[]
  actionExecutorPolicy: RuntimeActionExecutorPolicy
}
```

The helper should be usable by:

- platform-host root Agent steps;
- delegated `agent_call` target Agent steps;
- tests without platform-host imports.

## Runtime Enforcement

Runtime needs two layers:

1. Prompt shaping:
   - `buildWorkspaceToolInstructions` should only mention platform tool categories available to the current Agent.
   - Disabled `agent_call` should be omitted even if contacts exist.
   - Disabled workspace read/write categories should be omitted.

2. Hard execution gates:
   - `agent_call` must fail with a structured tool error when disabled.
   - Generic `workspace.*` calls must fail when their operation group is disabled.
   - Workspace operation execution must still run the existing exposed-operation and actor-level gates.
   - Skill action execution remains allowed, but platform-side effects inside Skill actions must not become a bypass for Agent workspace permissions.

## Studio UI

Add a Tools/Permissions section to the selected Agent detail area.

Suggested player-facing controls:

- Agent collaboration: toggle for asking contacted Agents.
- Workspace reading: toggle for reading/listing/searching workspace context.
- Workspace changes: toggle for allowing workspace changes.
- Workspace authority level: compact segmented control or select with plain descriptions.

Avoid per-executor names such as `browser_script`, `platform_action`, or `workspace_operation` as primary UI labels in the MVP. These can remain implementation details or future advanced controls.

Agent creation should write `agent.json`, `AGENT.md`, and `SOUL.md` together so players are not asked to manually assemble the layout.

## Data Flow

Read:

1. Studio snapshot loads effective card/save workspace files.
2. Registry discovers Agents from `agents/<agent>/agent.json`.
3. Registry requires and attaches `AGENT.md` and optional `SOUL.md` as prompt files.
4. Studio displays effective Skill and platform tool toggles for the selected Agent.
5. Runtime host derives per-Agent capability profile immediately before each Agent step.

Write:

1. Studio Skill/tool/permission toggles update selected Agent `agent.json`.
2. Writes preserve unrelated JSON fields when practical.
3. Snapshot reloads after mutation.

Runtime:

1. Root turn starts with effective workspace files.
2. Master/narrative context assembly selects Agent by `agent.json` id/path.
3. Runtime derives permissions from the selected Agent.
4. Tool prompt and execution use the selected Agent's permissions.
5. Delegated `agent_call` repeats derivation for the target Agent.

## Design Decisions

- Skill action side effects obey the selected Agent's platform workspace permissions. This keeps `workspace_write` meaningful while still allowing `skill_load` and `action_call` by default.

## Risks

- This is a breaking workspace contract change; default card content and specs/docs must be updated together.
- Agent discovery path changes from `AGENT.md` to `agent.json`, so any hardcoded diagnostics or path helpers need review.
- Cards that rely on Skill workspace actions need intentional workspace permissions in `agent.json`.
- If direct generic workspace write tools are advertised too broadly, Agents may mutate save-runtime more often than intended.
- `browser_script` Skills may expose SDK workspace methods; these paths must use the same effective Agent workspace permissions.

## Rollback

- Restore Agent discovery from `AGENT.md`.
- Remove `agent.json` parsing and Studio writes.
- Remove Studio tool/permission controls.
- Restore fixed runtime tool instructions and prior capability injection.
