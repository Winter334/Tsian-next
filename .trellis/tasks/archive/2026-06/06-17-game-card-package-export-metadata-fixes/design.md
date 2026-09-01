# Design

## Root Causes

- Built-in card refresh currently treats `manifest.frontend` as a reason to regenerate the built-in record. That is correct for old stale built-ins, but wrong once the UI allows users to bind a frontend for local testing.
- Package export records `coverFiles` in the contract but does not actually produce cover file entries.
- Package import accepts `coverFiles` in the manifest but ignores `cover/*` zip entries.
- Built-in card import rejection is correct, but the UI lacks a simple way to create a local copy with a distinct manifest id.

## Storage And Package Shape

- Continue using `.tsian-card.zip` with `game-card.json`, `workspace/*`, optional `frontend/*`, and optional `cover/*`.
- On export, when cover data can be resolved, write one binary cover file under `cover/`.
- On import, convert bundled cover data into a card-owned content file under `.cover/` with base64 content and set `manifest.cover.workspacePath` to that path. This matches existing display behavior in `getGameCardCoverUrl`, which can render image media types from card content.
- Leave external remote cover URLs alone when they cannot be safely bundled.

## Built-In Card Persistence

- The built-in blank card can still be refreshed for default content updates.
- User-configured `manifest.frontend` must not by itself make the built-in card stale.
- When a stale built-in is refreshed for default cover/content changes, preserve the existing frontend binding where possible.

## Metadata / Copy Flow

- Add a minimal metadata panel in Game Card Detail Overview.
- Allow editing local/imported card name, version, summary, and description in place.
- Allow creating a local copy with a distinct id from any card, including the built-in blank card.
- Do not overwrite the built-in blank card id through import or direct metadata writes.
- Copying a card should copy card content and packaged frontend files, but not saves.

## Boundaries

- Vue route views call platform-host helpers only.
- Storage helpers own package import/export and local card persistence.
- No contract shape change is planned.
