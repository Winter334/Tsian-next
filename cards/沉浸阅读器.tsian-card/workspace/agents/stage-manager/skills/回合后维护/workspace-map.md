# 回合后维护工作区文件地图

本文档列出回合后维护涉及的关键目录、文件路径格式与字段用途，供维护流程第 1 步参考。

## ref → 文件路径

拿到 ref 后按下表直接推出文件路径，不必先 list 或试读：

| ref 形式 | 文件路径 |
|---|---|
| `character:<localId>` | `save/entities/character/<localId>.json` |
| `item:<localId>` | `save/entities/item/<localId>.json` |
| `container:<localId>` | `save/entities/container/<localId>.json` |
| `location:<localId>` | `save/entities/location/<localId>.json` |
| `scene:<localId>` | `save/scenes/<localId>.json` |
| `character:<localId>` 的关系分片 | `save/relationships/character-<localId>.json` |

例：`runtime.activeSceneRefs[0].ref` 为 `scene:重生清晨恶奴上门`，对应 `save/scenes/重生清晨恶奴上门.json`。

## save/history/turns/

- `turn-NNNNNN.json`：每回合一条 JSON。`NNNNNN` 是回合号补零至 **6 位**——开局回合为 `turn-000000.json`，玩家第 1 个回合为 `turn-000001.json`，第 12 个回合为 `turn-000012.json`。`timeline` 数组记录本回合从玩家输入到 assistant 回复的完整事件流，含 `kind` 为 `user`/`thought`/`tool`/`assistant` 的条目。维护时只提取已发生事实。

## save/playthrough/

- `runtime.json`（**已注入上下文，直接取用**）：回合运行时摘要。字段：`worldTime`（世界/剧情时间字符串）、`weather`、`location`（`{ ref, name } | null`）、`activeSceneRefs`（当前活跃场景指针数组，每项 `{ ref, name }`）、`protagonistRef`（`{ ref, name } | null`）、`plotOrder`（单调递增整数，表示玩家当前 source order）、`extensions`（新增/临时玩家可见运行时字段）、`turn`、`updatedAtTurn`、`updatedBy`。
- `frontier.json`：源文本阅读进度与时间标记锚点。含 `sourceWindow`、`extractedThrough`、`timeline`（时间标记锚点数组，`kind` 为 `source`/`player`）、`notes`。场记读 frontier timeline 维护 `plotOrder`，不写 source 锚点。
- `player.json`：玩家 persona/视角设置。
- `branch.json`：玩家创建的分支摘要。

## save/entities/

- 路径格式：`save/entities/<type>/<localId>.json`，`<type>` ∈ `character` / `item` / `container` / `location`。
- `localId` 可含中文，但不含路径分隔符、冒号、NUL、空段、`.`、`..`。
- character：`id`、`name`、`brief`、`gender`、`attributes`（六维安全整数）、`containers`（容器指针数组）、`equipment`（按 slot 分组，每槽非空数组，空槽为 `{ "ref": null }`）。
- item：`id`、`name`、`brief`、`type`（`equipment`/`material`/`consumable`/`special`/`other`）、`tags`、`equipment`（`slotType`/`add`/`percent`/`effects`）。
- container：`id`、`name`、`brief`、`type: "container"`、`contents`（`{ ref, count? }` 数组）。
- 实体是事实权威。

## save/scenes/

- 路径格式：`save/scenes/<localId>.json`。
- 字段：`id`（`scene:<localId>`）、`name`、`location`（`{ ref, name }`）、`present`（在场实体指针数组，每项 `{ ref }`）、`status`（`active`/`background`/`resolved`）、`updatedTurn`/`updatedBy`、`extensions`。
- 场景是派生导航视图，不是实体副本。`present` 只存 ref，展示信息回读实体权威。
- resolved 场景不删除，保留可回溯。

## save/relationships/

- 路径格式：`save/relationships/character-<localId>.json`，每角色 subject 一文件。
- 字段：`subject`（`character:<localId>`）、`edges`（`{ to, type, since?, until?, note? }` 数组，`to` 也是 `character:<localId>`）、`updatedTurn`/`updatedBy`。
- 只承载角色间关系，不是泛实体图谱。地点、组织、物品、场景等非角色关联不写入 relationships。
- 双向关系两边各写一条；单向认知/隐瞒可只写主体侧。

## save/memory/

- `records.md`（**已注入上下文，直接取用**）：召回记忆记录。每条一行：`- [序号] <recall|scene|npc_action> 关键词: 简短关键词; 摘要: 一句客观事实`。序号从末条依次递增。
- `seeds.md`（**已注入上下文，直接取用**）：伏笔追踪。每条一行：`- [伏笔描述] 状态: <planted|developing|resolved|abandoned>; 关联回合: N`。
- 上面两行格式中的尖括号只标示可选值，写入时不带尖括号。正确示例：
  - `- [1] scene 关键词: 恶奴踹门; 摘要: 王有信带侍卫踹门闯入萧凌卧房。`
  - `- [王有信带话回萧瑞] 状态: planted; 关联回合: 1`

## save/schema/

- `current.md`（**已注入上下文，直接取用**）：当前存档的 schema 选择与偏差（相对于完整 schema guide）。
- `changelog.md`：schema 变更记录。
- `deprecated.md`：已废弃字段或概念记录。
- `patches/pending/*.md`：待确认的 schema 变更。
- `patches/applied/*.md`：已应用的 schema 补丁。

## docs/

- `novel-airp-schema-guide.md`：完整 schema 指南，按需查阅。
- `novel-airp-schema-reference.md`：schema 字段参考，按需查阅罕见或不确定的结构。

## 工具能力边界

- `query_entities`：只在 `save/entities/` 下按 type 子目录扫描，`types` 映射到 `<type>` 子目录（`character`/`item`/`container`/`location`）。不能查询场景或关系文件。
- `read_entities`：按明确 ref 读取实体完整 JSON 或指定字段；`relations` 参数可展开角色关系边。不能直接读取场景文件。
- 场景文件用原生读取 `save/scenes/<localId>.json`；关系文件用原生读取 `save/relationships/character-<localId>.json` 或通过 `read_entities` 的 `relations` 展开角色关系边。

## commit_turn_recall 字段

只覆盖目标 turn 的 `meta.recall`，不改 turn 正文。

| 字段 | 类型 | 约束 |
|---|---|---|
| `摘要` | 字符串 | **必填**，非空，≤240 字符 |
| `涉及实体` | **字符串数组** | 每项为 `<type>:<localId>`，最多 8 项 |
| `事件类型` | **字符串数组** | 只能取下列枚举值，逐字匹配 |
| `标签` | **字符串数组** | 最多 12 项，每项 ≤30 字符 |
| `剧情坐标` | 数字 | 可选 |
| `时间` | 字符串 | 可选，≤80 字符 |
| `schema` | 字符串 | 可省略，默认 `沉浸阅读器.turn-recall.v1` |

`事件类型` 枚举共 15 项：`对话交流`、`玩家选择`、`冲突争执`、`关系变化`、`承诺亏欠`、`秘密揭露`、`发现线索`、`物品变化`、`状态变化`、`场景变化`、`战斗危险`、`计划目标`、`交易谈判`、`亲密暧昧`、`伏笔回收`。

工具参数 `turn` 可省略，省略时写入编号最大的回合文件。
