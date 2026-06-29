# 小说 AIRP 初始理解窗口 — Implementation Plan

## 1. Files / Areas

Likely touched areas:

- `apps/play-frontend-dev/src/source-import.ts` or a new setup module split from it
- `apps/play-frontend-dev/src/style.css`
- Skill files for opening initialization, location to be determined from existing platform conventions
- Optional shared script files packaged with the Skill

Do not modify packaged default frontend files.

## 2. Frontend Refactor

> **Superseded by Section 8 (UI redesign, 2026-06-30).** The original plan below described the first cut implemented in `3fe3d69`. Section 8 is the redesign that replaces the shell/step-rail/step-2 presentation. Keep this section for history; follow Section 8 for the actual work.

Extend the current opening guide from import-only to multi-step state:

1. Keep import review as step 1.
2. Enable transition to step 2 after source exists.
3. Render step rail with active state based on current setup step.
4. Add initial understanding stage with `not_started`, `running`, `ready`, `failed` states.
5. On start, call `tsian.invokeAgent("world-architect", prompt)`.
6. After Agent returns, read `save/understanding/initial-summary.json` and related outputs.
7. Show summary or error/retry.

Do not call Skill actions directly from the frontend. The frontend invokes the Agent; the Agent chooses and runs `小说开局初始化`.

## 3. Skill / Script Work

Create opening initialization Skill with:

- `SKILL.md` flow instructions;
- Chinese `name` / `description` as the concise Skill index selection entry;
- script/action to inspect source opening structure from manifest/index;
- script/action to read continuous opening slices while the Agent judges plot sufficiency;
- script/action to commit the full opening understanding package with built-in required-field/sourceRef checks;
- clear error messages intended for Agent correction.

Keep the exposed actions Agent-centered. Avoid forcing the Agent to call separate low-level write tools for window, brief, entities, frontier, and summary.

Recommended Skill index:

```yaml
name: 小说开局初始化
description: 为刚导入的小说建立开局资料：阅读足够的开头剧情，整理初始人物、地点、势力、设定，并写入第一版 brief、实体和阅读进度。
```

Use English slugs for filesystem and action names:

```text
skills/opening-initialization/SKILL.md
inspect_source_opening
read_opening_slice
commit_opening_understanding
```

## 4. Agent Prompt Contract

The frontend invoke prompt should include:

- current goal: initialize opening understanding for this save;
- source paths: manifest and chapters index;
- instruction to use the opening initialization Skill;
- required completion signal: expected workspace files must exist;
- reminder not to extract the full book.

Keep the Agent definition itself minimal. Use a human professional role to shape judgment if needed, and reserve stronger persona/style for `SOUL.md`. Do not encode detailed paths, schema fields, or script procedures in `world-architect`; put those in the Skill and scripts.

## 5. Workspace Output Contract

Write at minimum:

- `save/understanding/initial-window.json`
- `save/understanding/initial-brief.md`
- `save/understanding/initial-summary.json`
- one or more entity files when found
- `save/playthrough/frontier.json`

The frontend should require `initial-summary.json` to mark step ready.

## 6. Validation

Run:

```bash
npm run build --workspace play-frontend-dev
```

Manual verification:

- imported save can move from import review to initial understanding;
- starting initial understanding triggers Agent call;
- running state is visible;
- if outputs are written, ready summary appears after refresh;
- if Agent call fails or outputs are missing, failed state and retry are visible;
- default packaged frontend remains untouched.

## 7. Risks / Follow-ups

- Agent id availability may vary by card; v0 should surface a clear error if `world-architect` is unavailable.
- Long source chapters may exceed prompt budgets; source window caps are budget guards, while the primary window decision is plot sufficiency for opening setup.
- Later task should add the separate world-maintenance Skill for post-opening updates.

## 8. UI Redesign (2026-06-30, supersedes Section 2)

The Skill/Agent/script work (Sections 3-5) is done and corrected. Remaining work is the **frontend presentation redesign** agreed in the 2026-06-30 design discussion. See `design.md` §5 for the full spec; this section is the execution plan.

### 8.1 Shell rework — `source-import.ts` + `style.css`

- Remove `renderSetupShell`'s `setup-header` (the `Opening Guide · 正式游玩前的开局准备` strip). Drop the `setup-eyebrow` / `setup-header-copy` elements and their CSS.
- Hide the global app header while the guide is active. The guide already hides the right sidebar via `.body:has(.setup-shell) .sidebar-right { display: none }`; add an equivalent rule to hide `.app-header` (e.g. `.app:has(.setup-shell) .app-header { display: none }`). Verify the guide still scrolls correctly full-viewport.
- Replace the left vertical `setup-step-rail` (148px column + `setup-step-list` + per-step `setup-step` rows) with a top horizontal stepper. New structure: a `setup-stepper` bar under where the header was, with one node per step (check icon for completed, glowing node for current, dimmed for unimplemented) connected by a line that fills as progress advances. Main content (`setup-stage`) takes full width — change `setup-workspace` grid from `148px 1fr` to a single column; the stepper is a row above the stage, not a sibling column.
- Step-transition animation: stop doing `story.innerHTML = ""` + instant re-render. Wrap the stage content swap in a fade/slide (opacity + translateY) transition. Simplest viable approach: a short CSS transition on a wrapper that gets a `.leaving` class before swap and `.entering` after, or a `requestAnimationFrame` two-stage swap. Keep it lightweight — no router, no virtual DOM.

### 8.2 Step 1 — 导入小说

- **choose screen**: remove the page title + `setup-copy` subtitle. Keep only `renderMethodChoice`'s two cards, centered. Card hover/active gets layered animation: `translateY(-2px)` (existing) + ember stroke + inner glow (`box-shadow: inset 0 0 24px var(--gold-glow)`). Make the card effect the visual centerpiece.
- **paste/file screens**: trim copy (e.g. "适合短篇、片段，或先用一小段文本确认开局流程。" → shorter). File drop zone: implement real drag-and-drop (`dragover`/`drop` listeners writing to the same path the `<input type=file>` uses) OR drop the dashed drop-area visual and keep a plain "选择文件" button. Decide during implementation; do not ship the fake drop zone.
- **review screen**: keep overview + split panes structure. De-report-ize copy: "检查切分结果" → "确认目录", "确认目录和章节开头是否符合预期。开局前可以重新导入。" → shorter. Button "开始初始理解" → "开始理解".

### 8.3 Step 2 — 初始理解

- **running**: replace the single static line with a themed animation (ember/turning-page motif — pure CSS keyframes, no assets) + preset stage copy. Three stages roughly map to the Skill tools: "正在观察导入结构…" → "正在阅读开头剧情…" → "正在写入开局资料…". Optional stage-advance: poll `understanding-summary.json` `status`, or elapsed-time fallback. Do not expose `world-architect` in copy.
- **ready**: minimal. No brief, no entity counts, no chapter range. Layout: guiding question "你想以谁的身份走进这个故事？" + two cards — **原著角色** / "扮演故事里已有的人"  ·  **原创角色** / "创造一个全新的角色". Secondary action "返回切分" only; no primary button (the card IS the next step). Selecting a card advances stepper to ③ (step 3 detail views are out of scope here — designed when step 3 is discussed).
- **failed**: short retry copy.
- Update `renderOpeningUnderstanding` and its CSS accordingly.

### 8.4 Copy pass

Global: shorten button labels, remove report-tone instructional text, never surface internal Agent ids to the player.

### 8.5 Validation

```bash
npm run build --workspace play-frontend-dev
```

Manual:
- guide is full-screen (no app header, no right sidebar);
- horizontal stepper shows progress with animation;
- step transitions fade/slide, not instant;
- step 1 choose is just two animated cards;
- step 2 running shows themed animation + staged copy;
- step 2 ready shows only the two branch cards;
- default packaged frontend untouched.
