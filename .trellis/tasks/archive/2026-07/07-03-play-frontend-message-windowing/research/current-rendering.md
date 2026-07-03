# Message Windowing Research

## Current Rendering Evidence

- `apps/play-frontend-dev/src/composables/useTsian.ts:38` defines `StreamItem` as a flat ordered stream.
- `apps/play-frontend-dev/src/composables/useTsian.ts:47` stores all visible history and live items in module-level `stream`.
- `apps/play-frontend-dev/src/composables/useTsian.ts:338` `reloadHistory()` calls `tsian.history.get()` and flattens every `SessionHistoryEntry.timeline` item into `stream.value`.
- `apps/play-frontend-dev/src/components/story/StoryView.vue:137` computes `mergedStream` by scanning full `stream.value` every time.
- `apps/play-frontend-dev/src/components/story/StoryView.vue:243` renders all `mergedStream` items with `v-for`.
- `packages/play-bridge/src/session-history.ts:22` documents that session history currently returns all turns in one RPC.
- `docs/active/storage-render-refactor-plan.md:8` records the product direction that player-visible history remains complete and separate from agent context compression.

## Current Interaction / Styling Evidence

- `apps/play-frontend-dev/src/composables/useTurnState.ts:23` tracks whether the user is pinned to bottom by distance `< 80`.
- `apps/play-frontend-dev/src/composables/useTurnState.ts:60` auto-scrolls only while pinned.
- `apps/play-frontend-dev/src/components/story/StoryView.vue:50` watches streaming text, stream length, and options to call `maybeScrollDown()` after DOM updates.
- `apps/play-frontend-dev/src/lib/tokens.css:3` defines the visual direction as “烛火书卷·重铸”; key tokens are `--void`, `--ember`, `--ember-bright`, `--whisper`, `--line`, `--font-serif`, and `--font-mono`.
- `apps/play-frontend-dev/src/components/checkpoints/CheckpointMark.vue:2` uses ember divider lines + small glyph as an in-flow ritual marker; useful visual reference for low-key history loading status.

## Relevant Contract Facts

- `packages/contracts/src/bridge.ts:230` defines `SessionHistoryEntry` with `turn`, `createdAt`, and ordered `timeline`.
- `packages/contracts/src/runtime.ts:96` defines `TurnTimelineItem` variants: `user`, `assistant`, `interim`, `thought`, `tool`, `options`.
- `packages/contracts/src/runtime.ts:87` says `options` is persisted in timeline and reload restores it naturally.
- The task MVP should not modify these contracts or bridge API.

## Planning Decisions

- User accepted automatic loading of older history near the top.
- User requested a quick jump-to-bottom / latest-content button.
- User accepted the recommended “渐进展开” MVP: initial recent turn window expands upward as the user scrolls up, without strict dynamic-height virtualization.
- User requested UI/UX changes to follow existing frontend style and be discussed before implementation when visible design decisions are needed.
- User selected the low-key floating marker for “回到最近内容”: show only when away from bottom, placed near the narrative column lower-right above Composer, ember line/glyph styling, smooth scroll to bottom. Top loading should be a subtle “翻阅更早记忆…” status.

## Design Implications

- Keep full history available in memory for MVP, but reduce initial DOM and `mergedStream` work by deriving the rendered list from a visible turn cutoff.
- A turn-aware render model is preferable to slicing arbitrary stream indexes, because checkpoint placement and `turnsAfter` already use turn numbers.
- Preserve existing bottom-pinned auto-scroll behavior and expose `userPinnedToBottom` or an equivalent signal for the low-key bottom float.
- When prepending older turns, compensate `scrollTop` by the `scrollHeight` delta after DOM update so the user's viewport does not jump.
