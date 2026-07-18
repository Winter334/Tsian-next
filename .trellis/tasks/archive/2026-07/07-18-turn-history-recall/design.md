# Turn 历史召回体系 Design

## Scope

本任务先验证当前沉浸阅读器卡片工作区，不同步更新内置模板：

- 卡片工作区：`cards/沉浸阅读器.tsian-card/workspace`
- 前端显示：`apps/play-frontend-dev` 角色档案概况页显示 `history`

平台核心不理解沉浸阅读器 recall schema。平台只提供 workspace/tool/script 执行能力。

## Data Model

### Turn recall metadata

历史正文权威仍为 `save/history/turns/turn-NNNNNN.json`。场记在回合后维护中写入：

```json
{
  "meta": {
    "recall": {
      "schema": "沉浸阅读器.turn-recall.v1",
      "剧情坐标": 42,
      "时间": "翌日清晨",
      "涉及实体": ["character:沈璃", "item:碎玉簪"],
      "事件类型": ["冲突争执", "关系变化", "承诺亏欠"],
      "标签": ["失约", "解释", "拒绝", "碎玉簪", "关系转冷"],
      "摘要": "玩家解释昨夜失约，沈璃没有接受，并把碎玉簪推回桌上。"
    }
  }
}
```

权威/派生关系：

- turn timeline 正文是历史原文权威。
- `meta.recall` 是由场记维护的派生导航层，可覆盖重写，可从正文+存档重新生成。
- `meta.recall` 不改变 turn 正文语义。

### Character history

角色实体可新增：

```json
"history": [
  { "event": "翌日清晨，因玩家昨夜失约而拒绝接受解释，并把碎玉簪退回。" }
]
```

权威/派生关系：

- `history` 是角色长期经历摘要，是角色资料的一部分。
- 它不是 turn 索引；不写 turn、事件类型、标签等内部检索字段。
- `history.event` 可作为正文 Agent 构造 `recall_turns` 查询的语义入口。

## Agent / Skill / Tool Boundaries

### Stage-manager

Stage-manager already owns回合后维护 and reads current turn/runtime/scenes/entities through `read_maintenance_context`.

新增：

- 回合后维护 Skill 增加“历史召回元数据维护”和“人物履历维护”步骤。
- 新增 `commit_turn_recall` stage-manager agent-local tool。

`commit_turn_recall` responsibilities:

- Read target turn file.
- Validate recall payload:
  - `schema === "沉浸阅读器.turn-recall.v1"` or tool fills schema.
  - `剧情坐标` finite number when present.
  - `时间` string when present.
  - `涉及实体` array of `<type>:<localId>` strings; suggested max 8.
  - `事件类型` items must be in approved Chinese enum.
  - `标签` string array; trim/dedupe; suggested max 12.
  - `摘要` non-empty short string.
- Merge into `turn.meta.recall`, preserving all existing turn fields and timeline.
- Return written path and normalized recall.

Character `history` maintenance remains normal entity write/edit by stage-manager. No separate tool required in first version unless implementation discovers write reliability issues.

### Storyteller

Storyteller should not gain broad `workspace_read`. It gets a targeted history recall capability through a Skill/action.

新增：

- `agents/storyteller/skills/历史召回/SKILL.md`
- `agents/storyteller/skills/历史召回/scripts/recall-turns.js`
- enable the Skill in storyteller `agent.json`.

Skill teaches:

- Use only when current writing needs old-event details absent from immediate context.
- Build semi-structured query with `涉及实体` refs, `事件类型`, `标签`, optional `时间线索`.
- Put unknown concepts in `标签`; do not invent entity refs.
- Use returned summaries/excerpts as old-history material; do not expose retrieval process.
- If no hit, continue conservatively without inventing exact old dialogue/action.

`recall_turns` action input:

```json
{
  "涉及实体": ["character:沈璃", "item:碎玉簪"],
  "事件类型": ["关系变化", "承诺亏欠"],
  "标签": ["失约", "拒绝接受解释", "把碎玉簪推回桌上"],
  "时间线索": "翌日清晨"
}
```

No limit/timeMode parameters. The script owns safety limits.

## Retrieval Algorithm

Input dimensions are optional, but at least one must be effective.

1. Glob `save/history/turns/turn-*.json`.
2. Parse each JSON and read `meta.recall`; skip missing/invalid recall.
3. Score each candidate.
4. Return top internal cap (e.g. 5). If too many weak candidates, return `conditionTooBroad` with suggestions.

Scoring principle: exact/rare/difficult matches score high; broad/high-frequency matches score low.

Suggested first-pass scoring:

- Exact involved-entity hit: low base per hit, plus combination bonus for multiple hits.
- Event type hit: moderate but lower than precise text/entity combinations.
- Label exact hit: strong.
- Query phrase exact substring in `摘要`: very strong, scaled by phrase length.
- Time clue exact/partial match against `时间`: moderate.
- Label/summary partial text match: char coverage or token coverage with low cap.
- Optional frequency dampening: high-frequency entity/type/tag contributes less.

Return shape:

```json
{
  "ok": true,
  "results": [
    {
      "turn": 347,
      "path": "save/history/turns/turn-000347.json",
      "score": 31,
      "matched": ["涉及实体:character:沈璃", "标签:失约", "摘要:把碎玉簪推回桌上"],
      "时间": "翌日清晨",
      "摘要": "...",
      "涉及实体": [...],
      "事件类型": [...],
      "标签": [...],
      "excerpt": "..."
    }
  ]
}
```

`excerpt` may be a short assistant正文 slice from the turn after final candidate selection. It must not include large history batches.

## Frontend Display

Current character overview renders identity, traits, appearance, status, relationships, goals, background, extensions. Add history display to overview page.

Files likely involved:

- `apps/play-frontend-dev/src/lib/character-types.ts`: add `CharacterHistoryEvent` and `history?: CharacterHistoryEvent[]` to `CharacterEntity`.
- `apps/play-frontend-dev/src/components/character/OverviewPane.vue`: display `entity.history` when present.

Display contract:

- Show as a compact section in overview, near background/relationships/goals.
- Each item displays `event` text only.
- Missing/invalid entries are ignored.

## Compatibility

- Existing turn files without `meta.recall` remain valid; recall tool simply skips them.
- Existing character entities without `history` remain valid; UI hides the section.
- No platform DB/schema migration.
- No internal template update in this task.

## Validation Notes

- Workspace card file changes are mostly data/Skill/Tool scripts; validate by reading changed files and, if possible, smoke-testing action scripts through runtime later.
- Frontend changes require `npm run build:web` per specs.
- Contract package changes should be avoided unless needed. If `CharacterEntity` is local to `play-frontend-dev`, no `build:contracts` required.
