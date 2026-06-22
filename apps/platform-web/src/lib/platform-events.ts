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

export const GAME_CARDS_CHANGED_EVENT = "tsian:game-cards-changed"
export const ACTIVE_CARD_CHANGED_EVENT = "tsian:active-card-changed"
export const SAVES_CHANGED_EVENT = "tsian:saves-changed"

export function emitGameCardsChanged(): void {
  window.dispatchEvent(new CustomEvent(GAME_CARDS_CHANGED_EVENT))
}

export function emitActiveCardChanged(): void {
  window.dispatchEvent(new CustomEvent(ACTIVE_CARD_CHANGED_EVENT))
}

export function emitSavesChanged(): void {
  window.dispatchEvent(new CustomEvent(SAVES_CHANGED_EVENT))
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
