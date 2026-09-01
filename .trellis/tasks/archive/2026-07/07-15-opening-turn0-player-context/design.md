# Design: 开局正文纳入 turn 0 history 并 seed 玩家回合上下文

## Scope

This child task fixes the future setup flow only. It does not migrate existing saves and does not introduce the generic reply projection system. Options remain embedded in assistant text and are parsed/rendered by the frontend convention.

## Current Flow

1. Step4 `commit_play_setup` writes setup artifacts, including `save/playthrough/opening-narrative.json` (`apps/platform-web/src/storage/workspace-templates.ts:1792`).
2. The default frontend reads `opening-narrative.json` through `loadOpeningNarrative()` and renders it before formal history (`apps/play-frontend-dev/src/composables/useTsian.ts:332`, `apps/play-frontend-dev/src/components/story/StoryView.vue:386`).
3. Formal UI history is rebuilt from `save/history/turns/turn-*.json` (`apps/platform-web/src/platform-host/history-turns.ts:223`).
4. Formal player-turn LLM context comes from the player-turn Agent context snapshot when present (`apps/platform-web/src/platform-host/index.ts:916`, `apps/platform-web/src/agent-runtime/index.ts:251`).
5. Because `opening-narrative.json` is only a UI-side special source, the first formal LLM turn cannot see the opening body.

## Target Flow

Step4 completion writes the opening reply to the same two persistent surfaces that formal turns already use:

1. **UI history**: `save/history/turns/turn-000000.json` with one assistant timeline item.
2. **LLM continuity**: `save/agents/<playerTurnAgent>/context.json` seeded with one turn 0 assistant context entry.

The default frontend then enters play and calls normal history loading. The opening is just the earliest assistant item in the stream.

## Data Contracts

### Turn 0 History File

Path:

```text
save/history/turns/turn-000000.json
```

Shape matches the existing raw AIRP history turn schema:

```json
{
  "schema": "tsian.airp.history.turn.v2",
  "turn": 0,
  "createdAt": "<ISO timestamp>",
  "source": {
    "kind": "agent-runtime",
    "entryAgentId": "<playerTurnAgentId>"
  },
  "timeline": [
    {
      "kind": "assistant",
      "content": "<opening assistant reply, including any embedded option markers>"
    }
  ]
}
```

Notes:

- Turn 0 is assistant-only by product decision.
- Options are not stored as a dedicated timeline item. They remain embedded in the assistant content.
- `getMaxTurnFromTurnFiles()` already treats turn 0 as max 0, so the first formal player turn remains turn 1.
- Checkpoint restore prunes append-only logs with `turn > targetTurn`; restoring to turn 0 keeps this file and deletes later formal turns.

### Player-Turn Agent Context Seed

Path:

```text
save/agents/<playerTurnAgentId>/context.json
```

Shape:

```json
{
  "schema": "tsian.agent.context.v1",
  "saveId": "",
  "agentId": "<playerTurnAgentId>",
  "summary": null,
  "recentTurns": [
    {
      "turn": 0,
      "role": "assistant",
      "content": "<opening assistant reply>"
    }
  ],
  "lastCompressedTurn": null,
  "updatedAt": "<ISO timestamp>"
}
```

Notes:

- `saveId` can be an empty string because `parseAgentContext()` normalizes it with the active save id at runtime.
- `summary` stays `null`; setup summary is not repurposed as compression summary.
- Context is overwritten by Step4 completion. No merge/backfill path is required in this future-only task.

## Player-Turn Agent Resolution

The Step4 browser script should not hardcode `storyteller`. It should read `game-card.json` from the effective workspace and use `manifest.runtime.entrypoints.playerTurn`.

Failure behavior:

- Missing/blank player-turn entrypoint: fail loud before any writes.
- Unsafe path segment: fail loud before any writes. Reject empty strings, `/`, `\\`, NUL, `.`, and `..`.

## Opening Artifact Removal / Stop-Use

`save/playthrough/opening-narrative.json` is no longer the UI source and should be removed from the default template/runtime docs for future saves. Existing old saves are out of scope.

Setup still needs `save/playthrough/setup-summary.json` for wizard/play-mode restoration and `enteredPlay`; that file remains.

## Default Frontend Changes

### History Loading

`reloadHistory()` should continue iterating `SessionHistoryEntry.timeline`. For assistant items it should parse embedded option markers with `parseStoryOptions()` and push only clean narrative text into `stream`, as it does today.

The last available options should be restored from the latest assistant item with embedded markers, not only from legacy `{ kind: "options" }` timeline items. Legacy `options` items may remain as a fallback for old records, but future turn 0 and formal turns use embedded markers.

### Opening Rendering

Remove the separate `openingNarrative` ref and the special `StoryView` block that renders it before `stream`. The opening assistant item appears via normal history rendering.

If the visual opening style is still desired, derive it from turn attribution in the merged stream (assistant item in turn 0) rather than from a separate `openingNarrative` source.

### Turn / Checkpoint UI

Current `StoryView` attributes turns by counting user messages. With assistant-only turn 0, the first assistant before any user naturally belongs to current turn 0.

The current checkpoint rendering inserts a turn 0 checkpoint before the stream and also inserts checkpoints after assistant items by current turn. With turn 0 in the stream, avoid duplicating the turn 0 checkpoint; prefer rendering checkpoint 0 after the turn 0 assistant item.

### `turnCount` Semantics

`SessionHistory.turn` is the next turn number (`max turn + 1`). With only turn 0 present it is `1`, which means the next formal player turn is turn 1 and displayed completed formal turns are still `turnCount - 1 = 0`.

Realtime `onTurnEnd` currently sets `turnCount` to the completed turn payload. If this causes the UI to stay one step behind after a completed turn, normalize it in this child task so the reactive value remains the next turn number after realtime completion.

## Checkpoint Interaction

The existing Step5 "进入故事" flow creates a turn 0 manual checkpoint after setup. Turn files are append-only logs and are excluded from checkpoint manifests; this is fine because restore-to-turn keeps logs with `turn <= targetTurn`. The manual checkpoint should continue to represent the post-setup state and should not block entering play if checkpoint creation fails.

## Out of Scope

- Old save migration/backfill.
- Generic `content` / `displayContent` / `projections` reply pipeline.
- Platform-host hardcoded opening-file injection.
- Dedicated `options` timeline schema for new turns.
