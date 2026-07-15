# 开局正文纳入 turn 0 history 并 seed 玩家回合上下文

## Goal

Fix the current bug where the Step4 interview-generated opening narrative is shown in the UI but not sent to the player-turn LLM. Future setup completion should write the opening as formal turn 0 history for UI replay and seed the player-turn Agent context so the first real player turn can continue from it.

## Background / Confirmed Facts

- Step4 currently writes the opening body to `save/playthrough/opening-narrative.json` from `commit_play_setup`: `apps/platform-web/src/storage/workspace-templates.ts:1792`.
- The default frontend reads that file into `openingNarrative` and renders it as a special pre-history block: `apps/play-frontend-dev/src/composables/useTsian.ts:332`, `apps/play-frontend-dev/src/components/story/StoryView.vue:387`.
- Formal turn history is reconstructed from `save/history/turns/turn-*.json`: `apps/platform-web/src/platform-host/history-turns.ts:223`.
- Formal player turns stage a raw AIRP history turn file after a successful LLM reply: `apps/platform-web/src/platform-host/index.ts:1085`.
- The player-turn runtime reads `save/agents/<playerTurnAgent>/context.json` and expands its `recentTurns` into model messages: `apps/platform-web/src/platform-host/index.ts:916`, `apps/platform-web/src/agent-runtime/index.ts:251`.
- Browser Skill scripts can write workspace files through `tsian.workspace.write`; the Step4 script is already the owner of setup-summary/opening persistence.

## Requirements

- R1: Future-only scope. No old-save backfill, no first-send repair, and no manual Step4 rerun path are required.
- R2: Step4 setup completion must write the opening assistant content into formal turn history as turn 0 instead of relying on `opening-narrative.json` as the UI source.
- R3: Step4 setup completion must seed the player-turn Agent context at `save/agents/<playerTurnAgent>/context.json`, so the first formal player turn includes the opening content in LLM-visible history.
- R4: The context seed should use a single assistant turn 0 entry. Do not add a synthetic user entry.
- R5: The player-turn Agent id should be resolved from the game card manifest (`runtime.entrypoints.playerTurn`) rather than hardcoding `storyteller`.
- R6: Options remain part of assistant content. Do not add a dedicated turn timeline `options` field for the opening.
- R7: Platform host/runtime must not special-case `save/playthrough/opening-narrative.json` or any other default-game-card opening file as a prompt source.
- R8: The default frontend should render the opening through the same history stream used for later turns, not through a separate `openingNarrative` ref/file source.
- R9: The implementation should leave the general regex/projection system out of scope; any interim option parsing should stay consistent with existing default-frontend behavior.

## Acceptance Criteria

- [ ] A fresh Step4 completion writes `save/history/turns/turn-000000.json` with an assistant timeline item containing the opening assistant content.
- [ ] A fresh Step4 completion writes `save/agents/<playerTurnAgent>/context.json` with a turn 0 assistant context entry containing the opening content needed for LLM continuity.
- [ ] Entering play renders the opening from history reconstruction, not from `save/playthrough/opening-narrative.json`.
- [ ] The first real player turn's LLM-visible messages include the opening content via player-turn Agent context.
- [ ] No dedicated `options` timeline item is introduced for initial choices; options, if present, remain embedded in assistant content and are interpreted by frontend conventions.
- [ ] No platform-host hardcoded opening-file prompt injection is introduced.
- [ ] `npm run build:web` passes after implementation.

## Out of Scope

- Migrating or repairing existing saves that already completed Step4.
- General reply regex/projection architecture (`content` / `displayContent` / `projections`).
- Security/sanitizer/ReDoS defenses for future projection rules.
