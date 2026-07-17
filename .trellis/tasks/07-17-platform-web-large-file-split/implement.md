# Implementation Plan: Platform Web 大文件拆分

## Phase 0: Scope Finalization

- [ ] Resolve Q1: keep current six-child scope or expand to all 1000+ line files.
- [ ] After scope is final, update parent `prd.md` and child map.
- [ ] Do not start implementation until the selected first child is reviewed and activated.

## Phase 1: Child Readiness Gate

For each child before `task.py start`:

- [ ] Read relevant spec indexes and concrete specs.
- [ ] Ensure child `prd.md`, `design.md`, and `implement.md` are complete.
- [ ] Fill child `implement.jsonl` and `check.jsonl` with real spec/research entries if dispatching sub-agents.
- [ ] Confirm no unrelated worktree changes.
- [ ] Record baseline commit and create local backup branch/ref.

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

- [ ] Preflight: `git status --short`.
- [ ] Backup: `git rev-parse HEAD` and `git branch backup/<child-slug>-pre-split HEAD`.
- [ ] Map declarations/imports/exports and choose one seam.
- [ ] Move one seam into a focused module.
- [ ] Keep original file facade/barrel where possible.
- [ ] Remove dead imports and check for barrel ↔ submodule cycles.
- [ ] Run `git diff --check`.
- [ ] Run `npm run build:web`.
- [ ] If green, proceed to next seam; if red, fix or roll back only the current seam.
- [ ] Update child artifact with final module map and validation output.

## Final Parent Integration Check

- [ ] `git status --short` contains only intended task/code changes.
- [ ] `npm run build:web` passes after all completed child changes are integrated.
- [ ] Source scan confirms primary large files are reduced or explicitly justified.
- [ ] Review public import paths for `runtime-host`, `agent-runtime`, `platform-host`, `storage`, and `views` boundaries.
- [ ] Confirm no rollback patch/backup artifact is imported by product code.
- [ ] Run Trellis quality check before reporting parent completion.

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
