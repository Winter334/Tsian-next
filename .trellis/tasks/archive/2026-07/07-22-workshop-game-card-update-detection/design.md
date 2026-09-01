# 创意工坊游戏卡更新检测 - Design

## Scope

This task is a platform-web-only MVP for detecting updates of workshop-installed game cards. It uses the existing market package contract and local IndexedDB card records. It does not change backend contracts or add changelog/content-hash support.

## Data Model

### Local game card origin

Extend `LocalGameCardRecord` with an optional workshop origin field, for example:

```ts
export interface LocalGameCardMarketOrigin {
  packageId: string
  resourceId: string
  resourceVersion: string
}

export interface LocalGameCardRecord {
  id: string
  manifest: GameCardManifest
  source: "builtin" | "local" | "imported"
  marketOrigin?: LocalGameCardMarketOrigin
  createdAt: number
  updatedAt: number
}
```

The field is optional so old records and non-workshop imports remain valid at runtime, but adding it to the stored table shape still requires the prototype DB rename convention.

### IndexedDB name bump

The storage spec requires a DB name bump for Dexie table shape changes and a matching Service Worker literal update. The implementation should:

- rename `tsian-agent-runtime-v13` to a new version in `storage/db.ts`
- update the same literal and comment in `public/tsian-game-card-frontend-sw.js`
- update `.trellis/spec/platform-web/storage/index.md` only if we decide this new field should become a lasting storage convention during finish/spec-update

No migration is expected. Old local data is abandoned by the prototype rename-and-reset convention.

## Import / Install Flow

### Storage import option

Add an optional import option to the game-card package import path:

```ts
interface GameCardPackageImportOptions {
  marketOrigin?: LocalGameCardMarketOrigin
}
```

`importGameCardPackage(input, options?)` passes `options.marketOrigin` into `putLocalGameCard`.

`putLocalGameCard` accepts `marketOrigin?: LocalGameCardMarketOrigin | null`:

- `undefined`: preserve existing `marketOrigin` when only ordinary metadata/content writes happen.
- object: normalize and store the new workshop origin.
- `null`: clear origin if a future caller needs it. This task likely does not need a clear operation.

Workshop install/update should pass the object. Local file import should omit it so it does not accidentally bind a disk import to any workshop entry.

### Platform-host boundary

Expose a typed wrapper through `platform-host/game-cards.ts` / `platform-host/index.ts`, for example:

```ts
importPlatformGameCardPackage(input, options?)
```

Components call platform-host functions rather than storage helpers directly, preserving the existing boundary.

### Market install

`AppMarketView.vue` already has the `MarketPackage` at install time. For game cards:

1. download package by `pkg.id`
2. inspect manifest to warn if same local card exists
3. call `importPlatformGameCardPackage(blob, { marketOrigin: originFromMarketPackage(pkg) })`
4. after successful import, emit existing game-card changed events and refresh update status

The stored `resourceVersion` should come from `pkg.resourceVersion`, not from the downloaded package manifest.

## Update Detection State

### New focused module

Create a focused module for workshop game-card update state rather than piling global state into `DesktopShell.vue`, `GameCardLibraryView.vue`, or `platform-host/index.ts`.

Recommended placement:

- `apps/platform-web/src/platform-host/game-card-updates.ts`

Responsibilities:

- list local game cards
- filter cards with `marketOrigin.packageId`
- fetch remote `MarketPackage` via `marketApi.get(packageId)`
- compare trimmed `resourceVersion` strings
- maintain in-memory last successful update results
- expose readonly status for Vue consumers
- expose explicit commands:
  - `refreshWorkshopGameCardUpdates(options?)`
  - `getWorkshopGameCardUpdate(cardId)`
  - `listWorkshopGameCardUpdates()`
  - `hasWorkshopGameCardUpdates`
  - `schedule...` only if needed by boot/visibility wiring

Because the app does not use Pinia/global store libraries, this can mirror the `useAnnouncements` singleton pattern with module-level Vue refs/computed and explicit refresh commands.

### Detection result shape

Recommended runtime shape:

```ts
export interface WorkshopGameCardUpdateInfo {
  cardId: string
  packageId: string
  resourceId: string
  currentVersion: string
  latestVersion: string
  package: MarketPackage
}
```

Only records whose remote fetch succeeds and whose `latestVersion !== currentVersion` appear as updates.

### Failure behavior

- A full refresh should not clear previous successful update results if network/API errors occur.
- If a package fetch returns 404/hidden/forbidden, treat it as a failed check for now and preserve previous results. Do not invent a “removed from workshop” UX in this task.
- When a successful refresh finds no updates, clear the update map.

### Request volume

MVP may query packages one by one by `packageId`, because no batch API exists. Use a short freshness window to avoid immediate duplicate refresh:

- Start/open My Apps: if last successful check or in-flight check is fresh enough, reuse it.
- Suggested minimum repeat interval: 60 seconds for foreground actions.
- Visibility resume: only refresh if last successful check is older than 10 minutes.

## UI Integration

### Boot and visibility

In `App.vue`, after `initializePlatformHost()` succeeds, start a non-blocking background refresh. Also add a document visibility listener:

- when `document.visibilityState === "visible"`
- if last successful refresh is older than 10 minutes
- refresh in background

Clean up listener on unmount.

### Desktop icon badge

`DesktopShell.vue` renders launchers from `desktopLaunchers`. Add a badge only when:

- launcher id is `my-apps`
- `hasWorkshopGameCardUpdates` is true

Badge text is exactly `更新`.

Do not show counts or versions on desktop icons.

### My Apps card badge and action

`GameCardLibraryView.vue` consumes update state and refreshes on mount/open. Each card tile checks `getWorkshopGameCardUpdate(card.id)`.

For cards with update info:

- render a short `更新` badge on the card preview
- expose a click target for update. The badge can be the click target; avoid making the whole card open action ambiguous.
- use `@click.stop` so update does not open the card detail route.

Confirmation dialog:

- title: `发现新版本`
- message includes current and latest versions and the fixed replacement/save-preservation sentence
- confirm text: `更新`
- cancel text: existing default is acceptable unless the confirm helper supports explicit cancel text

On confirm:

1. download `update.package.id`
2. import with `marketOrigin` rebuilt from the remote package
3. toast success
4. refresh local cards
5. refresh update state with a force option

Existing saves are preserved because same-id `putLocalGameCard` replaces card content/frontend rows but does not delete saves. Keep the existing affected-save warning only where it already exists for manual market install; My Apps update confirmation does not need backup/diff/merge messaging.

## Compatibility / Edge Cases

- Old cards without `marketOrigin`: ignored.
- Local file imports: no origin, ignored.
- Same `resourceId` across multiple packages: ignored; only stored `packageId` matters.
- `resourceVersion` blank: backend validation should prevent blank packages. Locally, normalize by trimming; if either side trims to empty, skip update detection for that item rather than showing a broken badge.
- Remote fetch failure: preserve previous state and surface no player-facing error.
- Remote version equals local source version but local manifest version differs: no workshop update badge; save-version confirmation remains a separate existing feature.

## Future Changelog Hook

Do not add changelog fields now. The confirmation UI can be structured so a future optional changelog block can be inserted when the contract provides it, but current implementation should not add fake placeholders.
