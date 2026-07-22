# Technical Design

## Scope

Three existing route views gain component-width responsive presentation without changing their data, routing, storage, or runtime contracts:

- `StudioView.vue`: object-selection sidebar → compact Agent selector.
- `AssistantView.vue` and assistant chrome: persistent session sidebar → overlay drawer.
- `AppMarketView.vue`: resource filter sidebar → compact filter bar; toolbar reflow.

No shared responsive split component is introduced because the three auxiliary regions have different responsibilities and interaction contracts.

## Responsive Boundary

Each route root becomes a named inline-size CSS container. Scoped container queries control which presentation is visible. Both desktop and compact controls bind to the same existing refs and handlers, so no viewport listener or duplicated business state is introduced.

The exact thresholds remain local implementation details selected from each view's minimum usable main-content width. They do not create global breakpoints.

## Studio

- Desktop: retain the existing 300px Agent sidebar and detail pane.
- Compact: hide the full Agent card list; show a one-row Agent selector above the detail pane.
- The compact selector writes `selectedAgentId` through the existing `selectAgent`/context-loading path.
- The directory button calls the existing `openPathDirectory(selectedAgent.path)`.
- The detail component remains mounted across layout changes.

## Assistant

- The route root owns `sessionDrawerOpen`, which is presentation-only state.
- The session sidebar remains mounted in both modes. In compact mode CSS positions it absolutely over the chat pane and translates it off-canvas while closed.
- A backdrop and explicit close control dismiss the drawer. The chat header opens it.
- Selecting or creating a session uses the existing async handlers, then closes the drawer.
- The chat pane is never conditionally removed, preserving messages, composer draft, scroll DOM, and streaming callbacks.
- Desktop mode ignores drawer positioning and retains the fixed 220px column.

## Market

- Desktop: retain the 220px resource-type sidebar and content pane.
- Compact list screen: hide the sidebar and show a one-row type select plus scope toggle before content.
- Compact detail/upload screens: hide the desktop sidebar and do not render the compact list filters.
- Type and scope controls call the existing `switchType` and `toggleMarketScope` handlers.
- Toolbar markup groups upload/back actions with sorting; tag and search inputs receive full compact rows through container-query CSS.

## Compatibility And Rollback

- No persisted state or API shape changes.
- Wide layouts remain available through the same DOM and handlers.
- Each view can be rolled back independently by removing its local compact markup and scoped container-query styles.

## Validation

- `npm run build:web`
- `git diff --check`
- User performs one final real-device/manual check covering all three views in narrow and wide layouts.
