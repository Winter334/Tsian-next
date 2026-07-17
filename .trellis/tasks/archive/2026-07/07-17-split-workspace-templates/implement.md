# Implementation Plan: 拆分 workspace templates 巨型模板文件

- [x] Read storage/frontend specs before implementation.
- [x] Record baseline commit and verify `backup/split-workspace-templates-pre-split` exists.
- [x] Produce pre-split snapshot of exported default workspace file paths and content hashes.
- [x] Extract docs/templates into `storage/workspace-templates/docs/*`.
- [x] Extract agent seed blocks into `storage/workspace-templates/agents/*`.
- [x] Extract script templates into `storage/workspace-templates/scripts/*`.
- [x] Extract default file assembly/list logic into `storage/workspace-templates/files.ts`.
- [x] Keep old import path working through facade/barrel.
- [x] Run snapshot comparison.
- [x] Run `git diff --check`.
- [x] Run `npm run build:web`.
- [x] Record validation results in task notes before finish.

## Implementation Notes

Baseline HEAD and backup branch both resolved to `7d12a7cd33ca1a22dfa123260d08a57cbb50d2d5` before implementation. Existing consumers import from `./workspace-templates`; the original `apps/platform-web/src/storage/workspace-templates.ts` is now a compatibility facade that re-exports `./workspace-templates/index`.

### Module Map

- `apps/platform-web/src/storage/workspace-templates/constants.ts` — workspace version, manifest path, save-runtime upgrade path set.
- `apps/platform-web/src/storage/workspace-templates/utils.ts` — shared `text`, `json`, `agentConfigContent`, and `TemplateFile` helpers.
- `apps/platform-web/src/storage/workspace-templates/files.ts` — public default workspace/save-runtime file arrays and runtime card path set assembly.
- `apps/platform-web/src/storage/workspace-templates/index.ts` — public barrel for the split module tree.
- `apps/platform-web/src/storage/workspace-templates/agents/storyteller.ts` — storyteller agent config, prompts, modules, local skills, and local tools.
- `apps/platform-web/src/storage/workspace-templates/agents/researcher.ts` — researcher agent seed and local skills.
- `apps/platform-web/src/storage/workspace-templates/agents/stage-manager.ts` — stage-manager agent seed, local skills, and maintenance tool references.
- `apps/platform-web/src/storage/workspace-templates/agents/world-architect.ts` — world-architect agent seed and local skill/script references.
- `apps/platform-web/src/storage/workspace-templates/scripts/opening.ts` — opening/play-setup common, validation, and commit scripts.
- `apps/platform-web/src/storage/workspace-templates/scripts/frontier.ts` — frontier window/material/state scripts.
- `apps/platform-web/src/storage/workspace-templates/scripts/maintenance.ts` — stage-manager maintenance context tool schema/run script.
- `apps/platform-web/src/storage/workspace-templates/docs/airp.ts` — AIRP schema docs and save README templates.
- `apps/platform-web/src/storage/workspace-templates/docs/framework.ts` — Tsian framework knowledge doc template.
- `apps/platform-web/src/storage/workspace-templates/tools/roll-dice.ts` — shared roll_dice tool README/schema/run script seed.

### Validation Results

- Pre-split snapshot artifact: `.trellis/tasks/07-17-split-workspace-templates/snapshot/pre-split-workspace-template.snapshot.json`.
- Snapshot script: `.trellis/tasks/07-17-split-workspace-templates/snapshot/workspace-template-snapshot.mjs`.
- Snapshot equivalence after split: PASS (`DEFAULT_WORKSPACE_FILES: 70`, `DEFAULT_SAVE_RUNTIME_FILES: 33`).
- Cycle check: no split submodule imports the compatibility facade/barrel; only `workspace-templates.ts` re-exports `./workspace-templates/index`.
- `git diff --check`: PASS.
- `npm run build:web`: PASS. Vite emitted existing Rollup pure-comment/chunk-size warnings only.

### Rollback Artifacts

- Direct revert patch: `.trellis/tasks/07-17-split-workspace-templates/rollback/revert-product-source-split.patch`.
- Forward source patch checkpoint: `.trellis/tasks/07-17-split-workspace-templates/rollback/final-product-source-split.patch`.

The split was performed as one mechanical extraction followed by exact snapshot equivalence and a green build instead of per-seam patch checkpoints; the final direct revert patch can roll back the source split in one apply step.

### Main-Agent Review

- Re-ran snapshot equivalence after reviewing the implementation: PASS (`DEFAULT_WORKSPACE_FILES: 70`, `DEFAULT_SAVE_RUNTIME_FILES: 33`).
- Re-ran `git diff --check` and an additional whitespace scan for untracked split/task files: PASS.
- Re-ran reverse-import check: split submodules do not import `workspace-templates.ts` or the barrel.
- Re-ran `npm run build:web`: PASS. Vite/Rollup emitted the same pure-comment and chunk-size warnings; command exited successfully.
- Fixed one indentation-only inconsistency in `files.ts`; snapshot equivalence remained exact.
- Regenerated forward/revert rollback patches after the indentation fix. `git apply --check .trellis/tasks/07-17-split-workspace-templates/rollback/revert-product-source-split.patch` passes.
