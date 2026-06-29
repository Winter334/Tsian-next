# 小说 AIRP 初始理解窗口 — Design

## 1. Positioning

This task implements the second opening guide step: initial understanding.

The product goal is not full-book extraction. It is to build enough reliable opening context from the imported source corpus so later setup steps can offer canon character choices, original character grounding, and an opening brief.

## 2. Responsibility Split

### 2.1 Frontend

`apps/play-frontend-dev` owns the setup UI and trigger lifecycle:

- detect whether source import exists;
- allow the player to continue from import review to initial understanding;
- call `tsian.invokeAgent(...)` for the initialization run;
- show pending / complete / failed / retry states;
- read completed workspace outputs and render a small summary.

The frontend does not deeply validate or repair extraction content.

### 2.2 Architect Agent

The `world-architect` is responsible for reading the initial source material, reasoning about the novel, and producing the initial world understanding.

The Agent definition should stay lightweight: role boundary, when it is called, and the principle that concrete capabilities come from Skills. It can use a human professional identity to stabilize judgment, while `SOUL.md` can carry a more stylized persona. Do not hard-bind large path/schema/script details into the Agent prompt. The frontend prompt should ask the Agent to use the opening initialization Skill rather than invent paths or schemas from scratch.

### 2.3 Opening Initialization Skill

Create a dedicated opening initialization Skill for this flow.

Responsibilities:

- choose the initial source window from `save/source/manifest.json` and `save/source/chapters.index.json`;
- read selected chapters;
- guide the Agent to extract opening-useful material;
- write initial workspace outputs through Skill scripts;
- validate required shape/sourceRefs inside the write scripts and return actionable errors when outputs are incomplete.

This Skill is not the later world-maintenance Skill. The flow is one-time opening setup. Shared scripts should be reusable by a future maintenance Skill.

### 2.4 Agent-Centered Script Layer

The Skill scripts should match how the Agent wants to work, not expose low-level CRUD primitives.

Recommended action shape:

- `inspect_source_opening`: returns book title, early chapter list, character counts, and short opening previews so the Agent can understand the source structure.
- `read_opening_slice`: reads a continuous chapter range or the next chapter slice, returning text plus the accumulated window metadata.
- `commit_opening_understanding`: accepts the full opening understanding package and writes window, brief, entities, frontier, and frontend summary in one validated commit.

`commit_opening_understanding` owns write-time validation. It should reject incomplete packages with actionable errors instead of requiring the Agent to remember a separate validation step.

The underlying write helpers can be generic enough for later reuse, but the exposed initialization actions should stay centered on this flow.

## 2.5 Skill Index Entry

The Skill index entry is the selection trigger. Keep it short, Chinese, and player-editable. Do not duplicate a separate internal trigger checklist in `SKILL.md`; once loaded, the Agent can decide from the actual instructions whether the Skill fits the current task.

Recommended index shape:

```yaml
name: 小说开局初始化
description: 为刚导入的小说建立开局资料：阅读足够的开头剧情，整理初始人物、地点、势力、设定，并写入第一版 brief、实体和阅读进度。
```

Use an English slug for filesystem/action stability:

```text
skills/opening-initialization/SKILL.md
actions: inspect_source_opening, read_opening_slice, commit_opening_understanding
```

Future Chinese maintenance Skill contrast:

```yaml
name: 世界资料维护
description: 在正式游玩过程中维护世界资料：根据新剧情更新实体、brief、阅读进度和运行时记录。
```

## 3. Workspace Contracts

Initial outputs:

```text
save/understanding/initial-window.json
save/understanding/initial-brief.md
save/understanding/initial-summary.json
save/entities/characters/*.json
save/entities/locations/*.json
save/entities/factions/*.json
save/playthrough/frontier.json
```

### 3.1 `initial-window.json`

Records what the Skill chose to read:

```json
{
  "version": 1,
  "selectedAt": "2026-06-28T00:00:00.000Z",
  "reason": "front chapters sufficient for opening context",
  "chapters": [
    { "index": 1, "title": "第一章", "path": "save/source/chapters/chapter-0001.md", "characters": 6812 }
  ],
  "totalCharacters": 6812
}
```

### 3.2 `initial-summary.json`

Frontend-readable status and summary:

```json
{
  "version": 1,
  "status": "ready",
  "title": "情花孽",
  "brief": "一句到三句的开局可用世界摘要。",
  "counts": { "characters": 6, "locations": 3, "factions": 2 },
  "candidateCharacterIds": ["character/guo-jing"],
  "updatedAt": "2026-06-28T00:00:00.000Z"
}
```

### 3.3 Entity files

Entity files use the parent task's ordinary frontend-readable shape:

```json
{
  "version": 1,
  "id": "character/example",
  "type": "character",
  "name": "角色名",
  "brief": "简短介绍。",
  "tags": ["原著角色"],
  "status": "初始可见",
  "fields": {},
  "sections": [],
  "sourceRefs": [
    { "chapterIndex": 1, "path": "save/source/chapters/chapter-0001.md" }
  ]
}
```

## 4. Source Window Selection

The opening initialization Skill owns source window selection.

Initial heuristic recommendation:

- select a continuous window from the beginning of `chapters.index.json`;
- stop when the read material contains enough plot to support an opening setup;
- treat chapter count and text length as safety caps, not as the primary selection rule;
- include at least one chapter/fragment;
- record every selected chapter in `initial-window.json`.

The Skill should explain the plot sufficiency judgment in `reason`, e.g. which inciting situation, protagonist context, conflict, or setting cues made the window enough for opening setup. Numeric caps can be tuned during implementation only as budget guards.

## 5. Frontend UX

### 5.1 Shell（重做，2026-06-30 讨论定稿）

The opening guide shell is redesigned away from its earlier "admin panel" feel toward a novel-opening ritual. Decisions:

- **Drop the setup header.** The `Opening Guide · 正式游玩前的开局准备` strip is removed — it is decorative and redundant with the stepper.
- **Full-screen guide.** While the guide is active, the global app header (`Tsian 就绪` bar) is hidden so the guide owns the full viewport. The right nav sidebar is already hidden (existing `.body:has(.setup-shell) .sidebar-right { display: none }`).
- **Top horizontal stepper** replaces the left 148px vertical step rail. The vertical rail read as a navigation bar, not a progress indicator. Horizontal stepper carries the timeline feeling: completed steps get a check, the current step glows, unimplemented steps are dimmed; a fill animation runs along the connecting line. The main content area goes full-width.
- **Step-transition animation.** Step changes currently do `story.innerHTML = ""` and re-render instantly. Add a fade/slide transition between steps so the guide feels continuous, not jumpy.
- **De-report-ize copy.** Current copy is report-toned ("确认切分结果", "检查目录和章节开头是否符合预期", "正式游玩前的开局准备"). Shorten button labels (e.g. "开始初始理解" → "开始理解") and soften instructional text. Avoid exposing internal Agent ids (`world-architect`) to the player.

### 5.2 Step 1 — 导入小说

Three sub-screens: choose → input → review.

- **choose**: Strip down to just two method cards (粘贴 / 文件). Remove the page title and subtitle copy — the stepper already labels this step. Center of gravity is the card effect: on hover/active, layer multiple animations (lift + ember stroke + inner glow), same visual language as the step-2 branch cards.
- **input (paste/file)**: Trim copy. The file drop zone currently shows a dashed-border drop area but only supports the hidden `<input type=file>` — either implement real drag-and-drop or drop the fake drop-zone visual and keep a plain file button. Decide at implementation time.
- **review**: Keep the structure (overview + split chapter/preview panes). De-report-ize the copy.

### 5.3 Step 2 — 初始理解

States: `not_started` / `running` / `ready` / `failed` (same as before, presentation redesigned).

- **running**: A themed animation (ember / turning-page motif) plus preset stage copy. Stages roughly map to the Skill's three tools (observe source structure → read opening plot → write opening materials). Do **not** reflect real-time tool progress — the Agent's work under the Skill is staged, so preset copy + animation is enough. Do not expose the `world-architect` id in the copy; write player-facing lines like "正在阅读开头…" → "正在整理开局资料…" → "正在写入…". Stage advance signal (if cheap): elapsed time, or polling `understanding-summary.json` `status` change from `pending`. Not required to be real.
- **ready**: Minimal. No brief, no entity counts, no chapter range — the player does not need to audit the extraction here; later Agent dialogue consumes those materials. The ready state's only job is one decision: choose an entry identity. Layout:
  - one guiding question: "你想以谁的身份走进这个故事？"
  - two cards: **原著角色** / "扮演故事里已有的人"  ·  **原创角色** / "创造一个全新的角色"
  - a single "返回切分" secondary action (no primary "下一步" — the branch card is the next step).
  - Selecting a card advances the stepper from ② to ③ 角色设定. The detail views behind each branch (canon character card grid, original-character dialogue collection) belong to step 3 and are designed when step 3 is discussed.
- **failed**: Short retry copy, no long explanation.

Do not overwhelm the player with extraction logs at any state.

## 6. Re-run Boundary

Before opening setup is complete, re-running initial understanding is allowed. It overwrites the previous initial understanding outputs and entity skeletons created by this initialization flow.

This task does not solve post-opening maintenance. Later world-maintenance Skill should handle incremental changes during play.

## 7. Agent Invocation

Frontend calls an Agent through `tsian.invokeAgent(agentId, input)`.

Design assumption for v0:

- preferred Agent id: `world-architect`;
- input includes source manifest/index summary and tells the Agent to run the opening initialization Skill;
- completion is determined by reading expected workspace outputs after the Agent returns.
- the frontend must not call Skill scripts directly or assemble the understanding package itself.

If `world-architect` is not configured in the current card, implementation should fail gracefully with an actionable UI error instead of silently marking setup complete.

Completion check:

1. Call `tsian.invokeAgent("world-architect", input)`.
2. Read `save/playthrough/understanding-summary.json` (the actual implementation path; the earlier `save/understanding/initial-summary.json` in the original plan was superseded — skill writes, UI reads, and the template seed all agree on `save/playthrough/understanding-summary.json`).
3. If summary exists and has `status: "ready"`, render ready state.
4. Otherwise render failed/retry state with a concise explanation.
