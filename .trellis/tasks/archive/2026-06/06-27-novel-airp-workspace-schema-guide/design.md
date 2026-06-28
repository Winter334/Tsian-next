# 小说 AIRP workspace 契约与 schema 设计规范 — Design

## 1. Scope

This child task defines the first contract layer for the novel-reader AIRP default card. It does not implement the full import UI, frontend renderer, or live Agent workflow.

Outputs should be split into:

1. Project-level direction docs for developers and future tasks.
2. Workspace-level execution docs/templates for in-game Agents.

The contract should stay simple enough for both humans and Agents to understand. Prefer readable Markdown rules, small JSON files, and direct workspace paths over a large formal schema system.

## 2. Document Placement

### Project-level source of truth

Recommended file:

```text
docs/active/novel-airp-workspace-schema-direction.md
```

Purpose:

- record product/architecture direction,
- explain trade-offs,
- define long-term vocabulary,
- guide future child tasks,
- avoid scattering decisions across task notes only.

### Workspace execution guide

Recommended files to add to the default workspace template:

```text
docs/novel-airp-schema-guide.md
save/source/README.md
save/schema/README.md
save/playthrough/README.md
save/director/README.md
```

Purpose:

- in-game Agents can read and follow these instructions,
- world-architect and post-processing know where to write and how to evolve schema,
- frontend knows which ordinary entity/runtime fields are safe to read.

## 3. Template Replacement Policy

The novel AIRP default template replaces the older generic demo workspace convention for new default-card saves.

Novel AIRP v0 does **not** use these older conventions as its main path:

- `save/world/<type>/<entity>/index.json`,
- one-entity-per-directory as the default storage shape,
- generic `_ref` / `_dir` granularity markers,
- a separate `save/render/` projection/cache layer,
- workspace-persisted pure frontend view state such as active tabs and scroll positions.

Old saves or other game cards may keep using the old convention, but the new default novel card should not ship two competing schema guides. New novel AIRP docs should point Agents at `save/entities/`, `save/schema/`, `save/playthrough/`, `save/source/`, and `save/director/`.

## 4. Workspace Contract Draft

```text
save/source/
  README.md
  manifest.json
  normalized.md or novel.txt
  chapters/
  chunks/

save/schema/
  README.md
  current.md
  changelog.md
  deprecated.md
  patches/pending/*.md
  patches/applied/*.md

save/entities/
  <type>/<localId>.json

save/playthrough/
  README.md
  runtime.json
  player.json
  mode.json
  frontier.json
  branch.json

save/director/
  README.md
  current-brief.md
  current-brief.meta.json
```

Exact file creation can be staged across later tasks. This child task should define the contract and seed README/template docs where useful.

## 5. Entity Model v0

### 5.1 Identity and path

Narrative entities use a typed id:

```text
<type>:<localId>
```

Examples:

```text
character:萧玄
location:青玄门山门
item:云纹剑
container:玩家储物袋
technique:青木诀
```

The entity path is derived directly from the id:

```text
save/entities/<type>/<localId>.json
```

Examples:

```text
save/entities/character/萧玄.json
save/entities/location/青玄门山门.json
save/entities/item/云纹剑.json
```

Guidelines:

- The `type` before `:` is the entity category and directory name.
- The `localId` after `:` is unique only inside that type.
- Chinese `localId` is allowed.
- `localId` must not contain `/`, `\`, `:`, NUL, empty path segments, `.` or `..`.
- Prefer stable ids. If a display name changes, keep the id and update `name` / `aliases`.
- If a Chinese name is duplicated or ambiguous, add a short disambiguator, e.g. `李四-客栈伙计`.
- Entity files do not need a separate `type` field by default. Tools derive the type from the id/path.
- Entity files do not need a per-file `schema` field by default. The save-level schema lives under `save/schema/`.

### 5.2 Minimum entity shape

The minimum useful entity is intentionally small:

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。"
}
```

Required fields:

- `id`: canonical typed id.
- `name`: display name.
- `brief`: short human/Agent-readable summary.

### 5.3 Recommended metadata

Use these fields when they help; do not force every entity to contain all of them.

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "aliases": ["萧师弟"],
  "origin": "canon",
  "sourceRefs": ["save/source/chapters/chapter-0001.md"],
  "tags": ["青玄门", "外门弟子"],
  "status": [
    {
      "id": "injury:右臂轻伤",
      "level": "minor",
      "description": "挥剑时略有迟滞。"
    }
  ],
  "fields": [
    { "label": "当前位置", "value": "青玄门山门" },
    { "label": "境界", "value": "炼气后期" }
  ],
  "sections": [
    { "title": "当前目标", "body": "查清山门冲突的起因。" }
  ],
  "updatedAtTurn": 6,
  "updatedBy": "post-processing"
}
```

Recommended fields:

- `aliases`: alternate names, titles, revealed identities, or old names.
- `visibility`: spoiler / player-knowledge boundary.
- `lifecycle`: whether this entity is currently active, background, retired, etc.
- `origin`: where the entity mainly came from.
- `sourceRefs`: source file paths that support the entity.
- `tags`: lightweight grouping/search/display anchors.
- `status`: lightweight current conditions.
- `fields`: simple frontend-readable label/value rows.
- `sections`: simple frontend-readable text sections.
- `updatedAtTurn` / `updatedBy`: maintenance anchors.

`fields` and `sections` are not a separate render layer. They are ordinary entity data with stable enough shape for the default frontend to display.

### 5.4 Small vocabularies

Keep controlled vocabularies short and readable.

Recommended `visibility` values:

```text
player-known      # safe for player-facing narration/frontend; default when omitted
hidden            # not currently visible to player, but usable by background Agents
future-spoiler    # future canon information; do not leak into player-facing narration
director-only     # planning/canon-risk material; master should not use it by default
```

Default policy:

- Omit `visibility` for ordinary player-known data.
- Entity-level `visibility` defaults to `player-known`.
- Nested `status`, `fields`, and `sections` inherit the parent entity/runtime visibility unless they explicitly override it.
- Add `visibility` only for exceptions such as hidden facts, future spoilers, or director-only planning notes.

Recommended `lifecycle` values:

```text
candidate    # extracted but not yet confirmed as important
active       # currently usable in play
background   # exists as context but is not current focus
retired      # out of current play unless deliberately reintroduced
```

Recommended `origin` values:

```text
canon        # from the imported source novel
branch       # created or changed by player branch
player       # player-created persona/preference/input
generated    # Agent-created runtime material
```

If one field does not capture the nuance, use a short note instead of introducing a new hierarchy. Example:

```json
{
  "origin": "canon",
  "branchNotes": "玩家在第 8 回合救下了原本应死亡的角色。"
}
```

### 5.5 Source references

Use simple path strings by default:

```json
"sourceRefs": [
  "save/source/chapters/chapter-0001.md",
  "save/source/chunks/chapter-0001-003.md"
]
```

If precision is needed later, add a small `evidence` array rather than replacing the simple `sourceRefs` convention:

```json
"evidence": [
  {
    "ref": "save/source/chunks/chapter-0001-003.md",
    "note": "首次提到青玄门外门弟子身份。"
  }
]
```

### 5.6 Structured refs

Natural-language text may mention any name or concept. It is semantic search material only. It should not be parsed for references.

Only explicit structured ids are resolvable references:

```json
{
  "owner": { "ref": "character:萧玄", "name": "萧玄" },
  "contents": [
    { "ref": "item:云纹剑", "name": "云纹剑", "quantity": 1 }
  ]
}
```

The inline `name` is a denormalized display snapshot for readability and frontend resilience, not the source of truth.

`_ref` / `_dir` are not part of the novel AIRP v0 model. If an entity becomes too large, prefer explicit related entities, explicit fields, or future toolkit-managed actions instead of generic marker expansion.

### 5.7 Status

Status v0 is lightweight and descriptive. The only required field is `id`:

```json
{ "id": "talent:木灵根" }
```

Optional fields:

```json
{
  "id": "debuff:内息紊乱",
  "level": "medium",
  "until": "调息恢复或离开战斗",
  "description": "短时间内不宜强行催动高阶功法。",
  "source": "technique:青木诀"
}
```

Guidelines:

- The prefix before `:` is the broad kind (`buff`, `debuff`, `injury`, `talent`, `constraint`, `condition`, `mode`, etc.).
- The suffix after `:` is the display/local name by default.
- Avoid precise arithmetic for durations, stacking, damage, capacity, cooldowns, or numeric effects unless the save explicitly opts into tool/frontend-managed mechanics.
- For ordinary updates, post-processing can replace the whole `status` array or add/remove/replace by status id.

### 5.8 Containers and inventory

Backpacks, storage bags, chests, warehouses, rooms, corpses, vehicle cargo holds, equipment slots, shop shelves, and room contents can be modeled as a generic container/contents pattern.

A compact container may look like:

```json
{
  "id": "container:玩家储物袋",
  "name": "我的储物袋",
  "brief": "下品储物法器，空间有限。",
  "contents": [
    { "ref": "item:下品灵石", "name": "下品灵石", "quantity": 12 },
    { "ref": "item:云纹剑", "name": "云纹剑", "quantity": 1 }
  ],
  "capacityNote": "接近满载",
  "status": [
    { "id": "constraint:接近满载", "description": "不宜继续收纳大件物品。" }
  ],
  "updatedAtTurn": 6
}
```

Default capacity policy:

- Descriptive capacity is the default (`capacityNote`, `near-full`, `full`, etc.).
- Strict numeric capacity is opt-in only.
- If strict capacity is enabled, updates should go through toolkit/frontend actions rather than freehand JSON edits.

## 6. Save-level Runtime Variables

Some state is not a narrative entity, but a save-level runtime variable used by frontend code, UI rendering, and Agent situational awareness.

Examples:

- current player location / active scene;
- current map coordinates or region labels;
- primary inventory HUD summary;
- equipment slot configuration and current equipped refs;
- current party members / active companions;
- high-priority player-facing status summaries.

These belong in:

```text
save/playthrough/runtime.json
```

Example:

```json
{
  "turn": 6,
  "activeScene": { "ref": "scene:山门冲突", "name": "山门冲突" },
  "player": {
    "character": { "ref": "character:萧玄", "name": "萧玄" },
    "location": { "ref": "location:青玄门山门", "name": "青玄门山门" }
  },
  "inventory": {
    "primaryContainer": { "ref": "container:玩家储物袋", "name": "我的储物袋" },
    "state": "near-full"
  },
  "status": [
    {
      "id": "constraint:储物袋接近满载",
      "description": "不宜继续收纳大件物品。"
    }
  ],
  "updatedAtTurn": 6,
  "updatedBy": "post-processing"
}
```

Guidelines:

- Runtime variables are intentionally small.
- They summarize frequently accessed, player-facing, or frontend-managed state.
- They are not a replacement for narrative entities.
- Avoid dual authority where possible. If runtime mirrors an entity field, record which side is authoritative or use a toolkit action that updates both consistently.
- Pure frontend view state should not be stored in workspace by default. Active tabs, collapsed panels, scroll positions, transient filters, hover state, and similar UI-only details should live in frontend memory or browser storage.
- Only persist a UI choice into workspace when it has gameplay meaning or must be shared with Agents/frontends.

## 7. Schema Guide and Evolution

### 7.1 Current schema files

The simple v0 schema authority is Markdown-first:

```text
save/schema/current.md       # authoritative human/Agent-readable current schema
save/schema/changelog.md     # applied changes and reasons
save/schema/deprecated.md    # retired fields/concepts and compatibility notes
```

Do not add `current.json` by default unless a later frontend/tool task proves it needs a machine-readable index. If added later, it should be a rebuildable helper index, not a second source of truth.

### 7.2 Schema design workflow

The guide should instruct Agents to:

1. Inspect the initial source window.
2. Identify genre, core conflicts, recurring entity categories, and gameplay-relevant data.
3. Avoid designing a giant universal schema.
4. Start from the minimum entity model and add only fields that current play actually needs.
5. Keep frontend-readable fields simple (`name`, `brief`, `tags`, `status`, `fields`, `sections`, runtime summaries).
6. Treat schema as a living document that changes through simple changelog entries or pending patch notes.
7. Prefer additive changes; use deprecation before deletion.
8. Ask for player confirmation before major gameplay schema shifts.

### 7.3 Simple change policy

Safe additive changes can be applied directly:

- add an optional entity type,
- add an optional field,
- add a tag/status convention,
- clarify a README rule,
- mark a field as deprecated without deleting data.

For these, update `save/schema/current.md` and append to `save/schema/changelog.md`. Do not create a patch file just to add harmless optional guidance.

Use a pending patch only when the change needs a decision or may surprise the player/author:

- deleting or renaming fields,
- changing field meaning,
- introducing strict numeric mechanics,
- converting a background concept into a tracked gameplay system,
- changing frontend-important fields,
- requiring data migration.

### 7.4 Markdown patch format

Pending patches are Markdown files, not JSON Patch operations:

```text
save/schema/patches/pending/0003-add-contribution-points.md
```

Template:

```md
# Schema Patch: Add Contribution Points

Status: pending
Decision: player-required
Proposed by: world-architect
Reason: 新章节出现"宗门贡献点"，看起来会持续影响角色行动和资源兑换。

## Proposed Change

- 为 `character` entity 增加可选字段：`progression.contributionPoints`。
- 含义：角色当前可用的宗门贡献点。
- 默认不存在；不存在表示未知或不追踪。

## Affected Files

- `save/entities/character/*.json`
- `save/schema/current.md`

## Migration

No required migration.

已有角色不需要补字段。只有剧情明确出现贡献点时才写入。

## Confirmation Needed

需要玩家确认，因为这会把"贡献点"从背景设定提升为可追踪玩法状态。

## Rollback

如果不采用，删除本 patch 即可；不要修改现有 entity。
```

When applied, move it to:

```text
save/schema/patches/applied/0003-add-contribution-points.md
```

Then update `save/schema/current.md` and append a short entry to `save/schema/changelog.md`.

## 8. Entity Toolkit Direction

A future `entity-toolkit` / `narrative-entity-manager` Skill can make common operations safer without complicating v0 files.

Potential actions:

- `resolve_entity_context`: read an entity/container and expand explicit `ref` objects in a bounded way.
- `validate_entity_refs`: check missing ids, stale display snapshots, invalid quantities, and simple schema violations.
- `patch_entity`: apply constrained patches to one entity file.
- `patch_container`: add/remove/move/set quantity in a container.
- `rebuild_entity_index`: rebuild optional id/path/name/brief caches if a later task adds them.

Resolver guidance:

- Treat the entity graph as a graph, not a tree.
- Keep a visited id set.
- Expand each entity at most once per bundle.
- Return compact reference stubs for already-seen nodes.
- Do not scan prose for references.
- Default output should be Agent-friendly context, not a raw debug graph.

## 9. Agent Responsibilities

### 9.1 Master read model

Master should use a hybrid read model:

- directly read high-frequency, player-safe context such as current brief, runtime vars, current scene, and recent turn context;
- use high-level toolkit actions such as `resolve_entity_context` for local entity/container context when available;
- avoid raw workspace browsing as the normal path;
- avoid direct full-source or future-canon reads by default;
- delegate deep source/canon retrieval, spoiler-sensitive reasoning, schema design, and opening/world adaptation to retrieval/director/world-architect.

### 9.2 Role split

- `world-architect`: creates initial schema draft, opening setup, and later schema patches.
- `post-processing`: detects stale schema/brief after turns, applies safe schema changes, writes pending patches when confirmation is needed, and calls world-architect when schema design is needed.
- `master`: consumes current brief, runtime vars, and visible entity data; should not invent schema ad hoc.
- `retrieval`: helps read source and entity details.

## 10. Non-goals

- No full novel import UI.
- No source semantic index implementation.
- No complete world-architect prompt implementation.
- No dedicated genre schema.
- No separate `save/render/` layer.
- No JSON Patch / migration engine.
- No hard permission enforcement for spoiler control.

