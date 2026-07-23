# 创意工坊游戏卡更新检测 - Implementation Plan

## Preconditions

- Task remains in planning until these artifacts are reviewed.
- Before code edits in Phase 2, load `trellis-before-dev` for the relevant platform-web frontend/storage specs.

## Implementation Checklist

1. **Storage schema and types**
   - Add `LocalGameCardMarketOrigin` and optional `marketOrigin` to `LocalGameCardRecord` in `apps/platform-web/src/storage/db.ts`.
   - Add normalization helper for market origin strings.
   - Extend `PutLocalGameCardInput` in `apps/platform-web/src/storage/game-cards.ts` to accept `marketOrigin?: LocalGameCardMarketOrigin | null`.
   - Preserve existing origin on `undefined`, store normalized origin on object, clear on `null` if implemented.
   - Bump Dexie DB name in `storage/db.ts` and matching `public/tsian-game-card-frontend-sw.js` literal/comment.

2. **Package import origin propagation**
   - Extend `importGameCardPackage(input, options?)` in `storage/game-card-packages.ts` to pass `marketOrigin` to `putLocalGameCard`.
   - Extend the platform-host wrapper `importPlatformGameCardPackage` in `platform-host/game-cards.ts` and re-export type/options through `platform-host/index.ts` as needed.
   - Keep ordinary local file import calls unchanged so they pass no origin.

3. **Workshop install writes origin**
   - In `AppMarketView.vue`, build origin from the current `MarketPackage` (`id`, `resourceId`, `resourceVersion`).
   - Pass it when installing game-card packages from the market.
   - Keep existing same-card overwrite/save-warning behavior.

4. **Update detection module**
   - Add focused module `apps/platform-web/src/platform-host/game-card-updates.ts`.
   - Implement singleton reactive state for update map, loading/in-flight promise, last successful checked timestamp, and silent error retention.
   - Implement `refreshWorkshopGameCardUpdates({ force?: boolean, minIntervalMs?: number })`.
   - Compare trimmed local origin `resourceVersion` and remote `resourceVersion` for equality only.
   - Export accessors/computed for `hasWorkshopGameCardUpdates`, `getWorkshopGameCardUpdate`, and list/count if useful.
   - Re-export through `platform-host/index.ts`.

5. **Boot and visibility triggers**
   - In `App.vue`, after `initializePlatformHost()`, start background refresh without blocking splash/desktop.
   - Register visibilitychange listener; on visible, refresh only if last successful check is older than 10 minutes.
   - Do not toast or show errors for update-check failures.

6. **Desktop badge**
   - In `DesktopShell.vue`, consume update state and render badge `更新` only on launcher id `my-apps` when any updates exist.
   - Keep badge concise, high-contrast, and visually consistent with card-level badge.
   - Ensure no badge appears on `market` or `play` launchers.

7. **My Apps badge and update action**
   - In `GameCardLibraryView.vue`, refresh update state on mount/open with a short min interval.
   - Render `更新` badge on each updated card tile.
   - Add update click handler that stops propagation, asks for confirmation, downloads by stored/remote package id, imports with origin from the remote package, then refreshes cards and update state.
   - Confirmation copy: current version, latest version, and “更新会替换本地游戏卡内容，已有存档会保留。”
   - Do not add backup, diff, merge, details, changelog, or ignore-version UI.

8. **Cross-view refresh after installs**
   - After market install/update succeeds, force refresh update state so stale badges disappear.
   - Existing `GAME_CARDS_CHANGED_EVENT` subscribers should still refresh their own card lists.

## Validation Commands

- `git diff --check`
- `npm run build:web`

If contract shapes are unexpectedly changed, also run:

- `npm run build:contracts`

## Manual Verification Matrix

- New market game-card install stores origin and does not immediately show update when versions match.
- A mocked/changed remote `resourceVersion` causes desktop My Apps badge `更新` and card badge `更新`.
- Remote `updatedAt` change alone does not cause update if `resourceVersion` is unchanged.
- Local/imported old cards with no origin show no update badge.
- Canceling update leaves local card and origin unchanged.
- Confirming update downloads by package id, overwrites local card content, preserves saves, updates origin version, and removes badges.
- Network/API failure during check is silent and preserves previous successful update state.
- Reopening My Apps shortly after boot does not cause excessive duplicate checks.
- Visibility resume after the 10-minute threshold refreshes in the background.

## Review / Rollback Points

- DB name bump is intentionally destructive under prototype rules; verify both DB literals are updated together.
- `putLocalGameCard` preservation semantics are important: ordinary metadata edits should not erase `marketOrigin`.
- The update module should remain focused; do not move market update polling logic into `DesktopShell.vue` or `GameCardLibraryView.vue`.
- If update execution proves too entangled with existing market install code, extract a shared helper for “import market game-card package with origin” rather than duplicating origin construction and install refresh behavior.
