# Implementation Plan: Platform Web 大文件拆分

## Phase 0: Scope Finalization

- [x] Resolve Q1: keep current six-child scope or expand to all 1000+ line files.
- [x] After scope is final, update parent `prd.md` and child map.
- [x] Do not start implementation until the selected first child is reviewed and activated.

## Phase 1: Child Readiness Gate

For each child before `task.py start`:

- [x] Read relevant spec indexes and concrete specs.
- [x] Ensure child `prd.md`, `design.md`, and `implement.md` are complete.
- [x] Fill child `implement.jsonl` and `check.jsonl` with real spec/research entries if dispatching sub-agents.
- [x] Confirm no unrelated worktree changes.
- [x] Record baseline commit and create local backup branch/ref.

## Phase 2: Recommended Child Order

1. `07-17-split-workspace-templates/`
   - Lowest behavior risk, highest line reduction.
   - Establishes backup/content-snapshot workflow.
2. `07-17-split-ai-config-runtime/`
   - High churn area after model/tool-call work.
   - Requires provider compatibility checks.
3. `07-17-split-agent-runtime-workspace-tools/`
   - Extract tool helper clusters before touching main runtime orchestration.
4. `07-17-split-agent-runtime-index/`
   - Depends on workspace-tools split to avoid too many moving parts.
5. `07-17-split-platform-host-index/`
   - Align host entry with existing directory structure guidance.
6. `07-17-split-assistant-view/`
   - UI behavior risk; do after runtime/API seams are stable.

## Common Implementation Loop Per Child

- [x] Preflight: `git status --short`.
- [x] Backup: `git rev-parse HEAD` and `git branch backup/<child-slug>-pre-split HEAD`.
- [x] Map declarations/imports/exports and choose one seam.
- [x] Move one seam into a focused module.
- [x] Keep original file facade/barrel where possible.
- [x] Remove dead imports and check for barrel ↔ submodule cycles.
- [x] Run `git diff --check`.
- [x] Run `npm run build:web`.
- [x] If green, proceed to next seam; if red, fix or roll back only the current seam.
- [x] Update child artifact with final module map and validation output.

## Final Parent Integration Check

- [x] `git status --short` contains only intended task/code changes.
- [x] `npm run build:web` passes after all completed child changes are integrated.
- [x] Source scan confirms primary large files are reduced or explicitly justified.
- [x] Review public import paths for `runtime-host`, `agent-runtime`, `platform-host`, `storage`, and `views` boundaries.
- [x] Confirm no rollback patch/backup artifact is imported by product code.
- [x] Run Trellis quality check before reporting parent completion.

## Final Integration Results

- Completed and archived all 6 child tasks.
- Created local checkpoint commit `8466711` after the first four child splits, then completed the last two children in isolated git worktrees.
- Merged `task/large-split-platform-host-index` and `task/large-split-assistant-view` back into the main worktree.
- Final `git diff --check`: PASS.
- Final `npm run build:web`: PASS. Vite/Rollup emitted existing non-fatal pure-annotation and chunk-size warnings.
- Final target file sizes:
  - `apps/platform-web/src/storage/workspace-templates.ts`: 1 line.
  - `apps/platform-web/src/runtime-host/ai.ts`: 22 lines.
  - `apps/platform-web/src/agent-runtime/workspace-tools.ts`: 48 lines.
  - `apps/platform-web/src/agent-runtime/index.ts`: 2013 lines, intentionally still owns high-level turn orchestration.
  - `apps/platform-web/src/views/AssistantView.vue`: 1283 lines, intentionally still owns route shell/orchestration.
  - `apps/platform-web/src/platform-host/index.ts`: 203 lines.
- Behavior-preservation reviews passed for default workspace content, AI provider/runtime behavior, workspace-tool observations/traces, Agent Runtime skeleton/context injection, platform-host bridge/lifecycle, and Assistant UI event wiring.

## Rollback Commands Reference

```bash
# Restore one file to HEAD
git restore -- apps/platform-web/src/path/to/file.ts

# Reverse a seam patch
git apply -R .trellis/tasks/<child>/rollback/<step>.patch

# Show local backup branches
git branch --list 'backup/*-pre-split'
```

Destructive commands such as `git reset --hard backup/<child>-pre-split` require explicit user confirmation.
