# Agent-Centered Studio Management UI

## Goal

Redesign Studio around configuring one Agent at a time, and land the first real Agent structure split by introducing `SOUL.md` plus simple Skill enable/disable management.

## User Value

- Players and authors enter Studio by choosing an Agent, then manage that Agent's definition, soul, Skills, tools, and permissions from one focused surface.
- Agent identity/work style moves out of the overloaded MVP-era `AGENT.md` body into a real `SOUL.md` file.
- Skill management becomes an enable/disable workflow rather than a browse-only registry.
- File names and paths shown in UI stay literal; real workspace files should not receive player-facing aliases that differ from their actual names.

## Confirmed Facts

- `SOUL.md` should be introduced in this task as a real workspace file, not only as a UI concept.
- `notes.md` remains available for future Agent-written sediment, but it should not become a primary player editing surface in this task.
- No generic `MEMORY.md` should be introduced for all Agents.
- Official/global Skills stay under `skills/<skill>/`.
- Future imported or Agent-created non-official Skills should live under `agents/<agent>/skills/<skill>/`.
- Studio should recognize all valid Skill files that follow the existing `SKILL.md` convention, whether global or Agent-local.
- The targeted player-to-Agent adjustment mechanism is future experience work and is out of scope.
- Skill assignment UI should be simple enable/disable, not a complex authoring workflow.
- Real tool and permission runtime enforcement is deferred to a follow-up task; this task must not add editable controls that imply unavailable behavior.

## Requirements

- Replace the current two-list Studio UX with an Agent-centered management view:
  - Agent list/selector remains the primary navigation.
  - Selecting an Agent shows focused sections for the selected Agent.
- Add real `agents/<agent>/SOUL.md` files for default Agents.
- Runtime Agent context should include the selected Agent's `SOUL.md` when present.
- Keep `AGENT.md` as the metadata/entry file for Agent identity, routing, contacts, context paths, and runtime discovery.
- Keep file labels literal in the UI, such as `AGENT.md`, `SOUL.md`, `notes.md`, and `SKILL.md`.
- Studio should allow editing `AGENT.md` and `SOUL.md` for the selected Agent.
- Studio should list all recognizable Skills and show whether each is enabled for the selected Agent.
- Studio should let the user enable or disable a Skill for the selected Agent without moving the Skill file.
- Disabled Skills must not appear in that Agent's runtime-visible Skill index.
- Existing Game Cards without `SOUL.md` must still open and run.
- Existing Skill files and old `defaultSkills`/`appliesTo` metadata must not break loading.
- Avoid adding the future player directive/旁路指令 mechanism.

## Acceptance Criteria

- [x] Studio opens as an Agent-centered management surface.
- [x] Selecting an Agent exposes literal file sections for `AGENT.md` and `SOUL.md`.
- [x] Default built-in Agents include `SOUL.md` files.
- [x] Agent Runtime includes `SOUL.md` content for an Agent when the file exists.
- [x] Studio lists global and Agent-local Skills in one management section for the selected Agent.
- [x] Skill enable/disable updates persistent card content and refreshes the selected Agent view.
- [x] A disabled Skill is not available through `agent-context.skillIndex` for that Agent.
- [x] Existing cards without `SOUL.md` or explicit Skill enable state remain usable.
- [x] The web build passes.
- [x] Contract/spec updates capture the new Agent file and Skill enablement behavior.

## Out Of Scope

- Generic `MEMORY.md` for every Agent.
- Player directive / side-channel adjustment syntax or frontend API.
- Tool availability and permission runtime enforcement.
- Non-functional tool/permission UI controls.
- Moving all Skills into one directory.
- Importing external Skill packages.
- Building full Skill authoring/creation flows.
- Multi-card loading or simultaneous active cards.
