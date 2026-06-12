# Implementation Plan: Record Agent Framework And Runtime Workspace Direction

## 0. Pre-Implementation Gate

- [x] User reviews `prd.md`, `design.md`, and this implementation plan.
- [x] Activate the task with `task.py start` only after review approval.
- [x] Load `trellis-before-dev` before editing active project docs.

## 1. Documentation Targets

- [x] Add a new active direction document:
  - `docs/active/agent-framework-runtime-workspace-direction.md`
- [x] Update active docs index:
  - `docs/active/README.md`
- [x] Update general docs index if needed:
  - `docs/README.md`
- [x] Update current state handoff:
  - `docs/active/current-state-handoff.md`
- [x] Optionally update the platform direction document with a short pointer:
  - `docs/active/airp-workflow-platform-direction.md`

## 2. Content To Record

- [x] Tsian Agent Framework is AIRP-first, not a personal-assistant host automation system.
- [x] Agents are configurable, replaceable, and extensible through `AGENT.md`.
- [x] Agent collaboration is based on contact declarations and `agent.call`, not explicit team configuration.
- [x] Skills are progressively loaded from `SKILL.md`:
  - always-visible index has summary/triggers/applicability;
  - actions/instructions/schemas/scripts load on demand.
- [x] Skill actions are unified callable actions; executor type is hidden from agents.
- [x] Web-executable and remote-executable skill actions are future-supported execution paths.
- [x] Ordinary agent output is a soft protocol guided by instructions, not platform-validated contract.
- [x] Hard validation happens only at action/tool/write/commit boundaries.
- [x] Runtime Workspace is the save-scoped virtual filesystem and should contain agent definitions, skills, history, world data, memory, frontend data, archive, and platform metadata.
- [x] Structured game state should live inside Runtime Workspace files/directories with README/schema conventions rather than as a separate product concept.
- [x] Agent-local and shared skills are both supported.
- [x] Agents may eventually create/edit skills, initially through proposed patches.
- [x] Detailed turn traces should be platform/debug metadata, not normal per-turn workspace spam.
- [x] Handoff files are optional persistent artifacts; direct agent-call is the main collaboration path.

## 3. Validation

- [x] Review documentation diff for consistency.
- [x] Run `git diff --check`.
- [x] Confirm no runtime code changes were made.
- [x] If Markdown tooling exists and is cheap to run, run it; otherwise manual review is enough for this doc-only task.

## 4. Rollback

- Revert the new active document and index pointer changes if the direction is rejected.
- Task artifacts can remain as planning history unless the user asks to delete them.

## 5. Out Of Scope For This Task

- No parser implementation.
- No storage migration.
- No runtime workspace API.
- No skill executor implementation.
- No UI implementation.
- No package schema changes.
