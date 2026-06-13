# Native AIRP history writeback MVP

## Goal

Make successful AIRP turns persist the player-facing exchange as durable Runtime Workspace files, so every save has a native fallback memory layer even when no custom memory Skill, memory Agent, or gameplay-specific memory system is installed.

This MVP should establish the raw AIRP conversation record as the most complete, least interpreted memory source. It can be searched and used as fallback context, while richer memory systems remain opt-in and replaceable.

## Confirmed Facts

- The current direction treats Runtime Workspace as the save-scoped data container for Agent definitions, Skill definitions, history, world data, memory, frontend data, archive material, and platform metadata.
- Successful turns already persist hidden platform trace files under `.tsian/traces/turns/*.jsonl` before checkpoint creation.
- New saves already include durable workspace entry points such as `history/timeline.md`, `memory/summaries/*`, and `agents/*/session.jsonl`, but none of these should imply a full native memory system in this task.
- The platform host already holds an in-memory `workspaceFiles` array for the active turn and syncs it when `workspace-write` / `workspace-delete` platform actions succeed.
- Checkpoints include workspace files, so writebacks performed before checkpoint creation should follow restore/rollback naturally.
- `agent_call`, `skill_load`, and gated `action_call` are available in the runtime tool loop.
- Default workspace currently has no shared `skills/*/SKILL.md` files.
- Formal test infrastructure is not currently present; recent runtime work used build checks and focused one-off SSR probes.

## Requirements

- Persist clean player/assistant conversation history into a normal workspace file for successful turns.
- Treat the raw player-facing exchange as the native fallback memory record.
- Provide basic retrieval over the raw record through existing workspace search/read/list capabilities or similarly minimal primitives.
- Store raw history in a shape that can be searched and read at turn granularity.
- Allow future manual correction by editing the stored turn record directly, instead of introducing a separate amendments/revision layer in this MVP.
- Keep `.tsian/traces/` as platform debug material, not the source of ordinary gameplay memory.
- Do not hard-code a gameplay-specific memory, event, archive, quest, relationship, or frontend rendering schema into the platform.
- Do not introduce automatic summarization as part of this MVP.
- Do not introduce Agent-authored memory maintenance as part of this MVP.
- Successful raw history writebacks must happen before the after-turn checkpoint is created.
- Failed or aborted turns must not write ordinary durable workspace history or summaries.

## Non-Goals

- No real browser script executor, remote executor, WASM executor, or hosted execution environment.
- No semantic memory retrieval system, vector index, memory ranking, or recall policy.
- No automatic timeline/current-summary maintenance.
- No Agent session/notes automatic writeback.
- No `agent_call` recursion, collaboration UI, or budget UI.
- No workspace browser/editor UI.
- No separate amendment, revision, or edit overlay system for raw history.
- No migration of `stateRecords` into workspace files in this task.
- No coverage-driven test suite rollout.

## Scope Decision

- Use a platform-owned deterministic writeback for the raw AIRP conversation record.
- Do not include Agent/Skill-authored semantic summary writeback in this MVP.
- Position the raw record as a native fallback memory layer, not as the full memory system.
- Treat the raw record as authoritative and reliable, not as a low-quality or obsolete memory approach.
- Native fallback memory can grow stronger through generic retrieval and rebuildable derived indexes, as long as the platform does not decide gameplay-specific memory semantics.
- More powerful memory behavior should be supplied by player/developer-designed Skills, Agents, or workspace conventions.
- Prefer direct manual editing of raw turn records later over a separate amendment layer; checkpoint/restore and trace provide enough recovery support for the MVP era.

## Future Memory Direction

- AIRP memory is different from ordinary chat memory. The player-facing assistant output is story text, and the story text implies a changing world, not just a conversational transcript.
- The raw AIRP history should remain the complete source record, while enhanced AIRP memory should process final narrative output into retrievable and updatable Runtime Workspace structures.
- Enhanced memory may maintain world facts, character state, background information, relationships, locations, timelines, rules, or other content-specific projections.
- These projections should live in the virtual workspace as files/directories that Agents can read and update during later story creation.
- The platform should provide reliable storage, search, checkpoint, trace, and execution boundaries, but should not hard-code one universal AIRP memory schema.
- Derived memory structures should be treated as rebuildable or correctable projections over the raw history and workspace state, not as a replacement for the raw source record.

## Acceptance Criteria

- [ ] After a successful turn, ordinary workspace files contain a durable raw record of the player's input and final narrative output at turn granularity.
- [ ] The raw record includes enough metadata to support basic retrieval and debugging without storing model prompts, tool traces, or hidden intermediate Agent outputs.
- [ ] The raw record can be accessed through normal workspace read/list/search paths.
- [ ] Basic retrieval can find and read matching individual turns rather than only a monolithic all-history file.
- [ ] The writeback path is generic Runtime Workspace behavior and does not require platform knowledge of gameplay-specific schemas.
- [ ] Failed or aborted turns do not append raw history records.
- [ ] The after-turn checkpoint captures the written workspace files, and restore should naturally restore them with the rest of the workspace.
- [ ] `npm run build:web` passes.
- [ ] A focused one-off runtime probe or manual verification demonstrates the writeback loop without adding a large permanent test suite.

## Proposed Storage Shape

- `history/turns/turn-000001.json` style per-turn JSON files.
- Each file should contain schema/version metadata, turn number, timestamps, player input, final assistant output, and minimal source metadata.
- One file per turn keeps the raw record easy to search, inspect, checkpoint, restore, and later manually edit.
