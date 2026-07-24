---
name: 回合后维护
title: 回合后维护
description: 正式玩家回合落定后维护 runtime/entity（含装备投影）/scene/relationship/memory/extensions 已发生事实，映射 plotOrder，追加 player 锚点，并维护 activeSceneRefs 以触发过期 scene 清理。
triggers:
  - 正式玩家回合正文落定后的回合后维护
appliesTo:
  - stage-manager
---

# 回合后维护

在一个正式玩家回合落幕后，把已经发生的变化维护到存档。维护已发生事实，不创作新剧情。

## 标准流程

1. 第一轮先调用 `read_maintenance_context({ turn: 目标回合号, includeTimeline: true })`，用它聚合本回合正文、runtime、active scenes、相关 entities/relationships、memory 文本、scene 清理候选和 timeline。
2. 基于聚合上下文判断本回合已发生变化，维护 runtime/entity（含完整装备投影）/scene/relationship/memory/timeline。若装备维护还需要某个具体容器或 item 实体，先定向读取该文件及其递归容器链，直到能确认持有关系；不要靠目录枚举猜测。
3. JSON 文件优先调用 `json_edit`；memory records、seeds 等行级文本优先调用 `text_edit`。
4. 每个正式玩家回合维护结束前，调用 `commit_turn_recall` 写入当前 turn 的 `meta.recall`。

## 回退流程

只有当 `read_maintenance_context` 缺失必要事实、返回空正文、目标文件不存在且不能用 `create` 明确创建，或工具不支持目标格式时，才补充读取/写入具体目标文件。不枚举 `save/entities`、`save/scenes`、`save/relationships`，不直接读取底层源文本文件——未读源章节只由 frontier 推进流程读取。

## 写入工具速用

### json_edit

`target` 用 ref 或路径。点路径用于 `set`/`append`/`upsert`/`remove`/`unset`。

```json
{
  "target": "save/playthrough/runtime.json",
  "set": {
    "turn": 3,
    "worldTime": "大婚之日，巳时初",
    "updatedAtTurn": 3,
    "updatedBy": "stage-manager"
  }
}
```

```json
{
  "target": "character:萧澈",
  "append": {
    "history": [
      { "event": "大婚之日，萧澈与夏倾月拜堂礼成。" }
    ]
  },
  "upsert": {
    "status": [
      {
        "match": { "id": "status:养心丹药效" },
        "set": {
          "name": "养心丹药效",
          "description": "药效约剩一个时辰",
          "polarity": "positive"
        }
      }
    ]
  }
}
```

```json
{
  "target": "save/relationships/character-萧澈.json",
  "upsert": {
    "edges": [
      {
        "match": { "to": "character:夏倾月" },
        "set": { "type": "夫妻", "since": 3, "note": "拜堂礼成，二人正式成婚" }
      }
    ]
  }
}
```

新建实体只写已确认的最小事实，不为了模板完整而填空字段：

```json
{
  "target": "character:夏冬灵",
  "create": {
    "id": "character:夏冬灵",
    "name": "夏冬灵",
    "brief": "夏倾月贴身侍女，比夏倾月大一岁，胆小怕生。"
  }
}
```

### text_edit

```json
{
  "target": "save/memory/records.md",
  "append": [
    "- [8] recall 关键词: 拜堂礼成; 摘要: 萧澈与夏倾月拜堂礼成"
  ]
}
```

```json
{
  "target": "save/memory/seeds.md",
  "replace": [
    {
      "find": "萧烈“好好看看她”的暗示",
      "line": "- [萧烈“好好看看她”的暗示] 状态: developing; 关联回合: 3"
    }
  ]
}
```

`replace`/`remove` 的 `find` 必须恰好命中一行；0 匹配或多匹配时先修正定位，不要假装已维护。

## 维护对象

### runtime（save/playthrough/runtime.json）

- `worldTime`（字符串）：玩家感受的时间流逝感。按正文中时间推进或场景变化更新为简短叙事字符串（如 `黄昏`、`翌日清晨`、`赤明纪十二年三月初七，黄昏`）；未知或暂不展示时留空字符串，不发明完整日历系统。
- `plotOrder`（数字）：剧情进度坐标。根据 frontier timeline 判断玩家当前剧情走到哪个 source 锚点之后，设 `runtime.plotOrder` 为该 source 锚点的 order。worldTime 与 plotOrder 独立维护。
- `weather`：当前天气字符串，按正文更新。
- `location`：当前地点 `{ ref, name } | null`。
- `activeSceneRefs`：当前活跃场景指针数组，每项 `{ ref, name }`。
- `protagonistRef`：主角指针 `{ ref, name } | null`。
- `extensions`：新增/临时玩家可见字段。

### plotOrder 映射方法

1. 从 `read_maintenance_context` 返回的 timeline 筛选 `kind: "source"` 的锚点，按 order 排序。
2. 根据正文中剧情推进，判断玩家当前走到了哪个 source 锚点之后。
3. 设 `runtime.plotOrder` 为该 source 锚点的 order。
4. 细粒度时间抖动（"第三天清晨→中午→黄昏"）不跨剧情节点时，plotOrder 不动。

### entity（save/entities/）

- entity 文件是实体权威。
- `character.history` 只记录会长期影响角色态度、关系、目标、创伤、秘密、承诺、恩怨或重要物件绑定的经历；每条只写 `{ "event": "..." }`。
- `status` 表示当前临时状态；稳定能力写 `traits`。
- 新建实体只写本回合已确认事实。结构不确定时触发 schema 演进检查或 call 世界架构师。

### 装备维护

角色装备栏类型为 `Record<string, { ref: string | null; applied?: Record<string, number> }>`。槽位名由当前游戏数据动态定义，不预设通用人体槽位；按 `character.equipment` 的 JSON key 原始顺序维护。每个非空 `ref` 必须指向 `type: "equipment"` 的 item，并能从该角色 `containers` 经嵌套 `container.contents` 递归到达；装备仍留在容器图中，不另建虚拟装备容器。

装备 item 的可选元数据为 `equipment?: { slot?: string; mods?: Record<string, string>; effects?: string[] }`：

- `slot` 是建议槽位，不是平台强制约束。
- `mods` 的 key 是属性名，value 必须是 `+=`、`-=`、`*=`、`=` 开头的字符串。
- 表达式只引用本次维护基线中的属性名，并只用 `floor`、`ceil`、`round`、`min`、`max`、`abs`、`clamp`。
- `effects` 只影响叙事判断，不自动改变数值。
- 这些规则由你根据明确上下文解释；平台没有 modifier 求值器。

当装备 ref、item 装备规则、角色属性或持有关系明确变化时，执行一次完整角色装备维护：

1. 从当前 `attributes` 逐槽减去所有旧 `applied`，得到本次维护基线。
2. 验证每个非空 ref 可递归到达且 item 为 `type: "equipment"`；不可达 ref 仍纳入本次完整维护，撤销旧贡献后把该槽写为 `{ "ref": null }`。
3. 按装备栏 key 顺序解释合法 `mods`。`+=` 增加表达式结果，`-=` 减少，`*=` 相乘，`=` 设为表达式结果；每步属性取 `round` 后整数且最低为 0。
4. 每槽 `applied` 写该槽实际造成的整数差值；`character.attributes` 写最终当前有效属性。
5. 用一个 `json_edit` 操作的 `set` 同时替换该角色完整 `attributes` 和完整 `equipment` 投影。这里要求的是一次工具操作内的完整角色写入，不表示平台提供数据库事务。

任一规则、属性引用、维护基线或持有关系无法确定时，不猜测、不调用 `json_edit` 写部分装备结算；保持旧 `attributes`/`equipment`，并在最终回复的 entities 域说明无法完整维护的原因。既有存档不会自动迁移；缺少这些可选字段本身不是错误。

### extensions.render

`extensions` 的显式 `render` 只接受 schema 已知 preset（`text`、`number`、`progress`、`tag`、`tags`、`list`、`section`、`ref`、`cards`）。省略时可按普通文本处理；显式值未知时，在最终回复对应维护域记录警告并隐藏该字段，不把它静默改成 text 或其他 preset。

### scene（save/scenes/）

- scene 文件里 `present` 只写 `{ ref }` 指针，name/brief/state 回读实体权威。
- scene 是当前/后台 playthrough 局面导航缓存，不是剧情历史或检索主索引。
- 维护 `runtime.activeSceneRefs` 作为当前活跃场景指针；需要长期保留为后台导航的 scene 写 `status: "background"`。平台宿主会在维护结束后清理不在 `activeSceneRefs` 且非 background 的 scene；不要尝试用 `json_edit` / `text_edit` 直接删除文件。

### relationship（save/relationships/）

- 只维护 `character:<localId>` 之间的人物关系。
- 双向角色关系两边各写一条；刻意单向的认知/隐瞒/单方面态度可只写主体侧。
- 非角色关联不要写入 relationships。

### memory / seeds

records 每条一行：
`- [序号] <recall|scene|npc_action> 关键词: 简短关键词; 摘要: 一句客观事实`

- `recall`：玩家可回忆的前文事件
- `scene`：当前场景的关键状态变化
- `npc_action`：NPC 的自主行动

只记客观事实，去修辞。不复制整段正文原文。序号根据 records tail 递增判断。

seeds 每条一行：
`- [伏笔描述] 状态: <planted|developing|resolved|abandoned>; 关联回合: N`

### turn recall metadata（save/history/turns/turn-NNNNNN.json）

- 每个正式玩家回合维护结束前，调用 `commit_turn_recall` 写入当前 turn 的 `meta.recall`。该工具只覆盖 `meta.recall`，不改正文 timeline。
- `meta.recall.schema` 固定为 `沉浸阅读器.turn-recall.v1`。
- `剧情坐标` 对应维护后的 `runtime.plotOrder`；能判断时填写数字，无法判断可省略。
- `时间` 写当前世界/剧情时间可读文本，优先使用维护后的 `runtime.worldTime` 或本回合明确时间词。
- `涉及实体` 只写未来召回最有价值的实体 ref；未知非实体概念放入 `标签`。
- `事件类型` 只能取：`对话交流`、`玩家选择`、`冲突争执`、`关系变化`、`承诺亏欠`、`秘密揭露`、`发现线索`、`物品变化`、`状态变化`、`场景变化`、`战斗危险`、`计划目标`、`交易谈判`、`亲密暧昧`、`伏笔回收`。
- `摘要` 写一句客观剧情摘要，必须非空。

## timeline player 锚点

- 在玩家视角发生显著事件时追加 player 锚点 `{ kind: "player", order, turn, time, label, alignment, sourceRef }`。
- `order` = 玩家当前所在 source 区间的起始 source 锚点 order。同一 source 区间内的多个 player 锚点共享相同 order。
- `alignment`：`diverged`（偏离原著，sourceRef=分叉自的 source order 或 null）、`rejoined`（从分支并回主干，sourceRef=并回的 source order）、`aligned`（经历 source 事件且结果相近，sourceRef=该 source order；可选，完美跟随时不建，source 锚点本身代表那段故事）。
- 只在偏离、并回、或经历 source 事件但结果不同时建 player 锚点。

## 最终回复格式

最终回复按维护域汇总；无变化域可简写，但要说明无变化原因。

推荐结构：

```md
回合后维护完成。本轮维护内容：

**runtime.json**
- ...

**entities / equipment**
- ...

**relationships**
- ...

**scene**
- ...

**memory**
- records.md：...
- seeds.md：...

**timeline**
- ...

**turn recall**
- ...
```

## 不做

- 不判断是否推进 frontier。
- 不读未读章节（frontier 推进才读）。
- 不写 source 锚点（world-architect 写）。
- 不创作新剧情，只维护已发生事实。
