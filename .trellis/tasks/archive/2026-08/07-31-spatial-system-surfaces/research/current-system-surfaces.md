# Current System Surfaces Evidence

## Registry and remaining parity gap

- `apps/platform-web/src/platform-apps.ts:218-241` registers `settings`, `account`, `announcements`, and `debug` with stable routes, singleton identities, labels, sizes, and RetroOS components.
- None of those four registrations passes a Spatial component into `presentation(...)`, so `apps/platform-web/src/platform-apps.ts:153` marks them `pending` and `SpatialWindowSurface.vue` renders `SpatialPendingAppSurface`.
- Existing ready Spatial applications live below `apps/platform-web/src/spatial/apps/`, consume shared controllers/composables, use `spatial-apps.css` and focused primitives, and register only after focused parity checks.

## Control Panel ownership

- `apps/platform-web/src/views/SettingsView.vue:34-115` owns the screen router for provider, model, semantic-search, cloud-backup, tunable, and appearance screens plus model dialogs.
- `SettingsView.vue:176-225` owns the mutable provider draft and active provider/model selection.
- `SettingsView.vue:313-363` owns UI-mode, embedding/RAG, cloud-backup, and tunable save flows. Every platform-config save merges into the complete current config rather than writing an isolated section.
- `SettingsView.vue:369-624` owns provider/model CRUD, confirmation, default selection, fallback order and parameter editing.
- `SettingsView.vue:626-703` owns Chat ping and native Tool-calling probes.
- `SettingsView.vue:719-738` owns the deep 800ms provider-draft auto-save and mount refresh.
- `components/settings/CloudBackupScreen.vue` still owns backup list/usage/delete orchestration, while `SemanticSearchScreen.vue` and `PlatformTunablesScreen.vue` own local forms/validation. These are real extraction seams; copying the components would duplicate storage/network behavior and import Retro styling.
- `ModelParamsFields.vue` mixes provider-specific form state, validation/test actions and Retro presentation. Spatial needs independent markup but should reuse extracted model-parameter state/helpers instead of creating a second parameter contract.

## Account and announcements

- `apps/platform-web/src/composables/useAuth.ts:9-54` already owns the authoritative process-wide user state and login/logout actions. `AccountView.vue` adds only presentation-local logout pending state and Discord-bound derivation.
- `apps/platform-web/src/composables/useAnnouncements.ts` owns one shared announcement collection, 60-second polling, error/loading state, persisted read IDs and unread count with mounted-consumer reference counting.
- `AnnouncementCenterView.vue:73-103` adds only selection, mark-read and date formatting.
- RetroOS exposes unread count in `DesktopShell.vue:99-105`. Spatial `SpatialStatusSurface.vue` currently exposes window tasks, minimize-all and return-to-Retro only, so status integration is part of this child rather than a new announcement data source.

## System Monitor ownership

- `apps/platform-web/src/views/DebugView.vue:186-251` owns overview/recovery UI state and aggregate status derivation.
- `DebugView.vue:311-401` owns diagnostic metadata refresh, checkpoint refresh/restore, record subscriptions, debounce and teardown.
- `apps/platform-web/src/components/debug/DiagnosticTracePanel.vue:324-369` owns Trace pagination, filters, detail, export and object-URL lifecycle state.
- `DiagnosticTracePanel.vue:402-670` owns query construction, list/detail/metadata refresh, paging, copying, bundle download, diagnostic subscriptions, debounce and cleanup.
- `components/debug/json-tree.ts` is already presentation-neutral traversal logic. `JsonBlock.vue`, `JsonTreeNode.vue`, `RawRecordSection.vue`, and `DiagnosticTracePanel.vue` all import Retro classes/tokens, so Spatial should reuse the pure traversal helpers and controller data, not mount those components unchanged.
- Existing storage/host tests cover diagnostic aggregation, bounded query, bundle selection/redaction, record retention and virtual workspace behavior. UI/controller tests should characterize orchestration without changing those contracts.

## Spatial integration constraints

- `.trellis/spec/platform-web/frontend/spatial-ui.md` requires independent Source DOM, projected-input-compatible controls, stable mounted windows, no Retro chrome, and explicit dirty/source lifecycle behavior.
- Spatial confirm, dialog-form and toast hosts already consume the shared stores, so controllers may continue using `confirm`, `openDialogForm`, and `toast`; they resolve through the active shell presentation.
- `SpatialImage` and the shared spatial media resolver provide the safe path for account avatars whose cross-origin or failed image content cannot be trusted for HTML-in-Canvas capture.
- The production Spatial release gate remains owned by `spatial-release-integration`; this child only changes the four application readiness registrations and the Spatial status announcement affordance.

## Planning conclusion

The minimum non-duplicating solution is to extract settings and diagnostic orchestration into shared controllers, keep authentication and announcements on their existing composables, build four independent Spatial presentations, and add one shell-owned unread announcement action. No contract or persistence migration is required.
