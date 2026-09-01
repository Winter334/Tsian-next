# 默认游戏卡小说阅读器 AIRP 重构 — Design

## 1. Positioning

This is a parent task for rebuilding the default game card into a novel-reader AIRP experience.

The target is not a single fixed genre game. The player may import any novel. The default card provides:

- a novel source corpus pipeline,
- a living schema design process,
- simple frontend-readable entity/runtime fields,
- Agent/Skill workflows for opening setup and ongoing world adaptation,
- AIRP play over original canon plus player-created branch overlays.

## 2. Core Product Model

### 2.1 Whole-book import, incremental understanding

The full novel is imported into the current save workspace as source corpus. The system does not try to extract the entire book upfront.

Instead:

1. Normalize and split the source into chapters/chunks.
2. Extract an initial source window, e.g. the first N chapters.
3. Build initial major entities, settings, events, and themes from that window.
4. Let the player choose viewpoint and play mode.
5. Assemble the opening from current canon, player preferences, and spoiler boundaries.
6. During play, expand the source frontier and derived setting cache as needed.

The source corpus remains the factual basis. Derived schema/entity/runtime data is a cache that can evolve.

### 2.2 Living schema

The schema is not a one-time template. It evolves as new concepts, rules, entity types, and frontend needs appear.

The default card should provide a Schema Design Guide that tells Agents how to design a schema for the imported novel:

- identify genre and narrative priorities,
- choose entity categories worth tracking,
- define semantic data for Agent use,
- define simple stable entity/runtime fields that the default frontend may read,
- evolve schema through changelog and simple Markdown patch notes,
- avoid breaking frontend-stable ordinary fields.

### 2.3 Simple frontend-readable fields

The frontend should not understand genre-specific concepts like cultivation realms, spaceship classes, alibis, or magical artifacts.

Novel AIRP v0 does not add a separate `save/render/` layer or render projection cache. The default frontend may directly read a small set of stable ordinary fields from entity/runtime files:

- `name`,
- `brief`,
- `tags`,
- `status`,
- `fields`,
- `sections`,
- selected runtime summaries.

Agents/project schema map novel-specific data into these simple fields only when the frontend needs to display it. Rich semantic detail can stay in flexible entity fields or Markdown notes. Special novels can later customize the frontend.

### 2.4 Spoiler control

Default policy: master should not directly read/search the full book by default, but the first version uses soft workflow constraints rather than hard platform permissions.

- master reads player-safe current scene, current brief, visible entities, and runtime/entity data intended for narration.
- retrieval / world-architect / future director/canon-keeper may inspect broader source material.
- player-facing narration must respect visibility and spoiler boundaries.
- Skills and cached briefs guide master to avoid spoilers while preserving immersion.

## 3. Workspace Information Architecture Draft

Exact paths can change during child task design, but the parent direction is:

```text
save/source/
  manifest.json
  novel.txt or normalized.md
  chapters/chapter-0001.md
  chunks/...

save/schema/
  current.md
  changelog.md
  patches/pending/*.md
  patches/applied/*.md
  deprecated.md

save/entities/
  <type>/<localId>.json

save/playthrough/
  runtime.json
  player.json
  mode.json
  frontier.json
  branch.json

save/director/
  current-brief.md
  current-brief.meta.json
```

Important distinction:

- semantic data may be flexible and Agent-facing;
- frontend-readable ordinary fields such as `name`, `brief`, `tags`, `status`, `fields`, `sections`, and runtime summaries should stay stable enough for the default frontend.

## 4. Agent Model Draft

```text
master              # player-facing narration and interaction
retrieval           # reads/searches source, canon, and entities
post-processing     # per-turn maintenance, memory/state/schema/brief staleness detection
world-architect     # schema design, opening setup, world adaptation, schema patches
```

Possible later splits:

```text
director            # narrative direction / pacing / branch management
canon-keeper        # canon consistency and spoiler-aware source reasoning
```

For the first architecture, `world-architect` can cover schema + opening setup; director/canon-keeper can remain future refinements unless design shows immediate need.

## 5. Runtime Flow Draft

### 5.1 Import and setup

1. Frontend imports/pastes the whole novel.
2. Source pipeline normalizes and splits it into workspace files.
3. Initial extractor processes the first source window.
4. world-architect generates schema draft.
5. Player confirms or tweaks schema/play priorities.
6. Player chooses original character or original persona, and play mode.
7. world-architect assembles opening state and initial current brief.
8. master begins player-facing AIRP.

### 5.2 Per-turn flow

1. master reads current brief and visible/useful entities.
2. master narrates and handles player action.
3. post-processing records state/memory/entity updates.
4. post-processing checks whether source frontier, schema, or current brief is stale.
5. If stale, post-processing calls world-architect/retrieval to refresh schema patches or brief.

### 5.3 Schema evolution

Schema changes should prefer additive patches. Breaking changes should require confirmation or migration planning.

Likely automatic:

- new optional entity type,
- new optional field,
- new tag/category,
- deprecated marker.

Likely confirmation-required:

- deleting/renaming fields,
- changing field meaning,
- changing frontend-important ordinary fields,
- adding a major rules/numeric system,
- converting narrative concept into core mechanic.

## 6. Key Technical Risks / Gaps

- Current semantic-index chunker is oriented around turn/history/memory, not imported source corpus.
- Default packaged frontend still has inline source in platform storage; direction docs prefer `apps/play-frontend-dev` as single truth.
- Whole-book import may hit workspace write/read size, UI responsiveness, and chunking constraints.
- Simple frontend-readable fields need careful shape design so frontend remains useful without becoming a genre engine.
- Soft spoiler control may need later hardening with scoped tools or access conventions.

## 7. Open Design Questions

1. Should opening setup be fully automated after schema confirmation, or should player review opening premises too?
2. What is the minimal set of frontend-readable ordinary fields for the first frontend version?
3. How should source chapters/chunks be identified and referenced in `sourceRefs`?
4. Which child task should be implemented first: source import pipeline, schema guide, Agent definitions, or frontend reader?
