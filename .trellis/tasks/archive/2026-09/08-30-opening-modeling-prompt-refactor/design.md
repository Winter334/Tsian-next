# 技术设计：开局建模提示词重构与属性刻度规范

## 设计立场

这次的本质不是「重写开局流程」，而是**知识归位**：把散在 SKILL.md、schema guide、场记 workspace-map、Agent 临时工作笔记里的同一批知识，各自归到唯一出处，并确保世界架构师能读到。

流程本身（访谈 → 实体 → 场景关系 → 状态 → 发布）经真实运行验证是可用的，不改动其骨架，只做阶段合并与关卡加固。

## 文件布局与改动清单

```
cards/沉浸阅读器.tsian-card/workspace/          ← 随卡打包分发，改完即生效
├── docs/
│   ├── novel-airp-schema-guide.md          [改] 删仙侠境界表 → 换指针
│   └── 属性刻度规范.md                       [新增] 通用属性刻度规范
└── agents/world-architect/skills/开局建模/
    ├── SKILL.md                             [重写] 瘦身为流程 + 关卡
    ├── workspace-map.md                     [新增] 开局建模的 workspace 契约
    └── scripts/
        └── commit-opening-state.js          [改] 新增可选切入点锚点字段

apps/platform-web/src/storage/workspace-templates/
└── files.ts                                 [改] 仅 save/schema/current.md 模板文本
                                                  ← 存档仍靠自动创建，这是唯一必须动的平台代码
```

`agent.json` 不改动（见「为什么不走 contextPaths」）。新增卡内文件**无需**登记模板数组（见「分发模型与改动归属」）。

## 知识归位映射

改动前每类知识的出处，与改动后的唯一出处：

| 知识 | 改动前 | 改动后（唯一出处） | 消费方式 |
|---|---|---|---|
| ref → 文件路径 | 只在场记 `workspace-map.md`；架构师没有 | `开局建模/workspace-map.md` | 第一步主动 read |
| 关系分片完整性规则 | 只在场记 `workspace-map.md` | 同上 | 第一步主动 read |
| 实体字段口径 | schema guide + entities README + SKILL 零散复述 | schema guide（唯一），`workspace-map.md` 只给指针 | 按需 read |
| 属性刻度 | schema guide 的仙侠专用表 | `docs/属性刻度规范.md` | 实体阶段主动 read |
| **本存档**的世界观口径 | 无处可放（落进临时工作笔记） | `save/schema/current.md` | contextPaths 注入（已有） |
| 写手输出格式 | `output-format.md` + SKILL 复述（已漂移） | `output-format.md`（唯一），SKILL 不复述 | 写手自身注入 |
| 开局阶段流程与关卡 | SKILL.md | SKILL.md（唯一职责） | use_skill 加载 |

## 注入策略与预算

| 文档 | 消费方式 | 理由 |
|---|---|---|
| `workspace-map.md` | **主动 `read`**，SKILL 执行规则第一步与工作笔记并行读取 | 见下方「为什么不走 contextPaths」 |
| `属性刻度规范.md` | 主动 `read`，SKILL 在实体阶段要求 | 只在实体阶段用一次，frontier 推进用不上 |
| `save/schema/current.md` | 已在 contextPaths（`position: prelude`），不动 | 全链路共用的存档级口径 |

### 为什么不走 contextPaths

初版设计打算把 `workspace-map.md` 加进 `world-architect/agent.json` 的 `contextPaths`，与场记保持一致。否决理由是技术上的：

1. **frontier 推进用不上这张表**。该 skill 明确「不写 runtime、不写 player 锚点、不写 scene」，scene/relationship 路径对它是死重量。注入意味着每次 frontier 推进都白付这笔 token。
2. **实际往返增量≈0**。SKILL 执行规则第一步本来就要读工作笔记，`workspace-map.md` 与之并行读取即可，不新增往返轮次。注入换不来往返节省。
3. **常驻上下文小对长会话有实打实的好处**。世界架构师每次开局只调用 2~3 次，摊薄不了注入成本；场记每回合被调用、每次都要查路径，注入才划算。两者结论不同是合理的。

顺带一提，`assistant-runtime.smoke.test.ts:856` 恰好也以「resident context minimal」固化了同一结论——但那是旁证，不是本次决策的依据。若技术权衡指向相反方向，该改的是测试。

因此 `workspace-map.md` 放在 `agents/world-architect/skills/开局建模/` 下（与场记的物理布局一致），而非 Agent 级目录——因为「两个 skill 共用」的前提经查证不成立。

## 分发模型与改动归属

本卡的分发路径是：**直接改卡内文本 → 打包为游戏卡 → 上传创意工坊**。玩家拿到的是打包后的卡，不经过平台模板的自动创建。因此：

| 内容类型 | 分发方式 | 是否需要动平台模板 |
|---|---|---|
| 卡内容（`agents/**`、`docs/**`、`skills/**`） | 随卡打包分发 | **否**。`world-architect.ts` / `airp.ts` 里的模板登记与实际分发无关 |
| 存档（`save/**`） | **仍由平台自动创建** | **是**。必须改 `files.ts` |

据此，本任务只有一处**必须**动平台代码：`files.ts` 的 `save/schema/current.md` 模板文本。

（卡内文件仍通过 `?raw` 被平台模板 import，所以改已有卡内文件会顺带改变模板内容；但由于分发不依赖模板，这只影响测试断言，不影响玩家拿到的卡。）

### 实施修正：新增卡内文件确实不登记（曾走错一次）

实施中途一度把两个新卡内文件登记进了模板数组，理由是「新 SKILL.md 指令 Agent 去读它们，模板路径下缺文件会造成悬空指针」。**该理由不成立，已回退。**

`.trellis/spec/contracts/frontend/type-safety.md` 早已记录权威规则：

> Platform built-in card/workspace templates are currently unmaintained and must not receive feature synchronization.
> | Built-in template appears similar | Leave it unchanged unless a separate template-maintenance task explicitly reactivates it |
> Good: update `cards/….../SKILL.md` without copying it into a platform template.

模板本身无人维护，其中的悬空指针不是需要修的缺陷。「模板看起来也该同步」正是该 spec 明确预判并否掉的动机。

因此本任务对 `apps/platform-web/**` 的改动**只有一处**：`files.ts` 的 `save/schema/current.md` 模板文本。它落在 spec 允许的例外内——「Modify `apps/platform-web/**` only when the behavior is platform-owned, including automatic generation of save skeletons」，存档骨架确实由平台自动创建。

### 现有测试：跟着改，不迁就

`apps/platform-web/src/integration/assistant-runtime.smoke.test.ts` 通过 `?raw` 读取卡内文件并断言，因此卡内改动会触发它。**测试为开发让路**：断言挡路时改断言或废弃用例，不为了让测试变绿而扭曲提示词写法。

**待改断言**（`:878-881`，逐字 `toContain` SKILL.md 的句子）：

- `run_script.inputRefs.openingReply`
- `responseRef`
- `opening-interview:continue:<sessionId>`
- `不复制已在 workspace 中的实体、场景、关系或 runtime 全文`

这几条锁的是**措辞**而非**行为**，范围窄且必然随文案演进过期。处理原则：纯措辞类直接删除，协议标识类若新文案仍自然包含则保留。

### 实施结果：预测的四条一条没断

SKILL.md 全文重写后，`:878-881` 四条全部自然存活——新文案本就要保留这些协议标识（`responseRef`、`inputRefs.openingReply`、`continue:<sessionId>`），而末条「不复制…全文」在 §5 委派段仍是准确表述，没有理由改写。按「自然包含则保留」的分支处理，未删除。

**实际删除的是另外三条**（2026-08-30，经用户确认「这种断言不适合维护，删掉更好」）：

| 位置 | 断言 | 性质 | 处理 |
|---|---|---|---|
| `:901` | `enabledModules` 不含 `原作文风` | 锁一个**已被用户手动推翻**的卡默认值（`3da479b8` 提交信息明写 "Manual tuning of the shipped defaults"）。该断言在本任务开始前就是红的 | 删 |
| `:906` | `current.md` 长度 < 1000 | 锁常驻上下文体量，阈值随模板演进必然过期 | 删 |
| `:907` | `current.md` 含 `save-specific` | 锁英文文案，已被 D9/R6 有意推翻 | 删 |

保留 `:902-904`（写手的 `workspace_read`/`workspace_write` 可用性与 `workspaceAccess.level`）——那锁的是真实能力契约，不是措辞。

**未触发**：`:886` 的 action 顺序与名称断言（action 集合未变）；`contextPaths` 断言（未改 `agent.json`）；`runState` 未断言 `plotOrder` 值，新增可选字段安全。

**D1 的直接佐证**：`:1196-1198` 已有用例验证「无选项块的 `openingReply` → `OPENING_REPLY_PROJECTION_FAILED` / `choices.missing`」。这正是写手若遵从 SKILL 的 `[[选项]]` 指令会撞上的失败路径。**这条用例断的是真实行为契约，应当保留。**

## 属性刻度规范设计

### 三层结构

**第一层 · 绝对锚点**：普通成年人的每个维度 = 5。跨世界观不变，因为任何小说都存在「普通人」这个参照物。

**第二层 · 维度分类**（跨世界观通用）：

| 类别 | 含义 | 数值行为 | 例子 |
|---|---|---|---|
| 成长维 growth | 随力量体系上升而暴涨 | 跟档位曲线走，上不封顶 | 法力 / 斗气 / 内力 / 异能强度 |
| 天赋维 talent | 先天素质，与等级基本无关 | **恒定 1-15，任何世界观都一样** | 悟性 / 气运 / 魅力 |
| 混合维 hybrid | 天生 + 后天强化 | 温和增长，约为成长维的开方量级 | 体魄 / 体质 |

天赋维锁死 1-15 是让规范跨世界观成立的关键：凡人的魅力 9 和神的魅力 9 是同一个意思，跨等级仍可直接比较。只有成长维需要按世界观校准。

**第三层 · 档位曲线**。不给死数值表，给三档让架构师**选**：

| 档位 | 判据（读完原文问自己一句话） | 顶层 ÷ 普通人 | 成长维 | 混合维 | 每阶递增 |
|---|---|---|---|---|---|
| 平缓 | 最强的人会不会被十个普通人围殴打死？会 | 3-5x | 5 → 25 | 5 → 15 | ×1.3 |
| 中等 | 最强的人能单挑一支军队，但仍怕暗算？ | 20-50x | 5 → 250 | 5 → 60 | ×1.8 |
| 陡峭 | 最强的人一挥手能毁一座城？ | 1000x+ | 5 → 5000+ | 5 → 150 | ×2.5~3 |

适用示例（仅作定位参照，不写进规范正文）：平缓＝都市/权谋/写实历史；中等＝西幻/武侠/超能力；陡峭＝仙侠/玄幻网文。

### 阶梯映射方法

1. 从原文读出本书的等级序列（低→高），记 N 阶。
2. 选档位。
3. 成长维按该档递增率生成等比区间，逐阶分配。
4. 阶内细分等级（如「初玄境一级～十级」）在该阶区间内**线性插值**。
5. 偏离常态的角色（残废、天生神力）用相对基线的偏移表达，**不另起一套刻度**。

以本次的《逆天邪神》为例（10 阶、陡峭档、×2.5）：初玄 5-12 → 入玄 12-31 → 真玄 31-78 → 灵玄 78-195 → …。萧泠汐（初玄六级）≈9，萧澈（初玄一级且玄脉残废）取基线以下的 1-2，萧烈（灵玄十级）≈195。差值量级正确，掷骰对抗可用。

### 维度可变性护栏

- 4-8 维（少于 4 无区分度，多于 8 撑不住 UI 且稀释掷骰意义）
- 每维必须标注类别（growth / talent / hybrid）
- 至少 1 个成长维 + 至少 2 个天赋维，否则对抗退化为单维比大小
- 名称用中文并匹配世界观（西幻可用 力量/敏捷/体质/智力/感知/魅力；都市可用 体能/学识/人脉/财力/意志/魅力）
- 开局落盘后不再改名，避免存档兼容问题

### 自检判据（写进规范，架构师填完必须逐条过）

1. 同体系内等级不同的两个角色，成长维**必须**有可见差值
2. 所有天赋维落在 1-15
3. 路人角色六维接近 5
4. 顶层角色成长维 ÷ 5 接近所选档位倍率

判据 1 直接对应本次缺陷 D5（萧泠汐与萧澈法力同为 1）。

## `current.md` 骨架设计

模板从「偏差记录本」改为「本存档口径卡」。题材中性、中文、只给槽位不给内容：

```md
# 本存档世界观口径

Status: draft

本文件记录**本存档**的世界观口径与相对 `docs/novel-airp-schema-guide.md` 的偏差，
由世界架构师在开局建模的实体阶段前填写，后续由场记沿用。

## 力量体系阶梯
<!-- 本作的等级序列，低 → 高。无力量体系时显式写「无」。 -->
待填

## 属性档位与区间映射
<!-- 选用的档位（平缓/中等/陡峭）与各阶梯对应的成长维区间。见 docs/属性刻度规范.md。 -->
待填

## 六维定义
<!-- 每维的名称与所属类别（成长维/天赋维/混合维）。 -->
待填

## 世界观术语与称呼约定
<!-- 专有名词、称谓、计时方式等需要全链路统一的口径。可留空。 -->
待填

## 结构偏差
<!-- 仅在实际偏离通用 schema 时记录。无偏差则留空。 -->
- 实体 id/路径：`<type>:<localId>` → `save/entities/<type>/<localId>.json`
- 人物关系：`save/relationships/` 下按 subject 分片
```

**边界**：`files.ts` 是平台级共享模板，所有游戏卡新建存档都用它。因此模板只提供槽位与填写说明，不含任何题材内容。改动仅限该条目的模板字符串，不触碰模板加载/写入逻辑，也不动其他模板条目。

## SKILL.md 重构后的结构

```
开局建模 SKILL.md
├─ 会话协议（三种 user input 语义）        保留
├─ tsian-actions 声明                      保留
├─ 工作笔记模板                            改：补三栏
├─ 执行规则                                改：阶段合并 + 知识指针
├─ §1 恢复、取证与访谈                     保留，切入点快照规则移出
├─ §2 实体阶段                             改：前置 current.md 填写、切入点快照规则、指向属性刻度规范
├─ §3 场景与关系阶段                       改：修正误导措辞、补关系完整性规则、声明一次性锁定
│      （§2 §3 允许同一次 invocation 连做）
├─ §4 状态阶段                             改：补切入点锚点字段说明
└─ §5 首回合正文与发布                     改：删输出格式复述、核对改显式清单
```

SKILL 不再出现任何字段形状、路径字面量、数值刻度——这些一律指向 `workspace-map.md` / `属性刻度规范.md` / `current.md`。

### 关卡设计：§5 核对清单

改动前是段落中的一句软要求，无可观测产物，本次被完全跳过。改为必须逐条写出判定结果后方可 `publish_opening`：

1. 正文终点是否停在工作笔记记录的那个瞬间
2. 正文出现的人物/地点/物件是否都已落盘
3. 正文是否写入了切入点之后才成立的事实
4. 正文事实是否与实体权威一致（本次漏掉的「左手 → 右手掌心印记」属此项）
5. 选项是否为玩家角色下一步可执行的动作

任一条不过 → 重新委派；已提交资料有误 → 回对应资料阶段。

## `commit-opening-state.js` 接口变更

现状 `commit-opening-state.js:57` 写死 `plotOrder: timeline[0].order`，而 `order` 又在同一函数内被重排为 `index + 1`，因此 plotOrder 恒为 1。

变更：`input.frontier` 增加可选字段（如 `entryAnchorIndex`，1-based，指向 timeline 中玩家切入点所在锚点），落盘时 `plotOrder` 取该锚点的 order；字段缺省或越界时回退到现有 `timeline[0].order`。

- 校验强度不变，不新增失败路径（越界即回退而非报错）
- 旧调用完全不受影响
- SKILL §4 教架构师传该字段，脚本兜底
- **实施补充**：`frontierFile` 由 `{ ...input.frontier }` 展开而来，`entryAnchorIndex` 会被带进落盘的 `frontier.json`。它是纯输入字段（与 `sourceWindow.startIndex/endIndex` 同类），落盘前显式 `delete` 掉，避免污染存档并保持幂等比较的语义。

## 兼容性

| 场景 | 影响 | 处理 |
|---|---|---|
| 已有存档的 `current.md` 是旧模板 | 无新槽位 | SKILL 要求填写时若发现无槽位，整体重写该文件；这一点写进 SKILL |
| 已有存档已按旧境界表填了属性值 | 数值不符合新规范 | 不回溯修改（开局阶段已锁）。仅新开局适用 |
| `commit_opening_state` 旧调用形状 | 无 | 新字段可选 + 缺省回退 |
| 其他游戏卡新建存档 | `current.md` 变为新骨架 | 模板题材中性，对任何卡都成立 |

## 回滚

全部为文件级改动，`git revert` 即可。唯一有状态残留的是回滚后新建存档退回旧 `current.md` 模板——已建存档不受影响，无数据迁移。

## 取舍记录

| 取舍 | 选择 | 放弃的方案与理由 |
|---|---|---|
| 属性规范的表达形式 | 三档曲线 + 映射方法 | 放弃给死数值表：不同小说战力差距天差地别，死表必然对不上号，本次即因此瞎猜 |
| 属性规范的注入方式 | 主动 read | 放弃 contextPaths 注入：frontier 推进阶段用不上，每次调用都带是浪费 |
| `workspace-map` 的消费方式 | 主动 read（与工作笔记并行） | 放弃 contextPaths 注入：与 smoke test 固化的「常驻上下文最小」设计意图冲突，且实际往返增量≈0 |
| `workspace-map` 的归属层级 | 开局建模 skill 级 | 放弃 Agent 级：经查证 frontier 推进用不上 scene/relationship 路径，「两 skill 共用」前提不成立 |
| 阶段合并粒度 | 合并前两阶段 | 放弃合并前三阶段：单次输出体量过大（十余个实体 JSON + 场景 + 关系 + runtime/frontier），失败重试成本高 |
| plotOrder 修法 | 脚本可选参数 + 提示词驱动 | 放弃纯提示词：依赖模型遵守，不遵守时静默偏掉且无从发现 |
| 旧境界表处理 | 删表换指针 | 放弃保留作示例：两套数值共存，模型大概率仍去抄更具体的旧表 |
