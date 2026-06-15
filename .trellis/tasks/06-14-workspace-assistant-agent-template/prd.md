# Workspace Assistant Agent Template

## Goal

Provide an official workspace assistant Agent template that is copied into new game cards/workspaces and then becomes ordinary customizable workspace content.

## Parent

- `.trellis/tasks/06-14-remote-game-frontend-foundation`

## Requirements

- Add a default assistant Agent, tentatively `agents/studio-assistant/AGENT.md`.
- Include assistant `notes.md` and `session.jsonl`.
- The assistant should be represented in the game card/workspace template, not as a hidden platform-only persona.
- The game card manifest or workspace convention should identify the assistant Agent entry.
- The assistant should have framework-aware context so it can help players/authors manage workspace content, Agent/Skill definitions, state models, frontend data conventions, and diagnostics through platform-controlled future UI/tools with less hallucination.
- Add a temporary official framework knowledge base document as ordinary workspace content. It should be maintained by the project and can later evolve into public project documentation for authors, players, and community developers.
- Add a query-oriented assistant Skill that tells the assistant how to inspect the official knowledge base and relevant workspace files before answering framework questions.
- The first version may be lightweight and temporary; structure and boundaries matter more than final polished content.
- Do not implement the final assistant chat UI in this child.
- Do not grant special platform powers beyond existing/future explicit bridge/tool boundaries.
- Do not implement a full first-launch world creation flow in this child. The eventual flow should mostly collect world/theme settings while using official default Agents, Skills, state contracts, and default frontend content, but it needs later content-design iteration.

## Acceptance Criteria

- [x] New blank game card/workspace templates include assistant Agent files.
- [x] Assistant entry is discoverable from manifest or workspace convention.
- [x] The assistant appears as ordinary Agent registry/workspace content.
- [x] Game authors can edit/replace assistant files like any other workspace files.
- [x] New blank game card/workspace templates include a framework knowledge base document as ordinary workspace content.
- [x] New blank game card/workspace templates include an assistant Skill for consulting the framework knowledge base before answering.
- [x] Docs/specs state that the active assistant is workspace content, not a hidden platform persona.
- [x] Docs/specs state that first-launch world creation and polished default frontend/content are deferred content-layer work.
- [x] Existing Agent Runtime behavior remains stable for master/narrative/memory.
- [x] Builds pass for affected packages.

## Dependencies

- Can be implemented with or after `06-14-game-card-library-save-model`.

## Out Of Scope

- Assistant chat UI.
- Polished first-launch onboarding/world creation flow.
- New Skills generated during first launch.
- Official default game frontend content beyond any existing built-in fallback.
- Autonomous assistant edits without user confirmation.
- Special account/workshop support behavior.
- Hidden built-in platform assistant persona.
