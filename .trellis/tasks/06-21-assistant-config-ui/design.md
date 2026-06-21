# Design: Desktop Assistant Config UI

## Architecture Overview

Two loosely coupled layers:

1. **Floating Window component** (generic UI primitive) — upgraded DialogForm, reusable by all dialog callers.
2. **Assistant Config content** — 4 section cards rendered inside the floating window, backed by local-assistant setter functions.

The floating window is the container; the assistant config is one consumer of its slot/custom-content mode. SettingsView's existing form dialogs are the other consumer (field-driven mode). Both share the same window chrome (draggable title bar, X close, shake-on-outside-click).

---

## Part 1: Floating Window Component

### Component: `components/feedback/FloatingWindow.vue` (replaces DialogForm.vue)

Rename `DialogForm.vue` → `FloatingWindow.vue` (or keep filename, refactor content — see implementation note). The component renders:

```
┌─────────────────────────────────┐
│ Title Bar (draggable)      [X] │  ← grab here to move
├─────────────────────────────────┤
│                                 │
│  <slot>                         │  ← custom content (assistant config)
│   OR                            │
│  field-driven form              │  ← existing openDialogForm callers
│                                 │
├─────────────────────────────────┤
│  [test]      [cancel] [confirm] │  ← buttons (form mode only)
└─────────────────────────────────┘
```

### Behavior

- **No backdrop**: remove `fixed inset-0 bg-black/55`. Render as a `position: fixed` panel at a default position (e.g. centered or offset from top-left), no overlay behind it.
- **Draggable**: title bar has a `pointerdown` → `pointermove` → `pointerup` drag handler updating `transform: translate(x, y)`. Constrain so the window can't be dragged off-viewport (keep title bar reachable).
- **X close**: title bar right side has an X button. Clicking it resolves the dialog as cancelled (null for form mode; emits `close` for slot mode).
- **Outside-click shake**: a global `pointerdown` listener detects clicks outside the window. On such a click, add a CSS `shake` keyframe animation class to the window for ~300ms, then remove it. Do NOT close or steal focus.
- **Single-instance**: one window at a time (preserved from existing `useDialogForm` — second `openDialogForm` auto-rejects).

### Dual content mode

- **Form mode** (existing callers): `openDialogForm({ title, fields, ... })` → renders field-driven form + confirm/cancel buttons. Preserves `Promise<Record<string,string> | null>` return.
- **Slot mode** (new, for assistant config): `openDialogWindow({ title })` → renders a window with only the title bar + X + `<slot>`. No form fields, no confirm/cancel buttons (the assistant config sections manage their own persistence imperatively). Returns `Promise<void>` (resolves on X close).

### Composable: `composables/useDialogForm.ts` → extend or split

Two options:
- **Extend**: add `openDialogWindow()` alongside `openDialogForm()` in the same composable, sharing the single-instance state. Simpler, less surface area.
- **Split**: new `useDialogWindow.ts` for slot mode. Cleaner separation but two single-instance guards to keep in sync.

**Decision: extend** — both modes share the same window chrome and single-instance invariant; one composable is simpler and avoids the risk of two windows. `openDialogForm` keeps its exact signature; `openDialogWindow` is additive.

### Migration: SettingsView callers

SettingsView's `openDialogForm` callers (provider add/edit, preset edit) keep working unchanged — they use form mode, which preserves the existing `Promise<Record<string,string> | null>` contract. The only visible change: the dialog becomes a draggable window with X + title bar + no backdrop + shake. No caller code changes needed (the composable signature is preserved).

---

## Part 2: Assistant Config Content

### Storage layer: `platform-host/index.ts`

New functions (modeled on card agent setters `platform-host:2808-2956`, simplified for fixed single assistant):

```ts
// Read full assistant config (via buildAgentRegistry, filter LOCAL_ASSISTANT_AGENT_ID)
export async function getLocalAssistantConfig(): Promise<AgentRegistryEntry | null>

// Setters — each reads current config, mutates one field, saveLocalAssistantFiles
export async function updateLocalAssistantSkillEnabled(input: { skillPath: string; enabled: boolean }): Promise<void>
export async function updateLocalAssistantPlatformToolEnabled(input: { tool: AgentPlatformToolName; enabled: boolean }): Promise<void>
export async function updateLocalAssistantWorkspaceAccess(level: number): Promise<void>
// providerPresetId setter already exists: updateLocalAssistantProviderPreset
```

Pattern (from `updateLocalAssistantProviderPreset:3017-3053`): `loadLocalAssistantFiles` → find `LOCAL_ASSISTANT_AGENT_CONFIG_PATH` → `parseAgentConfigRecord` → mutate field → `JSON.stringify` → `saveLocalAssistantFiles`. Each new setter copies this skeleton, mutates its own field.

`getLocalAssistantConfig` uses `buildAgentRegistry(files)` + filter `LOCAL_ASSISTANT_AGENT_ID` → returns full `AgentRegistryEntry` (skills state, platformTools state, workspaceAccess, contacts, contextPaths, knowledgeMount, providerPresetId all populated).

### Bridge exposure

Add the 4 new functions to the platform bridge (alongside existing `updateLocalAssistantProviderPreset`). The AssistantView calls them via the bridge.

### UI: AssistantView changes

- **Top bar**: remove the provider `Select` dropdown (`AssistantView.vue:89-107`). Replace with a gear icon button (`Settings` icon from lucide-vue-next). On click: `openDialogWindow({ title: "助手配置" })`.
- **Config content** (rendered in the window's slot): a new component `components/assistant/AssistantConfigPanel.vue` with 4 sections, modeled on `StudioView.vue`'s sections:
  - **Skills section** (`StudioView:139-169` pattern): list available skills, checkbox per skill, toggle calls `updateLocalAssistantSkillEnabled`.
  - **Platform Tools section** (`StudioView:186-208` pattern): 3 checkboxes (agent_call / workspace_read / workspace_write), toggle calls `updateLocalAssistantPlatformToolEnabled`.
  - **Workspace Access section** (`StudioView:212-242` pattern): `Select` dropdown with level options (0/1/2/4 + Chinese labels from `StudioView:371-392`), change calls `updateLocalAssistantWorkspaceAccess`.
  - **Provider Preset section** (`StudioView:244-275` pattern): `Select` dropdown with `__platform_default__` sentinel + preset options, change calls `updateLocalAssistantProviderPreset`.
- **State**: after each toggle/change, re-fetch `getLocalAssistantConfig()` to refresh the panel state (imperative, like StudioView's `reloadSnapshotAndSelectedAgent`).
- **Feedback**: `setFeedback` toast on success/error (StudioView pattern).

### Available skills source

The skills section needs the list of available skills to show checkboxes. StudioView gets them from `activeStudioWorkspaceFiles(card)` → `collectStudioSkills`. For the local assistant, skills come from `.tsian/local/assistant/skills/` (local assistant skills) + card-declared skills. Need to confirm: does `buildAgentRegistry` already populate the skill list for the assistant? If not, reuse the skill-collection logic scoped to local assistant files. (Implementation detail — verify in Step 1.)

---

## Tradeoffs

- **Replace vs. new dialog component**: chose replace (user decision) — unifies dialog UX, but requires migrating all existing callers. Risk mitigated by preserving `openDialogForm` signature (form-mode callers need no code changes).
- **Extend vs. split composable**: chose extend — simpler, single single-instance guard. Risk: the composable grows; acceptable for 2 modes.
- **No backdrop + shake**: deviates from standard modal pattern but matches user's Windows-aesthetic intent. Outside-click no-longer-cancels means users must explicitly close — reduces accidental data loss in form mode (a side benefit).

## Compatibility / Rollback

- `openDialogForm` signature preserved → SettingsView callers work without changes.
- If the floating window breaks SettingsView, rollback = revert `FloatingWindow.vue` + composable; assistant config panel is isolated in its own component.
- Assistant config setters are additive (new exports) → no existing function signatures change.
