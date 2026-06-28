# Novel AIRP Workspace Schema Direction

This document records the v0 workspace contract for the default novel-reader AIRP card. It is the project-level direction for implementation tasks; the in-workspace execution guide is `docs/novel-airp-schema-guide.md` in the default template.

## Direction

The default card should support a player importing a whole novel into the current save, then playing AIRP over a gradually understood source corpus. The system should not extract the whole book upfront. Agents expand source understanding, schema, entities, runtime summaries, and director brief as play needs them.

Novel AIRP v0 keeps the data model simple:

- no independent `save/render/` layer;
- no render projection/cache contract;
- no generic card/meter/stat frontend engine for v0;
- no `save/world/<type>/<entity>/index.json` as the main entity path;
- no generic `_ref` / `_dir` marker convention;
- no workspace-persisted pure frontend view state by default;
- no JSON Patch or migration engine.

The new default novel template replaces the older generic demo workspace convention for new default-card saves. Old saves and other cards may keep older conventions, but the new default card should not ship two competing guides.

## Workspace Contract

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

## Entity Model

Entity ids use `<type>:<localId>` and map directly to `save/entities/<type>/<localId>.json`.

Chinese `localId` is allowed. It must not contain `/`, `\`, `:`, NUL, empty path segments, `.`, or `..`.

Minimum entity:

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。"
}
```

Required fields:

- `id`
- `name`
- `brief`

Recommended fields when useful:

- `aliases`
- `visibility`
- `lifecycle`
- `origin`
- `sourceRefs`
- `tags`
- `status`
- `fields`
- `sections`
- `updatedAtTurn`
- `updatedBy`

Do not force every entity to contain every recommended field.

## Visibility

Omit `visibility` for ordinary player-known data. Defaults:

- entity-level `visibility` defaults to `player-known`;
- nested `status`, `fields`, and `sections` inherit the parent entity/runtime visibility;
- `runtime.json` is player-facing by default.

Use explicit values only for exceptions:

```text
player-known
hidden
future-spoiler
director-only
```

## Source References

Use simple path strings by default:

```json
"sourceRefs": [
  "save/source/chapters/chapter-0001.md",
  "save/source/chunks/chapter-0001-003.md"
]
```

If precision is needed later, add a small `evidence` array instead of replacing `sourceRefs`.

## Frontend-readable Ordinary Fields

The default frontend may read stable ordinary fields directly from entity/runtime files:

- `name`
- `brief`
- `tags`
- `status`
- `fields`
- `sections`
- runtime summaries in `save/playthrough/runtime.json`

`fields` are simple label/value rows. `sections` are simple title/body blocks. They are ordinary entity data, not a separate render layer.

## Schema Evolution

`save/schema/current.md` is the authoritative current schema. Do not create `current.json` by default. If a later tool/frontend task needs a machine-readable index, it should be rebuildable helper data, not a second authority.

Safe additive changes can directly update `current.md` and append `changelog.md`:

- new optional entity type;
- new optional field;
- new tag/status convention;
- README clarification;
- deprecation note without deleting data.

Use Markdown pending patches only when the change needs a decision or may surprise the player/author:

- deleting or renaming fields;
- changing field meaning;
- introducing strict numeric mechanics;
- converting a background concept into tracked gameplay;
- changing frontend-important ordinary fields;
- requiring data migration.

Pending patch files live under `save/schema/patches/pending/*.md`. When accepted, move them to `save/schema/patches/applied/*.md`, update `current.md`, and append `changelog.md`.

## Agent Responsibilities

- `world-architect`: creates the initial schema draft, opening setup, and later schema patches.
- `post-processing`: detects stale schema/brief after turns, applies safe schema changes, writes pending patches when confirmation is needed, and calls world-architect when schema design is needed.
- `master`: consumes current brief, runtime vars, and visible entity data; it should not invent schema ad hoc.
- `retrieval`: helps read source and entity details and returns concise findings.

## Runtime Variables

Save-level runtime variables belong in `save/playthrough/runtime.json` when they are frequently accessed, player-facing, or frontend-managed. Examples:

- active scene;
- player character/location;
- primary inventory summary;
- equipped refs;
- party members;
- high-priority status summaries.

Pure frontend view state such as active tabs, scroll positions, collapsed panels, transient filters, and hover state should not be stored in workspace by default.
