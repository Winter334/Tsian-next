---
name: 回合后维护
title: 回合后维护
description: 正式玩家回合落定后维护 runtime/entity/scene/relationship/memory/extensions 已发生事实，映射 plotOrder，追加 player 锚点，清理过期 scene。
triggers:
  - 正式玩家回合正文落定后的回合后维护
appliesTo:
  - stage-manager
---

# 回合后维护

在一个正式玩家回合落幕后，把已经发生的变化维护到存档。维护已发生事实，不创作新剧情。

## 标准流程

1. 第一轮先调用 `read_maintenance_context({ turn: 目标回合号, includeTimeline: true })`，用它聚合本回合正文、runtime、active scenes、相关 entities/relationships、scene 清理候选和 timeline。
2. 基于聚合上下文判断本回合已发生变化，维护 runtime/entity/scene/relationship/memory/timeline。
3. 用现有 workspace.write/edit/delete 做小而清晰的写入；同一次 invokeAgent 的 workspace mutations 会由平台事务统一提交。

## 回退流程

只有当 `read_maintenance_context` 缺失必要事实、返回空正文、目标文件不存在，或写入前确需确认旧文件全文时，才使用 workspace_read/list/glob 补充读取。补充读取只读具体目标文件，不做目录级探索；不要读取 `save/source/chapters/*`，未读源章节只由 frontier 推进流程读取。

## 维护对象

### runtime（save/playthrough/runtime.json）

- `worldTime`（字符串）：玩家感受的时间流逝感。按正文中时间推进或场景变化更新为简短叙事字符串（如 `黄昏`、`翌日清晨`、`赤明纪十二年三月初七，黄昏`）；未知或暂不展示时留空字符串，不发明完整日历系统。
- `plotOrder`（数字）：给前端做触发判断的剧情进度坐标。每回合维护：读 `save/playthrough/frontier.json` 的 timeline，判断玩家当前剧情走到哪个 source 锚点之后，设 `plotOrder` 为该 source 锚点的 order。worldTime 服务玩家感受，plotOrder 服务机器判断，两者独立维护。
- `weather`：当前天气字符串，按正文更新。
- `location`：当前地点 `{ ref, name } | null`。
- `activeSceneRefs`：当前活跃场景指针数组，每项 `{ ref, name }`。
- `protagonistRef`：主角指针 `{ ref, name } | null`。
- `extensions`：新增/临时玩家可见字段。
- 旧字段 `activeSceneIds`/`activeScene`/`player`/`inventory`/`status` 已废弃，不再写入 runtime。

### plotOrder 映射方法

1. 读 `save/playthrough/frontier.json` 的 timeline，筛选 `kind: "source"` 的锚点，按 order 排序。
2. 根据正文中剧情推进，判断玩家当前走到了哪个 source 锚点之后（语义判断，你已经在读正文、理解时间推进）。
3. 设 `runtime.plotOrder` 为该 source 锚点的 order。
4. 细粒度时间抖动（"第三天清晨→中午→黄昏"）不跨剧情节点时，plotOrder 不动。

### entity（save/entities/）

- entity 文件是实体权威：
  - `character` 的稳定信息写在 `identity`（`age`/`gender`/`role`/`affiliation`/`realm`，旧键 `race`/`class`/`title` 已废弃）、`appearance`（当前形象叙事字符串，旧 label/value 键值对已废弃）、`attributes`（固定6维，键名由世界架构师按世界观定义，默认`体魄`/`悟性`/`气运`/`根骨`/`法力`/`魅力`，基线 5）、`gauges`（自由命名量表数组，每项 `{ id, name, value, max?, min?, unit?, tone? }`；旧固定 5 key `hp`/`mp`/`sp`/`hunger`/`stamina` 已废弃）、`status`（状态项数组，每项 `{ id, name?, description?, polarity? }`，`polarity` 取值 `positive`/`negative`/`neutral`）、`goals`（`{ current?, shortTerm?, longTerm? }`，每项字符串）、`background`（单段叙事字符串）、`containers`（当前持有的容器指针数组，每项 `{ ref, count? }`，ref 指向 container entity；缺省表示未持有容器）。旧字段 `fields`、`sections`、`status[].level` 已废弃。`relationships` 不内嵌于 character entity；继续走 `save/relationships/character-<localId>.json` 分片。该分片只记录人物关系，subject/to 当前均必须是 `character:<localId>`；非角色关联不要写入 relationships。
  - `container` 存于 `save/entities/container/<localId>.json`，字段：`id`、`name`、`brief`、`type="container"`、`contents: Array<{ ref, count? }>`（ref 指向 item 或嵌套 container；count 缺省 1）、可选 `status`（与 character status 一致的数组形态）、`extensions?`。不设容量字段；contents 只存 ref+count，不冗余子物品 name/brief。
  - `item` 存于 `save/entities/item/<localId>.json`，字段：`id`、`name`、`brief`、`type`（取值 `equipment`/`material`/`consumable`/`special`/`other`）、`tags?: string[]`、`extensions?`。物品不存 `status`（品相变化改 name/brief 或用 extensions），不存 `quantity`（数量落在 container.contents[*].count）。

### scene（save/scenes/）

- scene 文件里 `present` 只写 `{ ref }` 指针，name/brief/state 一律回读实体权威。
- scene/relationship 是派生导航视图，刷新摘要，不把它当第二权威。relationship 只维护 `character:<localId>` 之间的人物关系；非角色关联不要写入 relationships。
- scene 是当前/后台 playthrough 局面导航缓存，不是剧情历史、原著场景资料库或检索主索引。过往剧情检索应读正式 turn history。
- 过期 scene 清理：确认不再作为 active/background 导航后可删除，不归档为历史资料。

### relationship（save/relationships/）

- 只维护 `character:<localId>` 之间的人物关系。
- 双向角色关系两边各写一条；刻意单向的认知/隐瞒/单方面态度可只写主体侧。

### memory / extensions

- memory 按需维护长期记忆摘要。
- `extensions` 的 key 可用中文；值内 `render` preset、tone 等机器字段用英文。

## timeline player 锚点

- 读 `save/playthrough/frontier.json` 的 timeline，在玩家视角发生显著事件时追加 player 锚点。
- player 锚点形态：`{ kind: "player", order, turn, time, label, alignment, sourceRef }`。
- `order` = 玩家当前所在 source 区间的起始 source 锚点 order。同一 source 区间内的多个 player 锚点共享相同 order。
- `alignment`：`diverged`（偏离原著，sourceRef=分叉自的 source order 或 null）、`rejoined`（从分支并回主干，sourceRef=并回的 source order）、`aligned`（经历 source 事件且结果相近，sourceRef=该 source order；可选，完美跟随时不建，source 锚点本身代表那段故事）。
- 只在有意义的时刻建 player 锚点：偏离、并回、或经历 source 事件但结果不同（用 `diverged` + sourceRef）。

## 不做

- 不判断是否推进 frontier（前端基于 plotOrder 客观计算）。
- 不读未读章节（frontier 推进才读）。
- 不写 source 锚点（world-architect 写）。
- 不创作新剧情，只维护已发生事实。
