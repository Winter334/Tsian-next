# Design

## UX Placement

This slice stays inside the current RetroOS desktop shell without introducing a new desktop application.

- App Market provides the local package installer affordance for `.tsian-card.zip`.
- My Apps mirrors the same import affordance for users who look for installed-card management there.
- Game Card Detail owns per-card export and frontend configuration.
- Game Card Detail > Frontend replaces the placeholder with a property-panel style view for current binding state, remote URL editing, packaged entry inspection, and stored frontend file listing.

## Platform Boundaries

- Route views call platform-host functions; they do not import Dexie tables directly.
- Package import/export continues to use `storage/game-card-packages.ts`.
- Frontend binding edits update the selected Game Card manifest through platform-host helpers.
- Packaged frontend files remain card-owned assets in `gameCardFrontendFiles`; saves never copy them.
- `/play` remains the thin active frontend loader. This task may add launch affordances, but not new play-rendering logic.

## Data Flow

### Import

1. User selects a `.tsian-card.zip` file in App Market or My Apps.
2. View passes the selected `File` to `importPlatformGameCardPackage`.
3. Storage validates zip shape, manifest, paths, unsupported frontend kinds, and packaged entry presence.
4. On success, the imported Game Card appears in My Apps and the UI can navigate to its detail page.
5. On failure, the view displays the package error message and leaves existing cards untouched.

### Export

1. User opens Game Card Detail for a card.
2. Export action calls `exportPlatformGameCardPackage(cardId)`.
3. View downloads the returned zip blob with a stable filename derived from card name and version.
4. Export includes card manifest, card content files, and stored frontend files only.

### Frontend Binding

1. Game Card Detail loads the card and stored frontend file summary.
2. Frontend tab displays one of three states: unconfigured, remote, packaged.
3. Remote edit writes `{ kind: "remote", url, bridgeVersion: "tsian.play-bridge.v1" }`.
4. Packaged edit writes `{ kind: "packaged", entry, bridgeVersion: "tsian.play-bridge.v1" }` only when an entry is present.
5. Clear binding removes `manifest.frontend` but leaves card content, saves, and packaged frontend files intact.

## Contracts And Compatibility

- `frontend.kind === "builtin"` remains unsupported and must not be introduced by UI writes.
- Remote URL validation should be browser-loadable and reject obviously dangerous schemes before persisting.
- Packaged entry paths must stay relative package paths under `frontend/`.
- Existing package import validation remains the authority for imported packages.
- No contract package changes are expected for this UI slice.

## Rollback

The work is isolated to platform-web UI and platform-host helpers. If needed, rollback can remove the new route controls and helper functions while leaving storage package support intact.
