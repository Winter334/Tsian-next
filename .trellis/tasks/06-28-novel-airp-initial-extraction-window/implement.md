# 小说 AIRP 初始理解窗口 — Implementation Plan

## 1. Files / Areas

Likely touched areas:

- `apps/play-frontend-dev/src/source-import.ts` or a new setup module split from it
- `apps/play-frontend-dev/src/style.css`
- Skill files for opening initialization, location to be determined from existing platform conventions
- Optional shared script files packaged with the Skill

Do not modify packaged default frontend files.

## 2. Frontend Refactor

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
