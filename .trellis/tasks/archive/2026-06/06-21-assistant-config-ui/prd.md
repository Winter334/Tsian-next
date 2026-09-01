# Desktop Assistant Config UI

## Goal

Desktop assistant (`agent.json` at `.tsian/local/assistant/agent.json`) currently has only one config UI control — the provider preset selector in `AssistantView.vue`. The other 9 fields (`title`/`summary`/`contacts`/`contextPaths`/`skills`/`platformTools`/`workspaceAccess.level`/`knowledgeMount`/`streaming`/`toolCallMode`) are only editable by hand-editing the JSON file. This task adds a configuration UI so the user can manage the assistant's full configuration through the interface, consistent with the "visible = editable = manageable" principle.

## Confirmed Facts (from codebase exploration)

- **agent.json fields** (AgentConfig, `contracts/runtime.ts:181-192`): `id`, `title`, `summary`, `contacts[]`, `contextPaths[]`, `skills{enabled,disabled}`, `platformTools{enabled,disabled}`, `workspaceAccess{level}`, `knowledgeMount?`, `providerPresetId?`.
- **Default assistant config** (`local-assistant-files.ts:82-102`): level 4, all platform tools enabled, `framework-knowledge` skill enabled, `knowledgeMount: "docs/"`.
- **Existing UI**: only provider preset selector (`AssistantView.vue:89-107`). `streaming`/`toolCallMode` are model-preset-level (SettingsView), not agent.json; `getLocalAssistantToolCallMode` exists (`platform-host:3061`) but no UI consumes it.
- **Blueprint**: `StudioView.vue` is the card agent editor with 4 sections (skills/tools/workspaceAccess/providerPreset). Same section-card pattern can be reused.
- **Storage ready**: `saveLocalAssistantFiles` (merge write), `buildAgentRegistry` (parses `.tsian/local/` agent.json into full `AgentRegistryEntry`). Card agent setters (`updatePlatformStudioAgentSkillEnabled` etc., `platform-host:2808-2956`) are direct templates for local-assistant versions — simpler (fixed single agent, no `agentId` param).
- **Persistence pattern**: imperative `saveLocalAssistantFiles` (NOT SettingsView's draft+deep-watch-autosave — different storage model).
- **Existing dialog component**: `components/feedback/DialogForm.vue` + `composables/useDialogForm.ts`. It is a fixed-center modal form (`fixed inset-0 grid place-items-center bg-black/55`), title is plain text (no title bar, no X, not draggable), field-driven only (no slot despite useDialogForm comment mentioning slot). Single-instance (second open auto-rejects). Consumed by SettingsView provider edit.

## Requirements

### Field scope (iteration 1 — confirmed)

Cover the 4 core "authority & capability" fields:
- `skills` (enabled/disabled) — reuse StudioView skills section pattern
- `platformTools` (enabled/disabled: agent_call / workspace_read / workspace_write) — reuse StudioView tools section pattern
- `workspaceAccess.level` (0-4) — reuse StudioView workspace access section pattern
- `providerPresetId` — integrate the existing AssistantView provider selector into the config UI

### UI placement (confirmed)

- AssistantView top bar: replace the provider preset `Select` dropdown with a gear icon button.
- Clicking the gear opens a **draggable floating window** (Windows-style) containing the 4 config sections.
- The floating window is the upgraded DialogForm component (see below) — NOT an embedded dialog.

### Dialog component upgrade (confirmed — replace existing)

**Replace** `components/feedback/DialogForm.vue` + `composables/useDialogForm.ts` with a Windows-style floating window. All existing callers (SettingsView provider edit, etc.) migrate to the new component. Behavior:
- **No backdrop/overlay** (remove `bg-black/55`).
- **Does not auto-close on outside click** — clicking elsewhere does not dismiss the window.
- **Shake feedback**: clicking outside the window while it's open triggers a brief shake animation (classic Windows "refuse-to-lose-focus" feedback).
- **Draggable**: grab the title bar to move the window. Constrain to viewport.
- **Title bar**: with the dialog title text + an X close button (top-right). No minimize/maximize buttons.
- **Close methods**: X button, or confirm/cancel buttons (existing form dialogs keep their buttons).
- **Dual content mode**: support both field-driven form mode (existing `openDialogForm` callers) AND slot/custom-content mode (for the assistant config's 4 section cards).
- Single-instance behavior preserved (one floating window at a time).

### Out of scope (iteration 1)

- `title` / `summary` / `contacts` / `contextPaths` / `knowledgeMount` — 5 simple form fields, deferred to a later iteration
- `streaming` / `toolCallMode` — live on model preset layer, not agent.json; deferred (cross-layer concern)
- Minimize/maximize buttons (explicitly excluded per user — X close only)

## Acceptance Criteria

- [ ] AssistantView top bar shows a gear icon (replacing the provider Select dropdown); clicking it opens the config floating window.
- [ ] The floating window renders 4 sections: Skills, Platform Tools, Workspace Access Level, Provider Preset.
- [ ] Toggling a skill / platform tool / access level / provider preset persists to `.tsian/local/assistant/agent.json` and reflects on next assistant turn (no page reload needed).
- [ ] The floating window is draggable by its title bar, constrained to the viewport.
- [ ] The floating window has an X close button in the title bar; clicking it closes the window.
- [ ] Clicking outside the open window does NOT close it; instead the window plays a brief shake animation.
- [ ] No backdrop/overlay behind the floating window.
- [ ] Existing SettingsView dialog callers still work after the DialogForm replacement (provider add/edit, preset edit) — regression check.
- [ ] `build:web` passes.

## Out of scope

- `title` / `summary` / `contacts` / `contextPaths` / `knowledgeMount` fields (iteration 2)
- `streaming` / `toolCallMode` config (model preset layer, separate concern)
- Minimize/maximize window buttons
- Multi-window support (single floating window at a time, as existing)

## Open Questions

(none — all resolved via brainstorm)
