# Card-Owned Content And Save Runtime Data Model

## Goal

Replace the current full workspace-copy mental model with a foundation where Game Cards own game/content definitions and Save Instances own only runtime play data.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## User Value

- Players understand saves the same way they understand mainstream game saves: one game/card has multiple save slots, and each slot stores one playthrough's runtime state.
- Authors can edit a Game Card's Agents, Skills, schemas, rules, author docs, and frontend-facing definitions as the card itself, without wondering whether they are editing a hidden save copy.
- Existing saves can benefit from card content edits because the save references the card content instead of carrying a stale copied game definition.
- Workspace Studio, Agent/Skill Studio, package export, and diagnostics can present a clearer boundary between reusable card content and runtime save data.

## Confirmed Facts

- Current implementation stores `LocalGameCardRecord.workspaceTemplateFiles`.
- Current save creation copies all card template files into save-scoped `workspaceFiles`.
- Current Agent Runtime, registry, Skill detail, workspace tools, checkpointing, and frontend bridge queries read save-scoped workspace files.
- Current active docs describe Runtime Workspace as save-scoped and include Agent/Skill definitions inside the save workspace.
- User direction has changed: Agent/Skill/schema/rule/frontend-definition content should be Game Card content, not save data.
- Save data should include generated NPCs, dialogue/history, maps, relationships, memory, frontend view state, and other runtime system state.
- Game Card edits should affect existing saves for that card, with later compatibility affordances such as duplicate/pin/version if needed.
- User-facing save management should feel like mainstream game saves: one larger save directory under a Game Card contains multiple save-slot files/directories, and each slot represents one playthrough's runtime data.

## Requirements

- Treat Game Card as the owner of definition/content files:
  - `agents/*`;
  - `skills/*`;
  - schemas and rules;
  - author docs and canonical setup;
  - frontend-facing definitions;
  - manifest, cover, assistant metadata, and frontend binding.
- Treat Save Instance as the owner of runtime play data:
  - dialogue/history;
  - generated NPCs and entities;
  - map/relationship/state/memory data;
  - frontend view state;
  - checkpointable runtime state.
- Model saves like a larger save directory containing multiple save slots/files/directories, where each slot is one playthrough.
- Present the selected Save Instance runtime data at a stable `save/` root in the effective workspace. The broader multi-slot view can use `saves/<save-id>/...` in Workspace Studio and storage-management UI, but runtime Agents/Skills/frontends should not need to know sibling save ids.
- Reserve `save/` for active save runtime data in effective workspaces; Game Card content must not define card-owned files under `save/`.
- Build or design an effective workspace layer that combines card content with the selected save's runtime data for runtime reads, bridge queries, Agent registry, Skill registry, and Skill detail.
- Ensure card content edits affect existing saves for that card.
- Ensure package export exports reusable Game Card content and packaged frontend assets, not runtime save slots unless a future explicit save-export flow is introduced.
- Preserve platform-only `.tsian/*` metadata rules.
- Keep gameplay semantics generic; platform should not understand NPC/map/relationship schemas beyond file boundaries and validation rules.

## Acceptance Criteria

- [ ] Planning identifies current code/docs/specs that assume save-scoped full workspace copies.
- [ ] Design defines card-owned content storage and save-owned runtime data storage.
- [ ] Design defines how effective workspace reads combine card content and active save data.
- [ ] Design defines how Agent/Skill registry/detail/context should read card content plus active save data.
- [ ] Design defines checkpoint semantics for save runtime data without accidentally checkpointing card content.
- [ ] Design defines package import/export behavior for card content vs save runtime data.
- [ ] Implementation plan lists contract, storage, platform-host, Agent Runtime, bridge, tests, and docs/spec updates.
- [ ] The chosen runtime save-data mount path is recorded before implementation starts.
- [ ] `design.md` and `implement.md` exist before `task.py start`.

## Out Of Scope

- Account system, cloud sync, workshop publishing, or cross-device save transfer.
- Rich schema-specific editors for NPCs, maps, relationships, or other gameplay data.
- A compatibility migration for historical user data unless explicitly requested; prototype IndexedDB reset remains acceptable by current policy.
- Card version pinning or save upgrade UI beyond recording the need as a follow-up.

## Open Questions

- None for planning.

## Resolved Questions

- User-facing save management uses a larger `saves/` directory with multiple save-slot files/directories, one per playthrough.
- Runtime-facing effective workspaces expose only the selected slot at the stable `save/` mount path.
- User approved this task as the first implementation slice before deep Game Card detail, Workspace Studio, or Agent/Skill Studio.
