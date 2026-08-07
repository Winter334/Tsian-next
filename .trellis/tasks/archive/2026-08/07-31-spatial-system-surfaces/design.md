# Spatial 系统界面 — Technical Design

## 1. Delivery boundary

This child adapts four existing platform applications without changing their domain contracts:

```text
platform config / auth / announcements / diagnostics / checkpoints
                              |
                    shared controllers/composables
                         /                 \
             RetroOS presentations     Spatial presentations
```

The task may refactor orchestration into controllers and pure helpers, but it does not add storage schemas, bridge methods, authentication methods, announcement formats, diagnostic records, or release-gate behavior.

## 2. Shared controller strategy

### 2.1 Settings controller

Add a controller under `controllers/settings/` that owns view-neutral settings state and actions currently concentrated in `SettingsView.vue`:

- cloned `BrowserPlatformConfigDraft` and active provider-type/preset/model selection;
- provider preset CRUD, default selection, provider availability and deep debounced auto-save;
- model CRUD/order/enabled/fallback/parameters;
- provider connectivity test, Chat ping and native Tool-calling probe;
- semantic-search embedding + RAG full-config save;
- cloud-backup config save and backup list/usage/delete orchestration;
- platform tunable full-config save;
- appearance capability and full-reload UI-mode switch.

The controller may call the existing global `confirm`, `openDialogForm`, and `toast` services because their stores are already presented independently by each shell. DOM refs, rail collapse, scroll position, section layout, modal focus, and element geometry remain presentation-owned.

Provider/model parameter editing needs one shared data contract and state helper. Extract provider-specific parameter normalization, defaults, validation, test payload construction, and text/list conversions from the Retro component. RetroOS and Spatial render their own controls against that state; Spatial must not mount a `retro-*` parameter editor.

RetroOS keeps its existing hub/subpage screen model. Spatial owns an `activeSection` for a persistent left rail and a nested provider/model detail state in the right pane. Both call the same controller actions, so navigation does not become a shared product constraint.

### 2.2 System Monitor controllers

Split diagnostic orchestration into two focused controllers under `controllers/system-monitor/`:

1. **Monitor controller** — overview, store health, aggregate status, platform context, checkpoints, refresh, restore, turn-ready/diagnostic subscriptions and teardown.
2. **Trace controller** — filters, 30-record paging, facets, list/detail loading, selected record, copy payload, bundle export, diagnostic-change refresh, pending download URL tracking and teardown.

Controllers expose immutable/read-only state and typed actions. They continue to call the existing `playFrontendBridge.debug`, query resource, restore action and diagnostic bundle APIs. They do not cache complete records in a new store or persist view filters.

Move formatting and record-kind/status derivation into pure helpers where both views need identical labels. Continue using `components/debug/json-tree.ts` as the shared JSON traversal contract. Retro and Spatial JSON tree components own only expansion/wrap/copy presentation state.

### 2.3 Existing composables remain authoritative

- Account presentations consume `useAuth`; only logout-pending UI state stays local.
- Announcement presentations and the Spatial status surface consume `useAnnouncements`; the composable's mounted-consumer accounting prevents duplicate polling.
- No wrapper controller is added where the existing composable already provides the complete domain boundary.

## 3. Spatial Control Panel presentation

Create `spatial/apps/settings/SpatialSettingsView.vue` and focused leaf components.

Layout:

- a permanent left rail with AI Providers, Semantic Search, Cloud Backup, Runtime, and Appearance entries;
- the right pane holds the active section; AI Providers uses progressive disclosure instead of one long form:
  1. provider type navigation plus compact preset summary cards;
  2. a selected-preset model list with fallback strategy, enable/order/delete actions and an explicit back affordance;
  3. a selected-model parameter page with Chat ping, native Tool-calling probe, save and back affordances;
- provider add/edit remains in the shared Spatial dialog form. Model add may use the shared dialog for model identity/defaults, but full provider-specific parameters are edited only on the third-level page;
- nested provider levels are presentation-local state. The shared settings controller remains the source for provider/model mutations and 800ms persistence;
- at narrow container widths the rail may collapse to icon/short labels or a controlled drawer, but section identity and keyboard order remain stable;
- deep forms use one main scroll container per section and do not create horizontally unreachable controls at the registered minimum size.

Use Spatial controls and tokens for text/password/number/select/range/switch/action surfaces. Provider add/edit and compact model creation use the Spatial global dialog form; model parameter editing remains in the right-pane third-level page and does not introduce another global modal Source. Password values remain masked, are never echoed into status copy, and stay within existing config persistence.

The Appearance section still labels Spatial as a local experiment and invokes the existing full-reload switch. Completing this child does not claim release readiness.

## 4. Spatial Account presentation

Create `spatial/apps/account/SpatialAccountView.vue`.

- Render explicit initializing, guest, signed-in, error and logout-pending states.
- Use `SpatialImage`/media resolver for the avatar and a deterministic initials/icon fallback.
- Keep Discord as the only active sign-in method; password/email/Magic Link remain disabled explanatory entries.
- Login uses the existing redirect action. Logout uses shared auth state and Spatial toast feedback.

No account data is copied into window/session state. A mounted account window reacts to process-wide auth changes.

## 5. Spatial Announcement presentation and shell integration

Create `spatial/apps/announcements/SpatialAnnouncementCenterView.vue` with a list/detail layout. It reuses `useAnnouncements`, `renderAnnouncementMarkdown`, selection and mark-read behavior. The list/detail split collapses predictably at narrow widths without hiding the current announcement.

Extend `SpatialStatusSurface` with an announcement action and bounded unread badge. `SpatialDesktopShell` owns the open/focus command and passes the current unread count; invoking it calls the existing application/window-session path for the `announcements` singleton. The status surface does not own a second route or window implementation.

The announcement window and status action may both mount `useAnnouncements`; shared consumer counting must result in one poll timer. Read changes update both surfaces immediately.

## 6. Spatial System Monitor presentation

Create `spatial/apps/system-monitor/SpatialSystemMonitorView.vue` and focused Trace/JSON leaf components.

- A stable tab/section control switches Overview, Trace and Recovery without discarding controller state.
- Overview presents health, usage, request counts and provider/model statistics from the shared monitor controller.
- Trace presents the same filters, 30-record paging, summary list, selected detail, relationships, request/response/error sections, complete raw record copy and diagnostic bundle export.
- Spatial JSON tree components reuse pure `json-tree.ts` traversal helpers and keep expansion/wrapping local. Large values live in bounded scroll regions; Source capture does not mirror them into another state object.
- Recovery uses the shared dangerous confirmation and restore action; success refreshes all relevant monitor state.

Object URLs created for exports are revoked on completion/timeout and close. Diagnostic subscriptions are installed once per controller instance and removed on unmount; minimizing keeps the mounted instance and therefore does not duplicate subscriptions on restore.

## 7. Registry and readiness

Add lazy imports for the four Spatial views and pass them to the existing `presentation(...)` registrations. Marking `ready` happens only after each corresponding view and shared-controller refactor pass focused tests. No temporary RetroOS component is used as a fallback.

The shell announcement action may open a non-launcher application through `platformWindowForRoute` or a small shared descriptor helper; do not change `launcher: false` merely to make the status button work.

## 8. Compatibility and migration

- Existing platform config, auth session, announcement read IDs, diagnostic records and checkpoint data require no migration.
- RetroOS route names, window identities, default sizes and visuals remain unchanged.
- Full platform-config writes must always merge from the current normalized config so parallel sections and secrets are retained.
- Existing diagnostic redaction, retention, query limits and bundle format remain authoritative.
- Spatial production selection/release gating remains disabled until the release-integration child.

## 9. Risks and rollback points

- **Settings extraction drift**: first characterize controller actions and make RetroOS consume them before registering Spatial Settings. Reverting the Spatial registration must leave the shared RetroOS controller green.
- **Model parameter duplication**: extracting state/helpers is required before the Spatial form; do not maintain two provider-specific validation tables.
- **Config overwrite**: tests must prove embedding/RAG, cloud backup, tunables and appearance saves preserve unrelated config and secrets.
- **Diagnostic subscription leaks**: controller tests must assert exact subscribe/unsubscribe and debounced refresh cleanup; minimize/restore must not remount.
- **Large JSON capture cost**: keep list/detail pagination and bounded scroll, reuse pure traversal, and avoid eager expand-all in normal rendering.
- **Avatar capture**: failed/CORS-unsafe avatar content uses the existing media fallback rather than direct uncontrolled `<img>` capture.
- **Unread polling duplication**: preserve the composable's mounted-consumer invariant while adding a permanent Spatial shell consumer.

Each application has an independent registry rollback: remove its Spatial component argument to return only that app to `pending` without affecting RetroOS or the other completed applications.

## 10. Verification strategy

1. Add controller tests before extraction for settings mutations/auto-save/config merges and monitor refresh/filter/export/subscription lifecycle.
2. Refactor RetroOS to shared controllers and run focused config/diagnostic regressions.
3. Add Spatial component/integration tests for rail navigation, auth states, announcement read/status linkage and monitor section behavior.
4. Run projected-input browser checks for password, select, range, scroll, JSON expansion/copy, export and restore confirmation.
5. Register each Spatial presentation only after its domain parity tests pass; run the full web build and relevant full test suite at the end.
