// Platform entity-level event bus.
//
// Mirrors lib/workspace-events.ts: window.dispatchEvent + CustomEvent + type
// guard, no payload. Subscribers respond by re-reading their own data via
// platform/storage APIs (per state-management.md: "Route views should refresh
// from platform/storage APIs after mutations"), so events carry no detail —
// a subscriber's refresh is always a full read, and a payload would only
// introduce "detail doesn't match my context" false-negatives.
//
// Events:
// - game-cards-changed: game card list mutated (create/delete/import/copy)
// - active-card-changed: active game card switched (load/new card activated)
// - saves-changed: save list mutated (create/delete/select)
// - frontend-reload: a game card's frontend/src changed + rebuilt; PlayView
//   in playing/ready state should remount the iframe to pick up new dist.
//     (No payload — PlayView re-resolves the active card's frontend URL.)
// - frontend-rebuilding: a card's frontend rebuild just started (status →
//   "building"). PlayView shows a "rebuilding" overlay so the player knows a
//   reload is coming. Cleared by frontend-reload (success → remount) or
//   frontend-rebuild-settled (failed → keep old dist, hide overlay).

export const GAME_CARDS_CHANGED_EVENT = "tsian:game-cards-changed"
export const ACTIVE_CARD_CHANGED_EVENT = "tsian:active-card-changed"
export const SAVES_CHANGED_EVENT = "tsian:saves-changed"
export const FRONTEND_RELOAD_EVENT = "tsian:frontend-reload"
export const FRONTEND_REBUILDING_EVENT = "tsian:frontend-rebuilding"
export const FRONTEND_REBUILD_SETTLED_EVENT = "tsian:frontend-rebuild-settled"

export function emitGameCardsChanged(): void {
  window.dispatchEvent(new CustomEvent(GAME_CARDS_CHANGED_EVENT))
}

export function emitActiveCardChanged(): void {
  window.dispatchEvent(new CustomEvent(ACTIVE_CARD_CHANGED_EVENT))
}

export function emitSavesChanged(): void {
  window.dispatchEvent(new CustomEvent(SAVES_CHANGED_EVENT))
}

export function emitFrontendReload(): void {
  window.dispatchEvent(new CustomEvent(FRONTEND_RELOAD_EVENT))
}

export function emitFrontendRebuilding(): void {
  window.dispatchEvent(new CustomEvent(FRONTEND_REBUILDING_EVENT))
}

export function emitFrontendRebuildSettled(): void {
  window.dispatchEvent(new CustomEvent(FRONTEND_REBUILD_SETTLED_EVENT))
}

export function isGameCardsChangedEvent(event: Event): event is CustomEvent<void> {
  return event.type === GAME_CARDS_CHANGED_EVENT && event instanceof CustomEvent
}

export function isActiveCardChangedEvent(event: Event): event is CustomEvent<void> {
  return event.type === ACTIVE_CARD_CHANGED_EVENT && event instanceof CustomEvent
}

export function isSavesChangedEvent(event: Event): event is CustomEvent<void> {
  return event.type === SAVES_CHANGED_EVENT && event instanceof CustomEvent
}

export function isFrontendReloadEvent(event: Event): event is CustomEvent<void> {
  return event.type === FRONTEND_RELOAD_EVENT && event instanceof CustomEvent
}

export function isFrontendRebuildingEvent(event: Event): event is CustomEvent<void> {
  return event.type === FRONTEND_REBUILDING_EVENT && event instanceof CustomEvent
}

export function isFrontendRebuildSettledEvent(event: Event): event is CustomEvent<void> {
  return event.type === FRONTEND_REBUILD_SETTLED_EVENT && event instanceof CustomEvent
}
