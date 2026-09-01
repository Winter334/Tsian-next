# 场记回合后维护效率优化

## 背景

2026-08-28 对沉浸阅读器卡片一次真实的回合后维护请求（玩家回合 #1）做了全链路分析，结果：

- **29 轮 LLM 往返、约 70 次工具调用**，其中 **13 次失败或空结果**
- 实际有效信息约 8k token，累计消耗约 100 万 input token，**信息效率不足 1%**
- 单次最大浪费：为查 `records.md` 行格式，读取了 `tools/text_edit/run.js` 全文（19651 字符），该内容随后在 7 轮里被重复发送

根因分三类：**阻塞性 bug**、**上下文注入缺失**、**读取行为缺乏引导**。

### 与 `0a38b969` 重构的关系

本次问题多数可追溯到 2026-08-27 的提交 `0a38b969 fix(card): harden stage-manager post-turn maintenance`：

- 删除 `read_maintenance_context`（一次性聚合工具，原本一次调用即返回
  turnBody / runtime / activeScenes / entities / relationships / timeline）
- 改为 `query_entities` + `read_entities` 细粒度工具组
- 同时移除了 `agent.json` 的 `contextPaths` 条目
- 新增 `text_edit` 的 memory 行格式校验（+318 行）

聚合工具原本承担的「上下文供给」职责在重构后无人接手，`contextPaths` 又被清空，
Agent 只能自行 `list` + `read` 探索——这是 29 轮往返的结构性根因。
新增的 memory 校验又与既有的 `seeds.md` 说明行相撞，形成 R1。

因此 **R1 与 R3 的性质是「补重构遗留缺口」，而非新增能力。**

### 范围约束：零平台改动

`apps/platform-web/src/storage/workspace-templates/**` 已整体废弃（仅影响「创建新卡」路径，
当前卡片走打包上传创意工坊分发，不依赖玩家创建卡片动作），后续将由通用游戏卡模板取代。

**本任务所有改动落在 `cards/沉浸阅读器.tsian-card/workspace/` 内，不修改任何平台代码。**

## 目标

降低场记回合后维护的往返轮次与 token 消耗，并消除已确认的阻塞性 bug。

## 需求

### R1 修复 memory 文件校验被已有行阻塞（bug · 阻塞）

`tools/text_edit/run.js` 的 `validateMemoryLines` 校验的是**编辑合并后的完整文件**，
对每一行先判定「是否为条目」再解析，解析失败即 `fail`：

```js
isSeedEntryCandidate = /^- \[[^\]\n]+\] 状态: /   // 判定为 seed 条目
parseSeedLine        = /^- \[...\] 状态: (planted|developing|resolved|abandoned); 关联回合: (\d+)$/
```

存档中 `save/memory/seeds.md` 自带一行格式说明：

```
- [伏笔描述] 状态: <planted|developing|resolved|abandoned>; 关联回合: N
```

该行命中 candidate 正则、但因 `<尖括号>` 解析失败 → **任何对 `seeds.md` 的写入都被这行拖死**。

**后果：** 本次分析中 Agent 连续 2 次写入失败；错误 `details.line` 指向文件已有行，
Agent 误读为自己提交的内容有误，遂转去阅读工具源码（19651 字符）——这是本次最大的单次浪费。

**修复位置在卡片侧，不改平台模板。** 该说明行来自 `workspace-templates/files.ts`，
但该模板已废弃（仅影响「创建新卡」路径，当前卡片走打包分发）。且改模板对**存量存档无效**——
已创建的存档里那行仍在。卡片侧修校验可同时覆盖存量与新建。

对照：`records.md` 的同类说明行用反引号包裹，行首为 `` ` `` 而非 `- `，侥幸未触发。
即修复后该文件的校验行为也应保持一致。

**验收：** 对含说明行的 `seeds.md` 直接 `text_edit` 追加条目，一次成功，无需先 remove。

### R2 修复 turn 文件名位数矛盾（bug）

`agents/stage-manager/skills/回合后维护/workspace-map.md:7` 自相矛盾：

- 声明 `turn-NNNNNN.json`（6 位）
- 注解却写「NNNNN需替换为对应回合号，例如第一回合为turn-00001.json」（5 位）

实际文件为 `turn-000001.json`。本次 Agent 据此连续 2 次 read 失败，另花 3 轮 list 找路径。

注解中「第一回合」的编号语义也含糊（开局回合为 `turn-000000`，玩家首回合为 `turn-000001`）。

**一并补全 ref → path 转换规则。** `workspace-map.md` 目前只给出路径格式，未明写从 ref
推导路径的规则。R3 决定不注入场景文件后，Agent 需要从 `runtime.activeSceneRefs[0].ref`
（形如 `scene:重生清晨恶奴上门`）自行推出 `save/scenes/重生清晨恶奴上门.json`。
本次 Agent 推导正确，但这类「靠猜」的环节正是 R2 本身的失败模式，应显式消除。

需覆盖全部类型：

- `character:<localId>` → `save/entities/character/<localId>.json`
- `item:<localId>` / `container:<localId>` / `location:<localId>` → 同构
- `scene:<localId>` → `save/scenes/<localId>.json`
- 角色关系分片 → `save/relationships/character-<localId>.json`

**验收：** 位数与实际一致；开局回合与玩家回合的编号对应关系表述无歧义；
任一 ref 到文件路径的推导规则可从文档直接读出，无需推测。

### R3 补齐回合上下文注入

`agents/stage-manager/agent.json` 的 `contextPaths` 当前**只注入 `workspace-map.md`**。

平台注入机制已完备（`ContextPathEntry` 支持 `path` XOR `template`、`role`、
`position: prelude|runtime|framing`；`position: "runtime"` 明确定位为「每轮可能变化的状态文件」），
且 `macro-engine.ts` 支持 `{{file:路径}}` 与 `{{file:目录/*.ext?enabled}}` glob 宏。

归档任务 `07-13-stage-manager-maintenance-round2` 的 prd 已写明「基于上下文已注入的
records.md / seeds.md 内容维护」——**机制做了，配置没跟上**。

应注入（每回合必读、内容确定，无需 Agent 决策）：

| 文件 | position | 依据 |
|---|---|---|
| `save/playthrough/runtime.json` | runtime | 每轮变化的状态；Skill 第 1 步必读 |
| `save/memory/records.md` | runtime | 每轮追加；需知尾部序号才能续写 |
| `save/memory/seeds.md` | runtime | 每轮可能更新 |
| `save/schema/current.md` | prelude | Skill 第 1 步必读；稳定 profile，非每轮状态 |

**历史依据：** 废弃的平台模板 `workspace-templates/agents/stage-manager.ts:140` 保留了重构前的
配置，其中 `runtime.json` / `records.md` / `seeds.md`（position: runtime）与
`save/schema/current.md`（position: prelude）四条与上表完全一致——本需求属回归修复，
配置形态有历史验证。

（模板另有 `docs/novel-airp-schema-guide.md` 与两个 README，本任务不纳入：
schema-guide 体积大且 Skill 明确为「按需查阅」，README 为说明文档，价值低于占用。）

**不注入当前场景文件**（决策已定，理由如下）：

1. **信息高度重叠**：scene 的 `name` 与 `location` 在 `runtime.json` 中已完整存在，
   真正的增量只有 `present[]` 与 `extensions`。
2. **`present` 是索引而非内容**：其中全部为裸 ref（`{"ref": "character:萧凌"}`），
   Skill 自身即规定「`present` 只存 ref，展示信息回读实体权威」。注入后 Agent 仍须再读实体，
   省不掉后续跳转，只是把跳跃提前。
3. **`present` 必要但不充分**：本回合实际维护涉及 4 个角色，而 `present` 仅含 3 个
   （萧瑞不在场，却因「带话给萧瑞」产生关系边变更）。Agent 无论如何须自行判断维护范围。
4. **多场景时为负收益**：glob 全量注入会混入 resolved 旧场景，增加噪音与误判风险。

场景改由 Agent 按需读取（1 次 `read`，路径可从 `runtime.activeSceneRefs` 确定推导，
推导规则由 R2 补全）。

**注入判据（沉淀为通则）：注入「内容」，不注入「索引」。**
拿到即可直接使用的（runtime / records / seeds）注入；拿到后仍需再跳一次的（scene.present）
留给工具按需读取。

**验收：** 维护流程第 1 步不再产生任何 `read` / `list` 调用即可获得上述四个文件内容。

### R3 附带：memory 文件无界增长（记为技术债，本任务不解决）

`records.md` 每回合追加 1–3 条、`seeds.md` 的 resolved / abandoned 条目按 Skill 规定不删除，
两者随回合数线性增长（估算 100 回合约 300 条 ≈ 8k token）。

**显式声明：这违反 spec 原则 5「会无界增长的量一开始就按自然单元分片」**
（`.trellis/spec/guides/airp-data-capability-design-principles.md`），该原则明确反对
「拖延以后再拆」；与原则 8「高频常驻必须精简」亦有张力。

**本任务仍不解决，理由：**

1. 本任务性质是「补 `0a38b969` 重构留下的缺口」。分片属数据结构改造，需连带改
   `text_edit` 序号校验、Skill 写入指引与注入配置，范围翻倍且两个关注点纠缠。
2. 注入并未加剧该问题——注入与 Agent 自行 `read` 的 token 成本等价（两者都全文进上下文
   并逐轮重发），注入额外省一轮往返，仍**严格优于**读取方案。膨胀是既有问题，非本方案引入。

**触发阈值（达到任一即应立项分片）：**

| 文件 | 阈值 | 分片方向 |
|---|---|---|
| `records.md` | 条目数 > 100 或 文件 > 8000 字符 | 滚动归档，活跃文件保留近期条目 |
| `seeds.md` | resolved + abandoned 累计 > 30 | 已结伏笔归档，活跃文件只留未结 |

**阈值可观测（本任务顺带实现）：** `text_edit` 在 trace 中输出 memory 文件的当前条目数
与字符数，使阈值到达可被直接观察，而非依赖记忆。该 trace 有真实消费者——开发者据此判断
何时立项分片（符合原则 9 的消费者验证）。

Skill 已有「读取 records **tail**」的表述，说明设计时已意识到该问题；
`contextPaths` 缺 tail / 截断机制，一并留待分片任务。

### R4 text_edit 校验失败返回可操作的格式信息

`tools/text_edit/run.js:131` 的错误信息仅为
`"<file> edit lines must use the maintenance entry format."`，不含正确格式。

对照范例：同卡片的 `commit_turn_recall` 在枚举校验失败时直接返回 `allowed` 数组，
本次 Agent 据此**一次即修正成功**；而 `text_edit` 的两次格式失败共引发约 15 轮探索。

`records.md` / `seeds.md` 的格式校验失败时，应返回 `expectedFormat`（格式串）与一条合法示例。

同时需区分错误来源：`editLine`（本次编辑的行）与 `line`（文件已有行）语义不同，
错误信息应明确指出是哪一种，避免 R1 那类误导。

**验收：** 构造一次格式错误的 `text_edit`，返回结果包含足以直接改对的格式串与示例。

### R5 补齐 事件类型 枚举文档

`commit_turn_recall` 的 `事件类型` 接受 15 个枚举值（对话交流 / 玩家选择 / 冲突争执 / 关系变化 /
承诺亏欠 / 秘密揭露 / 发现线索 / 物品变化 / 状态变化 / 场景变化 / 战斗危险 / 计划目标 /
交易谈判 / 亲密暧昧 / 伏笔回收），但未出现在 `workspace-map.md`、`SKILL.md` 或 `AGENT.md` 中。

本次 Agent 因此连续 2 次 `commit_turn_recall` 失败（第一次误传字符串，第二次枚举值不合法）。

**验收：** 枚举值可从注入上下文中直接读到，无需试错。

### R6 引导 Agent 优先使用专用读取工具

`SKILL.md` 第 3 步已写明「用 `query_entities` 筛选候选，再用 `read_entities` 读取选中实体和所需字段」
「不要读取整库或所有关系」，但本次 Agent **一次都没调用这两个工具**，改用 `list` + `read`
全量读取 7 个角色实体、7 个关系分片、3 个无关实体（紫星塔 / 丹田 / 小院，本回合均无变化）。

其中至少 8 次读取与本回合完全无关。若改用 `read_entities({refs, fields, relations})`，
14 次 read 可压缩为 1 次。

改为**正向引导 + 失败回退**的表述：明确指示优先调用专用工具，失败时才回退原生 `read`。

**设计意图（重要）：** 本需求刻意不采用「收窄原生工具权限」的硬约束方案。理由：

1. 工具自身存在 bug 时（如 R1），硬约束会使 Agent 失去自救路径，形成死锁
2. 「引导后仍绕开专用工具」本身是**可观测信号**，指向工具易用性问题，比硬堵更有信息量

**验收：** 后续真实回合中，实体与关系读取走 `query_entities` / `read_entities`；
若仍绕开，则将其作为读取工具易用性改进的输入证据。

## 非目标

- **不修改任何平台代码。** `apps/platform-web/**` 一行不动，含已废弃的 `workspace-templates/`
  （其中仍引用已删除的 `read_maintenance_context`，属已知遗留，不在本任务处理）。
- **不注入当前场景文件**（理由见 R3）。
- **不新增 `read_scenes` 工具。** 场景既不注入、也无多跳压缩需求——单场景读取路径可从
  `runtime.activeSceneRefs` 确定推导，1 次 `read` 即可。该工具仅在批量管理 background /
  resolved 旧场景时才有价值，当前需求强度不足。
- **不收窄 stage-manager 的原生工具权限**（理由见 R6 设计意图）。
- **不恢复 `read_maintenance_context`。** 细粒度工具组是 `0a38b969` 的既定方向，
  本任务补的是该方向下缺失的上下文供给，不回退架构。
- 不改动写入侧工具（`json_edit` 本次 6 次调用全部一次成功，设计健康）。
- 不解决 `records.md` / `seeds.md` 的长期线性增长（记为带阈值的技术债，见 R3 附带段；
  本任务仅实现阈值可观测）。

## 验收标准（整体）

1. R1 / R2 两个 bug 有可复现的验证步骤，且修复后不再复现
2. R3 注入生效：维护流程第 1 步获取 runtime / records / seeds / schema profile 零 `read` / `list`
3. R4 格式错误返回可直接改对的信息
4. R5 枚举可从上下文直接读到
5. R6 引导语落地到 `SKILL.md` / `AGENT.md`
6. 改动全部位于 `cards/沉浸阅读器.tsian-card/workspace/`，平台侧 diff 为空
7. 以同一回合数据重跑一次维护，往返轮次相对基线（29 轮）显著下降
