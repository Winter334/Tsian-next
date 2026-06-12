# Implementation Plan

## Scope

Only edit documentation and Trellis task artifacts. Do not edit application code, tests, package configs, or generated runtime files.

## Checklist

1. Update planning artifacts
   - [x] Create Trellis task.
   - [x] Write `prd.md`.
   - [x] Write `design.md`.
   - [x] Write `implement.md`.

2. Rewrite active direction
   - [x] Replace `docs/active/airp-workflow-platform-direction.md` content with Agent-Orchestrated AIRP Runtime direction.
   - [x] Cover platform / runtime / frontend package / content-mod / save instance boundaries.
   - [x] State clearly that workflow-as-system and SillyTavern prompt-engine are no longer long-term core directions.

3. Update active entry docs
   - [x] Update root `README.md`.
   - [x] Update `docs/README.md`.
   - [x] Update `docs/active/README.md`.
   - [x] Update `docs/active/current-state-handoff.md`.
   - [x] Update `docs/active/deferred-work.md`.

4. Clean outdated docs
   - [x] Delete outdated `docs/reference/*.md` skeleton files that only preserve old planning assumptions.
   - [x] Delete outdated `docs/archive/2026-06-05-workflow-as-system/*.md` files that duplicate old workflow direction already captured by task/git history.
   - [x] Keep only minimal README/index files if needed to explain why old docs were removed.

5. Verify search hygiene and consistency
   - [x] Search docs for current-authority phrases such as `workflow-as-system`, `SillyTavern`, `prompt preset`, `workflow editor`, `schema resource`, and verify remaining hits are clearly historical, deferred, or implementation-state references.
   - [x] Search active docs for the new terms `Agent Runtime`, `主控 Agent`, `Frontend Package`, `存档实例`, and `Bridge API`.
   - [x] Run `git diff --check`.

## Validation Commands

```bash
find docs -maxdepth 3 -type f -name '*.md' | sort
rg -n "workflow-as-system|SillyTavern|prompt preset|workflow editor|schema resource|renderer adapter" docs
rg -n "Agent Runtime|主控 Agent|Frontend Package|存档实例|Bridge API" docs
git diff --check
```

## Risk Notes

- Deleting docs is intentional in this task because the user wants fewer stale search hits and accepts Trellis task records / git history as the history source.
- Keep task artifacts explicit so future sessions understand why old docs disappeared.
- Do not remove `.trellis/tasks/archive` records; those are the authoritative historical task records.

## Review Gate

Before `task.py start`, confirm the deletion scope:

- Recommended: delete old `docs/reference` skeleton docs and old `docs/archive/2026-06-05-workflow-as-system` docs, keeping only active docs plus minimal README/index guidance.
