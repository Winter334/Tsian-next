# Implement: 左侧状态栏 MVP

## Preconditions

- Task is planning until reviewed and started with `task.py start`.
- Dependencies satisfied: `07-04-frontend-runtime-render-infra` (archived) + `07-05-runtime-world-time-field` (archived).

## Implementation Checklist

1. Create `composables/useStatusBarCollapsed.ts`.
   - Module-level singleton: `statusCollapsed` ref + `toggle()`.
   - localStorage key `tsian.statusCollapsed`.
   - Same pattern as `useTsian` / `useRuntime`.

2. Create `components/status-bar/StatusBarScene.vue`.
   - Props: `runtime: Runtime | null`.
   - Display `activeScene.name` (fallback chain: `activeScene.name` → `activeSceneIds[0]` → "未知场景").
   - Display `worldTime` (empty string → "时间未知").
   - Scene name: `--font-serif`, `--prose`, slightly larger.
   - Time: `--font-mono`, `--prose-dim`, small.

3. Create `components/status-bar/StatusBarCharacter.vue`.
   - Props: `collapsed: boolean`, `character: { ref, name } | null`.
   - Expanded mode:
     - Square rounded 56×56 avatar with single-line border.
     - Default avatar: `--void-deep` bg + character name first char (`--font-display`, `--ember-bright`).
     - Right side: name (`--prose`) + brief (1-line truncated, `--prose-dim`).
     - Use `useEntity(ref)` when ref present to get `name`/`brief`.
     - ref null → "未设定角色".
     - Click → emit `open-character`.
   - Collapsed mode (极简图腾):
     - Square rounded 40×40 avatar.
     - Bottom gradient overlay + character name first char centered.
     - Radial micro-glow background.
     - Click → emit `toggle`.
     - No character → "?" placeholder + dimmed border.

4. Create `components/status-bar/StatusBarStatus.vue`.
   - Props: `status: Runtime["status"]`, `tags: DisplayItem[]`.
   - Section title "状态" + gradient thin line.
   - Render `status` items: `description` + optional `level` tag.
   - Render `tags` items: `label: value` or `label` (fallback).
   - Empty: "暂无状态" (`--whisper`).

5. Create `components/status-bar/StatusBarMetrics.vue`.
   - Props: `metrics: DisplayItem[]`.
   - Section title "数值" + gradient thin line.
   - progress: label + bar (`--ember` fill, `--line` track, 4px height) + number.
   - number: label + value + unit.
   - tone color mapping: `danger → --blood`, `warning → --ember-bright`, `success → --ember`, default `--ember`.
   - Empty: "暂无数值".

6. Create `components/status-bar/StatusBarRefs.vue` (optional).
   - Props: `refs: DisplayItem[]`.
   - Section title "关联" + gradient thin line.
   - Each item: `label` + `name`.
   - If `refs` empty, entire section hidden (no empty title placeholder).
   - MVP: display only, no navigation (navigation deferred to character card task).

7. Create `components/StatusBar.vue` (container).
   - fixed left, top 52px, bottom 0, z 19.
   - GSAP width animation: `collapsed ? 48 : 240`, duration 0.3s, ease `power2.inOut`.
   - Background: `rgba(10, 5, 6, 0.7)` + `backdrop-filter: blur(8px)`.
   - Right border: `1px solid var(--line)`.
   - Data: `useRuntime()` → `runtimeData`.
   - Expanded: render Scene → Character → Status → Metrics → Refs (top to bottom).
   - Collapsed: render only Character (collapsed mode).
   - Error states:
     - `error === "load-failed"` → show "状态暂不可用", hide sections.
     - `error === "not-found"` → show empty states per section.
     - `status === "loading"` → show dimmed placeholder.
   - emit `toggle` (collapsed avatar click) + `open-character` (expanded avatar click).

8. Integrate into `App.vue`.
   - Add `StatusBar` to `stage-play` (v-if phase revealed).
   - Extend `navCurrent` type to `"story" | "character" | "settings"`.
   - Add `CharacterView` placeholder (v-if navCurrent === 'character') — MVP minimal placeholder, full UI deferred to character card task.
   - Wire `useStatusBarCollapsed()` + `onToggleStatus`.
   - `onOpenCharacter` → `navCurrent.value = "character"`.

9. Integrate into `AppHeader.vue`.
   - Add `statusBarCollapsed: boolean` prop + `toggleStatusBar` emit.
   - Add left-side collapse button (mirror of right nav toggle).
   - Position: left of Logo, same 28×28 button style.

10. Integrate into `AppNav.vue`.
    - Add "角色" nav item: `{ key: "character", label: "角色", icon: "..." }`.
    - Update `NavItem` type to include `"character"`.

11. Update `StoryView.vue` padding.
    - `padding-left: 240px` (expanded) / `48px` (collapsed).
    - CSS transition 0.3s ease on padding-left.
    - Use `:has(.status-bar.collapsed)` selector or receive prop.

12. Validation.
    - `npm run build --workspace play-frontend-dev`.
    - `git diff --check`.
    - Manual check: status bar visible, fold/unfold works, padding syncs, character click switches to character view, story nav returns.

## Review Gates

- Before starting implementation, confirm task activation through Trellis (`task.py start`) after planning review.
- After implementation, verify:
  - Status bar does not break send/stop/options/scroll/checkpoint restore.
  - Fold/unfold persists across reloads (localStorage).
  - StoryView padding-left syncs with fold state.
  - Character view switch works (nav 故事 ↔ 角色 ↔ 设置).

## Risk / Rollback Points

- `App.vue` / `AppHeader.vue` / `AppNav.vue` / `StoryView.vue` are existing components — use minimal integration edits, don't refactor.
- `navCurrent` type extension touches AppNav items + App.vue switching logic — verify all v-show/v-if branches.
- GSAP width animation: ensure `onMounted` sets initial width without animation (same as AppNav pattern).
- StoryView `:has()` selector: verify `:has()` browser support is acceptable (Chromium-based platform web; already used in App.vue:180).
- Rollback: delete new components + composable, revert integration points in App/AppHeader/AppNav/StoryView.
