# Novel AIRP Schema 详尽参考

详尽字段手册，按需查阅，不常驻上下文。速查见 `docs/novel-airp-schema-guide.md`。

## 实体推荐元数据

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "gender": "男",
  "tags": ["青玄门", "外门弟子"],
  "identity": { "age": 17, "gender": "男", "role": "外门弟子", "affiliation": "青玄门", "realm": "炼气后期" },
  "appearance": "身着青玄门外门弟子袍，衣袖被剑气割裂，右臂缠着临时止血布。脸色略白，但目光仍然清醒。",
  "attributes": { "体魄": 5, "悟性": 6, "气运": 4, "根骨": 5, "法力": 5, "魅力": 5 },
  "gauges": [
    { "id": "cultivation-progress", "name": "修炼进度", "value": 24, "max": 100, "tone": "accent" },
    { "id": "corruption", "name": "腐化值", "value": 37, "max": 100, "tone": "danger" },
    { "id": "mana-deficit", "name": "法力亏空", "value": 10, "max": 100, "tone": "warning" }
  ],
  "status": [
    { "id": "injury:右臂轻伤", "name": "右臂轻伤", "description": "挥剑时略有迟滞。", "polarity": "negative" }
  ],
  "traits": [
    { "id": "trait:明镜心", "name": "明镜心", "description": "一种天生澄澈、难染外邪的心性天赋。", "effects": ["能够堪破虚妄", "心神不受外力影响"] }
  ],
  "goals": {
    "current": "证明自己没有私通外敌，并从山门冲突中脱身。",
    "shortTerm": "查清禁地异动与玄衣少女出现之间的关联。",
    "longTerm": "在青玄门站稳脚跟，找出山门内暗藏的叛徒线索。"
  },
  "background": "萧玄入门时间不长，但剑法基础稳。本轮前，他被卷入山门冲突，目标是证明自己没有私通外敌。",
  "history": [
    { "event": "元年山门冲突时，被同门当众质疑私通外敌，因此更执着于证明清白。" }
  ],
  "containers": [
    { "ref": "container:萧玄行囊" }
  ],
  "equipment": {
    "武器": { "ref": "item:粗铁短剑", "applied": { "体魄": 2 } },
    "护甲": { "ref": null }
  },
  "extensions": {
    "腐化值": { "render": "progress", "value": 37, "max": 100, "tone": "danger" }
  }
}
```

`identity`/`appearance`/`attributes`/`gauges`/`status`/`traits`/`goals`/`background`/`equipment` 为 character 权威结构。`identity` 键为 `age`/`gender`/`role`/`affiliation`/`realm`。`attributes` 固定6维、值为非负整数，键名由世界架构师按世界观定义，基线为 5；装备刷新后这里保存当前有效属性。`gauges` 是自由命名数组，每项 `{ id, name, value, max?, min?, unit?, tone? }`。`appearance` 是单段叙事字符串。`goals` 是 `{ current?, shortTerm?, longTerm? }`，每项字符串。`background` 是单段字符串。`status[].polarity` 取值 `positive`/`negative`/`neutral`。`traits` 是永久性稳定特质数组，每项 `{ id, name?, description?, effects? }`，`id` 必填（`trait:<localId>` 格式），表示特殊体质、天赋、系统、血脉、命格等稳定能力来源；区别于 `status[]`（当前临时状态），`traits[]` 是永久性的，不随单回合状态变化消失。`relationships` 不内嵌于 character entity；走 `save/relationships/character-<localId>.json` 分片。

character 可选 `history?: Array<{ event: string }>`：人物履历，只记录会长期影响角色态度、关系、目标、创伤、秘密、承诺、恩怨或重要物件绑定的经历。每条只包含 `event` 一个字段；时间自然写入 `event` 文本，不另设 `time`。不要写 `turn`、`tags`、`eventKinds`、`涉及实体` 等内部检索字段；它不是 turn 索引，只是角色资料和正文 Agent 发起历史召回的语义入口。普通流水账不写入。

character 可选 `containers?: Array<{ ref, count? }>`：当前持有的容器指针数组，ref 指向 `save/entities/container/<localId>.json`，`count` 缺省视为 1。角色不持有容器时省略该字段或写空数组。物品数量不写在 character 层，落在 container.contents[*].count。

character 可选 `equipment?: Record<string, { ref: string | null; applied?: Record<string, number> }>`：当前装备栏。槽位名由当前游戏数据动态定义，不预设通用人体槽位；JSON key 顺序就是维护和展示顺序。`ref` 指向当前装备 item；空槽位写 `null`。`applied` 记录上一次完整装备刷新时本槽实际写入 `attributes` 的整数差值，只用于下次刷新前撤销旧影响，不是角色的裸装属性。

## container / item entity

容器与物品是独立实体，与 character 平级，通过 ref 从 character.containers 与 container.contents 引用。背包、装备栏、物品详情等固定版块会直接读取这些结构；不需要用 extensions 承载它们。

```json
{
  "id": "container:萧玄行囊",
  "name": "外门弟子行囊",
  "brief": "入门时统一发放的青灰色布囊，绳口有磨损。",
  "type": "container",
  "contents": [
    { "ref": "item:清心丹", "count": 3 },
    { "ref": "container:内胆锦囊" }
  ],
  "status": [
    { "id": "container:潮湿", "name": "轻微受潮", "polarity": "negative" }
  ]
}
```

container 字段：`id`（必填，`container:<localId>`）、`name`、`brief`、`type`（固定字符串 `"container"`）、`contents: Array<{ ref, count? }>`（ref 指向 item 或嵌套 container 实体；count 缺省 1，负数或 0 视为无效）、`status?`（可选，与 character status 数组形态一致）、`extensions?`。容器只表达持有/收纳，不表达穿戴；装备中的物品仍应出现在角色持有的某个容器里。不设容量字段；contents 只存 ref+count，不冗余子物品 name/brief（展示时按 ref 回读实体权威）。嵌套 container 允许（书箱内套锦囊），需要判断是否持有某件装备时递归展开，并避免循环引用。

```json
{
  "id": "item:清心丹",
  "name": "清心丹",
  "brief": "外门发放的低阶疗伤丹，回气去乱。",
  "type": "consumable",
  "tags": ["丹药", "疗伤"],
  "extensions": {
    "药力": { "render": "progress", "value": 30, "max": 100, "tone": "success" }
  }
}
```

item 字段：`id`（必填，`item:<localId>`）、`name`、`brief`、`type`（取值 `equipment`/`material`/`consumable`/`special`/`other` 五类之一；未知或不便归类写 `other`）、`tags?: string[]`（自由标签，用于列表分组或详情标签）、`equipment?: { slot?: string; mods?: Record<string, string>; effects?: string[] }`、`extensions?`（承载新增/临时可见字段，如药力进度、耐久、附魔层数；沿用 extensions 展示方式）。物品自身不存 `quantity`：数量由持有者 container.contents[*].count 表达。物品也不存 `status`：品相变化直接改 name/brief 或用 extensions（如 `{ 破损度: { render: 'progress' } }`），不再区分 status/extensions 两条路径。

type 五类的语义指引：`equipment` 装备武器护甲等可佩戴/持握；`material` 材料矿石药材等制作/交易素材；`consumable` 消耗品丹药符箓一次性道具；`special` 剧情关键物任务物证；`other` 上述都不合适的杂项。归类不清时写 `other`，不发明第六类。`equipment` 只是说明物品可装备，不表示已经装备；谁正在使用它写在角色 `equipment`。

### 装备栏与装备刷新

角色装备栏直接写在 character entity：

```json
{
  "equipment": {
    "武器": {
      "ref": "item:玄铁剑",
      "applied": { "体魄": 2, "法力": 1 }
    },
    "护甲": { "ref": null },
    "饰品·左": { "ref": "item:聚灵玉佩", "applied": { "法力": 3 } },
    "饰品·右": { "ref": null }
  }
}
```

装备栏只记录“这个角色当前把哪件持有物作为哪个槽位的装备使用”。槽位由当前游戏数据动态定义，不预设通用人体槽位；保持 JSON key 原始顺序。装备不会从行囊、剑匣、储物袋等容器中移出；角色必须能从自己的 `containers` 递归找到该装备 ref。若装备 ref 不再由该角色持有，刷新装备时视为失效：撤销旧 `applied`，将该槽位写为 `{ "ref": null }`。不检查其他角色是否也引用同一个 item ref。

装备物品在 item entity 中写 `equipment`：

```json
{
  "id": "item:聚灵玉佩",
  "name": "聚灵玉佩",
  "brief": "温润玉佩，能缓慢聚拢周身灵气。",
  "type": "equipment",
  "tags": ["玉佩", "灵器", "饰品"],
  "equipment": {
    "slot": "饰品·左",
    "mods": {
      "法力": "*=1.2",
      "悟性": "+=floor(根骨 * 0.15)",
      "气运": "=max(气运, 8)"
    },
    "effects": [
      "修炼时更容易感知周围灵气流动",
      "在灵气充沛之地效果更明显"
    ]
  }
}
```

- `slot`：建议槽位名，不是平台强制约束；若当前角色装备栏采用对应槽位，可写同一自然名称。角色实际有哪些槽位只由该角色 `equipment` 的 key 决定。
- `mods`：属性影响。key 是属性名；value 必须是 `+=`、`-=`、`*=`、`=` 开头的字符串。
- `effects`：叙事效果，不自动改变数值。条件性、世界观性、战斗姿态等难以稳定量化的影响写在这里。

`mods` 写法：

```json
{
  "体魄": "+=2",
  "气运": "-=1",
  "法力": "*=1.2",
  "魅力": "=max(魅力, 10)",
  "悟性": "+=floor(根骨 * 0.15)"
}
```

- `+=表达式`：当前属性增加表达式结果。
- `-=表达式`：当前属性减少表达式结果。
- `*=表达式`：当前属性乘以表达式结果，`applied` 记录新旧差值。
- `=表达式`：当前属性设为表达式结果，`applied` 记录新旧差值。

`mods` 是供 Stage Manager 解释的 Agent-facing 规则，不是平台可执行 DSL。表达式中可直接使用当前维护基线里的属性名，如 `体魄`、`悟性`、`根骨`、`法力`。有限函数只用 `floor`、`ceil`、`round`、`min`、`max`、`abs`、`clamp`。不要写裸数字、裸公式或对象式 modifier；所有 mods 都用上面的运算符字符串。平台没有 modifier 求值器，前端只读取维护后的投影。

装备刷新规则：只有在装备、装备规则、角色属性或持有关系明确变化且所需上下文完整时，Stage Manager 才做一次完整角色投影维护。先从当前 `attributes` 撤销所有槽位旧 `applied` 得到基线；再验证每个非空 ref 可从角色 `containers` 递归到达且 item 的 `type` 为 `equipment`；然后按 `character.equipment` 的 JSON key 顺序解释合法 mods。每一步写回属性时取 `round` 后的整数，最低为 0，并把该槽实际整数差值写入新 `applied`。不可达 ref 撤销旧贡献后改成 `{ "ref": null }`。同一角色的 `attributes` 与整张 `equipment` 投影应一起写回；任一规则、属性引用、维护基线或持有关系无法确定时，保持旧投影，不猜测也不写部分结算结果。这里约定的是 Stage Manager 行为，不表示平台提供确定性求值器或数据库事务；已有存档也不会自动迁移或由模板覆盖 living schema。


## extensions

`extensions` 是动态玩家可见字段，子 key 可用中文；值内 `render` 只接受 `text`、`number`、`progress`、`tag`、`tags`、`list`、`section`、`ref`、`cards` 等已知 preset。省略 `render` 时可按普通文本展示 `value`；显式值未知时，消费者必须记录警告并隐藏该字段，不得静默降级成 text 或其他展示方式。固定的角色、装备、容器、关系事实不要藏进 extensions。

## 受控词表

### visibility

```text
player-known      # 玩家面向的叙述/界面安全；省略时默认
hidden            # 玩家当前看不见，但背景 Agent 可用
future-spoiler    # 未来的原著信息；不要泄露进玩家面向的叙述
```

### lifecycle

```text
candidate    # 已抽取但尚未确认重要
active       # 当前可在游玩中使用
background   # 作为背景存在但非当前焦点
retired      # 已退出当前游玩，除非刻意重新引入
```

## Runtime 变量

`save/playthrough/runtime.json` 存放高频访问、玩家面向或界面需要高频读取的摘要。`worldTime` 是当前世界/剧情时间的固定字符串字段；它不是平台墙钟时间，也不用于日历运算。`plotOrder` 是数字字段，单调递增，表示玩家当前走到哪个 source order；场记每回合读 frontier.json timeline 映射维护，用于判断是否触发 frontier 推进（`plotOrder > 最后 source 锚点 order` 时触发）。未知或尚未建立时写空字符串/0。

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
    "月相": { "render": "text", "value": "上弦" },
    "护山阵倒计时": { "render": "number", "value": 3, "unit": "刻" }
  },
  "updatedAtTurn": 6,
  "updatedBy": "stage-manager"
}
```

`activeSceneRefs` 是当前活跃场景指针数组（每项 `{ ref, name }`）；场景内容权威在 `save/scenes/<id>.json`，runtime 只存指针。`protagonistRef` 是当前主角指针（`{ ref, name }`），主角实体权威仍在 `save/entities/character/<localId>.json`。`location` 是当前地点指针 `{ ref, name } | null`。`weather` 是当前天气字符串。`plotOrder` 是数字，单调递增，表示玩家当前走到哪个 source order；场记每回合读 frontier.json timeline 映射维护，用于判断是否触发 frontier 推进。`extensions` 仍用于月相、倒计时、诅咒周期、节气规则等新增/临时时间机制；当前世界/剧情时间本身写 `worldTime`，剧情进度坐标写 `plotOrder`。

## frontier.json

`save/playthrough/frontier.json` 记录源文本抽取进度与时间标记锚点，供场记维护剧情坐标，并供界面与正文上下文展示原著剧情节点。

```json
{
  "sourceWindow": { "start": 1, "end": 8, "chapters": [{ "index": 1, "title": "第 1 章", "ref": "source:chapter-0001" }] },
  "extractedThrough": "source:chapter-0008",
  "timeline": [
    { "kind": "source", "order": 1, "chapter": 1, "time": "元年", "label": "开局" },
    { "kind": "source", "order": 2, "chapter": 4, "time": "二年春", "label": "离山历练" },
    { "kind": "player", "order": 2, "turn": 8, "time": "二年春", "label": "提前离山", "alignment": "diverged", "sourceRef": 2 }
  ],
  "notes": "Track how far the imported source has been normalized, chunked, and extracted.",
  "updatedAt": "2026-07-07T00:00:00.000Z",
  "updatedBy": "world-architect"
}
```

字段：

- `sourceWindow`：已读章节窗口。`start`/`end` 为章节号（闭区间），`chapters` 为窗口章节元信息数组（每项 `{ index, title, ref }`）。推进 frontier 时移动。
- `extractedThrough`：已抽取到的最远源章节引用；缺省取窗口末章 ref。
- `timeline`：时间标记锚点数组，用 `kind` 字段区分两类锚点：
  - source 锚点：`{ kind: "source", order, chapter, time, label }`。world-architect 推进时建立，标记原著剧情节点。
    - `order`：单调递增整数，是我们建立的线性坐标轴，表示剧情事件先后顺序，与原著精确时间标记无关。即使原著写“回到过去”，`order` 也严格递增——`time` 字段可能变化，但 `order` 只向前。source 锚点 order 由 world-architect 推进时递增赋值。
    - `chapter`：原著章节号，与 `sourceWindow` 同一坐标。
    - `time`：游戏时间字符串，自由粒度（默认年+季/月）。原文无明确时间词时从剧情推断估计；开局第一个锚点 `time` 固定 `"元年"`。
    - `label`：一句话客观标签，不是剧情摘要。
  - player 锚点：`{ kind: "player", order, turn, time, label, alignment, sourceRef }`。stage-manager 维护时追加，标记玩家视角显著事件。
    - `order`：等于玩家当前所在 source 区间的起始 source 锚点 order。同一 source 区间内的多个 player 锚点共享相同 order，按 turn 排序展开。
    - `turn`：游戏回合号，分支内排序与后续精确找 turn 正文用。
    - `time`：游戏时间字符串（显示用）。
    - `label`：一句话客观描述。
    - `alignment`：标记与原著关系，取值 `diverged` / `rejoined` / `aligned`。
    - `sourceRef`：关联的 source order（number 或 null）。语义见下表。

  `alignment` 三值语义：

  | 值 | 含义 | sourceRef | 建立时机 |
  |---|---|---|---|
  | `diverged` | 玩家偏离原著 | 分叉自的 source order，或 null（原创区间） | 玩家从 source 事件分叉，或在原创区间发生显著事件 |
  | `rejoined` | 从分支并回主干 | 并回的 source order | 玩家重新遇到 source 事件且结果相近 |
  | `aligned` | 经历 source 事件且结果相近 | 该 source order | 可选——完美跟随时不需要建，source 锚点本身代表那段故事 |

  stage-manager 只在有意义的时刻建 player 锚点：偏离、并回、或经历 source 事件但结果不同（此时用 `diverged` + sourceRef，表示遇到了同一事件但走了不同方向）。
- `notes`：抽取进度备注。
- `updatedAt` / `updatedBy`：维护锚点。

`timeline` 与 `sourceWindow` 独立：`sourceWindow` 记录已读窗口，`timeline` 记录锚点。推进时 `sourceWindow` 移动、`timeline` 追加新 source 锚点。两者通过 `chapter` 字段关联。`runtime.plotOrder` 是判断是否触发 frontier 推进的剧情进度坐标，等于玩家当前走到的 source 锚点 order。

## Turn recall metadata

`save/history/turns/turn-NNNNNN.json` 的正文 timeline 是历史正文权威。`meta.recall` 是场记维护的派生导航层，用于正文 Agent 按旧事件细节召回 turn；可覆盖重写，可从正文和存档重新生成，不改变 turn 正文语义。

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

字段：

- `schema`：固定 `沉浸阅读器.turn-recall.v1`。
- `剧情坐标`：对应当前 `runtime.plotOrder`，能判断时填写；可省略。
- `时间`：世界/剧情时间可读文本；可省略。
- `涉及实体`：实体 ref 数组（`<type>:<localId>`），只放未来召回最有价值的实体；通常不写主角，除非召回目标是主角重大选择、承诺、身份或伤害。未知非实体概念放 `标签`，不要硬猜 ref。
- `事件类型`：受控枚举：`对话交流`、`玩家选择`、`冲突争执`、`关系变化`、`承诺亏欠`、`秘密揭露`、`发现线索`、`物品变化`、`状态变化`、`场景变化`、`战斗危险`、`计划目标`、`交易谈判`、`亲密暧昧`、`伏笔回收`。
- `标签`：自由短词/短语，记录非实体检索线索、主题、承诺、误会、物件名、关键动作等；不要写文学化空泛词。
- `摘要`：一句客观剧情摘要，供候选快速判断和文本匹配。

## 场景分片格式

```json
{
  "id": "scene:山门冲突",
  "name": "山门冲突",
  "location": { "ref": "location:青玄门山门", "name": "青玄门山门" },
  "present": [
    { "ref": "character:萧玄" }
  ],
  "status": "active",
  "updatedTurn": 0,
  "updatedBy": "world-architect"
}
```

## Schema Patch Markdown 模板

```md
# Schema Patch: 增加宗门贡献点

Status: pending
Decision: player-required
Proposed by: stage-manager
Reason: 新章节出现“宗门贡献点”，看起来会持续影响角色行动和资源兑换。

## 拟议变更

- 为 `character` entity 增加可选字段：`progression.contributionPoints`。
- 默认不存在；不存在表示未知或不追踪。
```
