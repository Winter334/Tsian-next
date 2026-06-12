# Runtime Workspace Storage/API MVP

## Goal

Introduce the first save-scoped Runtime Workspace storage and API layer so Tsian saves can carry file-like runtime data alongside the current snapshot/history/checkpoint/stateRecords model.

This is the foundation for later `AGENT.md`, `SKILL.md`, progressive skill loading, context sharing, workspace UI, and migration of runtime state into files.

## Confirmed Facts

- Current platform implementation is the Agent Runtime MVP in `apps/platform-web`.
- Local persistence currently uses Dexie tables for `meta`, `saves`, `saveSnapshots`, `saveHistory`, `checkpoints`, and `stateRecords`.
- Current bridge exposes query resources such as `history`, `checkpoints`, `state-records`, and `ai-debug`, plus platform actions such as `restore-checkpoint`.
- Checkpoint restore currently rolls back snapshot, history, and state records only.
- Direction docs define Runtime Workspace as a save-scoped virtual filesystem containing agent definitions, skills, history, world data, memory, frontend data, archive, and `.tsian` metadata.
- The first implementation must not reintroduce workflow/prompt-engine/event-archive platform semantics.

## Requirements

- Add a save-scoped workspace file model in local browser persistence.
- Support file-like paths with a stable root-relative convention, including hidden `.tsian/` paths.
- Support minimum file operations:
  - list children under a directory path;
  - read one file by path;
  - write or replace one file by path;
  - delete one file or directory subtree;
  - search files by path/content text.
- Initialize default workspace files/directories for new saves so a new AIRP session has a recognizable workspace structure.
- Expose the storage layer through the existing frontend bridge shape, using framework-neutral query/action payloads.
- Include workspace files in checkpoint creation and checkpoint restore so rollbacks preserve workspace state.
- Keep existing snapshot/history/stateRecords behavior working during the transition.
- Keep hard validation at workspace action boundaries: non-empty normalized path, valid text content, known action name, active save required.

## Resolved Decisions

- This MVP will not include a workspace viewer/editor UI. It stops at storage, bridge API, and checkpoint integration.

## Acceptance Criteria

- [x] Creating a new save creates a default Runtime Workspace with root `README.md` plus the agreed top-level directories represented by README/placeholder files.
- [x] Bridge queries can list workspace entries, read a workspace file, and search workspace files for the active save.
- [x] Bridge platform actions can write and delete workspace paths for the active save with invalid inputs rejected by structured platform action errors.
- [x] Deleting a save deletes its workspace records.
- [x] Creating and restoring a checkpoint preserves workspace files together with snapshot/history/stateRecords.
- [x] Existing `history`, `checkpoints`, `state-records`, AI debug, message sending, save selection, and checkpoint restore continue to work.
- [x] Contract changes build with `npm run build:contracts`.
- [x] Platform web changes build with `npm run build:web`.

## Verification

- `npm run build:contracts`
- `npm run build:web`

## Out Of Scope

- Parsing or executing `AGENT.md` / `SKILL.md`.
- Skill index generation or progressive skill loading.
- `agent.call` and action executor registry.
- Migration of existing `stateRecords` into workspace files.
- A full workspace file explorer/editor UI.
- DebugView workspace viewer/editor changes.
- Import/export format for workspace archives.
- Remote scripts, browser scripts, WASM, or hosted execution.
