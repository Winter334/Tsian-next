# Implement Plan: 可渲染运行时与实体 schema 约定

## Scope

This task updates documentation and default workspace templates for the renderable runtime/entity schema convention. It does not implement frontend UI.

## Checklist

### 1. Pre-change review

- [ ] Review current `docs/active/novel-airp-workspace-schema-direction.md` sections for entity model, frontend-readable fields, runtime variables, schema evolution, scenes/relationships.
- [ ] Review generated default template strings in `apps/platform-web/src/storage/workspace-templates.ts`:
  - `NOVEL_AIRP_SCHEMA_GUIDE_MD`
  - `NOVEL_AIRP_SCHEMA_REFERENCE_MD`
  - `SCENES_README_MD`
  - `RELATIONSHIPS_README_MD` if cross references are needed
  - default `save/schema/current.md`
  - default `save/playthrough/runtime.json`
  - opening initialization runtime writes, if default runtime shape changes
  - `agents/post-processing/AGENT.md`
  - `WORLD_STATE_MAINTENANCE_SKILL_MD`

### 2. Update project-level direction docs

- [ ] Update `docs/active/novel-airp-workspace-schema-direction.md` to document:
  - runtime as current status surface
  - fixed UI + dynamic extension slots
  - `extensions` recommended object
  - finite render preset list
  - `name` / `aliases` / localId semantics
  - no universal renderer / no independent `save/render/` layer

### 3. Update default generated workspace docs

- [ ] Update `NOVEL_AIRP_SCHEMA_GUIDE_MD` with a short high-frequency guide:
  - fixed schema can be rendered by dedicated UI
  - new player-visible fields go into `extensions`
  - render presets are finite
  - maintenance instructions do not live in runtime/entity data
- [ ] Update `NOVEL_AIRP_SCHEMA_REFERENCE_MD` with detailed examples:
  - runtime example with `extensions`
  - character example with `extensions`
  - container example with `extensions`
  - item example with `extensions`
  - scene example with `extensions`
  - render preset table
- [ ] Update default `save/schema/current.md` content to mention renderable fields and extension slots.
- [ ] Add `extensions: {}` to default `save/playthrough/runtime.json`, and update opening initialization runtime overwrite to include it.

### 4. Update Agent / Skill guidance

- [ ] Update `agents/post-processing/AGENT.md` template text to mention runtime/entity renderable fields at a high level.
- [ ] Update `WORLD_STATE_MAINTENANCE_SKILL_MD` to allow and guide `extensions` writes without overloading the Skill with UI design details.
- [ ] Keep Agent.md concise; put reusable details in schema guide/reference or future Skill docs.

### 5. Consistency pass

- [ ] Search for stale language that says “no generic card/meter/stat frontend engine” and ensure it does not conflict with “fixed UI + dynamic extension slots”. The distinction should remain clear: no universal renderer, yes extension slots.
- [ ] Search for `fields vs sections`, `Runtime 变量`, `Frontend-readable` and ensure all descriptions agree.
- [ ] Ensure no doc implies all runtime fields must be rendered.
- [ ] Ensure no doc tells Agent to write maintenance SOP into runtime/entity files.

### 6. Validation

- [ ] Run `npm run build:web` if `apps/platform-web/src/storage/workspace-templates.ts` changes.
- [ ] Run `npm run build:contracts` only if shared contract source changes (not expected for this task).
- [ ] Record any skipped validation and reason.

## Rollback Points

- Documentation updates can be reverted independently.
- Template string changes in `workspace-templates.ts` should be reviewed as a batch because default generated docs and default save files must stay consistent.

## Review Gate

Before implementation starts, confirm the design with the user, especially:

- `extensions` as the recommended dynamic field container. **Confirmed.**
- render preset list. **Confirmed for first pass.**
- default `runtime.json` includes an empty `extensions` object. **Confirmed.**
- Agent/Skill guidance stays lightweight in this child task; deeper roster/Skill changes move to the later Agent task. **Confirmed.**
