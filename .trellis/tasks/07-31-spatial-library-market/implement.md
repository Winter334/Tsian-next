# Spatial Library and Market Implementation Plan

## Execution Rules

- Implement only after this planning summary receives fresh user approval and `task.py start` activates this child.
- Use the Trellis implementation sub-agent with the curated context in `implement.jsonl`; the main session coordinates registry/shared-boundary decisions and reviews each seam.
- Do not edit renderer, curve projection, window geometry, shell environment, backend/contracts/storage schema, or the production release gate. Approved exceptions are the minimum viewport/frame-scheduler contract for bounded opt-in Source recapture and the minimum projected-default-action adapter for required Select click and native scrollbar thumb behavior; neither may introduce alternate hit math.
- Preserve unrelated uncommitted Trellis task directories.

## Phase 1 — Shared Controller Extraction

- [ ] Extract My Apps domain state/commands/event subscriptions into a per-instance controller.
- [ ] Switch `GameCardLibraryView.vue` to the controller without changing its RetroOS presentation or route behavior.
- [ ] Add focused tests for refresh/mutation guards, event-driven re-read and helper predicates where practical.
- [ ] Extract Game Card detail loading, drafts, mutations, object-URL cleanup and close-guard registration into a per-instance controller.
- [ ] Switch `GameCardDetailView.vue` to the controller and preserve draft-until-saved, frontend binding and close veto behavior.
- [ ] Split App Market logic along catalog/detail, local resource inventory and package-operation seams; compose one per-instance view controller.
- [ ] Remove the market view's RetroOS window-manager dependency and use shell-neutral route navigation for Account.
- [ ] Switch `AppMarketView.vue` and existing market components to shared controller/types/helpers without visual redesign.
- [ ] Run focused tests and Vue type-check after each view migration; stop and repair RetroOS regressions before Spatial work.

Rollback point: controller extractions are individually revertible; no Spatial registration is ready yet.

## Phase 2 — Shared Spatial Media Policy and App Primitives

- [ ] Add the typed Spatial image input/state resolver with same-origin, Blob/File and CORS materialization rules.
- [ ] Add request-race/cancellation and owned-object-URL cleanup tests.
- [ ] Add a reusable Spatial image/fallback component that reports loading/ready/unavailable without blocking sibling content.
- [ ] Add shared Spatial app primitives under `spatial/apps/` that inherit the accepted shell variables; semantic aliases must derive from `--spatial-*` tokens rather than define a parallel palette.
- [ ] Cover focus-visible, buttons, form controls, segments, cards, command/status regions, Source-local menus/dialogs, loading/empty/error banners and responsive scroll containers with one consistent component language.
- [ ] Add a focused style contract test that guards inherited framework tokens, the absence of `retro-*` chrome and the absence of a second app palette/material system.

Rollback point: media/primitives are isolated and have no registry consumer.

## Phase 3 — Spatial My Apps Vertical Slice

- [ ] Implement `SpatialGameCardLibraryView` over the shared My Apps controller.
- [ ] Implement responsive card grid, covers/fallbacks, active/update badges, loading/error/empty and status feedback.
- [ ] Implement create/import/open/copy/load/update/delete/market commands.
- [ ] Implement pointer and keyboard card activation, nested quick actions and Source-local context menus.
- [ ] Review My Apps beside current window/Dock chrome; adjust its internal layout when needed for readable card density and projected targets without changing commands.
- [ ] Register only `my-apps` as ready for local manual validation while keeping the production gate closed.
- [ ] Verify change-event refresh, curved edge input, scroll and state preservation through focus/minimize/restore.

Rollback point: set `my-apps` registration back to pending; shared controller remains used by RetroOS.

## Phase 4 — Spatial Game Card Detail

- [ ] Implement `SpatialGameCardDetailView` with Overview and Frontend areas over the shared detail controller.
- [ ] Implement load/export, metadata/cover draft/save/delete and builtin restrictions.
- [ ] Implement none/remote/packaged binding, frontend package import/export, file list and apply/clear behavior.
- [ ] Route all images through the Spatial media policy, including upload preview and external URL failure.
- [ ] Review the Detail information architecture at minimum and default window sizes; keep all fields/actions discoverable even if the RetroOS poster/property split is replaced.
- [ ] Register `game-launcher` as ready.
- [ ] Verify `cardId` changes, active-card refresh, close-guard veto/approval and object-URL disposal.

Rollback point: set `game-launcher` back to pending; RetroOS remains on the shared controller.

## Phase 5 — Spatial App Market

- [ ] Implement Spatial resource type/scope controls, search/tag/sort, counts, pagination and list/empty/login states.
- [ ] Implement Spatial package cards/details with shared image fallback.
- [ ] Implement game-card/Agent/Skill/Tool install flows and Source-local target/replacement dialogs.
- [ ] Implement upload selection/metadata flow, package update/replacement and delete using shared controller operations.
- [ ] Implement shell-neutral Account navigation and preserve list/filter state while visiting detail/upload screens.
- [ ] Review the Market rail/results/detail/upload arrangement at minimum and default window sizes; change the layout if necessary while preserving every filter and package action.
- [ ] Register `market` as ready.
- [ ] Verify simultaneous Market/My Apps/Detail windows refresh and retain independent state.

Rollback point: set `market` back to pending; market APIs/data remain unchanged.

## Phase 6 — Automated Verification

- [ ] Assert the exact ready Spatial app set is `market`, `my-apps`, `game-launcher`; all other app registrations remain pending.
- [ ] Assert no Spatial app imports the three RetroOS route views, `useDesktopWindows`, or `retro-*` presentation chrome.
- [ ] Assert shared app styles consume the accepted shell token family and do not introduce an independent palette or conflicting material language.
- [ ] Run focused controller/media/registry/Spatial tests.
- [ ] Run the full Spatial suite and existing RetroOS window/config registry regressions.
- [ ] Run Vue type-check, platform-web build and whitespace check.

Planned commands:

```powershell
npm test -- --run apps/platform-web/src/spatial/apps apps/platform-web/src/platform-apps.test.ts
npm test -- --run apps/platform-web/src/spatial apps/platform-web/src/config apps/platform-web/src/composables/useDesktopWindows.test.ts
npm exec vue-tsc -- -b apps/platform-web/tsconfig.json
npm run build:web
git diff --check
```

Add or adjust focused test paths to match the final controller module names.

## Phase 7 — Flag Chromium Product Matrix

- [ ] My Apps: empty/loading/error, create/import/open/copy/load/update/delete, blank/card context menus, keyboard activation and change refresh.
- [ ] Market catalog: all resource types, all/mine, logged-out Account entry, search/tag/sort/counts/load-more and detail return.
- [ ] Market mutations: install game card/Agent/Skill/Tool, target selection, overwrite/old-save confirmations, upload, edit/replace and delete.
- [ ] Detail: metadata/cover draft save, Blob upload, same-origin/external URL/clear/failure, load/delete/export, frontend modes and package import/export.
- [ ] Window lifecycle: My Apps/Market/Detail open together; focus, overlap, side pose, occlusion, minimize/restore and close preserve each view's state.
- [ ] Input/accessibility: center and visible curved edges, pointer/keyboard/context menu, text/textarea/select/file picker/IME, focus visibility and reduced motion.
- [ ] Visual/layout: compare all three windows beside the current Dock/title/control/frame system at default and minimum sizes; verify one visual language, consistent shared primitives, complete action mapping and no unjustified RetroOS layout cloning.
- [ ] Media: same-origin market cover, local Blob cover, CORS-readable external cover, failed/unreadable external cover and placeholder.
- [ ] RetroOS regression: repeat the critical three-view workflows with the RetroOS shell.

## Phase 8 — Shared Presentation Primitive Revision

- [ ] Add a reusable Spatial Action Button and migrate every text+icon/icon-only button in My Apps, Market and Detail to it.
- [ ] Add a Source-local Spatial Select with trigger/listbox semantics and replace Market sort/resource-type native selects.
- [ ] Preserve Select activation when only compatibility `mousedown` is canceled, and implement captured Source-local vertical/horizontal native scrollbar thumb dragging with exact cleanup and owning-Source repaint.
- [ ] Remove the global Spatial app focus outline/box-shadow treatment; add only geometry-stable, non-box keyboard state where needed.
- [ ] Keep Market list/detail/upload and Detail overview/frontend as immediate Source-texture swaps without CSS/Vue dominant-content transitions; retain shared bounded transitions only for Select/menu/dialog opening and card/list entry.
- [ ] Add opt-in Source animation tracking: continuously recapture computed intermediate frames without overwriting an outstanding paint generation, stop on end/cancel or a sub-second hard limit, and upload one final frame.
- [ ] Ensure every transition settles, remains interruptible and respects `prefers-reduced-motion` without changing final state or leaving `animated-source`/dirty work active.
- [ ] Review all existing app tests: keep controller/media/registry/essential primitive behavior coverage; remove or avoid redundant source-format/exact-visual assertions.
- [ ] Do not modify shell/engine production code outside the approved Source repaint bridge or chase unrelated existing baseline failures.
- [ ] Run task-owned focused tests, type-check, build and diff check. Browser product/visual testing is explicitly handed to the user.

## Completion Gate

- [ ] Every PRD acceptance criterion has explicit automated or manual evidence.
- [ ] Visual consistency and layout parity audits both pass: the former checks unity with Spatial shell, the latter checks that any rearrangement preserved all workflows.
- [ ] User feedback iteration passes: custom selects, aligned icon buttons and no focus rectangles are present; dominant content swaps immediately on the curved Source while only approved local transitions remain bounded.
- [ ] No product code outside this child's ownership changed without a recorded planning return.
- [ ] Production Spatial release gate remains disabled.
- [ ] Full-scope Trellis check passes before spec update, commit and archive.
