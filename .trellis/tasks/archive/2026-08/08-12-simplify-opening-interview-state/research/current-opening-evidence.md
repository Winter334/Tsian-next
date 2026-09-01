# Current Opening Evidence

## Observed failure

- The captured request injected `basedOnRevision: 2` and a new `attemptId`, while Tool Memory still reported the prior successful revision 2/attempt.
- The Agent treated “重新输出并闭合标签” as presentation repair, returned valid visible text, and did not call `advance_opening_progress`.
- `apps/play-frontend-dev/src/composables/useSetupState.ts:440-469` rejects the response unless progress has the exact expected attempt/revision. The packaged/stale frontend contains the same blocking message.

## Existing authorities

- Successful player-visible `invokeAgent` calls already persist an append-only transcript independently from compressed model context: `.trellis/spec/platform-web/frontend/type-safety.md:727-790`.
- The latest frontend restores successful visible dialogue and projected choices from that transcript: `apps/play-frontend-dev/src/composables/useSetupState.ts:711-768`.
- `opening-progress.json` currently duplicates transport state via `revision/processedAttemptId/phase`: `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/scripts/_progress.js:34-141`.
- `advance-opening-progress.js:1-31` performs CAS, attempt validation, inheritance validation and simultaneous control/progress writes for every interview response.
- `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/agent.json` already enables `workspace_read` and `workspace_write`, with `workspaceAccess.level: 1` (“可维护存档”). A new permission mechanism is unnecessary.
- The generic `write` Tool description explicitly permits writing Skill-required state/notes; a small opening note therefore needs one native write rather than a dedicated action.

## Actual downstream hard dependencies

- Runtime parsing requires numeric `turn`, string `worldTime/weather`, array `activeSceneRefs`, and object `extensions`: `apps/play-frontend-dev/src/lib/parse-runtime.ts:59-73`.
- Story context injection blocks if an active scene or protagonist ref cannot be loaded: `apps/play-frontend-dev/src/lib/context-injection.ts:500-550`.
- Frontier parsing only requires a timeline array; source window fields are otherwise tolerant: `apps/play-frontend-dev/src/lib/parse-frontier.ts:84-125`. Frontier advancement uses the persisted window end.
- The first formal reply must pass reply projection so turn 0 contains clean content and projected choices: `.trellis/spec/platform-web/frontend/state-management.md:455-543`.
- Runtime Workspace browser scripts execute with savepoint/transaction rollback, so script failure can provide zero accepted writes without a second domain receipt protocol.

## Complexity without demonstrated consumer value

- Frontend correlates transcript, control and semantic progress as three synchronized ledgers.
- Progress rejects unknown fields, requires exact inheritance, forbids phase regression, and binds every semantic snapshot to a transport attempt.
- Dedicated read/advance scripts wrap a single small note file even though the Agent already owns native save-runtime read/write capability.
- `commit-opening.js` is over 1300 lines and performs shallow issue collection followed by the original deep validation again.
- Commit requires exact duplicate names, full contiguous chapter metadata echoed by the Agent, first timeline time `元年`, ready-to-commit phase, deep equipment/container closure and a payload-hash receipt. Several of these are conventions rather than consumer requirements.

## Source synchronization

- Card workspace Skill/scripts are imported by `apps/platform-web/src/storage/workspace-templates/agents/world-architect.ts` via `?raw`.
- Game frontend package authority is `apps/play-frontend-dev/src`; `scripts/package-immersive-reader-card.mjs:20-25,157-238` snapshots that source together with the card workspace and builds the package through the real browser exporter.
- Do not hand-edit checked-in `frontend/dist`.
