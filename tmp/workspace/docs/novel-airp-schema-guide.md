# Novel AIRP Schema 速查指南

本默认卡支持小说 AIRP 流程：玩家导入小说，后台 Agent 团队渐进维护 schema、entities、runtime 与 frontier.timeline。完整字段手册见 `docs/novel-airp-schema-reference.md`。

## 主路径

```text
save/source/         # 导入的源文本：manifest、chapters、chunks
save/schema/         # 当前 schema、changelog、deprecated 笔记、Markdown patches
save/entities/       # 语义实体，存为 save/entities/<type>/<localId>.json
save/scenes/         # 场景分片，存为 save/scenes/<localId>.json（一场景一文件）
save/relationships/  # 人物关系分片，存为 save/relationships/<scope>.json（一角色 subject 一文件）
save/playthrough/    # player、frontier、runtime、opening/setup 摘要
```

## 语言边界

- 英文：JSON 字段、机器枚举、render preset、tone、visibility、lifecycle、entity type。
- 中文：Agent/Skill 显示名、entity `name`/`brief`、字段 label、section title/body、extension key、玩家可见描述。

## 权威归属

- entity json 是实体权威。
- scene / relationship json 是派生快照；丢了可重建。relationship 只承载人物/社交/阵营关系，不是泛实体图谱。
- `runtime.activeSceneRefs` 是当前活跃场景指针（每项 `{ ref, name }`），不是场景内容权威。
- `runtime.protagonistRef` 是当前主角指针 `{ ref, name }`；主角实体权威仍在 `save/entities/character/<localId>.json`。
- `runtime.location` 是当前地点指针 `{ ref, name } | null`。
- `runtime.worldTime` 是当前世界/剧情时间的固定字符串字段；它不是平台时间，也不等同于 turn。未知或尚未建立时写空字符串。
- `runtime.plotOrder` 是数字字段，单调递增，表示玩家当前走到哪个 source order；场记每回合维护，前端用于判断是否触发 frontier 推进。
- `runtime.weather` 是当前天气字符串；未知时写空字符串。

## runtime.json

当前世界/剧情时间写固定字段 `worldTime`，天气写 `weather`。`plotOrder` 是数字，单调递增，表示玩家当前走到哪个 source order；场记每回合维护，前端用于判断是否触发 frontier 推进。月相、倒计时、诅咒周期等新增/临时时间机制仍可放在 `extensions`。旧字段 `activeSceneIds`/`activeScene`/`player`/`inventory`/`status` 已废弃，不再写入 runtime。

```json
{
  "turn": 6,
  "worldTime": "赤明纪十二年三月初七，黄昏",
  "plotOrder": 3,
  "weather": "阴云聚拢",
  "location": { "ref": "location:青玄门山门", "name": "青玄门山门" },
  "activeSceneRefs": [{ "ref": "scene:山门冲突", "name": "山门冲突" }],
  "protagonistRef": { "ref": "character:萧玄", "name": "萧玄" },
  "extensions": {
    "月相": { "render": "text", "value": "上弦" }
  },
  "updatedAtTurn": 6,
  "updatedBy": "stage-manager"
}
```

## frontier.json

`save/playthrough/frontier.json` 记录源文本抽取进度与时间标记锚点。

```json
{
  "sourceWindow": { "start": 1, "end": 8, "chapters": [...] },
  "extractedThrough": "save/source/chapters/0008.md",
  "timeline": [
    { "kind": "source", "order": 1, "chapter": 1, "time": "元年", "label": "开局" },
    { "kind": "player", "order": 2, "turn": 8, "time": "二年春", "label": "离开山门", "alignment": "diverged", "sourceRef": 2 }
  ],
  "notes": "...",
  "updatedAt": "...",
  "updatedBy": "world-architect"
}
```

- `sourceWindow`：已读章节窗口（`start`/`end` 为章节号，`chapters` 为窗口章节元信息）。推进 frontier 时移动。
- `extractedThrough`：已抽取到的最远章节文件路径。
- `timeline`：时间标记锚点数组，用 `kind` 区分 source/player：
  - source 锚点 `{ kind: "source", order, chapter, time, label }`：world-architect 推进时建立，标记原著剧情节点。
  - player 锚点 `{ kind: "player", order, turn, time, label, alignment, sourceRef }`：stage-manager 维护时追加，标记玩家视角显著事件。
  - `order`：单调递增整数，是我们建立的线性轴，表示剧情事件先后顺序，与原著精确时间标记无关（即使原著写“回到过去”，order 也只向前）。
  - `alignment`（仅 player）：`diverged`（偏离原著，sourceRef=分叉自的 source order 或 null）、`rejoined`（从分支并回主干，sourceRef=并回的 source order）、`aligned`（经历 source 事件且结果相近，sourceRef=该 source order；可选，完美跟随时不建）。
- `timeline` 与 `sourceWindow` 独立：`sourceWindow` 记录已读窗口，`timeline` 记录锚点；推进时 `sourceWindow` 移动、`timeline` 追加 source 锚点。

## 实体基础

实体 id 用 `<type>:<localId>`，映射到 `save/entities/<type>/<localId>.json`。必填字段：`id`、`name`、`brief`。

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "gender": "男"
}
```

按需使用：`gender`、`aliases`、`visibility`、`lifecycle`、`tags`、`identity`、`appearance`、`attributes`、`gauges`、`status`、`traits`、`goals`、`background`、`containers`、`portrait`、`extensions`。旧字段 `fields`、`sections`、`origin`、`sourceRefs`、`updatedAtTurn`、`updatedBy` 已废弃，不再新增。

## character identity / appearance / attributes / gauges / status / traits / goals / background / containers

- `identity`：稳定身份键值对，键为 `age`/`gender`/`role`/`affiliation`/`realm`（如 年龄/性别/身份/所属/境界）。旧键 `race`/`class`/`title` 已废弃。
- `appearance`：当前形象叙事字符串（单段），描述角色当下外貌。旧 label/value 键值对形态已废弃。
- `attributes`：固定6维基础属性，键名由世界架构师按世界观定义（默认`体魄`/`悟性`/`气运`/`根骨`/`法力`/`魅力`），值为正整数，基线 5。维度分两类：**修炼型**（`法力`，随境界暴涨）和**天赋型**（`悟性`/`气运`/`根骨`/`魅力`，先天素质，与境界关系小）；`体魄`介于两者之间（天生体质＋修炼强化）。填值时按角色境界估算法力量级，天赋维度按角色资质给，不要把所有维度压在同一小区间。

  以下是示例刻度尺（仅供参照——不同小说的战力差距天差地别，有的境界间差百倍，有的几乎没有差距，按实际世界观调整）：

  | 境界 | 法力（修炼型） | 体魄（半修炼） | 天赋型（悟性/气运/根骨/魅力） |
  |---|---|---|---|
  | 凡人 | 1-2 | 3-8 | 1-10 |
  | 开识 | 2-5 | 5-10 | 1-12 |
  | 观心 | 5-15 | 8-15 | 1-12 |
  | 生灵 | 15-50 | 12-25 | 1-15 |
  | 金丹 | 50-150 | 20-40 | 1-15 |
  | 元婴 | 150-500 | 30-60 | 1-15 |
  | 化神 | 500-1500 | 50-100 | 1-15 |
  | 神通 | 1500-5000 | 80-150 | 1-15 |
  | 大乘 | 5000+ | 100+ | 1-15 |

  没有剧情佐证时也要按境界大致估算，不要留空或全填基线——空值或全 5 比不合理估值更糟，因为掷骰对抗会直接用这些数值做差值。跨境界法力差距应大到低境界方几乎不可能正面赢，这靠数值刻度本身保证，不靠掷骰时事后主观找补。
- `gauges`：自由命名量表数组，每项 `{ id, name, value, max?, min?, unit?, tone? }`。`id`/`name`/`value` 必填；`tone` 取值 `neutral`/`accent`/`success`/`warning`/`danger`/`muted`。旧固定 5 key `hp`/`mp`/`sp`/`hunger`/`stamina` 已废弃。
- `status`：状态项数组，每项 `{ id, name?, description?, polarity? }`。`polarity` 取值 `positive`/`negative`/`neutral`；旧 `status[].level` 已废弃。`status[]` 表示当前临时状态（受伤、中毒、灵力亏空、buff）。
- `traits`：永久性稳定特质数组，每项 `{ id, name?, description?, effects? }`。`id` 必填（`trait:<localId>` 格式）；`name` 主展示；`description` 表达特质本身的设定说明；`effects` 为字符串数组，表达具体可用效果/限制/叙事影响（如「能够堪破虚妄」「心神不受外力影响」）。表示特殊体质、天赋、系统、血脉、命格等稳定能力来源。区别于 `status[]`（当前临时状态）：`traits[]` 是永久性的，不随单回合状态变化消失。旧存档无此字段仍可解析。
- `goals`：意图与目标 `{ current?, shortTerm?, longTerm? }`，每项字符串。缺省项不写入。
- `background`：背景摘记，单段叙事字符串。
- `containers`：当前持有的容器指针数组，每项 `{ ref, count? }`，ref 指向 container entity；`count` 缺省视为 1。角色不持有容器时省略该字段或写空数组。物品数量不落在这里，落在 container.contents[*].count。
- `portrait`：玩家上传头像的 UI/媒体引用元数据 `{ path, mimeType?, updatedAt?, updatedBy? }`，`path` 指向 `save/assets/portraits/characters/<localId>.webp`。仅前端 UI 使用，不进入 AIRP injection；agent 重写 character entity 时应保留该字段，不要删除。
- `relationships` 不内嵌于 character entity；继续走 `save/relationships/character-<localId>.json` 分片。该分片只记录人物关系：subject/to 当前均必须是 `character:<localId>`；地点、组织、物品、场景、事件、尸体/线索、概念等非角色关联不要写入 relationships。

## container / item entity

容器与物品是独立实体，不内嵌于 character。

- `container` entity 存于 `save/entities/container/<localId>.json`。字段：`id`、`name`、`brief`、`type="container"`、`contents: Array<{ ref, count? }>`（ref 指向 item 或嵌套 container 实体；count 缺省 1）、`status?`（可选，沿用 character status 数组形态）、`extensions?`。不设容量字段；不冗余存储子物品的 name/brief。
- `item` entity 存于 `save/entities/item/<localId>.json`。字段：`id`、`name`、`brief`、`type`（取值 `equipment`/`material`/`consumable`/`special`/`other`）、`tags?: string[]`、`extensions?`。物品不设 `status`（品相变化直接改 name/brief 或走 extensions）；数量由持有者 container.contents[*].count 表达，item entity 自身不存 `quantity`。

```json
{
  "id": "container:萧玄行囊",
  "name": "外门弟子行囊",
  "brief": "入门时统一发放的青灰色布囊，绳口有磨损。",
  "type": "container",
  "contents": [
    { "ref": "item:清心丹", "count": 3 },
    { "ref": "item:粗铁短剑" }
  ]
}
```

```json
{
  "id": "item:粗铁短剑",
  "name": "粗铁短剑",
  "brief": "制式短剑，刃口有小豁，仍堪一用。",
  "type": "equipment",
  "tags": ["制式", "近战"]
}
```

## extensions

- `extensions`：动态玩家可见字段，子 key 可用中文，值内用有限 `render` preset（text/number/progress/tag/tags/list/section/ref/cards）。`render` 可省略，省略时前端按朴素文本展示 value；写了 `render` 但值不在 preset 里时前端 fail loud（warn + 隐藏该字段），不静默降级。需要新 render 类型时通过脚本/工具在写入时校验，不要在数据里发明任意 UI 组件名。

固定基础 schema 由前端做专门 UI；`extensions` 只是这些 UI 内的新字段扩展槽，不是万能 renderer。

## Agent 职责

- `storyteller` / 三人写手：玩家正式回合入口，写沉浸式正文和选项；信息不足时 call 资料员。
- `researcher` / 资料员：只读 source/entity/scene/relationship/schema，返回精炼事实。
- `stage-manager` / 场记：回合后维护 runtime、entities、scenes、relationships、memory 与可渲染状态；必要时 call 世界架构师。
- `world-architect` / 世界架构师：开局建模、schema 设计与 pending patch。
