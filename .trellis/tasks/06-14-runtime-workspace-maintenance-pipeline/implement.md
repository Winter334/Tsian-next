# Implementation Plan

## Pre-Implementation Checks

- Load `trellis-before-dev` before editing product code.
- Read the platform-web specs listed by `.trellis/spec/platform-web/frontend/index.md`.
- Re-read this task's `prd.md` and `design.md`.
- Re-scan:
  - `apps/platform-web/src/agent-runtime/index.ts`
  - `apps/platform-web/src/agent-runtime/workspace-tools.ts`
  - `apps/platform-web/src/agent-runtime/context.ts`
  - `apps/platform-web/src/platform-host/index.ts`
  - `apps/platform-web/src/storage/workspace.ts`
  - `apps/platform-web/src/storage/saves.ts`
- Search before changing path constants or maintenance targets:
  - `session.jsonl`
  - `notes.md`
  - `history/timeline.md`
  - `memory/summaries/current.md`
  - `memory/summaries/long-term.md`
  - `.tsian`

## Implementation Checklist

1. Add Agent session transcript types and collector.
   - Keep the collector storage-free inside `agent-runtime`.
   - Capture Agent-facing model messages, model output, parsed tool calls, tool observations, delegated Agent interactions, turn, agent id, role, model-call index, timestamps, and status.
   - Exclude platform-only storage/transaction/debug internals that were not visible to the Agent.

2. Wire transcript collection through the existing tool loop.
   - Record master and narrative model calls.
   - Record delegated Agent calls when `agent_call` invokes another Agent.
   - Preserve existing runtime return shape for callers or add a backwards-compatible field if needed.
   - Keep trace summary behavior separate from transcript persistence.

3. Stage Agent session transcript writes in platform-host.
   - Append JSONL records to `agents/<agent>/session.jsonl` using the active runtime workspace transaction.
   - Create the file if a custom Agent exists without a session file.
   - Ensure failed/aborted turns do not stage session transcript records.
   - Do not implement transcript segmentation, trimming, compression, or archival in this slice.

4. Add maintenance plan parsing and validation.
   - Define a versioned maintenance plan schema.
   - Allow empty `writes` as an explicit no-op maintenance decision.
   - Allow only approved targets for this slice:
     - `agents/<agent>/notes.md`
     - `history/timeline.md`
     - `memory/summaries/current.md`
     - `memory/summaries/long-term.md`
   - Reject `.tsian/*`, invalid paths, missing content, unsupported modes, and oversized content.
   - Return structured validation failures without throwing away the successful player-facing turn.

5. Add triggered maintenance plan orchestration.
   - Do not run enhanced memory maintenance automatically on every turn.
   - Let workspace-defined Skills explicitly submit maintenance plans through a loaded Skill action.
   - Reuse existing Skill executor surfaces, preferably `browser_script`, rather than adding a maintenance-specific platform action.
   - Ensure maintenance is reachable through `skill_load` -> `action_call`, not as an always-visible runtime primitive.
   - Stage valid maintenance writes through the same runtime workspace transaction when a plan is submitted.
   - Treat an empty valid plan as an explicit no-op maintenance decision.
   - Treat absence of a maintenance plan as no maintenance request, not as a failure.
   - On maintenance failure, emit trace summary and continue committing the successful turn without maintenance writes.
   - This child task includes triggered maintenance plan handling; do not defer it without updating planning artifacts and getting user review.

6. Add or seed the maintenance Skill surface.
   - Provide an official default `skills/memory-maintenance/SKILL.md` that explains when to apply maintenance and declares an `apply_maintenance_plan` action.
   - Prefer a Skill-local browser script such as `skills/memory-maintenance/scripts/apply-maintenance-plan.js` to validate the plan and write approved workspace files through the Tsian SDK.
   - Add the Skill files to new-save default workspace content.
   - Add a safe default workspace upgrade/ensure path for existing non-empty saves:
     - use the host-owned workspace manifest version or equivalent platform marker to run once for this default-content addition;
     - create missing official maintenance Skill files only when the path is absent;
     - preserve any existing user-authored file at the same path;
     - do not re-create the Skill after the upgrade marker is current if a user later deletes it;
     - do not auto-load the Skill or trigger maintenance.
   - Do not add a new platform action for maintenance unless existing executors prove insufficient and planning is revised.
   - Keep the Skill replaceable workspace content; if later usage shows this policy belongs in `AGENT.md`, move it in a future task without changing the platform contract.

7. Integrate with successful-turn commit.
   - Stage raw AIRP history, session transcripts, maintenance writes, successful trace, snapshot/history, and checkpoint coherently.
   - Keep final atomic commit behavior from `commitSuccessfulRuntimeTurnForSave`.
   - Preserve frontend bridge `platform.runAction` immediate behavior.

8. Update docs/specs.
   - Update `.trellis/spec/platform-web/frontend/type-safety.md` with the session transcript and maintenance plan contract.
   - Update `docs/active/current-state-handoff.md`.
   - Update `docs/active/agent-framework-runtime-workspace-direction.md`.

## Validation Plan

- Build: `npm run build:web`
- Diff hygiene: `git diff --check`
- Contract builds only if shared contract source changes:
  - `npm run build:contracts`
- Focused probes:
  - successful normal turn appends valid JSONL transcript records for master and narrative;
  - delegated `agent_call` appends transcript records for the delegated Agent;
  - transcript records contain Agent-facing messages, model output, tool calls, and tool observations;
  - transcript records omit platform-only internals;
  - session transcript files append records without segmentation, trimming, compression, or archival;
  - failed model call or abort leaves no ordinary session transcript writes;
  - successful turn without maintenance trigger commits normally and writes no notes/timeline/summary maintenance files;
  - maintenance action is unavailable until its declaring Skill is loaded;
  - official maintenance Skill can be discovered, loaded, and can run its declared action through existing executors;
  - new saves include the official maintenance Skill files by default;
  - existing non-empty saves with older workspace manifests receive missing official maintenance Skill files without overwriting same-path user content;
  - once the default workspace upgrade marker is current, deleting the maintenance Skill does not cause it to be re-created on every turn;
  - valid maintenance plan updates approved notes/timeline/summary paths through staged writes;
  - valid empty maintenance plan records no writes and does not mutate notes/timeline/summary files;
  - invalid maintenance plan does not fail the player-facing turn and does not write ordinary maintenance files;
  - `.tsian/*` maintenance target is rejected;
  - checkpoint restore includes/removes session and maintenance files coherently;
  - frontend bridge direct workspace write/delete remains immediate.

## Risky Files

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `docs/active/current-state-handoff.md`
- `docs/active/agent-framework-runtime-workspace-direction.md`

## Rollback Points

- After transcript collector creation, verify no-tool master/narrative turns still return the current `{ replyText, masterPlan }` shape.
- After tool-loop transcript wiring, verify tool observations still return to the same Agent and final output strips tool-call blocks.
- After session JSONL staging, verify failed turns discard session records.
- After maintenance plan validation, verify invalid output is traced but does not fail an accepted player-facing turn.
- After triggered maintenance orchestration, verify no maintenance work runs when no loaded Skill action submits a plan.
- If full maintenance pass becomes too broad, stop after a coherent transcript implementation checkpoint, update planning artifacts, and ask the user before splitting notes/timeline/summary maintenance into a follow-up child.
- Do not add session transcript compaction or archival while implementing this slice; record it as follow-up if file size becomes a concern.

## Review Gate

- Review `prd.md`, `design.md`, and this `implement.md` with the user.
- Do not run `task.py start` until the user approves the planning artifacts.
