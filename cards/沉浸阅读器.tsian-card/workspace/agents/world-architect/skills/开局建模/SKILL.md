---
name: 开局建模
title: 开局建模
description: 为刚导入的小说建立开局世界资料（实体、场景、关系、runtime、frontier、understanding-summary）。
triggers:
  - 小说导入后建立开局世界资料
appliesTo:
  - world-architect
---

# 开局建模

目标是建立后续常态流程能读到的正式路径。所有开局产物通过脚本校验写入——脚本返回错误时按错误修正后重试。

## 可用脚本（tsian-actions）

用 `run_script` 执行下列 browser_script action；脚本校验输入并写入对应落点，失败时返回 code/message 供你修正重试。

```json tsian-actions
[
  {
    "name": "inspect_source_opening",
    "description": "观察导入源 manifest 与开头章节预览，选择开局阅读窗口。",
    "inputSchema": { "type": "object", "properties": { "previewCount": { "type": "number" }, "previewCharacters": { "type": "number" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/inspect-source-opening.js", "timeoutMs": 10000, "helpers": ["_common.js"] }
  },
  {
    "name": "read_opening_slice",
    "description": "连续读开头章节正文，返回拼接文本与窗口元信息。可多次调用。",
    "inputSchema": { "type": "object", "properties": { "startIndex": { "type": "number" }, "endIndex": { "type": "number" }, "maxCharacters": { "type": "number" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/read-opening-slice.js", "timeoutMs": 10000, "helpers": ["_common.js"] }
  },
  {
    "name": "commit_entities",
    "description": "校验实体 id/必填字段并写入 save/entities/<type>/<localId>.json。先于 scenes/relationships/runtime 提交。",
    "inputSchema": { "type": "object", "required": ["entities"], "properties": { "entities": { "type": "array" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-entities.js", "timeoutMs": 10000, "helpers": ["_common.js", "_validation.js"] }
  },
  {
    "name": "commit_scenes_and_relationships",
    "description": "校验场景与人物关系 ref；场景写入 save/scenes/<localId>.json，人物关系写入 save/relationships/<scope>.json（subject/to 均必须是 character:<localId>）。共享一次 entity id 加载。",
    "inputSchema": { "type": "object", "required": ["scenes", "relationships"], "properties": { "scenes": { "type": "array" }, "relationships": { "type": "array" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-scenes-and-relationships.js", "timeoutMs": 10000, "helpers": ["_common.js", "_validation.js"] }
  },
  {
    "name": "commit_runtime_and_frontier",
    "description": "校验 runtime.activeSceneRefs 指向已写 scene、protagonistRef/location 指向已写 entity，接受 runtime.worldTime/weather 字符串（缺省为空），校验 frontier.sourceWindow 章节路径存在与 frontier.timeline 锚点格式，一次写入 runtime.json 与 frontier.json。",
    "inputSchema": { "type": "object", "required": ["runtime", "frontier"], "properties": { "runtime": { "type": "object" }, "frontier": { "type": "object" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-runtime-and-frontier.js", "timeoutMs": 10000, "helpers": ["_common.js", "_validation.js"] }
  },
  {
    "name": "commit_understanding_summary",
    "description": "校验 title 与 candidateCharacters 并写入 save/playthrough/understanding-summary.json 为 {status, title, candidateCharacters}。",
    "inputSchema": { "type": "object", "required": ["title", "candidateCharacters"], "properties": { "title": { "type": "string" }, "candidateCharacters": { "type": "array" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-understanding-summary.js", "timeoutMs": 10000, "helpers": ["_common.js", "_validation.js"] }

]
```

## 执行步骤

1. `inspect_source_opening` → 观察导入源结构和章节预览。
2. `read_opening_slice` → 连续阅读开头剧情（可多次调用）。读够的判据：主要角色登场、冲突建立、开局场景可定。
3. `commit_entities` → 写入实体（先写，后续 ref 依赖）。每实体至少 `id` / `name` / `brief`，按需加 `gender` / `tags` / `aliases` / `identity` / `appearance` / `attributes`。character 的 `attributes` 按境界参照 schema guide 的示例刻度尺填写；没有剧情佐证时也要估算，不要全填基线或留空。
4. `commit_scenes_and_relationships` → 写入场景与人物关系（校验 present/location ref 指向已写实体；relationship subject/to 均必须是 `character:<localId>`；双向角色关系两边各写一条；非角色关联不要写入 relationships）。
5. `commit_runtime_and_frontier` → 写入 runtime（校验 activeSceneRefs 指向已写 scene、protagonistRef/location 指向已写 entity；`worldTime` 传 `"元年"`，`weather` 写当前天气字符串，未知则留空）与 frontier（`sourceWindow` 传 `{ startIndex, endIndex, reason, chapters }`：`startIndex`/`endIndex`/`chapters` 复用 `read_opening_slice` 返回的窗口字段，`reason` 写一句话说明为何选此窗口；`timeline` 传第一个锚点 `[{ kind: "source", order: 1, chapter: <开局起始章>, time: "元年", label: "开局" }]`，`chapter` 用 `sourceWindow.startIndex` 的值。脚本会自动按数组顺序赋 `order`（从 1 递增），`kind` 固定为 `"source"`）。
6. `commit_understanding_summary` → 写入理解摘要。`candidateCharacters` 从已写 character 类型 entity 提取 `{id, name, brief, gender?}`；无合适原著角色时给空数组。

开局正文不在本 Skill 落盘；后续「游玩设定」Skill 会调用 storyteller 生成 openingReply，并通过 `commit_play_setup` 写入 turn 0 history 与玩家回合上下文。

无依赖的 commit 脚本可在一轮内同时调用。例如 `commit_understanding_summary` 与 `commit_runtime_and_frontier` 互不依赖，可并行发出工具调用，框架串行执行后一并返回。

## 产物落点（直接 workspace_write，不走脚本）

- `save/schema/current.md` 与 `save/schema/changelog.md`：当前 schema 草案与变更理由。

## 重试策略

脚本返回校验错误时按 code/message 修正后重试，不放弃。常见错误：

- `OPENING_SOURCE_REF_UNKNOWN` — 窗口章节 path 指向不存在章节 → 检查 path 是否来自 `read_opening_slice` 结果。
- `OPENING_WINDOW_REASON_REQUIRED` — `frontier.sourceWindow.reason` 缺失 → 补一句话窗口选择理由。
- `OPENING_ENTITY_ID_INVALID` — id 格式错 → 改成 `<type>:<localId>`。
- `OPENING_ENTITY_TYPE_INVALID` — `container` 实体需 `type="container"`；`item` 实体 `type` 需为 equipment/material/consumable/special/other 之一 → 补/改正 `type` 字段。
- `OPENING_CANDIDATE_TYPE_INVALID` — 理解摘要候选角色 id 必须用 `character:<localId>` → 改成 character 类型。
- `OPENING_REF_UNKNOWN` / `OPENING_RELATIONSHIP_SUBJECT_UNKNOWN` / `OPENING_RELATIONSHIP_TO_UNKNOWN` / `OPENING_RUNTIME_SCENE_UNKNOWN` / `OPENING_RUNTIME_PROTAGONIST_UNKNOWN` / `OPENING_RUNTIME_LOCATION_UNKNOWN` — ref 指向不存在的实体/场景 → 确认目标已在之前 commit 中写入或已存在。
- `OPENING_RELATIONSHIP_SUBJECT_TYPE_INVALID` / `OPENING_RELATIONSHIP_TO_TYPE_INVALID` — relationships 只记录角色/人物关系，subject/to 必须是 `character:<localId>`；地点、组织、物品、事件、尸体/线索等非角色关联放到对应字段、已有 ref 结构或 `extensions.render="ref"`，不要写入 relationships。
- `OPENING_SCENE_PRESENT_REQUIRED` — 场景 present 不能为空。
- `OPENING_TIMELINE_ANCHOR_INVALID` / `OPENING_TIMELINE_TIME_REQUIRED` / `OPENING_TIMELINE_LABEL_REQUIRED` — frontier.timeline 锚点格式错 → 每项需为 `{ chapter: number, time: string, label: string }`（脚本自动补 `kind: "source"` 和 `order`），`chapter` 用 `sourceWindow.start`。
- 缺必填 → 补齐。

## spoiler-safe

只使用开头窗口中读到的内容。不推断、不剧透未来剧情。实体都只反映开局已知事实。
