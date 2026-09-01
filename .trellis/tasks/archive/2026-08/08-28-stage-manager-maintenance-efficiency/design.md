# 设计：场记回合后维护效率优化

## Spec 依据

本设计的关键取舍均可回溯到
`.trellis/spec/guides/airp-data-capability-design-principles.md`：

| 原则 | 应用于 | 结论 |
|---|---|---|
| **10** 卡内分发源是 AI 能力的验证边界 | 范围 · R1 | 「平台 template 停止维护后，不为卡内能力改动同步修改模板」→ 零平台改动，R1 在卡片侧修 |
| **8** 文档分层按读取频率 | R3 | 「每次操作都查 → 进常驻上下文，且保持精简」→ 四文件注入；schema-guide「偶尔查」→ 排除 |
| **3** 是否封装 skill 看往返次数 | 非目标 | 「一次能完成 → 别包」→ 场景 1 次 read 可达，不做 `read_scenes` |
| **1** 按频率 × 后果给能力 | R4 · R6 | 「失败返回可操作错误让 agent 修正重试」→ R4；「高频 × 可自纠 → 不限量供给」→ 不收窄原生权限 |
| **9** 每个字段必须有一个真实消费者 | R1 trace | trace 字段的消费者为开发者的分片立项判断，非装饰性审计字段 |
| **5** 无界增长应尽早分片 | R3 技术债 | **本设计已知违反**，理由与触发阈值见 `prd.md` R3 附带段 |

另参考 `.trellis/spec/guides/prompt-self-contained-and-tone.md` 与
`ai-facing-content-changes.md`（R2 / R3 措辞 / R6 的文档改写）。

## 范围

**全部改动落在卡片工作区内，平台侧零改动。**

路径前缀：`cards/沉浸阅读器.tsian-card/workspace/`

| 文件 | 需求 | 改动性质 |
|---|---|---|
| `tools/text_edit/run.js` | R1 · R4 | 逻辑 |
| `agents/stage-manager/agent.json` | R3 | 配置 |
| `agents/stage-manager/skills/回合后维护/workspace-map.md` | R2 · R5 | 文档 |
| `agents/stage-manager/skills/回合后维护/SKILL.md` | R6 | 文档 |
| `agents/stage-manager/AGENT.md` | R6 | 文档 |

不触碰：`json_edit`、`commit_turn_recall`、`query_entities`、`read_entities`、
`apps/platform-web/**`（含已废弃的 `workspace-templates/`）。

## R1 memory 校验不再被文件已有行阻塞

### 问题机制

`run.js` 中 memory 文件的校验分两处，职责不同但错误处理不一致：

| 函数 | 校验对象 | 无法解析时 | details 键 |
|---|---|---|---|
| `assertMemoryOperationLines` | **本次提交**的 append / replace 行 | `fail` | `editLine` |
| `validateMemoryLines` | **合并后完整文件**的每一行 | `fail` ← 问题所在 | `line` |
| `validateSeedTransitions` | 合并前后文件的 seed 状态 | `continue` | — |

`validateMemoryLines` 对全文中「像条目但解析失败」的行直接 `fail`。
`seeds.md` 自带的说明行 `- [伏笔描述] 状态: <planted|...>; 关联回合: N`
命中 `isSeedEntryCandidate`、解析失败于 `parseSeedLine` → **任何写入都被拖死**。

### 方案

`validateMemoryLines` 中两处 `if (!parsed) fail(...)` 改为 `continue`：

```js
// records 分支
if (!isRecordEntryCandidate(lines[i])) continue;
const parsed = parseRecordLine(lines[i]);
if (!parsed) continue;          // 原为 fail(TEXT_EDIT_RECORD_FORMAT_INVALID)

// seeds 分支
if (!isSeedEntryCandidate(lines[i])) continue;
const parsed = parseSeedLine(lines[i]);
if (!parsed) continue;          // 原为 fail(TEXT_EDIT_SEED_FORMAT_INVALID)
```

### 安全性论证

1. **写入侧校验强度不变。** 本次提交的 append / replace 行仍由
   `assertMemoryOperationLines` 严格 `fail`，格式错误的新内容依然写不进去。

2. **与同文件既有处理对齐，非发明新语义。** `validateSeedTransitions` 对
   `parseSeedLine` 返回 null 的行本就是 `continue`（`if (!parsed) continue`）。
   同一份代码里迁移校验宽容、格式校验严格，本身就是不一致；本改动是向已有的宽容侧对齐。

3. **序号连续性反而更准。** records 的 `expected = previous + 1` 依赖已解析条目序列。
   跳过无法解析的行意味着它不参与统计——这正确，因为它本就不是合法条目。
   （反例验证：第 5 行为坏行、第 6 行为 `[5]`，则 previous 停在 `[4]`、expected = 5，通过。）

4. **重复检测不受影响。** fingerprint 集合只收合法条目，坏行本就无 fingerprint。

5. **状态迁移检测不受影响。** 该逻辑在独立函数中，已是宽容处理。

### 可观测性

`tsian.trace('text_edit', {...})` 增加 `memory` 字段：每个被成功写入的 memory 文件一项；
本次调用未涉及 memory 文件时该字段不出现。

| 字段 | 含义 | 消费者 |
|---|---|---|
| `path` / `kind` | 文件路径与类型（`records` / `seeds`） | 区分同批写入的多个 memory 文件 |
| `entryCount` | 合并后文件的合法条目数 | 开发者判断是否触达分片阈值 |
| `charCount` | 合并后文件字符数 | 同上 |
| `closedCount` | seeds 专有：resolved + abandoned 条目数 | 对应 seeds 的分片阈值 |
| `skippedLines` | 合并后文件中「像条目但解析失败」的行数 | 开发者确认文件中是否存在脏行 |

前四项服务于 `prd.md`「R3 附带」段记录的分片阈值——使技术债的触发条件可被直接观察，
而非依赖记忆。各项均有明确消费者，符合 spec 原则 9。

**实施调整（相对本设计初稿）：** 初稿写的是三个扁平字段
`skippedMemoryLines` / `memoryEntryCount` / `memoryCharCount`。实现时发现两处缺口：
一次调用可同时写 records 与 seeds，扁平字段会相互覆盖；且 `prd.md` 给 seeds 的阈值是
「resolved + abandoned 累计 > 30」，只有 `entryCount` 无法判定。故改为 per-file 数组并补
`closedCount`，使两个阈值都能直接读出。统计由独立函数 `collectMemoryStats` 对最终文件内容
执行，不与 `validateMemoryLines` 的校验职责耦合。

### 覆盖范围

改动同时作用于存量存档与新建存档——存量存档中的说明行不再需要 `remove` 即可自愈。
平台模板中的说明行保持原样（模板已废弃，且改它对存量无效）。

## R2 workspace-map 文档修正

纯文档，两处：

1. **第 7 行位数注解**：`turn-00001.json` → `turn-000001.json`；
   明确开局回合 = `turn-000000`、玩家首回合 = `turn-000001`。

2. **新增 ref → path 转换规则小节**：

```
character:<localId>   → save/entities/character/<localId>.json
item:<localId>        → save/entities/item/<localId>.json
container:<localId>   → save/entities/container/<localId>.json
location:<localId>    → save/entities/location/<localId>.json
scene:<localId>       → save/scenes/<localId>.json
（角色关系分片）       → save/relationships/character-<localId>.json
```

该规则是 R3「不注入场景」决策的前置条件——Agent 需据此从
`runtime.activeSceneRefs[0].ref` 推出场景文件路径。

## R3 上下文注入

### 机制

`ContextPathEntry` = `{ path | template, role, position }`。
`position` 落点（见 `agent-runtime/index.ts` 消息序列）：

- `prelude` — system 之后、调用方信息之前。**背景层**，适合稳定不变的资料
- `runtime` — history 之后、turn-runtime 之前。**状态层**，适合每轮变化的文件
- `framing` — 序列末尾

读不到的 path 记入 `missingContextPaths` 并 `continue`，不抛错。

### 方案

`agent.json` 的 `contextPaths` 追加四条（用 `path` 型，无需拼接故不走 `{{file:}}` 宏）：

```jsonc
"contextPaths": [
  { "path": "agents/stage-manager/skills/回合后维护/workspace-map.md",
    "role": "user", "position": "runtime" },                      // 既有，保留
  { "path": "save/schema/current.md",        "role": "user", "position": "prelude" },
  { "path": "save/playthrough/runtime.json", "role": "user", "position": "runtime" },
  { "path": "save/memory/records.md",        "role": "user", "position": "runtime" },
  { "path": "save/memory/seeds.md",          "role": "user", "position": "runtime" }
]
```

`current.md` 用 `prelude` 而非 `runtime`：它是存档级 schema profile，跨回合稳定，
属背景资料而非每轮状态。其余三个每回合变化，归 `runtime`。

配置形态与废弃模板 `workspace-templates/agents/stage-manager.ts:140` 的对应四条一致
（历史验证）。

### 配套文档调整

注入生效后，`SKILL.md` 固定流程第 1 步的表述需同步：
从「用原生读取打开 runtime.json / current.md / records.md / seeds.md」
改为「基于上下文已注入的内容」，仅保留 turn 文件的读取指引。

此措辞与归档任务 `07-13-stage-manager-maintenance-round2` 采用的
「正面引导用注入内容，不加『不要 read』禁令」策略一致。

### 已知技术债：memory 无界增长

违反 spec 原则 5，本任务不解决——理由、触发阈值与分片方向见 `prd.md`「R3 附带」段。

本设计只承担其中的**可观测部分**：`text_edit` 在 trace 中输出 memory 文件的
条目数与字符数（实现见 R1「可观测性」），使阈值到达可被直接观察。

注入本身不加剧该问题：注入与 Agent 自行 `read` 的 token 成本等价（两者都全文进上下文
并逐轮重发），注入额外省一轮往返，**严格优于**读取方案。

## R4 text_edit 错误信息

### 现状

`run.js:131` 错误文案为 `"<file> edit lines must use the maintenance entry format."`，
不含正确格式。Agent 因此无法直接改对。

对照：同卡片 `commit_turn_recall` 在枚举校验失败时返回 `allowed` 数组，
本次 Agent 据此**一次修正成功**（两次失败均为一次性修复）。

### 方案

1. **定义格式常量**，records / seeds 各一组：

```js
const MEMORY_FORMAT_HINT = {
  records: {
    expectedFormat: "- [序号] <recall|scene|npc_action> 关键词: <简短关键词>; 摘要: <一句客观事实>",
    example: "- [1] recall 关键词: 王有信饶命; 摘要: 萧凌饶王有信一命，令其带话给萧瑞。",
  },
  seeds: {
    expectedFormat: "- [伏笔描述] 状态: <planted|developing|resolved|abandoned>; 关联回合: <整数>",
    example: "- [王有信带话回萧瑞] 状态: planted; 关联回合: 1",
  },
}
```

2. **`assertMemoryOperationLines` 的 `fail()` details 带入** `expectedFormat` 与 `example`。

   R1 之后 `validateMemoryLines` 不再 `fail`，故格式错误只可能来自本次提交，
   `editLine` 语义明确，无需再区分 `line` / `editLine`。
   （R1 与 R4 在此处形成合力：R1 消除了误导性错误源，R4 让剩余错误一次可修。）

3. 保持 `retryable` 与 `correction.focus` 不变，不改变调用方契约。

### 与 R1 的关系

R1 消除「文件已有行导致的失败」，R4 让「本次提交导致的失败」可一次修复。
两者共同覆盖 memory 写入的全部失败路径。

## R5 事件类型枚举文档化

15 个枚举值写入 `workspace-map.md` 的 `commit_turn_recall` 小节，并标注 `事件类型` 为**数组**
（本次 Agent 第一次失败即误传字符串）。

枚举值以 `agents/stage-manager/tools/commit_turn_recall/run.js` 的实际校验数组为准，
实施时读取确认，不从本文档转抄。

## R6 专用工具引导

### 表述策略

正向引导 + 失败回退，不加禁令、不收权限。

- **`SKILL.md` 第 3 步**：将「用 `query_entities` 筛选候选，再用 `read_entities`」
  从描述性表述改为明确的**首选路径指令**，并补充失败时回退原生 `read` 的许可。
- **`AGENT.md`**：工具说明段落同样点明实体 / 关系读取的首选工具。

### 设计取舍

刻意不采用「收窄原生工具权限」的硬约束：

1. 工具自身存在 bug 时（如 R1），硬约束使 Agent 失去自救路径 → 死锁。
   本次 Agent 正是靠原生 `read` 才最终定位到格式问题。
2. 「引导后仍绕开专用工具」是**可观测信号**，指向工具易用性问题，比硬堵更有信息量。

### 可观测性

效果无法在实施时验证，只能在后续真实回合中观察。
若引导后 Agent 仍绕开专用工具，该行为即构成「读取工具易用性不足」的证据，
作为后续工具优化任务的输入。此为刻意保留的观测窗口，非验收缺口。

## 验证策略

遵循项目既有约定：不建持久化测试套件，采用**按需活体检查**。

| 需求 | 验证方式 |
|---|---|
| R1 | 对含说明行的 `seeds.md` 直接 append 一条 seed → 一次成功 |
| R2 | 文档 review：位数、编号语义、ref→path 规则完整 |
| R3 | 真实回合中检查消息序列含四个文件内容；第 1 步无 read / list |
| R4 | 构造格式错误的 `text_edit` → 返回含 `expectedFormat` + `example` |
| R5 | 文档 review：15 个枚举值齐全、标注为数组 |
| R6 | 文档 review + 后续真实回合行为观察（不阻塞验收） |
| 整体 | 以同一份 turn-000001 数据重跑维护，对比基线 29 轮 / 70 次调用 |

`git diff --stat apps/` 应为空（验证零平台改动）。

## 风险

| 风险 | 缓解 |
|---|---|
| R1 放宽校验后写入脏数据 | 写入侧 `assertMemoryOperationLines` 强度不变；且与同文件 `validateSeedTransitions` 的既有宽容处理对齐 |
| R3 注入使每轮 prompt 增大 | 四个文件当前合计 < 2k 字符；与 Agent 自行 read 等价，净收益为正 |
| R3 改 SKILL 措辞后 Agent 仍去 read | 属 R6 观测范畴，不阻断；注入内容已在上下文，重复 read 只多一轮 |
| R5 枚举转抄失真 | 实施时从 `commit_turn_recall/run.js` 读取实际数组 |
| 卡片改动需重新打包才能分发 | 打包是发布动作（`npm run package:card`），不影响开发期验证 |
