# Implementation Plan: 开局正文纳入 turn 0 history 并 seed 玩家回合上下文

## Pre-Implementation Context

Relevant specs to read before code changes:

- `.trellis/spec/platform-web/frontend/index.md`
- `.trellis/spec/platform-web/frontend/state-management.md`
- `.trellis/spec/platform-web/frontend/hook-guidelines.md`
- `.trellis/spec/platform-web/frontend/quality-guidelines.md`
- `.trellis/spec/platform-web/storage/index.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/ai-facing-content-changes.md`

## Ordered Steps

### 1. Update default workspace setup script and Skill text

File: `apps/platform-web/src/storage/workspace-templates.ts`

- Update `PLAY_SETUP_SKILL_MD` wording:
  - Stop describing `opening-narrative.json` as the opening output.
  - Tell world-architect/staged storyteller flow that the storyteller returns one opening assistant reply containing the opening body and any embedded option markers.
  - Keep options as assistant content conventions; do not introduce a structured options input.
- Update `commit_play_setup` action schema:
  - Future-only rename is allowed. Prefer `openingReply` over `openingNarrative` to clarify that embedded options may be present.
  - If keeping `openingNarrative` for smaller code churn, update descriptions so it means the whole opening assistant reply, including embedded markers. Do not describe a split options field.
- In `COMMIT_PLAY_SETUP_SCRIPT_JS`:
  - Validate all inputs before writes.
  - Read effective `game-card.json`, parse `runtime.entrypoints.playerTurn`, and validate the agent id path segment.
  - Build `turn-000000.json` with schema `tsian.airp.history.turn.v2`, `turn: 0`, source `entryAgentId`, and assistant-only timeline.
  - Build player-turn `context.json` with schema `tsian.agent.context.v1`, `summary: null`, and a single `{ turn: 0, role: "assistant", content: openingReply }` recent turn.
  - Continue writing protagonist traits and `setup-summary.json`.
  - Stop writing `save/playthrough/opening-narrative.json` from `commit_play_setup`.
  - Return writes including `history-turn` and `agent-context` kinds.
- Remove or stop seeding `save/playthrough/opening-narrative.json` from the default save template and update `save/playthrough/README.md` text accordingly.
- Remove stale setup-skill file mappings only if they are no longer referenced by any remaining default Skill flow. If `commit-opening-narrative.js` remains for a separate opening-modeling flow, update docs so it is not part of Step4.

### 2. Update default frontend history source

Files likely involved:

- `apps/play-frontend-dev/src/composables/useTsian.ts`
- `apps/play-frontend-dev/src/App.vue`
- `apps/play-frontend-dev/src/components/story/StoryView.vue`
- `apps/play-frontend-dev/src/lib/source.ts`

Changes:

- Remove `openingNarrative` state and `loadOpeningNarrative()` if no longer used.
- Remove `OPENING_NARRATIVE_PATH` if it becomes unused.
- Remove `loadOpeningNarrative()` calls from restore/enter-play paths in `App.vue`.
- In `reloadHistory()`:
  - Continue parsing assistant content into clean stream text with `parseStoryOptions()`.
  - Restore `turnOptions` from the latest assistant timeline item by parsing embedded markers.
  - Keep legacy `{ kind: "options" }` fallback only if easy and non-invasive.
- In `StoryView.vue`:
  - Remove `openingNarrative` destructuring, `showOpeningNarrative`, the special opening block, and empty-state dependency on `openingNarrative`.
  - Ensure assistant-only turn 0 renders through normal `mergedStream`.
  - Avoid duplicating checkpoint 0 now that turn 0 assistant is in the stream.
  - If preserving opening visual style, annotate merged assistant items with their turn number and apply `opening-narrative` class when `turn === 0`.
- Check `turnCount` realtime semantics:
  - `history.get()` returns `maxTurn + 1`; after `turn-completed` for turn N, `turnCount` should become N + 1.
  - Keep `triggerSyncAfterTurn(completedTurn)` using the completed turn number.

### 3. Verify no platform-host opening special-case was added

- Do not modify `platform-host/index.ts` to read `opening-narrative.json`.
- Do not add runtime special handling for opening files.
- The runtime should see opening content only through normal player-turn Agent context.

### 4. Validation

Commands:

```bash
npm run build:web
```

Manual checks after build:

- Fresh setup completion creates:
  - `save/history/turns/turn-000000.json`
  - `save/agents/<playerTurnAgent>/context.json`
  - `save/playthrough/setup-summary.json`
- Fresh setup completion does not rely on `save/playthrough/opening-narrative.json` for play UI.
- Entering play shows the opening through normal history rendering.
- Initial options embedded in the opening assistant content are parsed into default frontend options.
- First formal player send starts as turn 1 and the model debug messages include the turn 0 assistant context through `context.json`.
- Restore to the turn 0 checkpoint keeps the opening and prunes later turns.

## Risk / Rollback Points

- `workspace-templates.ts` contains large AI-facing string templates. After editing, grep for stale `opening-narrative.json` mentions in Step4-facing text and ensure any remaining mentions belong to intentionally retained legacy/opening-modeling paths.
- `StoryView` currently infers turn numbers by counting user messages; assistant-only turn 0 is a special case. Verify checkpoint marker placement and older-turn window behavior.
- `turnCount` has mixed comments/usage around next-turn vs completed-turn semantics. If changing realtime assignment, verify AppHeader, TurnMeta, restore dialog `turnsAfter`, and sync-after-turn still behave correctly.
- Removing `openingNarrative` frontend state is future-only. Do not add compatibility fallback unless the scope is reopened.

## Completion Gate

Before `task.py start`, confirm:

- `prd.md`, `design.md`, and `implement.md` match the current product decisions.
- No unresolved product questions remain for child A.
- Child B remains separate and is not pulled into this implementation.
