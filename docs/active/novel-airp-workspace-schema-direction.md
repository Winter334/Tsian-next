# Novel AIRP Workspace Schema Direction

This document records the v0 workspace contract for the default novel-reader AIRP card. It is the project-level direction for implementation tasks; the in-workspace execution guide is `docs/novel-airp-schema-guide.md` in the default template.

## Direction

The default card should support a player importing a whole novel into the current save, then playing AIRP over a gradually understood source corpus. The system should not extract the whole book upfront. Agents expand source understanding, schema, entities, runtime summaries, and director brief as play needs them.

Novel AIRP v0 keeps the data model simple:

- no independent `save/render/` layer;
- no render projection/cache contract;
- no universal card/meter/stat frontend renderer that replaces bespoke UI; fixed schemas may expose dynamic extension slots for new player-visible fields;
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

save/scenes/
  README.md
  <localId>.json

save/relationships/
  README.md
  <scope>.json

save/playthrough/
  README.md
  runtime.json
  player.json
  mode.json
  frontier.json
  understanding-summary.json
  setup-summary.json
  opening-narrative.json
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

`name` is the primary display name for frontend/UI and agent prose. The id localId is a stable path/ref segment; it may equal `name` but does not replace display semantics. Use `aliases` only when nicknames, titles, old names, disguises, or alternate forms of address matter.

Recommended fields when useful:

- `aliases`
- `gender`
- `visibility`
- `lifecycle`
- `origin`
- `sourceRefs`
- `tags`
- `status`
- `fields`
- `sections`
- `extensions`
- `updatedAtTurn`
- `updatedBy`

Do not force every entity to contain every recommended field.

## Visibility

Omit `visibility` for ordinary player-known data. Defaults:

- entity-level `visibility` defaults to `player-known`;
- nested `status`, `fields`, `sections`, and `extensions` inherit the parent entity/runtime visibility;
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
- `extensions`
- runtime summaries in `save/playthrough/runtime.json`

`fields` are simple label/value rows. `sections` are simple title/body blocks. `extensions` are dynamic player-visible fields that declare a finite preset `render` type so they can be inserted into dedicated UI slots. These are ordinary entity/runtime data, not a separate render layer.

Recommended extension shape:

```json
"extensions": {
  "腐化值": { "render": "progress", "value": 37, "max": 100, "tone": "danger" },
  "契约对象": { "render": "ref", "ref": "character:玄衣少女", "name": "玄衣少女" }
}
```

First-pass preset render types: `text`, `number`, `progress`, `tag`, `tags`, `list`, `section`, `ref`, `cards`. Add new render types only after updating the frontend preset and this schema guidance; do not invent arbitrary UI component names in runtime/entity data. `render` is optional: omit it when the field is a plain value and the frontend should display it as text. When a `render` value is present but not in the preset list, frontends fail loud (warn + hide the field) rather than silently degrading; Agents that need non-text rendering must use a preset type or wait for the frontend to add it. New render types and their field shapes are introduced via predesigned scripts/tools that validate at write time, not by Agents inventing UI component names in data.

Fixed baseline schemas such as character, scene, container, item, and runtime can be rendered by bespoke frontend components. `extensions` are only the dynamic slot mechanism for new or temporary fields (for example corruption, alert level, contract target, or special resource), not a universal renderer replacing those components.

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

- `storyteller`: player-turn entry Agent. Consumes current brief, runtime vars, schema, and visible entity data; writes player-facing prose and options; calls researcher when facts are missing; does not invent schema ad hoc.
- `researcher`: read-only source/entity/scene/relationship/schema/brief retrieval. Returns concise findings and source paths; does not write save data or story prose.
- `stage-manager`: after-turn maintenance Agent. Updates runtime, entities, scenes, relationships, memory/status extensions, applies safe schema clarifications, writes pending patches when confirmation is needed, and calls world-architect when schema design is needed.
- `world-architect`: creates the initial schema/world model, opening setup structures, gameplay enablement plans, and later schema design/pending patches.
- `director`: maintains `save/director/current-brief.md` and metadata for pacing, foreshadowing, spoiler boundaries, and canon/branch balance.

## Aggregation Layer (scenes / relationships)

The flat entity store (`save/entities/`) is the entity authority but carries no navigation. Two aggregation layers provide O(1) retrieval of "who is in the current scene" and "all character relationships of a subject":

- `save/scenes/<localId>.json` — one scene per file. Records `{ id, name, location, present, status, updatedTurn }`. `present` is a derived navigation snapshot (ref + name + brief + status summary), not an entity copy. `status`: `active`/`background`/`resolved` (resolved scenes are not deleted — plot is traceable). Supports multi-scene natively (original-character dual-line, canon multi-line).
- `save/relationships/<scope>.json` — one character subject per file. `<scope>` = character subject scope (e.g. `character-萧玄`). Records `{ subject, edges, updatedTurn }` where `subject` and every `edges[].to` must be character/person refs in the current schema (`character:<localId>`). Absorbs long-novel social relationship explosion: a subject's file is small, retrieval is O(1). Bidirectional character relations write an edge on both sides; intentionally one-sided perception/knowledge may write only the subject side. Non-character associations (location, affiliation, item, scene, event, corpse/evidence, concept) do not belong here; keep them in the appropriate fixed field, existing ref-bearing structure, or `extensions.render="ref"` until a unified reference-value schema is designed.
- `save/playthrough/runtime.json` adds `activeSceneRefs: [...]` — pointers to current active scenes (navigation entry, not scene content authority).

## Authority

- entity json is the entity authority.
- scene / relationship json are derived snapshots (present summaries derive from entities; relationship edges reference character ids); lost ones are rebuildable, not a second source of truth.
- `runtime.activeSceneRefs` are pointers, not scene content authority.

When two copies of the same data exist, the authority / derived relationship and refresh timing must be written down to avoid dual authority.

## Runtime Variables

Save-level runtime variables belong in `save/playthrough/runtime.json` when they are frequently accessed, player-facing, frontend-managed, or unsuitable as their own entity file. Runtime is the current status surface that frontends may selectively render. Examples:

- active scene ids (pointers to current scenes);
- player character/location;
- story time, coordinates, and world variables;
- primary inventory summary;
- equipped refs;
- party members;
- high-priority status summaries;
- `extensions` for temporary or newly evolved player-visible runtime fields.

New default runtime files include `extensions: {}`. Older saves without this field are treated as if it were an empty object.

Pure frontend view state such as active tabs, scroll positions, collapsed panels, transient filters, and hover state should not be stored in workspace by default.
