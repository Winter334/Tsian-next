# 开局建模工作区地图

本文档给出开局建模涉及的路径格式、提交语义与完整性规则。**每次 invocation 的第一步就读它**，不要靠 glob / list / 语义搜索去猜路径。

字段形状与取值口径见 `docs/novel-airp-schema-guide.md`（罕见结构再查 `docs/novel-airp-schema-reference.md`），属性数值见 `docs/属性刻度规范.md`。本文档不复制这些内容。

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

注意：**场景不在 `save/entities/` 下**，关系分片文件名带 `character-` 前缀。

`localId` 可含中文，但不含路径分隔符、冒号、NUL、空段、`.`、`..`。文件路径与文件内 `id` 必须互相吻合，否则提交时报 `OPENING_*_FILE_INVALID`。

## 其他常用路径

| 用途 | 路径 |
|---|---|
| 工作笔记 | `save/playthrough/opening-notes.md` |
| 本存档世界观口径 | `save/schema/current.md`（**已注入上下文**） |
| 导入源清单 | `save/source/manifest.json`（**已注入上下文**） |
| 源进度与时间锚点 | `save/playthrough/frontier.json`（**已注入上下文**） |
| 回合运行时 | `save/playthrough/runtime.json` |
| 开局摘要与完成信号 | `save/playthrough/setup-summary.json` |
| 首回合正文 | `save/history/turns/turn-000000.json` |

标注「已注入上下文」的三个文件直接取用，不要重复读取。

## 权威归属

- **实体 json 是事实权威。** 正文、场景、关系、runtime 与实体冲突时，以实体为准。
- **场景与关系是派生快照。** `scene.present` 只存 `{ ref }`，展示信息回读实体；不要在场景里复制实体字段。
- **runtime 的 `protagonistRef` / `location` / `activeSceneRefs` 都是指针**，不是内容权威；它们指向的目标必须已落盘，否则报 `OPENING_REF_UNKNOWN`。
- **关系分片只承载人物关系。** `subject` 与 `edges[].to` 都必须是 `character:<localId>`；地点、组织、物品、场景、事件、概念一律不写进 relationships。

## 切入点时刻快照

开局落盘的全部资料（实体、场景、关系、runtime）描述的是**玩家切入点那一刻**的世界状态，而不是已读章节结束时的状态。

- 已读范围内、但发生在切入点**之后**的事件，不写成当前事实。
- 典型出错方式：把后文才发生的换装、伤势、身份变动、他人的到场或知情写进 `appearance` / `brief` / `status` / `present`。
- 判据：写下每一条事实前问一句「玩家按下第一个选项之前，这件事已经发生了吗？」答否就删掉。

## 各阶段的提交语义

三个 commit action 都是**该阶段的一次性全量提交**，不是增量追加。

| action | 写入路径 | 全量范围 |
|---|---|---|
| `commit_opening_entities` | `save/entities/<type>/<localId>.json` | 本期开局需要的**全部**实体（≤64 个） |
| `commit_opening_graph` | `save/scenes/<localId>.json`、`save/relationships/character-<localId>.json` | 本期开局的**全部**场景（≤32）与**全部**关系分片（≤64） |
| `commit_opening_state` | `save/playthrough/runtime.json`、`frontier.json`、`setup-summary.json` | runtime + frontier + 玩家可读 summary |

### 全量与锁定

- **未提交即冲突**：目标目录里已存在、但不在本次输入中的路径会让提交失败（`OPENING_ENTITIES_CONFLICT` / `OPENING_GRAPH_CONFLICT`）。重提该阶段时必须把之前提交过的内容一并带上。
- **重复提交完全相同的内容是幂等的**，返回 `alreadyComplete: true` 且不写盘，不算错误。
- **下游阶段一旦落地，上游即锁死**：
  - 场景或关系已存在，或 state 已完成 → 再改实体报 `OPENING_ENTITIES_LOCKED`；
  - state 已完成 → 再改场景或关系报 `OPENING_GRAPH_LOCKED`。

**推论：实体和关系必须一次写全。** 开局期内没有「先提交一部分，回头再补」的机会。

## 关系分片完整性规则

组装 `relationships` 时逐条核对：

1. **每个在关系中被引用的角色，都要有自己的 subject 分片。** 若 A 的 edges 指向 B，B 也必须作为某个 `relationships[]` 条目的 `subject` 出现。只出现在别人 `edges[].to` 里而没有自己分片的角色，等于没有关系数据。
2. **双向关系两边各写一条。** 父子、夫妻、师徒、同门、仇敌这类互认关系，A→B 和 B→A 都要写。单向的认知、暗恋、隐瞒、监视可以只写主体侧。
3. **首回合登场的每个角色都应有分片。** 尤其是首回合唯一登场的 NPC——漏掉它意味着写手和场记拿不到任何关系依据。
4. **`edges` 不能为空。** 某角色确实没有任何关系时，不要给它建空分片，直接不写这个 subject。
5. `edges[].to` 必须指向本期已提交的 character，否则报 `OPENING_RELATIONSHIP_TO_UNKNOWN`。

## 常见提交失败与成因

| 错误码 | 成因 |
|---|---|
| `OPENING_ENTITIES_CONFLICT` / `OPENING_GRAPH_CONFLICT` | 该阶段已有文件不在本次输入里；把已提交内容一并带上重提 |
| `OPENING_ENTITIES_LOCKED` / `OPENING_GRAPH_LOCKED` | 下游阶段已完成，上游不可改；只能带着现状继续 |
| `OPENING_REF_UNKNOWN` | 指针指向尚未落盘或类型不符的目标；先确认上一阶段已提交 |
| `OPENING_SCENE_PRESENT_REQUIRED` | 场景 `present` 为空；场景必须至少有一个在场实体 |
| `OPENING_RELATIONSHIP_SUBJECT_UNKNOWN` / `..._TO_UNKNOWN` | 关系两端必须是已提交的 `character:` |
| `OPENING_TIMELINE_ANCHOR_INVALID` | 锚点 `chapter` 越出 `sourceWindow` 范围，或章节号递减 |
| `OPENING_PLAY_ALREADY_STARTED` | 已进入正式游玩；保留错误详情并停止，不要尝试覆盖 |

## 工具能力边界

世界架构师**没有** `query_entities` / `read_entities`（那是场记的工具）。读取已落盘资料一律用原生 workspace 读取明确路径——这也是上面那张 ref→路径表存在的理由。

可用：`workspace_read`、`workspace_write`、`workspace_semantic_search`、`agent_call`，以及 `json_edit` / `text_edit`。

`workspace_semantic_search` 用于在原文语料里找线索，不要拿它来定位已知结构的存档文件。
