# Spatial 系统界面 — Implementation Plan

## 0. Activation gate

- [x] Re-read the converged PRD/design/plan and confirm the latest planning summary has explicit user approval.
- [x] Start only `07-31-spatial-system-surfaces`; do not start the parent or resume `agent-tool-observation-contract` for this work.
- [x] Load the curated implementation context and preserve unrelated `.codex/config.toml` and sibling task directories.

## 1. Characterize current behavior

- [x] Add focused tests around Settings provider/model mutations, 800ms auto-save, model probes and full-config merge writes before moving logic.
- [ ] Cover cloud backup list/usage/delete lifecycle and semantic-search/tunable validation at the controller boundary.
- [x] Add monitor tests for overview/recovery refresh, aggregate status, checkpoint confirmation/action, record subscriptions and teardown.
- [x] Add Trace controller tests for query construction, filters, 30-record pagination, stale request handling, detail selection, copy/export and URL cleanup.
- [ ] Record existing RetroOS render/integration expectations so controller extraction cannot silently change routes or behavior.

## 2. Extract shared Settings orchestration

- [x] Add `controllers/settings/` controller(s) for provider draft, provider/model mutations, probes, auto-save and complete-config section saves.
- [x] Extract shared model-parameter defaults/normalization/validation/test-payload helpers from Retro presentation code.
- [x] Move cloud-backup loading/usage/delete orchestration out of the Retro screen into the shared settings boundary.
- [x] Refactor `SettingsView.vue` and existing settings screens to consume the controller while preserving the Hub/subpage Retro layout.
- [x] Verify provider secrets and every unrelated platform-config section survive semantic-search, cloud-backup, tunable and appearance writes.

Rollback point: no Spatial Settings registration until the refactored RetroOS control panel and focused config tests pass.

## 3. Implement Spatial Control Panel

- [x] Add the permanent section rail and right-pane `SpatialSettingsView` structure with responsive container behavior.
- [x] Implement AI provider/preset management and nested model configuration against the shared controller.
- [x] Implement a Spatial-native model-parameter form using shared parameter helpers; cover all provider-specific fields, Chat ping and native Tool-calling probe.
- [x] Implement Spatial semantic-search, cloud-backup, runtime-tunable and appearance sections.
- [ ] Verify auto-save feedback, validation, confirm/dialog focus, secret masking, select/range/password projected input and full-reload mode switch.

## 4. Implement Spatial Account

- [x] Add independent guest/initializing/signed-in/error/logout-pending presentation using `useAuth`.
- [x] Render Discord login/binding and disabled future credential methods with keyboard and status semantics.
- [x] Use Spatial media resolution for avatar plus deterministic failed/empty fallback.
- [ ] Add focused tests for state transitions, login invocation, logout success/failure and avatar fallback.

## 5. Implement Spatial Announcements and unread shell action

- [x] Add Spatial announcement list/detail, loading/empty/error, refresh, Markdown and read-state behavior using `useAnnouncements`.
- [x] Add an announcement action and bounded unread badge to `SpatialStatusSurface`.
- [x] Route the status action through `SpatialDesktopShell` to open/focus the existing announcement singleton without changing launcher registration.
- [ ] Test immediate unread updates, one shared polling timer across shell/window consumers, keyboard activation and focus of an existing window.

Rollback point: shell unread integration can be removed without affecting the announcement composable or RetroOS status area.

## 5a. Revise Spatial provider interaction hierarchy

- [x] Replace the all-in-one provider form with provider-type navigation plus compact preset cards.
- [x] Move model management into a selected-preset detail level with explicit back/breadcrumb navigation.
- [x] Show model parameters only after an explicit edit action; preserve Chat ping and native Tool-calling probe without expanding every model inline.
- [x] Keep provider add/edit in the shared Spatial dialog surface and retain 800ms controller auto-save.
- [x] Add component tests for level transitions, selected preset/model retention, and absence of eagerly rendered parameter forms.
- [x] Match RetroOS optional-parameter semantics with a Spatial range primitive whose dedicated leftmost stop emits `null` / “不发送”; reuse it for every Settings range control.
- [x] Restore compact, keyboard-accessible parameter Tip buttons backed by the shared explanations and translate primary Settings task copy while retaining technical API/provider names where useful.
- [x] Add regression coverage for nullable range transitions, Tip discovery, Chinese model summaries, no native select, and no RetroOS presentation classes.
- [x] Clamp open parameter Tips within their nearest Spatial scroll/Source boundary so first/last-column explanations are not clipped; explicitly restore normal whitespace for long copy under nowrap field rows, recalculate on scroll/resize and clean up layout observers.

Rollback point: keep `settings` Spatial registration pending until the hierarchical provider flow passes focused tests and the Web build again.

## 6. Extract shared System Monitor orchestration

- [x] Add monitor controller for overview, health, checkpoints, restore and subscriptions; make `DebugView.vue` consume it.
- [x] Add Trace controller for filters, list/detail, paging, metadata, copy/export and URL/subscription lifecycle; make `DiagnosticTracePanel.vue` consume it.
- [x] Extract shared pure labels/formatters only where both presentations need identical semantics.
- [x] Keep `json-tree.ts` as the shared traversal contract and preserve existing Retro JSON components/visuals.
- [x] Run diagnostic storage/query/bundle tests and RetroOS monitor integration tests before Spatial registration.

## 7. Implement Spatial System Monitor

- [x] Add Overview, Trace and Recovery sections backed by the shared controllers.
- [x] Add Spatial Trace filters, page controls, summary list, record detail and relationship/status metadata.
- [x] Add independent Spatial JSON tree/raw sections using shared traversal helpers, bounded scroll, wrapping, expand/collapse and copy.
- [x] Add diagnostic bundle export form and checkpoint restore confirmation through existing Spatial global surfaces.
- [ ] Verify large JSON, rapid filter changes, record-change refresh, minimize/restore and close cleanup.

## 8. Registry readiness and integration

- [x] Add lazy imports and register Spatial components for `settings`, `account`, `announcements`, and `debug` only after their focused checks pass.
- [x] Assert route/deep-link and singleton identities remain unchanged and no Spatial view imports Retro route components or `retro-*` styles.
- [ ] Verify all four windows retain local selection/filter/draft state across focus, side pose, occlusion and minimize/restore.
- [x] Confirm the production Spatial release gate remains disabled.

## 9. Automated verification

Focused existing regressions:

```powershell
npx vitest run apps/platform-web/src/config/platform-config.test.ts apps/platform-web/src/config/platform-config.persistence.test.ts apps/platform-web/src/config/platform-ui-mode.test.ts
npx vitest run apps/platform-web/src/platform-host/diagnostics.test.ts apps/platform-web/src/platform-host/diagnostic-bundle.test.ts apps/platform-web/src/storage/diagnostic-records.test.ts
npx vitest run apps/platform-web/src/platform-apps.test.ts apps/platform-web/src/spatial/shell/spatial-window-surface.test.ts
```

New focused suites:

```powershell
npx vitest run apps/platform-web/src/controllers/settings apps/platform-web/src/controllers/system-monitor
npx vitest run apps/platform-web/src/spatial/apps/settings apps/platform-web/src/spatial/apps/account apps/platform-web/src/spatial/apps/announcements apps/platform-web/src/spatial/apps/system-monitor
```

Full gate:

```powershell
npm run build:web
npm test
git diff --check
```

Run `npm run build:contracts` only if an existing contract shape must change after explicit review.

## 10. Manual/projected-input matrix

- [ ] Control Panel: rail keyboard navigation; provider add/edit/test/delete/default; model add/delete/reorder/enable/parameters; auto-save; semantic-search; cloud-backup; tunables; UI-mode save/reload.
- [ ] Native controls: text/password/number/select/range/switch, clipboard and dialog focus at center and curved edges.
- [ ] Account: guest/login/bound/logout/error and valid/failed/cross-origin avatar.
- [ ] Announcements: polling, refresh, list/detail, long Markdown, mark-read, status unread badge, repeated open/focus.
- [ ] Monitor: overview refresh, every filter, multi-page Trace, large JSON expand/wrap/copy, bundle download, checkpoint restore and errors.
- [ ] Lifecycle: focus, side-position, overlap, minimize/restore and close while drafts, filters, subscriptions and safe background requests are active.
- [ ] RetroOS: all four original applications remain visually and behaviorally unchanged.

## 11. Finish gates

- [x] Run `trellis-check` and fix spec, type, test, accessibility and cross-layer drift.
- [x] Run `trellis-update-spec` if implementation establishes durable settings-controller, monitor-controller or Spatial system-surface conventions.
- [ ] Commit the child independently, then run the Trellis finish/archive flow.
- [ ] Leave `spatial-release-integration` as the next child; do not enable production release here.
