# Implementation Plan: 游戏前端长历史消息窗口化渲染优化

## Checklist

1. Update `StoryView.vue` render planning comments to describe turn-window rendering instead of full-stream rendering.
2. Add window constants and view-local state:
   - `INITIAL_VISIBLE_TURNS`
   - `LOAD_OLDER_TURNS`
   - `TOP_LOAD_THRESHOLD`
   - `visibleStartTurn`
   - small loading guard for top expansion.
3. Add helpers in `StoryView.vue`:
   - derive the latest/recent visible start turn from `turnCount`.
   - map a `StreamItem` to its owning turn while scanning.
   - compute `visibleStream` from full `stream.value` and `visibleStartTurn`.
   - reset window to latest content.
   - load older turn window with scroll-height compensation.
4. Modify `mergedStream` to consume `visibleStream` and initialize `currentTurn` from `visibleStartTurn - 1`.
5. Gate opening narrative and initial checkpoint rendering so they appear only when the earliest turn is visible.
6. Wire scroll handling:
   - use `userPinnedToBottom` returned by `useTurnState()` for bottom-float visibility.
   - add an `@scroll` handler on `.story-scroll` that calls the turn-state scroll handler and triggers top auto-load.
   - ensure old event listener behavior in `useTurnState` is not duplicated or, if needed, expose `handleScroll` from the composable and bind once in template.
7. Add low-key top loading/status row in the template.
8. Add low-key floating “回到最近内容” control:
   - visible only away from bottom.
   - smooth-scrolls to bottom.
   - follows ember/whisper/token visual style.
9. Adjust watchers:
   - stream length changes should keep bottom-follow behavior when pinned.
   - when pinned and a new turn arrives, keep/reset to latest recent window so DOM remains bounded during normal play.
   - restore should reset the window after history reload.
10. Preserve existing behaviors:
    - sending, streaming, stop, options, TurnMeta.
    - checkpoint restore confirmation math.
    - opening narrative and empty state.
11. Run validation:
    - `npm run build --workspace play-frontend-dev`.
    - `npm run build:web` if implementation touches `apps/platform-web` (expected: not touched).

## Risky Points / Review Focus

- Scroll compensation when prepending older turns: capture `scrollHeight` before expanding; after `nextTick`, add the height delta to `scrollTop`.
- `currentTurn` inside `mergedStream` must remain correct after slicing away earlier turns, otherwise checkpoint marks and `turnsAfter` can be wrong.
- `openingNarrative` must not appear above a recent-only window unless turn 1 is visible.
- Avoid duplicate scroll listeners: `useTurnState` currently attaches a DOM listener internally, so implementation should either extend it carefully or replace it with a single template-bound handler.
- Avoid broad UI redesign; the only visible additions are the subtle top loading row and low-key bottom float.

## Validation Notes

Manual/visual checks after build:

- Short history: no “load older” affordance noise; empty state and opening narrative still behave.
- Long history: first render shows recent turns only; scrolling up auto-loads older turns without viewport jump.
- Away from bottom: low-key float appears; clicking it returns to latest content and hides the float.
- During streaming: auto-scroll only when pinned; if reading old history, streaming should not yank the viewport.
- After checkpoint restore: future messages disappear, options are recalculated, and the window shows latest content for the restored history.
