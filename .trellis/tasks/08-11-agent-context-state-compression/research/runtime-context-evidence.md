# Runtime Context Evidence

## Current code paths

- Cross-turn and same-invocation compression live in `apps/platform-web/src/agent-runtime/context-lifecycle.ts`; runtime call sites are in `apps/platform-web/src/agent-runtime/index.ts`.
- Cross-turn task compression currently uses `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`; same-invocation tool-loop compression uses `TASK_COMPRESSION_SYSTEM_PROMPT`. Both accept free-form summaries and only reject empty output.
- `compressContext()` groups/ages `recentTurns` and `toolMemories` by `turn`; `compressTaskContext()` replaces early tool interactions with one synthetic user summary.
- persistent `invokeAgent` is implemented in `apps/platform-web/src/platform-host/ai-invocation.ts`. It passes `turn: getMaxTurnFromTurnFiles(...)`, uses `compressionMode:"task"`, stages `context-<slot>.json`, and does not write formal history.
- context parsing/staging is in `apps/platform-web/src/platform-host/history-turns.ts`; context path generation and v1 parsing are in `context-lifecycle.ts`.
- formal turn history remains `save/history/turns/turn-*.json`; desktop-assistant visible messages remain in its existing session message storage. These are not model context snapshots.

## Tool and Skill boundaries

- `apps/platform-web/src/agent-runtime/workspace-tools/skill-actions.ts` currently records loaded Skills in per-loop `RuntimeWorkspaceToolSessionState`; `run_script` throws `SKILL_NOT_ACTIVATED` when a prior same-loop `use_skill` call did not populate it.
- Current visibility comes from `agentContext.skillIndex`; action parsing comes from the visible Skill's `SKILL.md`; executor policy and workspace mutation scope are checked separately. Those remain authorization boundaries.
- `apps/platform-web/src/agent-runtime/tool-memory.ts` currently creates a generic bounded projection from every accepted observation, including Skill/source previews, then applies per-tool and total character caps plus placeholders.
- Current Tool Memory collection consumes accepted observations in both native and text loops. UI timeline projection is independent and must remain independent.
- Skill actions and Agent Tools share `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`; the Worker currently exposes `tsian.workspace`, `tsian.reply`, logging, config and deterministic libraries. This is the common insertion point for a memory side channel.

## Opening boundaries

- Opening frontend source is `apps/play-frontend-dev/src/lib/opening-interview.ts` and `apps/play-frontend-dev/src/composables/useSetupState.ts`; the authoritative packaged source mirrors under `cards/沉浸阅读器.tsian-card/frontend/src/` and is rebuilt, not edited in `frontend/dist`.
- Opening calls `invokeAgent("world-architect", ..., { persist:true, contextSlot, purpose:"opening-interview" })`.
- Current recovery scans `context-<slot>.json.recentTurns`, parses assistant `[[开局会话]]`, validates revision/attempt/source refs, and reconstructs visible messages. Compression can remove those entries.
- Current `save/playthrough/opening-interview.json` stores source/session/branch, attempt, revision and final receipt; semantic progress is not stored there.
- `cards/沉浸阅读器.tsian-card/workspace/config/reply-projection.json` already projects `openingChoices`; its `openingState` rule exists only for the hidden-state protocol being removed.
- `commit-opening.js` performs all validation before its write loops but uses fail-fast helpers. Generic `validateActionInputSchema()` is shallow and fail-fast; batch validation is intentionally opening-specific.

## Compatibility decisions carried forward

- Do not change compression thresholds or contextWindow configuration in this task.
- Existing formal turn and desktop-assistant message archives remain unchanged.
- Only explicitly player-visible persistent invokeAgent conversations opt into full transcript; current consumer is opening interview. Background persistent calls do not.
- Existing test opening sessions do not migrate.
- Preserve UI diagnostics/timeline even when model-facing Tool Memory omits process noise.
- Preserve the user's existing uncommitted opening Skill edit that removes questions with no downstream consumer.

## Required source synchronization

- Platform runtime/contracts: `packages/contracts/src/**`, `apps/platform-web/src/**`.
- Platform workspace templates: `apps/platform-web/src/storage/workspace-templates/**`.
- Card workspace authority: `cards/沉浸阅读器.tsian-card/workspace/**`.
- Frontend authority: `apps/play-frontend-dev/src/**`; package build copies/builds it into the card.
- Final package/hash: rebuild through `scripts/package-immersive-reader-card.mjs`; do not hand-edit packaged manifests or dist.

