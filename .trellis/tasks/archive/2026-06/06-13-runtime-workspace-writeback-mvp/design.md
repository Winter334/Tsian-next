# Native AIRP History Writeback Design

## Boundary

The MVP adds a platform-owned deterministic writeback for the raw AIRP exchange of each successful turn.

It does not add an Agent-authored memory step, summary maintenance, vector search, memory ranking, or gameplay-specific schema. Agent Runtime continues to produce the master plan and final narrative reply as it does today. The platform host persists the final player-facing exchange into Runtime Workspace after the turn succeeds.

## File Contract

Raw history is stored as one JSON file per turn:

```text
history/turns/turn-000001.json
history/turns/turn-000002.json
```

Each file uses media type `application/json` and contains only the player-facing exchange plus minimal metadata:

```json
{
  "schema": "tsian.airp.history.turn.v1",
  "turn": 1,
  "createdAt": "2026-06-13T00:00:00.000Z",
  "source": {
    "kind": "agent-runtime",
    "masterAgentId": "master",
    "narrativeAgentId": "narrative"
  },
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

The file must not include model prompts, hidden master briefs, tool observations, trace events, or delegated Agent intermediate outputs.

## Data Flow

1. `interaction.sendMessage` receives non-empty player input.
2. The platform initializes and lists Runtime Workspace files.
3. `runAgentRuntimeTurn` produces the final narrative reply.
4. The platform checks for abort, then builds the next snapshot/history.
5. The platform writes the raw AIRP history file into `history/turns/turn-*.json` and syncs the in-memory `workspaceFiles` array.
6. The platform writes the runtime trace file under `.tsian/traces/`.
7. The platform persists snapshot/history and creates the after-turn checkpoint.

If the turn fails or is aborted before the final reply is accepted, no raw history file is written. If a later storage step fails after the raw history file has been written, the host should best-effort restore the previous file content or delete the newly-created path before rethrowing, so failed turns do not leave ordinary history records behind.

## Retrieval

The MVP relies on existing Runtime Workspace access:

- `workspace_list("history/turns")` discovers turn files.
- `workspace_read("history/turns/turn-000123.json")` reads a precise turn.
- `workspace_search({ query, path: "history/turns" })` can return matching individual turn files because each turn is stored separately.

No dedicated `history_search`, full-text index, BM25, vector search, or semantic recall tool is added in this task.

## Manual Correction

Future workspace editing can modify the raw turn JSON file directly. The MVP does not add an amendment or revision overlay. Checkpoint/restore and trace are sufficient recovery support for this stage.

## Compatibility

- Existing `saveHistory` and snapshots remain unchanged and continue to support the current frontend chat display.
- Workspace raw history duplicates the player-facing exchange intentionally: it is the save-scoped native fallback memory record.
- Existing saves are not backfilled. They will start receiving `history/turns/turn-*.json` files on future successful turns after this change.
- Default workspace docs should mention `history/turns/` as the raw AIRP history location.

## Rollback

The change is isolated to Runtime Workspace writeback and default workspace documentation. Removing the write call restores the previous behavior without changing Agent Runtime generation or existing storage tables.
