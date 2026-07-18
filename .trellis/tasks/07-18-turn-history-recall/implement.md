# Turn 历史召回体系 Implementation Plan

## Pre-checks

- Load current card workspace files before editing.
- Follow `.trellis/spec/guides/airp-data-capability-design-principles.md`:
  - Gameplay schema belongs in card workspace, not platform.
  - Duplicate data must define authority/derived relationship.
  - Every new field must have a real consumer.

## Implementation Checklist

### 1. Card schema/docs updates

- Update `cards/沉浸阅读器.tsian-card/workspace/docs/novel-airp-schema-guide.md` and/or `save/schema/current.md` equivalent docs if present in the card workspace to describe:
  - `turn.meta.recall` fields.
  - `history: Array<{ event: string }>` on character entity.
  - event type enum and writing discipline.
- Keep docs concise; high-frequency agent context should not become bulky.

### 2. Stage-manager maintenance updates

- Update `agents/stage-manager/skills/回合后维护/SKILL.md`:
  - Add turn recall metadata maintenance step.
  - Add character history maintenance rule.
  - Include field discipline for `涉及实体`, `事件类型`, `标签`, `摘要`.
- Add `agents/stage-manager/tools/commit_turn_recall/tool.json`.
- Add `agents/stage-manager/tools/commit_turn_recall/run.js`.
- Enable the new tool in `agents/stage-manager/agent.json`.

### 3. Storyteller recall skill/action

- Create `agents/storyteller/skills/历史召回/SKILL.md`.
- Create `agents/storyteller/skills/历史召回/scripts/recall-turns.js`.
- Enable the skill in `agents/storyteller/agent.json`.
- The action should:
  - Read turn recall metadata.
  - Score multi-field matches.
  - Return top candidates with matched reasons.
  - Avoid exposing huge history payloads.

### 4. Frontend character history display

- Update `apps/play-frontend-dev/src/lib/character-types.ts`:
  - Add `CharacterHistoryEvent`.
  - Add `history?: CharacterHistoryEvent[]` to `CharacterEntity`.
- Update `apps/play-frontend-dev/src/components/character/OverviewPane.vue`:
  - Compute valid history entries.
  - Render a compact “人物履历” section when present.

### 5. Validation

- Run `npm run build:web`.
- Inspect changed workspace JSON/Markdown for valid syntax.
- Optional manual smoke check:
  - Confirm `commit_turn_recall` writes only `meta.recall`.
  - Confirm `recall_turns` skips turns without recall and returns expected candidates for fixture-like payloads.

## Risk / Rollback Points

- Card workspace changes can be reverted file-by-file.
- Frontend UI change is isolated to character overview/types.
- Do not touch platform template files in this task.
- Do not add platform DB tables or contract fields unless a later explicit decision expands scope.
