# My Apps And Game Card Launcher UI Design

## Design Direction

Use the parent Tsian RetroOS direction for this child. The UX should borrow classic Windows-like patterns where they make the product easier to understand:

- Desktop is the primary home surface; the old lobby is removed from the main UX.
- App Market is a desktop application placeholder for later upload/download flows.
- My Apps is an Explorer-style folder of installed Game Cards.
- Game Card Detail is a properties plus launcher window.
- Save Instance management is a save-slot panel.
- Workspace appears as a folder-like launcher tab; later authoring destinations appear as tabs or property-sheet pages.

This does not require a true draggable multi-window desktop in the first implementation. Route-backed views can be styled as windows with title bars, menu/toolbar rows, content panes, and status bars.

## Route Shape

First slice routes:

- `/market` -> App Market placeholder window.
- `/library` -> My Apps Explorer window.
- `/cards/:cardId` -> Game Card Detail window.

The home desktop links to `/market` and `/library`. This child should remain usable by direct navigation.

`/play` remains outside the platform window chrome and continues to load only the active card frontend.

## App Market Window

The App Market reserves the future community distribution surface without implying network catalog support exists in this slice:

- title bar: `App Market`;
- toolbar entries for install/upload/search can be disabled placeholders;
- category pane can show expected groups;
- content pane should clearly route installed cards back to My Apps.

## My Apps Window

My Apps should feel like opening an installed applications folder:

- title bar: `My Apps`;
- optional menu/toolbar row for later import/export/filter actions;
- main pane: large-icon thumbnail grid using Game Card covers;
- footer/status bar: count of installed cards and selected card summary;
- empty state: an empty folder style message with a clear next useful action.

Game Card icons should keep the player-first rule:

- resting state shows cover/fallback preview plus title;
- hover/focus/selected state reveals short summary overlay;
- no ids, versions, frontend status, or author controls on icons;
- click/enter opens detail.

On narrow viewports, the window chrome can collapse into a stacked panel while preserving the same hierarchy: title, toolbar, grid, status.

## Detail Window

The detail page should feel like a game cartridge/disc properties window that can also launch the game.

Recommended first screen:

- title bar with card name and back-to-library affordance;
- local tabs/property sheet: `Overview`, `Saves`, `Workspace`, `Frontend`, `Agents`, `Diagnostics`;
- `Overview` content split into two main panes:
  - left poster pane: cover image dominates, with title, full description, author, and minimal card facts overlaid near the lower area;
  - right save-slot pane: recent save, save list, create save, continue/open, delete.
- overview should include an `Open Folder` affordance into the Workspace tab.

Tabs that are not implemented in this child should be visible only if they provide useful disabled/placeholding wayfinding without pretending the feature is done.

## Workspace Placement

Workspace belongs in both mental models:

- Launcher owns play, save-slot, and configuration decisions.
- Workspace tab should feel like opening the Game Card root directory from the launcher.
- The first slice can show folder-level structure only: card-owned content, save runtime data mounted at `save/`, and host metadata under `.tsian/`.
- Full file editing remains deferred to Workspace Studio.

## Save Slot Panel

Save management should use mainstream game-save language:

- show each Save Instance as one slot/row;
- show last played/created metadata when available;
- expose `Continue` for the currently selected or most recent playable slot;
- expose `New Save` for creating a playthrough from the card;
- expose `Delete` with an explicit confirmation and copy that names the save, not the reusable Game Card;
- if the card has no frontend, explain that saves can exist but play is not available until a frontend is configured.

Checkpoint and runtime files remain internals. The UI should not make checkpoints look like separate Game Cards.

## Frontend-Less State

Frontend-less cards are valid in the current product stage. The detail window should make the distinction clear:

- card content can be browsed and edited later;
- save slots can be created/managed if storage allows;
- `/play` is unavailable until a remote or packaged frontend is bound.

The state should read like a disabled launch button with an explanation, not like a runtime error.

## Visual Notes

The first implementation should establish reusable RetroOS primitives through ordinary Vue/CSS:

- window frame;
- title bar;
- toolbar/menu row;
- inset content pane;
- status bar;
- raised/inset buttons;
- icon/thumbnail grid;
- property-sheet tabs;
- confirmation dialog style.

Use the project UI component patterns where practical, but the RetroOS visual system may require shared CSS classes or wrapper components so later surfaces do not reinvent chrome.

Avoid copying exact Windows branding or pixel-identical assets. The target is familiar desktop UX, not a clone.

## Data Flow

- Read Game Cards through existing storage/platform helpers.
- Read and mutate Save Instances through existing storage/platform helpers.
- Use shared contract types from `@tsian/contracts` where exposed.
- Do not duplicate Dexie queries in route components if a helper already exists.
- Route to `/play` only when the selected card/save can provide a playable frontend.

## Validation

- `npm run build:web`.
- Browser smoke on desktop and narrow viewport.
- Smoke flow: open library, select/open card, create save, select/continue save, delete save with confirmation, verify frontend-less card communicates not playable.
