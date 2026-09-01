# 默认游戏卡小说阅读器 AIRP 重构 — Implementation Plan

This parent task should be implemented through child tasks. Do not attempt the whole system in one PR.

## Child Task Roadmap Draft

### 1. Workspace contract and schema guide

- Define initial directory contract for source corpus, schema, entities, playthrough state, and director brief.
- Write Agent-facing Schema Design Guide.
- Define schema patch format and changelog conventions.
- Define entity core metadata and simple frontend-readable ordinary fields.

Validation:

- Docs/specs exist in default workspace template.
- Agents can read clear instructions for where to write data.

### 2. Whole-book import and source normalization

- Frontend supports paste or txt/md import.
- Source is written to save workspace.
- Source is normalized and split into chapter/chunk files.
- Source manifest records title, size, chapter list, import time, and processing status.

Validation:

- A full book can be imported without blocking the UI excessively.
- Workspace contains normalized source files and manifest.

### 3. Initial extraction window

- Process first N chapters/chunks.
- Extract major characters, locations, factions, events, and setting notes.
- Avoid minor extras unless important.
- Store extracted data as semantic entity files with sourceRefs and simple frontend-readable summaries where needed.

Validation:

- Extracted entities have sourceRefs.
- The default frontend can render a small entity list/card set.

### 4. world-architect Agent and schema-maintenance Skill

- Add world-architect Agent definition and contacts.
- Add schema-maintenance Skill for schema draft/patch generation.
- Add opening setup responsibilities.
- post-processing can call world-architect when schema is stale.

Validation:

- world-architect can generate schema draft from extracted source.
- post-processing can request a schema patch.

### 5. Player setup flow

- Frontend guides player through import, schema/play-priority confirmation, viewpoint choice, and play mode.
- Persist setup state in workspace.

Validation:

- Player choices are written to save workspace.
- Setup can be resumed after refresh.

### 6. Opening assembly

- world-architect assembles initial scene, player state, visible entities, and current director brief.
- master starts play from assembled opening.

Validation:

- First AIRP turn uses imported novel material and chosen viewpoint.
- No obvious future spoiler leaks in opening.

### 7. Frontend reader over ordinary entity/runtime fields

- Render current brief summary, visible entities, status fields, relation/timeline/list sections, and AIRP narrative.
- Consume stable ordinary entity/runtime fields rather than a separate render projection layer or genre-specific schema.

Validation:

- Different sample genres can render useful cards using the same component shapes.

### 8. Incremental frontier and refresh loop

- Track source frontier.
- post-processing detects stale extraction/schema/brief.
- Refresh source window and current brief on demand.

Validation:

- As play progresses, new source chapters can be processed and new entities/schema patches appear.

## Suggested First Child Task

Start with **Workspace contract and schema guide**.

Reason:

- It prevents later churn across frontend, Agents, Skills, and state files.
- It does not require solving UI import or long-text processing first.
- It gives future child tasks a stable target.

## Validation Commands Placeholder

To be filled once implementation starts:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Rollback Notes

Each child task should avoid destructive migrations to existing saves. Default-card template changes should be additive where possible.
