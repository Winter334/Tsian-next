---
name: 回合后维护
title: 回合后维护
description: 正式玩家回合落定后，按固定步骤维护已发生事实、消费局部写入结果，并最后写入回合召回。
triggers:
  - 正式玩家回合正文落定后的回合后维护
appliesTo:
  - stage-manager
---

# 回合后维护

在一个正式玩家回合落幕后，把已发生的变化维护到存档。只维护有证据支持的事实，不创作、补全或预支剧情。

## 固定流程

1. **读取本轮基础资料。** `workspace-map.md`、`save/schema/current.md`、`save/playthrough/runtime.json`、`save/memory/records.md` 与 `save/memory/seeds.md` 已随本次调用注入上下文，直接取用。另需用原生读取打开目标 `save/history/turns/turn-NNNNNN.json`（`NNNNNN` 为回合号补零至 6 位）。本轮涉及 `plotOrder`、player 锚点或当前场景时，再读取 `save/playthrough/frontier.json`，或按 `workspace-map.md` 的 ref → 路径规则从 `runtime.activeSceneRefs` 推出 scene 文件。
2. **判定事实。** 将正文和已存档资料分为：已发生事件、当前明确状态、已表达意图、命令/预测/担忧/选项。只有已发生事件和当前明确状态可写入 history、status、scene、relationship、memory 或 timeline。意图只在已明确表达且会持续影响角色时写入 goals；不得把预期结果写成现状。
3. **定位实体与场景。** 人物、物品、容器、地点等实体一律先用 `query_entities` 筛选候选，再用 `read_entities` 按 ref 读取所需字段——一次调用可覆盖多个实体和字段，不要逐个原生读取实体文件。角色关系优先用 `read_entities` 的 `relations` 参数展开指定方向、关系类型和有限层数。场景不在专用工具覆盖范围内：从 `runtime.activeSceneRefs` 取 ref，按 `workspace-map.md` 的规则推出 `save/scenes/<localId>.json` 后原生读取。`query_entities` 只扫描 `save/entities/`，不能查询场景或关系文件。专用工具报错或返回结果不足以判断时，才回退到原生读取对应文件，并在最终摘要中说明回退原因。不要读取整库或所有关系。
4. **补齐必要上下文。** 实体与角色关系仍按第 3 步走专用工具；本步只处理 schema、源文等非实体资料，已知路径直接用原生读取。仅当 `current.md` 未覆盖的罕见字段、结构或 render 规则需要确认时，才查阅 `docs/novel-airp-schema-reference.md` 的相关部分。需要变更 schema 时加载 `schema演进检查` 或 call 世界架构师。重要实体只有在已有明确角色或章节定位、且当前证据不足以完成必要维护时，才定向读取最小范围源文；不得借此批量阅读未读章节或预测后续剧情。
5. **决定创建或更新。** 已有实体优先更新。缺失实体仅在会跨回合参与剧情、关系、目标、物品归属、场景状态或未来召回时，以最小事实创建；原创角色和原著角色适用同一规则。明显一次性、短暂退场且无后续价值的龙套不建实体。已知字段逐步补全，未知字段保持缺失。`attributes` 仅依据已知境界、稳定表现和主体事实派生，不能倒推出身份、境界、伤势、目标或其他主体事实。
6. **写入核心目标。** runtime、entity、scene、relationship 和 timeline 的结构化修改使用 `json_edit`。同一目标相互依赖的修改放入一个目标微批次，独立目标分开提交；可用外层 `target` 与 `ops`，未指定 target 的子操作继承外层 target。确有必要移除实体时用独立的 `delete: true` 操作；它只适用于实体 ref，不能和同目标其他修改混用。穿戴、卸下、替换和属性投影刷新使用 `装备管理`，不手工覆盖 `equipment` 或以不明基线写入 `attributes`。
7. **消费写入结果。** 对每个目标记录 `applied`、`noop`、`failed` 和 `not_run`。已应用或无变化的操作不重放；可修正的失败只重新读取该目标并修正一次。独立目标继续处理。核心目标完成后，用 `text_edit` 维护 records 与 seeds。
8. **收尾。** 核心和 memory 写入结果已确认后，最后调用 `commit_turn_recall` 写本回合 `meta.recall`。最终摘要按维护域列出实际成功项；必要目标未完成时写“部分维护完成”，并列出目标与原因。

## 维护边界

### runtime 与 timeline

- `worldTime` 写正文明确的时间推进或场景时间；未知或无变化时保持原值或留空，不发明日历。
- 需要维护 `plotOrder` 时，读取 frontier timeline，按正文已到达的 source 区间更新；细粒度时间变化不跨剧情节点时不改。
- 仅当 source 结果可比较时，才建立带 `aligned`、`diverged` 或 `rejoined` 的 player 锚点。无法比较时只维护 `plotOrder`，不猜测 alignment。
- 不判断 frontier 是否推进，不写 source 锚点。

### entity、scene 与 relationship

- `history` 只记录会持续影响态度、关系、目标、创伤、秘密、承诺、恩怨或重要物件绑定的经历；`status` 写当前临时状态；稳定能力写 `traits`。
- scene 只保存当前或后台局面导航。`present` 只写实体 ref，`runtime.activeSceneRefs` 指向当前活跃 scene；需长期后台保留的 scene 标为 `background`。不直接删除 scene 文件。
- relationship 只维护 `character:<localId>` 之间的人物关系。双向关系两边各写一条；单向认知、隐瞒或态度可只写主体侧。
- 装备栏与属性投影由 `装备管理` 维护。普通属性变化传给 `装备管理.refresh` 的 `attributeChanges`，不直接修改投影值。

### memory 与 recall

- records 每条一行：`- [序号] <recall|scene|npc_action> 关键词: 简短关键词; 摘要: 一句客观事实`。尖括号只标示可选值，写入时不带尖括号，例：`- [1] scene 关键词: 恶奴踹门; 摘要: 王有信带侍卫踹门闯入萧凌卧房。`。序号从注入的 records 末条依次递增；只记将来召回有价值的客观事实，不复制正文。
- seeds 每条一行：`- [伏笔描述] 状态: <planted|developing|resolved|abandoned>; 关联回合: N`。同样不带尖括号，例：`- [王有信带话回萧瑞] 状态: planted; 关联回合: 1`。仅更新本轮有明确发展、解决或放弃证据的伏笔。
- `commit_turn_recall` 的摘要必须非空；涉及实体只放对未来召回有价值的实体 ref，其他概念放标签。`事件类型`、`涉及实体`、`标签` 均为数组，枚举值与各字段上限见 `workspace-map.md`。它只覆盖 `meta.recall`，不改 turn 正文。

## 失败处理

- 参数形状、精确定位、格式或版本冲突可修正时，先读取失败目标，再重试一次。
- 事实不足、实体身份不能确认、当前 schema 无法表示，或同一目标第二次失败时，停止该目标并在最终摘要中说明。
- 单个普通操作失败不应阻断其他独立目标。读取或写入的基础设施故障使当前调用无法继续时，立即中止并报告。

## 最终回复

按实际有变化的维护域简要汇总，并说明 records、seeds 与 turn recall 的结果。全部必要目标完成才写“回合后维护完成”；否则写“回合后部分维护完成”，列出未完成目标和原因。
