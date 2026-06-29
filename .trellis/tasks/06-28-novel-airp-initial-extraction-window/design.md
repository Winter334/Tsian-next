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

The existing setup shell step rail should make step 2 active after import review.

Initial understanding stage states:

- `not_started`: source imported but no initial outputs found;
- `running`: Agent call in progress;
- `ready`: summary files found and readable;
- `failed`: Agent call or expected output read failed, with retry action.

Ready state should show a small summary only:

- brief;
- counts of characters / locations / factions;
- selected source window size;
- a few candidate original character names if available.

Do not overwhelm the player with extraction logs.

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
2. Read `save/understanding/initial-summary.json`.
3. If summary exists and has `status: "ready"`, render ready state.
4. Otherwise render failed/retry state with a concise explanation.
