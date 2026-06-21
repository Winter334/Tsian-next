# Implement: Desktop Assistant Config UI

## Step 1: Floating Window component (replace DialogForm)

- [ ] Rename `components/feedback/DialogForm.vue` → `components/feedback/FloatingWindow.vue` (or refactor in place — keep the export path stable for App.vue's import).
- [ ] Template: remove `fixed inset-0 bg-black/55` overlay. Render `position: fixed` panel with:
  - Title bar (draggable handle) with title text + X close button (lucide `X` icon).
  - Content area: `<slot>` for custom content OR field-driven form (existing logic).
  - Footer: confirm/cancel/test buttons (form mode only — hide when slot mode).
- [ ] Drag logic: `pointerdown` on title bar → track `pointermove` → update `transform: translate(x, y)`. Constrain to viewport (window can't go fully off-screen; keep at least the title bar visible). Reset transform on open.
- [ ] Shake on outside-click: global `pointerdown` listener (added on mount, removed on unmount). If click target is outside the window element → add `animate-shake` class for 300ms. Define `@keyframes shake` in the component's scoped style (small horizontal jitter, 3-4 cycles).
- [ ] X button: resolves as cancel (form mode → null; slot mode → resolve void).
- [ ] Update `App.vue` import if filename changed.
- [ ] **Verify**: `build:web` passes; SettingsView provider add/edit dialogs still open (form mode intact, now as draggable windows).

## Step 2: Composable — add slot mode

- [ ] In `composables/useDialogForm.ts`: add `openDialogWindow(options: { title: string; widthClass?: string }): Promise<void>`. Shares the same `pending` ref (single-instance). Resolves when X clicked.
- [ ] Extend `PendingDialog` type: add `mode: "form" | "window"` + optional slot resolution. Form mode preserves existing `Promise<Record<string,string> | null>`. Window mode returns `Promise<void>`.
- [ ] `FloatingWindow.vue`: check `pending.value.mode` — if "form", render fields + buttons; if "window", render `<slot>` only (no fields, no buttons).
- [ ] **Verify**: `build:web` passes.

## Step 3: Storage layer — assistant config getters/setters

- [ ] `platform-host/index.ts`: add `getLocalAssistantConfig()` — `loadLocalAssistantFiles` → `buildAgentRegistry(files)` → filter `LOCAL_ASSISTANT_AGENT_ID` → return `AgentRegistryEntry | null`.
- [ ] Add `updateLocalAssistantSkillEnabled({ skillPath, enabled })` — copy `updateLocalAssistantProviderPreset` skeleton, mutate `skills.enabled`/`skills.disabled` arrays.
- [ ] Add `updateLocalAssistantPlatformToolEnabled({ tool, enabled })` — mutate `platformTools.enabled`/`disabled`.
- [ ] Add `updateLocalAssistantWorkspaceAccess(level)` — set `workspaceAccess.level` (clamp 0-4).
- [ ] (`updateLocalAssistantProviderPreset` already exists — no change.)
- [ ] Expose all 4 in the platform bridge (alongside existing `updateLocalAssistantProviderPreset`).
- [ ] **Verify**: `build:web` passes (type layer).

## Step 4: AssistantConfigPanel component

- [ ] New `components/assistant/AssistantConfigPanel.vue` — 4 section cards, modeled on StudioView sections.
- [ ] On mount: call `getLocalAssistantConfig()` via bridge → populate reactive state.
- [ ] **Skills section**: list available skills (verify skill source in Step 1 — `buildAgentRegistry` skill list or collect from local assistant files). Checkbox per skill → `updateLocalAssistantSkillEnabled` → refetch config.
- [ ] **Platform Tools section**: 3 checkboxes (agent_call / workspace_read / workspace_write) with Chinese labels/descriptions (copy from `StudioView:349-369`) → `updateLocalAssistantPlatformToolEnabled`.
- [ ] **Workspace Access section**: `Select` dropdown, level options 0/1/2/4 with Chinese labels (copy from `StudioView:371-392`) → `updateLocalAssistantWorkspaceAccess`.
- [ ] **Provider Preset section**: `Select` dropdown, `__platform_default__` sentinel + `providerPresetOptions` → `updateLocalAssistantProviderPreset`.
- [ ] Feedback toast on each toggle (success/error).
- [ ] **Verify**: `build:web` passes.

## Step 5: AssistantView integration

- [ ] Remove provider `Select` dropdown from `AssistantView.vue:89-107`.
- [ ] Add gear icon button (`Settings` icon from lucide-vue-next) in the top bar.
- [ ] On click: `const win = await openDialogWindow({ title: "助手配置", widthClass: "max-w-lg" })` — but need to render `AssistantConfigPanel` in the window's slot. Since `openDialogWindow` is promise-based (no slot injection), use a reactive flag: set `showAssistantConfig = true`, render `<FloatingWindow v-if="showAssistantConfig"><AssistantConfigPanel @close="showAssistantConfig = false" /></FloatingWindow>` directly (not via the composable). Or extend `openDialogWindow` to accept a slot render function.
  - **Implementation note**: Vue's reactivity + the single-instance composable don't mix cleanly with slots. Cleaner approach: render `FloatingWindow` directly in AssistantView's template with `v-if`, bypass the composable for slot mode, and let the composable handle only form mode. This avoids the slot-injection problem. Decide in Step 5.
- [ ] **Verify**: `build:web` passes; gear button opens the window; 4 sections render.

## Step 6: Build + smoke test

- [ ] `npm run build:web` green.
- [ ] Smoke test (user): gear button opens config window; window is draggable; X closes it; outside-click shakes; each toggle persists to agent.json and reflects on next assistant turn; SettingsView dialogs still work.

## Validation Commands

```bash
npm run build:web
npm run dev:web   # smoke test (user)
```

## Rollback Points

- After Step 1-2: revert FloatingWindow + composable → DialogForm restored.
- After Step 3-5: revert AssistantView + AssistantConfigPanel + storage functions → additive, no existing signatures changed.
