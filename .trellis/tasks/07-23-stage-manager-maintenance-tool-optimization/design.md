# 场记维护工具效率优化 Design

## Overview

本任务将 stage-manager 的回合后维护能力从 entity 专用 `update_entity` 升级为一组面向 AIRP save 文档形态的通用工具：

- `json_edit`：结构化 JSON 局部编辑。
- `text_edit`：Markdown/文本行级编辑。
- 增强 `read_maintenance_context`：stage-manager 私有导航聚合读取。
- 保留 `commit_turn_recall`：turn recall contract tool。

设计遵循两条边界：

1. 工具按数据形态设计，不按 runtime/entity/scene/relationship 等领域机械拆分。
2. 工具只做稳定底层不变量校验，schema 语义和流程取舍由 Skill/参考文档承载。

## Current State

### Current stage-manager tools

- `read_maintenance_context` 聚合信息不足，只返回摘要，导致补读。
- `commit_turn_recall` 职责合理，保留。
- `update_entity` 绑定 entity，参数格式容易漂移，且不适合 scene/relationship/runtime 等 JSON 文档。
- stage-manager 常驻 contextPaths 过重，动态状态和长 schema 文档每轮注入。

### Current world-architect scripts

world-architect 已有专门 commit 脚本用于开局建模与 frontier 推进。它们提供跨文件业务校验，不应被通用编辑工具替代。

## Tool Contracts

### `json_edit`

#### Location

Shared tool: `cards/沉浸阅读器.tsian-card/workspace/tools/json_edit/`.

Enabled for:

- stage-manager
- world-architect

Not enabled for:

- storyteller

#### Input shape

Single op:

```json
{
  "target": "character:萧澈",
  "create": { "id": "character:萧澈", "name": "萧澈", "brief": "..." },
  "set": { "goals.current": "..." },
  "append": { "history": [{ "event": "..." }] },
  "upsert": {
    "status": [
      {
        "match": { "id": "status:养心丹药效" },
        "set": { "description": "药效约剩一个时辰" },
        "unset": ["expires"]
      }
    ]
  },
  "remove": { "status": [{ "id": "status:旧状态" }] },
  "unset": ["extensions.旧字段"]
}
```

Multiple ops:

```json
{
  "ops": [
    { "target": "save/playthrough/runtime.json", "set": { "turn": 3 } },
    { "target": "character:萧澈", "append": { "history": [{ "event": "..." }] } }
  ]
}
```

`ops` and single-op fields are mutually exclusive at the root.

#### Target resolution

- `target` starting with `save/` is a path.
- `target` matching `<type>:<localId>` is a ref.
- Ref mapping:
  - entity refs: `<type>:<localId>` -> `save/entities/<type>/<localId>.json`, except `scene`.
  - scene refs: `scene:<localId>` -> `save/scenes/<localId>.json`.
- relationship files use path targets, e.g. `save/relationships/character-萧澈.json`; no relationship ref syntax is introduced.

#### Operation semantics

- Dot paths split by `.`. Empty segments and dangerous keys (`__proto__`, `prototype`, `constructor`) are invalid.
- `create` is explicit. Missing target without `create` fails. Existing target with `create` fails.
- `set` creates missing intermediate objects; if an intermediate value exists and is not an object, fail.
- `set` value can be any JSON value, including object, array, and `null`.
- `unset` deletes fields by dot path.
- `append` target must be an array if present; absent target becomes an empty array. Items already present by deep equality are skipped, not errors.
- `upsert` target must be an array if present; absent target becomes an empty array. Each entry has `{ match, set?, unset? }`. `match` must be non-empty. 0 matches add `{...match, ...set}` and ignore unset. 1 match shallow-merges set and removes listed top-level fields. Multiple matches fail.
- `remove` target must be an existing array. 0 matches and multiple matches fail; exactly one match is deleted.
- JSON values must be JSON-serializable and finite for numbers.

#### Validation

Before write, validate:

- Path is under `save/` and contains no traversal/NUL.
- JSON parses.
- Operation syntax is valid.
- For `save/entities/<type>/<localId>.json`: if root `id` exists after applying op, it must be `<type>:<localId>`.
- For `save/scenes/<localId>.json`: if root `id` exists after applying op, it must be `scene:<localId>`.
- For `save/relationships/character-<localId>.json`: if root `subject` exists after applying op, it must be `character:<localId>`; every `edges[].to` must be `character:<localId>`.

Do not validate full character/item/container/runtime/frontier schemas. Do not block turn timeline writes.

#### Execution and errors

- Each file op reads current content, computes next JSON, and writes with expectedContent.
- Multi-op executes sequentially. On failure, stop and return `partial_failed` with successful results and short error containing `opIndex`.
- Do not roll back successful ops.
- Expected errors return compact `{ code, message, opIndex?, target?, path?, details? }`; do not include stack traces in normal tool output.

#### Output

```json
{
  "status": "ok",
  "results": [
    {
      "opIndex": 0,
      "target": "character:萧澈",
      "path": "save/entities/character/萧澈.json",
      "changed": true,
      "changedPaths": ["history", "status"]
    }
  ]
}
```

Optional short warnings may report duplicate append counts.

### `text_edit`

#### Location

Shared tool: `cards/沉浸阅读器.tsian-card/workspace/tools/text_edit/`.

Enabled for stage-manager and world-architect, not storyteller.

#### Input shape

```json
{
  "target": "save/memory/seeds.md",
  "create": "",
  "append": ["- [8] recall 关键词: ...; 摘要: ..."],
  "replace": [{ "find": "天毒珠掌心印记", "line": "- [天毒珠掌心印记] 状态: developing; 关联回合: 2" }],
  "remove": ["旧伏笔描述"]
}
```

Multiple ops use `{ "ops": [...] }` with the same op shape.

#### Semantics

- Target must be under `save/` and a text/Markdown path.
- Missing target without `create` fails. Existing target with `create` fails.
- `create` initializes file content before applying append/replace/remove.
- `append` appends lines at EOF and ensures line breaks.
- `replace` matches lines containing `find`; each find must match exactly one line and replaces the whole line.
- `remove` matches lines containing `find`; each find must match exactly one line and deletes it.
- No regex, no Markdown AST, no records auto-numbering.
- `ops` executes sequentially, stops on first error, no rollback.

#### Output

Return per-op `opIndex`, `target`, `path`, `changed`, and `changedLines`.

### `read_maintenance_context`

#### Location

Existing stage-manager private tool remains in place:

`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/`.

#### Design changes

Keep the current name and first-step role. Change output from schema-field summary to navigation bundle:

- `turnBody`
- runtime JSON full content
- active scene JSON full content
- present entity JSON full content
- protagonist entity if not already included
- character relationship JSON full content for relevant characters
- records tail lines
- seeds lines / current content at current scale
- optional timeline anchors
- scene cleanup candidates

It may still internally use runtime.activeSceneRefs and scene.present to navigate. It should not hardcode projections such as `status`, `goals`, `historyTail`, or relationship edge field subsets.

No complex compact strategy in v1. If a future save file becomes too large, add a simple size guard in a separate change.

### `commit_turn_recall`

Keep existing stage-manager private tool and contract. Update expected validation failures to short error style if needed.

## Agent and Skill Changes

### stage-manager `agent.json`

- Remove contextPaths for dynamic/long files:
  - `docs/novel-airp-schema-guide.md`
  - `save/schema/current.md`
  - `save/playthrough/runtime.json`
  - `save/playthrough/frontier.json`
  - `save/scenes/README.md`
  - `save/relationships/README.md`
  - `save/memory/seeds.md`
- Enable tools:
  - stage-manager private `read_maintenance_context`
  - stage-manager private `commit_turn_recall`
  - shared `json_edit`
  - shared `text_edit`
- Remove `update_entity` from enabled tools.
- Keep platform `workspace_read`, `workspace_write`, `agent_call` as test-stage fallback.

### stage-manager `回合后维护` Skill

Update AI-facing flow:

1. Call `read_maintenance_context({ turn, includeTimeline: true })` first.
2. Use `json_edit` for JSON documents.
3. Use `text_edit` for records/seeds/Markdown line edits.
4. Use `commit_turn_recall` for turn recall.
5. Use workspace tools only when context is missing, target is unsupported, or diagnosis needs it.
6. Final response summarizes by domain: runtime, entities, relationships, scene, memory records/seeds, timeline, turn recall.

Add short examples for:

- runtime set
- entity append/upsert
- relationship upsert by path
- records append
- seeds replace
- minimal entity create

Keep prompt self-contained and avoid developer-side rationale.

### stage-manager `schema演进检查` Skill

Update to state that `save/schema/current.md`, changelog, guide/reference are read on demand when schema evolution is triggered. Do not assume they are in standing context.

### world-architect

Enable shared `json_edit`/`text_edit`.

Update opening/frontier Skills with positive guidance:

- Use existing commit scripts for main opening/frontier submissions because they provide cross-file validation.
- Use `json_edit`/`text_edit` for local fixes and schema/document maintenance.

Do not frame this as a prohibition; keep it AI-facing.

## Compatibility and Rollback

- Current task is test-stage; no compatibility wrapper for `update_entity` is required.
- Remove or stop exposing `update_entity` so Agents do not choose it.
- If `json_edit` has defects, fix `json_edit` rather than falling back to old tool.
- Platform workspace tools remain available as manual fallback during testing.

## Future Work

- Optional frontend display of maintenance changes by parsing final summary or reading a dedicated maintenance change file.
- Optional `check_save`/`validate_save` only if real data consistency problems emerge.
- Optional simple size guard for `read_maintenance_context` if individual save files grow beyond context-friendly size.
