# Card-Owned Content And Save Runtime Data Model Implementation Plan

## Pre-Start Checklist

1. Active save runtime-data mount path is resolved: runtime effective workspaces expose selected save data at `save/...`; broader management UI may show all slots under `saves/<save-id>/...`.
2. Run `trellis-before-dev` for `apps/platform-web`, `packages/contracts`, and active docs/spec updates.
3. Update active docs/specs to state the new authoritative model before or alongside code changes.
4. Decide whether the prototype IndexedDB reset is acceptable for the implementation slice.

## Implementation Steps

1. Contracts and naming
   - Review whether `GameCardWorkspaceTemplateFile` should be renamed or semantically redefined as card content files.
   - Add or document the reserved effective-workspace root `save/` for active save runtime data.
   - Add shared shapes only if UI/bridge/runtime boundaries need them.

2. Storage model
   - Replace save-scoped full workspace-copy creation with save runtime-data initialization.
   - Keep or introduce card-owned content file storage.
   - Keep save records linked to `gameCardId`.
   - Store save runtime files keyed by `saveId`, with UI/storage presentation equivalent to `saves/<save-id>/...`.
   - Ensure save deletion deletes runtime data/checkpoints/history for that save, not card content.

3. Effective workspace helper
   - Add a helper that assembles card-owned content plus selected save runtime data.
   - Map selected save runtime files into the effective workspace under `save/...`.
   - Reject or prevent card-owned content under the reserved `save/` root.
   - Apply path normalization and `.tsian/*` hiding rules.
   - Define collision behavior for reserved roots and same-path card/runtime conflicts.

4. Platform host and runtime
   - Route Agent Runtime reads through effective workspace assembly.
   - Route runtime writes/deletes under `save/...` to selected save runtime data by default.
   - Route card authoring writes through explicit card-content APIs.
   - Update `agent-registry`, `agent-context`, `skill-registry`, and `skill-detail` query sources.

5. Checkpoints and history
   - Make checkpoints store save runtime data plus snapshot/history.
   - Avoid checkpointing card-owned content by default.
   - Keep restore explicit and bounded to save runtime data.

6. Package import/export
   - Export card content files, frontend files, cover files, and manifest.
   - Exclude save slots, runtime data, checkpoints, traces, and AI debug.
   - Import packages as card content only.

7. UI compatibility
   - Keep thin card/save UI working during the transition.
   - Gate deep Workspace Studio and Agent/Skill Studio implementation on the new model.

8. Docs and specs
   - Update `docs/active/agent-framework-runtime-workspace-direction.md`.
   - Update `.trellis/spec/platform-web/frontend/state-management.md`.
   - Update package/import/export and workspace scenarios in `.trellis/spec/platform-web/frontend/type-safety.md`.
   - Update current-state handoff when implementation is complete.

## Validation Commands

Run when contracts change:

```bash
npm run build:contracts
```

Run for platform-web changes:

```bash
npm run build:web
```

Run before completion:

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate 06-15-card-owned-content-save-runtime-data-model
```

## Focused Tests / Checks

- Creating a save from a card does not copy card content into save runtime data.
- Effective workspace reads expose selected save runtime data under `save/...`.
- Game Card package import/card authoring rejects card-owned content under reserved `save/`.
- Existing saves read updated card Agent/Skill/schema content after the card changes.
- Runtime Agent/Skill writes mutate save runtime data, not card content.
- Card authoring writes mutate card content and are visible to existing saves.
- Checkpoint restore restores save runtime data only.
- Package export excludes save runtime data.
- Agent and Skill registries are populated from card content.
- `.tsian/*` remains hidden from ordinary workspace APIs.

## Risky Areas

- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/game-cards.ts`
- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `apps/platform-web/src/storage/game-card-packages.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/*`
- `packages/contracts/src/game-card.ts`
- `packages/contracts/src/workspace.ts`
- active docs and Trellis specs that currently describe save-scoped Runtime Workspace copies

## Rollback Points

- Keep route/UI changes separate from storage model edits.
- Keep package import/export changes separate from runtime write routing where practical.
- If the model migration becomes too large, first land the effective workspace helper and docs/spec updates, then adjust UI in follow-up children.
