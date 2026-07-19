# Implement: 时间线注入轻量 MVP

## Scope

Only edit:
- `apps/play-frontend-dev/src/lib/context-injection.ts`

Do not edit:
- `cards/沉浸阅读器.tsian-card/frontend/src/lib/context-injection.ts`
- platform contracts
- stage-manager / world-architect tools
- frontier schema files

## Steps

1. Import frontier parsing/types
   - Import `parseFrontier` from `./parse-frontier`.
   - Import `SourceAnchor` / `PlayerAnchor` types if useful.

2. Add helper functions
   - `selectNearbySourceAnchors(timeline, plotOrder)`:
     - source anchors with `order <= plotOrder`: last 2
     - source anchors with `order > plotOrder`: first 3
   - `selectRecentPlayerAnchors(timeline)`:
     - last 3 player anchors, preferably sorted by `turn` when available.
   - `formatTimelineBlock(runtime, frontier)`:
     - include current `plotOrder` and `worldTime`
     - include source window entries with `order/chapter/time/label`
     - include recent player entries with `turn/time/label/alignment/sourceRef`
     - include semantic boundary text: direction, not already-happened facts or mandatory script.

3. Extend `buildContextInjection`
   - After runtime/world block is pushed, attempt to read `save/playthrough/frontier.json` using the existing `workspace.read(path, "save-runtime")` contract.
   - Wrap read and JSON parse in `try/catch`.
   - On any failure/null/invalid parse, skip timeline block.
   - On success with non-empty formatted block, push:
     ```ts
     {
       role: "user",
       content: formatTimelineBlock(...),
       position: "before-input",
     }
     ```
   - Keep existing scene/protagonist blocking behavior unchanged.

4. Keep comments aligned
   - Update top comment from “3 类 block” to include timeline.
   - Update build sequence comment to mention optional timeline block and skip-on-failure behavior.

## Validation

Run focused validation for the dev frontend/package as available:
- TypeScript check or package build for `apps/play-frontend-dev`.
- If no dedicated script exists, run the nearest repo lint/typecheck command that covers this file.

Manual/code review checks:
- `frontier.json` failure path cannot return blocked.
- `scene-load-failed` and `protagonist-load-failed` semantics remain unchanged.
- No `ifLineStatus`, `pending`, `fired`, or `superseded` additions.
- No edits under `cards/沉浸阅读器.tsian-card/frontend/src/lib/context-injection.ts`.

## Rollback

Revert only the changes in `apps/play-frontend-dev/src/lib/context-injection.ts`; no data migration is needed because the feature writes no persistent state.
