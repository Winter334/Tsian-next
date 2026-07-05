# Implement Plan: 可渲染运行时与实体 schema 约定

## Scope

This task updates documentation and default workspace templates for the renderable runtime/entity schema convention. It does not implement frontend UI.

## Status

> 2026-07-05 核实：本任务主体已由 `07-04-airp-agent-roster-skills` 的子任务（默认 Agent/Skill 模板重写）顺带完成。schema direction doc、schema guide/reference、默认 runtime.json（含 `extensions: {}`）、stage-manager AGENT.md + 状态栏维护 Skill 全部到位，构建通过，一致性扫描无残留。OQ-2 的"省略 render = 朴素文本 / 未知 render fail loud"约定已补入 direction doc 和 schema guide。design.md §9 三个 OQ 已记录处理结果。

## Checklist

### 1. Pre-change review

- [x] Review current `docs/active/novel-airp-workspace-schema-direction.md` sections for entity model, frontend-readable fields, runtime variables, schema evolution, scenes/relationships.
- [x] Review generated default template strings in `apps/platform-web/src/storage/workspace-templates.ts`:
  - `NOVEL_AIRP_SCHEMA_GUIDE_MD`
  - `NOVEL_AIRP_SCHEMA_REFERENCE_MD`
  - `SCENES_README_MD`
  - `RELATIONSHIPS_README_MD` if cross references are needed
  - default `save/schema/current.md`
  - default `save/playthrough/runtime.json`
  - opening initialization runtime writes, if default runtime shape changes
  - `agents/post-processing/AGENT.md` → 已迁移为 `agents/stage-manager/AGENT.md`
  - `WORLD_STATE_MAINTENANCE_SKILL_MD` → 已迁移为 `STAGE_MANAGER_STATUS_SKILL_MD`

### 2. Update project-level direction docs

- [x] Update `docs/active/novel-airp-workspace-schema-direction.md` to document:
  - runtime as current status surface
  - fixed UI + dynamic extension slots
  - `extensions` recommended object
  - finite render preset list
  - `name` / `aliases` / localId semantics
  - no universal renderer / no independent `save/render/` layer
  - render optional / unknown render fail loud（OQ-2 补充）

### 3. Update default generated workspace docs

- [x] Update `NOVEL_AIRP_SCHEMA_GUIDE_MD` with a short high-frequency guide:
  - fixed schema can be rendered by dedicated UI
  - new player-visible fields go into `extensions`
  - render presets are finite
  - maintenance instructions do not live in runtime/entity data
  - render optional / unknown render fail loud（OQ-2 补充）
- [x] Update `NOVEL_AIRP_SCHEMA_REFERENCE_MD` with detailed examples:
  - runtime example with `extensions`
  - character example with `extensions`
  - container example with `extensions`
  - item example with `extensions`
  - scene example with `extensions`
  - render preset table
- [x] Update default `save/schema/current.md` content to mention renderable fields and extension slots.
- [x] Add `extensions: {}` to default `save/playthrough/runtime.json`, and update opening initialization runtime overwrite to include it.

### 4. Update Agent / Skill guidance

- [x] Update `agents/post-processing/AGENT.md` template text to mention runtime/entity renderable fields at a high level. → 已由 `agents/stage-manager/AGENT.md` 完成
- [x] Update `WORLD_STATE_MAINTENANCE_SKILL_MD` to allow and guide `extensions` writes without overloading the Skill with UI design details. → 已由 `STAGE_MANAGER_STATUS_SKILL_MD` 完成
- [x] Keep Agent.md concise; put reusable details in schema guide/reference or future Skill docs.

### 5. Consistency pass

- [x] Search for stale language that says "no generic card/meter/stat frontend engine" and ensure it does not conflict with "fixed UI + dynamic extension slots". The distinction should remain clear: no universal renderer, yes extension slots.
- [x] Search for `fields vs sections`, `Runtime 变量`, `Frontend-readable` and ensure all descriptions agree.
- [x] Ensure no doc implies all runtime fields must be rendered.
- [x] Ensure no doc tells Agent to write maintenance SOP into runtime/entity files.

### 6. Validation

- [x] Run `npm run build:web` if `apps/platform-web/src/storage/workspace-templates.ts` changes. → 2026-07-05 通过
- [x] Run `npm run build:contracts` only if shared contract source changes (not expected for this task). → 本任务未触及 contracts 源码
- [x] Record any skipped validation and reason.

## Rollback Points

- Documentation updates can be reverted independently.
- Template string changes in `workspace-templates.ts` should be reviewed as a batch because default generated docs and default save files must stay consistent.

## Review Gate

Before implementation starts, confirm the design with the user, especially:

- `extensions` as the recommended dynamic field container. **Confirmed.**
- render preset list. **Confirmed for first pass.**
- default `runtime.json` includes an empty `extensions` object. **Confirmed.**
- Agent/Skill guidance stays lightweight in this child task; deeper roster/Skill changes move to the later Agent task. **Confirmed.**
