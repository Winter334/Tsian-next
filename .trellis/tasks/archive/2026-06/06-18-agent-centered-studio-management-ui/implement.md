# Implementation Plan

## Preconditions

- Resolve the open product decision: real tool/permission enforcement now, or defer it to a follow-up task.
- If real tool/permission enforcement is deferred, do not add non-functional controls that imply runtime behavior.

## Implementation Steps

1. Contracts and registry model
   - Add optional `soulFile` support to shared Agent context contracts.
   - Extend Agent registry parsing to read `enabledSkills` and `disabledSkills` while preserving `defaultSkills`.
   - Add pure helpers for Skill matching and Agent Skill enablement.

2. Runtime context assembly
   - Load `agents/<agent>/SOUL.md` when present.
   - Include `SOUL.md` content in runtime prompt assembly after `AGENT.md`.
   - Filter `agentContext.skillIndex` through Agent Skill enablement.

3. Default workspace content
   - Add `SOUL.md` for built-in default Agents.
   - Move durable identity/work-style prose from built-in `AGENT.md` bodies into `SOUL.md` where appropriate.
   - Preserve `notes.md` and session files as save-runtime/internal files.

4. Platform-host Studio APIs
   - Add small platform-host helpers for Studio edits:
     - read/write selected Agent `AGENT.md`
     - create/read/write selected Agent `SOUL.md`
     - update selected Agent Skill enablement fields
   - Reuse existing workspace/card content write validation paths where possible.

5. Studio UI
   - Redesign `StudioView.vue` around Agent selection first.
   - Add literal file sections/tabs for `AGENT.md` and `SOUL.md`.
   - Add a Skills section that lists all valid global Skills and selected-Agent-local Skills with enabled toggles.
   - Keep file path/advanced operations visible but secondary.
   - Avoid exposing `shared` / `agent-local` as player-facing categories.

6. Optional tools/permissions scope
   - If deferred: omit editable tool/permission controls or show only a non-editing reserved section.
   - If included: add separate design before implementing runtime enforcement.

7. Tests and validation
   - Add/adjust unit tests for Agent registry, Skill enablement filtering, and `SOUL.md` context assembly if test harness exists.
   - Run `npm run build:contracts` if shared contracts change.
   - Run `npm run build:web`.
   - Use Playwright smoke on `http://127.0.0.1:5173/#/studio`.

## Risk Points

- Frontmatter parser currently supports simple scalar/list fields only; keep new fields simple YAML lists.
- Existing built-in cards may refresh content; avoid overwriting user-authored card files except through existing built-in refresh behavior.
- Skill enable toggles must not silently edit the Skill file itself.
- Runtime prompt changes should not expose disabled Skills through `skill_load`.

## Rollback

- Revert contract/registry changes and restore the prior Studio view.
- Since no Dexie schema migration is planned, rollback should not require database migration.
