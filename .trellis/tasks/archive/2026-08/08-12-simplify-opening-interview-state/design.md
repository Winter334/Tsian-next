# Design: Simplified Opening Interview

## 1. Boundary

The opening interview has two layers only:

1. **Conversation archive:** platform transcript records successful player/Agent exchanges for UI recovery.
2. **Semantic notes:** one optional progress file helps the Agent continue after context compression.

Neither layer is a per-turn transaction coordinator. The only domain transaction is final `commit_opening`.

## 2. Control and native notes

Introduce a simplified test-only opening control schema containing only source identity, session id/slot and branch. Remove `status`, `attempt`, `revision` and `receipt`; `setup-summary.json` remains the single completion authority.

Semantic continuity uses a small Markdown note rather than another domain schema:

```md
# 开局建模工作笔记
## 主角
## 已确认
## 待确认
## 已读原文
```

The Skill uses native `read` and `write` on `save/playthrough/opening-notes.md`. The file is optional and small enough for full replacement. It contains exact refs/ranges where useful, but no schema, audit metadata or transport identity. The frontend never consumes it.

Delete `_progress.js`, `read-opening-progress.js` and `advance-opening-progress.js`. No replacement action or permission work is needed: world-architect already exposes `workspace_read/workspace_write` with level 1 save maintenance access.

Dedicated actions remain only where they earn their maintenance cost:

- `inspect_source_opening` / `read_opening_slice` aggregate sharded source access and avoid multiple low-level reads.
- `commit_opening` performs the destructive multi-file final write under one Runtime Workspace transaction.

## 3. Frontend flow

- Start: create simplified control and invoke the bootstrap prompt.
- Answer: append the local player bubble, invoke the Agent, and accept any non-empty displayable assistant response.
- Success: transcript persistence is handled by the platform; the frontend displays response/projections and returns to ready.
- Failure: keep same-page retry state in memory. A reload restores the last successful transcript and may discard the failed draft.
- Restore: validate source/session identity, parse transcript entries, and rebuild visible messages. Do not load or correlate semantic notes.
- Complete: `setup-summary.status === "complete"` selects confirmation view; control does not duplicate completion status.

Opening choice parsing accepts either a normal closed block or one trailing unclosed `[[开局选项]]` block. The fallback is limited to end-of-response text so it cannot swallow later narrative.

## 4. Skill behavior

The Skill describes a normal requirements conversation:

- Read `opening-notes.md` with the native workspace Tool when continuity is needed.
- Read source only for the current decision.
- Rewrite the note with the native workspace Tool when a durable decision, unresolved question or useful read range changes.
- Do not save notes for restatement, explanation, formatting repair or other non-semantic turns.
- Commit after the player confirms and the Agent judges the opening sufficient.

No phase machine or exact per-turn action count is exposed to the Agent.

## 5. Final commit

`commit_opening` no longer accepts a session envelope. It reads source/control and normalizes the supplied semantic payload into persisted files.

Hard failures are limited to demonstrated operational boundaries:

- malformed top-level payload or unsafe/duplicate write identity;
- source/control unavailable or formal play already started;
- no usable entity/scene set;
- runtime cannot satisfy frontend required fields, or protagonist/active scenes do not exist in this commit;
- frontier lacks a usable source window/anchor needed by later frontier advancement;
- first reply cannot project visible content and at least one choice.

The script derives target names from refs, source chapter metadata from indexes, and stable kind/order fields where possible. Optional or semantically imperfect content is normalized or retained rather than rejected. Remove the bounded multi-issue collector and avoid validating properties with no known consumer.

Runtime Workspace transaction rollback remains the atomicity mechanism. If setup summary already reports complete, return the existing completed result without rewriting. No payload hash/revision receipt is needed during the test-only workflow.

## 6. Compatibility and synchronization

- Old opening control/progress schemas are not migrated; the frontend reports that a new save is required.
- Generic transcript/context/Tool Memory platform contracts remain unchanged.
- The existing uncommitted expanded action schema is superseded by native workspace note maintenance and is intentionally absorbed.
- Update card workspace sources, remove obsolete raw-import template registrations, update play frontend, and synchronize affected Trellis specs.
- Build the distributable card from `apps/play-frontend-dev/src` and card workspace through the existing package command; do not hand-edit dist.

## 7. Verification strategy

- Focused script/runtime smoke: minimal success, missing runtime target with zero writes, repeated completion no-op.
- Frontend parser/flow coverage for trailing unclosed opening choices and acceptance without a progress write.
- Build play frontend and platform web; run retained web smoke suite.
- Build/package immersive reader card.
- User performs the real browser interview.
