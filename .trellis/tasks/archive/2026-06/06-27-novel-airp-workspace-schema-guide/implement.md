# 小说 AIRP workspace 契约与 schema 设计规范 — Implementation Plan

## Steps

1. Add project-level direction doc.
   - Create `docs/active/novel-airp-workspace-schema-direction.md`.
   - Include product model, workspace contract, living schema rules, entity core metadata, simple frontend-readable fields, patch rules, and Agent responsibilities.
   - Explicitly state that novel AIRP v0 has no separate `save/render/` layer.

2. Replace default workspace template docs for the novel AIRP default card.
   - Add/adjust README files for source, schema, playthrough, and director.
   - Add an Agent-facing `docs/novel-airp-schema-guide.md` to the default workspace template.
   - Replace the old generic demo workspace guidance in the new default template instead of shipping both old `save/world` / `_ref` / `_dir` and new `save/entities` conventions.
   - Keep content concise enough for Agent use.

3. Define entity core metadata in docs.
   - Required: `id`, `name`, `brief`.
   - Recommended: `aliases`, `visibility`, `lifecycle`, `origin`, `sourceRefs`, `tags`, `status`, `fields`, `sections`, `updatedAtTurn`, `updatedBy`.
   - Define typed ids as `<type>:<localId>` and file paths as `save/entities/<type>/<localId>.json`.
   - Use simple `sourceRefs` path strings by default.

4. Define simple frontend-readable ordinary fields.
   - No render projection/cache.
   - No generic card/meter/stat system as a separate layer in v0.
   - Frontend may read stable ordinary entity/runtime fields such as `name`, `brief`, `tags`, `status`, `fields`, `sections`, and runtime summaries.

5. Define schema evolution conventions.
   - `save/schema/current.md` is the human/Agent-readable authority.
   - `save/schema/changelog.md` records applied changes.
   - `save/schema/deprecated.md` records retired fields/concepts.
   - Safe additive changes can update `current.md` + `changelog.md` directly.
   - Decision/risk/migration changes use `save/schema/patches/pending/*.md` and move to `applied/*.md` after approval/application.
   - Do not introduce JSON Patch or a migration engine in this child task.

6. Update parent/child planning docs if design shifts.
   - Remove references to `save/render/`, render projection, and JSON patch envelopes.
   - Clarify that old default template conventions are deprecated for the new novel AIRP template.

## Candidate Files

Likely files to modify later:

```text
docs/active/novel-airp-workspace-schema-direction.md
apps/platform-web/src/storage/workspace-templates.ts
```

Potential docs inside default workspace template:

```text
docs/novel-airp-schema-guide.md
save/source/README.md
save/schema/README.md
save/playthrough/README.md
save/director/README.md
```

Potential new workspace directories/files in the template:

```text
save/source/
save/schema/current.md
save/schema/changelog.md
save/schema/deprecated.md
save/schema/patches/pending/
save/schema/patches/applied/
save/entities/
save/playthrough/runtime.json
save/playthrough/player.json
save/playthrough/mode.json
save/playthrough/frontier.json
save/playthrough/branch.json
save/director/current-brief.md
save/director/current-brief.meta.json
```

## Validation

Run usual checks after implementation:

```bash
pnpm lint
pnpm typecheck
```

If template output has tests or snapshots, run the relevant package tests.

## Rollback

Changes are documentation/template additions and replacements. Rollback by reverting the template/doc changes for the novel AIRP default card. Existing old saves should not be migrated destructively by this child task.
