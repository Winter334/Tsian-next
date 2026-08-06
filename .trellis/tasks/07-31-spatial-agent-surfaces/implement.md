# Spatial Agent 工作界面 — Implementation Plan

## 0. Activation gate

- [x] Re-read PRD/design/plan and confirm the latest planning summary is approved.
- [x] Ensure this child, not the parent or `agent-tool-observation-contract`, is the active implementation target.
- [x] Load curated implement context and start only `07-31-spatial-agent-surfaces`.
- [x] Preserve unrelated `.codex/config.toml` and sibling task directories.

## 1. Lock the `ask_user` default with tests

- [x] Add a focused Tool-execution test that captures the normalized request passed to `onAskUser`.
- [x] Assert omitted `allowCustom` becomes `true` with and without options.
- [x] Assert explicit `false` remains false and invalid non-boolean values still fail.
- [x] Add/update assistant-state or component coverage for options + custom, open-ended custom, and options-only rendering.

## 2. Implement the shared `ask_user` fix

- [x] Normalize the default in `normalizeAskUserArguments`.
- [x] Make local active ask state explicit and defensively normalize incoming interaction events.
- [x] Preserve focus, trim, cancel, single-input-region, session routing, and abort cleanup behavior.
- [x] Run the focused ask tests before touching process presentation.

Rollback point: the Tool normalization and local state changes are isolated from timeline rendering.

## 3. Preserve Tool display metadata and add process helpers

- [x] Extend `AssistantTimelineNode` Tool nodes with `displayName` and add ephemeral outer process-fold state to `ChatMessage`.
- [x] Thread `displayName` through `useAssistantTimeline.onTool`; upserts must fill but never erase optional display metadata.
- [x] Preserve `displayName` in stored/live assistant message mappers with old-history fallback.
- [x] Add a pure helper for Tool count, aggregate status, visible label and status labels.
- [x] Add tests for original order, mixed statuses, custom display names, later-event omission, and `agent_call` presentation retention.

## 4. Replace RetroOS Tool groups with one process fold

- [x] Remove `TOOL_LABEL`, generated action sentences, adjacent Tool grouping, and per-group fold map.
- [x] Render one default-closed “执行过程” per assistant reply.
- [x] Render interim/thought/tool/read-only ask nodes in original order.
- [x] Render one Tool per row with separate identity/status, stable geometry and accessible live status.
- [x] Keep bounded `agent_call` target/response/error detail.
- [x] Add fold/count/status animations and `prefers-reduced-motion` behavior using RetroOS tokens.
- [x] Update component/mapper tests and remove stale parent props/state.

## 5. RetroOS baseline quality and runtime gate

Automated:

- [x] Focused RetroOS Assistant tests (5 files, 13 tests).
- [x] `npm run build:web`.
- [x] `git diff --check`.

```powershell
npm test -- --run apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.test.ts apps/platform-web/src/composables apps/platform-web/src/views/assistant
npm run build:web
git diff --check
```

Manual browser matrix:

- [ ] `ask_user({question, options})` shows options and custom input.
- [ ] `allowCustom:false` shows options only; no-options question shows custom input.
- [ ] option/custom/cancel all resume the same turn and leave a read-only record.
- [ ] one assistant reply owns one process fold; direct Tool rows retain order and custom display names.
- [ ] running/success/failure and `agent_call` details are clear in normal and reduced-motion modes.
- [ ] switching sessions, scrolling, stopping, minimizing and restoring do not lose active work.

- [x] User accepted the RetroOS runtime baseline on 2026-08-06; the Spatial controller gate is open.

Pause for user runtime acceptance before Spatial controller extraction.

## 6. Extract shared Assistant orchestration

- [x] Characterize current session, streaming, attachment, ask, provider and persistence behavior with focused tests.
- [x] Move only view-neutral orchestration into `controllers/assistant/`; keep DOM/scroll/focus concerns presentation-local.
- [x] Make RetroOS `AssistantView.vue` consume the controller without visual or behavioral regression.
- [x] Verify background-session streaming and ask routing before building Spatial UI.

Rollback point: no Spatial registry readiness changes until RetroOS passes after extraction.

## 7. Extract shared Studio orchestration

- [x] Characterize Agent selection, file/config mutations, provider/model controls, Skill visibility and refresh events.
- [x] Move view-neutral state/actions into `controllers/studio/`.
- [x] Make RetroOS `StudioView.vue` consume the controller without changing its UI behavior.
- [x] Verify mutations refresh other open surfaces and preserve workspace navigation.

## 8. Implement Spatial Studio

- [x] Add independent Spatial Studio view/components using the shared controller and Spatial primitives.
- [x] Cover Agent selection, instruction/config/Skill previews, provider/model/platform Tool controls and workspace navigation.
- [x] Add container-responsive and keyboard behavior; keep source DOM stable for projected input.
- [x] Add focused component/controller tests.

## 9. Implement Spatial Assistant

- [x] Add independent Spatial Assistant view/components using the shared controller.
- [x] Implement session navigation, message timeline, one-fold process renderer, streaming and stop behavior.
- [x] Implement attachments, copy/edit-resend, composer, ask deformation, config surface and jump-to-bottom.
- [x] Preserve per-session scroll and Blob cleanup.
- [ ] Verify side-position, occlusion, focus changes and minimize do not abort streaming or ask waits.
- [x] Add focused component/controller tests.

## 10. Register Spatial views and run parity review

- [x] Add lazy Spatial imports and mark only Studio/Assistant registry entries ready.
- [x] Confirm no RetroOS component is embedded and no automatic UI fallback occurs.
- [ ] Run every Studio/Assistant route and action in both shells.
- [x] Keep the production Spatial release gate disabled.

## 11. Full quality gate

```powershell
npm run build:contracts
npm test
npm run build:web
git diff --check
```

- [x] Full automated gate passed on 2026-08-06: contracts, 108 test files / 854 tests, Web build and diff check.
- [x] Run `trellis-check` over the full child scope after code changes. The agent was rate-limited after contributing the per-turn ask scope fix; the main session completed the same full-scope review and validation.
- [x] Run `trellis-update-spec` for the final ask default, Assistant process model and dual-presentation controller contract.
- [ ] Commit only this child’s task/spec/code files in Phase 3.4.
- [ ] Finish/archive this child; do not archive the Spatial parent or remaining sibling tasks.

## 12. Spatial manual-feedback corrections

- [x] Hide the compact Assistant composer scrollbar without removing max-height overflow scrolling.
- [x] Move Assistant configuration out of the application window subtree into an independent global Canvas Source with shell-owned modal presentation and input priority.
- [x] Unify application/global-modal/Toast scrollbars under one Spatial skin while retaining Chromium gutter geometry for projected thumb dragging.
- [x] Add focused request, view boundary and delayed-close tests; rerun the focused suite and Web build.
- [x] Post-feedback automated gate passed: contracts, 109 test files / 857 tests, Web build and diff check. One unrelated schema-cache test exceeded its 5-second limit only under the first parallel run, then passed alone and in the serial full suite.
- [x] User manually accepted the independent configuration surface and unified scrollbar visuals in the flagged browser on 2026-08-06.

## 13. Spatial configuration drag follow-up

- [x] Make the independent Assistant configuration Source draggable from its dark header using the same routed projected screen-coordinate semantics as Spatial windows.
- [x] Keep the moved Source clamped to the measured shell viewport and preserve its position across dirty/render layout passes while open.
- [x] Reset the transient Source position when a new configuration request opens.
- [x] Make the shared global-modal close treatment override `SpatialActionButton` default, hover and focus styles without changing button geometry.
- [x] Add durable component/layout tests without CSS source snapshots; rerun the focused suite, Web build and diff check.
- [x] Final follow-up gate passed: 12 focused files / 72 tests, 110 full files / 859 tests, contracts build, Web build and diff check.
- [x] User manually accepted configuration dragging and the corrected close-button treatment in the flagged browser on 2026-08-06.

## 14. Projected title-action activation follow-up

- [x] Diagnose the close failure as a PointerRouter pressed/captured target mismatch caused by unconditional gesture-owner promotion.
- [x] Preserve actionable descendants, including nested SVG targets, at the shared projected capture boundary while retaining titlebar drag promotion.
- [x] Cover exact-once close activation, ordinary title promotion and non-primary targeting with focused tests.
- [x] Final activation gate passed: 5 focused files / 26 tests, 110 full files / 860 tests, contracts build, Web build and diff check.
- [x] User manually confirmed the Assistant configuration close button closes the independent Spatial Source normally on 2026-08-06.
