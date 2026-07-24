# Implementation Plan

## 1. Establish Data Contracts

- Add character equipment slot/types and `CharacterEntity.equipment`.
- Add item equipment metadata and `ItemEntity.equipment`.
- Extend `parseCharacter` and `parseItem` with local, type-safe normalization helpers that preserve valid partial data and source key order.
- Add focused fixture-style checks if the package has an existing lightweight test location; otherwise validate parsers through build/type-check and manual malformed-data probes without introducing a new test runner solely for this task.
- Review gate: no `any`, no modifier evaluation, no schema write changes.

## 2. Preserve Full Portrait Images And Add Portrait Dialog

- Change `preparePortraitBlob` from permanent 3:4.15 center crop to aspect-preserving max-dimension scaling and WebP export.
- Refactor `CharacterPortrait` so the image itself is the trigger and the standalone upload button disappears.
- Add a Reka Dialog that shows the complete saved image with `contain`, upload/replace action, progress, errors and close controls.
- Apply the borderless smoke-ink stage treatment while preserving fallback avatars and object URL cleanup.
- Verify an existing cropped portrait still displays and a new landscape/portrait upload is not cropped in the modal.
- Rollback point: image-processing and portrait components can be reverted independently before changing the wider character layout.

## 3. Build Shared Character Stage

- Move active `character/items` mode and per-mode track scroll positions to `CharacterView`.
- Fix current scene changes by explicitly reloading when `currentSceneRef` changes; keep selection only if it remains present.
- Replace the old tab shell with a top mode control, shared `CharacterStage`, and mode-specific right panel.
- Add focused components for attribute marks, synchronized dual tracks, equipment slots and stage gauges instead of growing `CharacterCard.vue` into a mixed-responsibility file.
- Keep one portrait instance mounted across mode switches.
- Restrict PinButton rendering to protagonist fields by passing a clear `canPin`/effective entity ref through dossier and stage components.
- Review gate: switching character preserves mode; switching mode restores its track position; no old “概况 / 属性 / 背包” navigation remains.

## 4. Refactor Character Selection And Desktop Layout

- Simplify CharacterList to `scene.present` only and remove the related-people branch.
- Add compact desktop/mobile variants to CharacterListItem, showing avatar, name and lightweight markers only.
- Lay out desktop as compact character rail + stage + dossier/container panel.
- Implement three independent hidden-scrollbar domains: character rail, shared dual-track container and right content panel.
- Keep portrait/identity/gauges anchored while the track layer scrolls.
- Add subtle edge fades/content peeking for scroll affordance.

## 5. Refactor Inventory Navigation And Item Detail

- Extract/refine the inventory entity loading helper so container navigation and modal rendering do not share one large component state machine.
- Replace modal-based container browsing with an in-panel path, breadcrumbs, request-version checks and cycle guards.
- Extend InventoryGrid to uniform square cells with container visual treatment, equipped-slot badges, highlight state and missing/cycle states.
- Build the equipment-ref context map once for slot/grid/detail use.
- Replace ItemDetailModal with a Reka single-item dialog and add equipment slot, raw mods, effects and actual applied contribution sections.
- Link equipment slots and visible inventory cells by item ref; empty slots remain read-only descriptions.
- Review gate: clicking a container never opens the item modal; clicking an item never changes the container path.

## 6. Add Mobile Character Layout

- Add the mobile page control row with current-avatar drawer trigger and `角色 / 物品` control.
- Implement the left character drawer with Reka Dialog primitives; select closes it and no swipe handler is added.
- Reflow stage tracks into two columns below the Hero portrait and use one page scroll container.
- Add Hero-to-compact-character-strip transition using a scroll threshold or observer, with direct state changes under reduced motion.
- Account for global header, bottom navigation and safe-area spacing; verify no nested main scroll or horizontal clipping.

## 7. Add Minimal Global Mobile Shell

- Add App-owned mobile status drawer open state without changing desktop persisted collapse preferences.
- Compress AppHeader on mobile; use its left action to open status and hide the desktop nav-collapse control.
- Convert StatusBar to a mobile overlay drawer while retaining desktop GSAP width behavior.
- Convert AppNav to a safe-area-aware bottom navigation while retaining desktop rail behavior.
- Reset left/right view padding for mobile across StoryView, CharacterView, TimelineView and settings placeholder.
- Update viewport/dynamic-height CSS (`100dvh` with fallback and `viewport-fit=cover`).
- Review gate: desktop expand/collapse still works, and all four main views receive reachable content width on mobile.

## 8. Accessibility, Visual Polish, And Regression Review

- Verify visible focus for every new button/grid cell and accurate aria labels for short slot labels and portrait triggers.
- Verify Dialog focus trap, Escape, overlay close, explicit close and trigger focus restoration for portrait, item, status and character drawers.
- Verify hidden scrollbars retain keyboard, wheel and touch scrolling.
- Verify smoke-ink edge is static, performant and does not obscure core portrait content.
- Verify reduced-motion rules disable nonessential transforms/transitions.
- Search for obsolete old-tab labels, stale container-modal handlers and NPC pin entry paths.

## 9. Validation

Run:

```bash
npm run build --workspace play-frontend-dev
git diff --check
```

Manual browser validation at minimum:

- Desktop wide viewport (for example 1440×900): all three scroll domains, fixed portrait, both modes, multiple characters, modal focus/close behavior and desktop sidebars.
- Desktop short viewport (for example 1280×640): synchronized track overflow and independent dossier/container scroll.
- Mobile narrow viewport (for example 390×844): status drawer, bottom nav, character drawer, Hero collapse, two-column tracks, container drill-in and bottom-sheet item detail.
- Mobile short/narrow viewport (for example 360×640): safe-area/bottom-nav reachability, no horizontal clipping and no nested main scroll.
- Data cases: no equipment, empty slot, malformed slot, long dynamic slot name, equipped ref still in nested container, missing ref, cyclic container, no attributes/gauges, NPC selection and protagonist selection.
- Portrait cases: fallback image, existing saved image, new landscape image and new portrait image.

Final scope checks:

```bash
git status --short -- apps/play-frontend-dev .trellis/tasks/07-24-character-detail-responsive-equipment
git diff --name-only -- cards/沉浸阅读器.tsian-card/frontend cards/沉浸阅读器.tsian-card/game-card.json
```

The second command may show pre-existing user changes outside the frontend snapshot; compare against the session baseline and do not attribute or overwrite them. This task must not add changes under packaged frontend source/dist or frontend file inventory.

## Review Gates And Stop Conditions

- Stop and redesign if preserving one portrait instance requires duplicating the character business DOM for desktop/mobile.
- Stop and simplify if synchronized dual-track scrolling is implemented as two mutually updating scroll listeners; use one shared scroll container instead.
- Do not add equip/unequip/move controls or an expression evaluator.
- Do not broaden `useEntity` or `useScene` APIs across the whole app unless a local, request-safe solution cannot meet this task.
- Do not run packaging/write-back commands or modify the formal card frontend in this round.
- Do not overwrite unrelated working-tree changes.
