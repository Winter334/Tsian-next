# Workspace Assistant Agent Template Design

## Architecture And Boundaries

The workspace assistant is game-card/workspace content, not a hidden platform persona. The built-in blank game card points its `manifest.assistant.agentId` to `studio-assistant`, and the default workspace template includes that Agent under `agents/studio-assistant/`.

The assistant is deliberately ordinary content:

- `agents/studio-assistant/AGENT.md` defines the assistant role and references normal workspace context paths.
- `agents/studio-assistant/notes.md` starts empty and may be edited by authors or future assistant flows.
- `agents/studio-assistant/session.jsonl` exists as the assistant transcript placeholder, matching the Agent directory convention.
- `agents/studio-assistant/skills/framework-knowledge/SKILL.md` is an Agent-local Skill so the assistant can load detailed guidance only when needed.
- `docs/tsian-framework-knowledge.md` is the temporary official knowledge base document copied into each blank workspace.

The platform only seeds these files and exposes the existing Agent/Skill registry behavior. It does not grant the assistant special write powers or account/workshop capabilities.

## Data Flow

New blank game card creation uses `createDefaultWorkspaceTemplateFiles()`. The helper returns the default workspace template files that are stored on the built-in blank game card. Creating a save instance from that card copies these template files into the save-scoped Runtime Workspace.

Existing saves use `initializeWorkspaceForSave()` upgrade logic. The workspace version is bumped and the new assistant/knowledge files are added only if missing. Existing user-authored files are not overwritten.

The built-in blank card manifest stores:

```json
{
  "assistant": {
    "agentId": "studio-assistant"
  }
}
```

Future UI can resolve the active assistant from the active game card/save metadata, but this task does not build that UI.

## Skill Behavior

The framework knowledge Skill is query-oriented. It instructs the assistant to:

- load the Skill only for framework/workspace/diagnostics/authoring questions;
- read or search `docs/tsian-framework-knowledge.md` first;
- inspect relevant workspace files such as `README.md`, `agents/README.md`, `skills/README.md`, `state/README.md`, and `frontend/README.md` when the answer depends on local conventions;
- answer from cited workspace facts and state uncertainty when the knowledge base is incomplete.

The Skill does not introduce a new action or executor. It relies on existing runtime primitives such as workspace read/search/list and future assistant UI tooling.

## Deferred Content Layer

A polished first-launch flow is intentionally out of scope. The likely future shape is: collect world/theme/settings from the player, keep official default Agents/Skills/state contracts/frontends, and write those settings into workspace files. That needs repeated content and UX iteration, so this task only creates the assistant and knowledge substrate.

## Compatibility

The existing master/narrative/memory runtime path should continue working because those Agent definitions remain present and unchanged unless a future game card chooses otherwise. Adding `studio-assistant` to the registry should not change the current default AIRP turn entrypoint.

## Rollback

Rollback is straightforward:

- remove the new default workspace files from `DEFAULT_WORKSPACE_FILES`;
- remove them from the workspace upgrade set;
- point the built-in blank card assistant metadata back to the previous entry if needed;
- decrement or supersede the workspace version according to the normal migration policy.
