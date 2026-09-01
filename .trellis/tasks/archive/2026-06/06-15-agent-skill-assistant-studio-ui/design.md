# Agent Skill And Assistant Studio UI Design

## Architecture

This task adds a lightweight Studio surface for the currently loaded Game Card. It should feel like a player-readable inventory of the card's roles and abilities, not a registry debugger or code IDE.

The implementation has three boundaries:

1. **Current Game Card context**
   - Add a single active Game Card id in platform-local metadata.
   - Keep active Save Instance as a separate runtime/play state.
   - Loading or opening a Game Card may set the active Game Card.
   - Selecting or creating a save should also set the active Game Card to the save's card.

2. **Agent/Skill query adapter**
   - Existing `agent-registry`, `agent-context`, `skill-registry`, and `skill-detail` resources are active-save based.
   - Add platform UI helpers that can read a Game Card's card-owned content directly.
   - When a selected/current save exists for that card, Agent context may use the effective workspace so save runtime files can fill notes/session/context paths.
   - When no save exists, registry views still work from card content alone and context views show missing runtime paths gracefully.

3. **Studio UI**
   - Add a desktop app/window route for Studio.
   - Default target is the currently loaded Game Card, not an in-app card picker.
   - Use simple overview/list/detail composition:
     - top area: card name, assistant availability, count of roles/abilities
     - roles section: Agent entries with title, short summary, ability count
     - abilities section: Skill entries with title, short summary, simple scope hint
     - detail panel/drawer: selected role or ability details, with resource links
   - Editing should link to Workspace Explorer/Editor instead of embedding an editor.

## Data Flow

```
Game Card Loader / Detail
  -> set active Game Card id
  -> optionally set active Save id

Studio route
  -> wait for platform host
  -> get active Game Card
  -> list card content files
  -> build Agent registry and Skill registry
  -> if active save belongs to active card:
       load effective workspace for Agent context / Skill detail
     else:
       use card-owned content only
```

## Contracts

- No contract shape change is expected.
- Reuse existing `AgentRegistryEntry`, `AgentContextEntry`, `SkillRegistryEntry`, and `SkillDetailEntry`.
- Add platform-host exported helpers for UI use if existing bridge query resources remain active-save oriented.
- Do not expose raw Skill bodies in list views.

## Compatibility

- Existing active-save behavior should continue to work for runtime/play.
- Play frontend resolution should use the currently loaded Game Card when present.
- Runtime workspace operations tied to an active save must not accidentally combine an active save with an unrelated active Game Card. Effective runtime workspace helpers should resolve the save's own card when the operation is save-scoped.
- If no active Game Card is set, fall back to the current active save's card or built-in blank card during initialization.

## Trade-Offs

- A separate active Game Card id adds a small state concept, but it matches the chosen product model and avoids per-app card pickers.
- The first Studio UI intentionally hides many technical fields. Advanced users can open files through Workspace Explorer/Editor.
- Full Assistant chat is deferred so this task remains focused and testable.

## Rollback

- The active Game Card metadata is stored in local platform metadata and can be ignored or cleared without data loss.
- The Studio route/window can be removed without changing Game Card package format or Runtime Workspace data.
