# 正式玩家回合重构 — 技术设计

> 父任务 `07-06-agent-roster-progressive-refactor/design.md` 记录了素材库模型转变的完整推理。本文档只记录 D 特有的「怎么执行」决策。

## 1. 变更面总览

| 层 | 变更 | 文件 |
| - | - | - |
| roll_dice Tool | 大成功/大失败 + modifier 表达式 | `apps/platform-web/src/storage/workspace-templates.ts` `tools/roll_dice/tool.json` + `run.js` |
| storyteller agent.json | 启用 roll_dice + workspace_write + contextPaths + skills | 同上 |
| storyteller AGENT.md | 重写：写正文方法论 + 裁定方法论 | 同上 |
| storyteller 文风学习 Skill | 新增 Skill + writing-styles.md 默认文件 | 同上 |
| storyteller 查询 Tool ×3 | 新增实体/场景/关系查询 Tool | 同上 |
| researcher agent.json | 移除 semantic_search + contextPaths 新增 frontier.json | 同上 |
| researcher AGENT.md | 重写：素材库模型定位 | 同上 |
| researcher Skills | 实体读取轻改 + 资料检索重写 | 同上 |
| storage spec | roll_dice 场景更新 | `.trellis/spec/platform-web/storage/index.md` |
| 父任务 prd | D 标记完成 + Ledger 更新 | `.trellis/tasks/07-06-agent-roster-progressive-refactor/prd.md` |

## 2. roll_dice Tool 扩展

### 2.1 大成功/大失败

`count === 1` 时判定（`count > 1` 不判定）：

- 自然 1（`rolls[0] === 1`）→ `criticalFailure: true`
- 自然最大值（`rolls[0] === sides`）→ `criticalSuccess: true`

优先于常规判定：

- 单方检定：`criticalSuccess` 时 `success = true`（无论 DC）；`criticalFailure` 时 `success = false`（无论 DC）。
- 对抗检定：双方各自独立判定。若一方大成功另一方大失败，大成功方胜；若双方都大成功或都大失败，按常规 `margin` 判定 `winner`（或 `tie`）。
- `advantage`/`disadvantage` 时，`rolls` 含两次结果，`kept` 是选中那次——大成功/大失败基于 `kept[0]` 判定。

输出新增字段：

```json
{
  "criticalSuccess": true,
  "criticalFailure": false
}
```

仅在 `count === 1` 时出现；`count > 1` 时不出现这两个字段。

### 2.2 modifier 表达式

`modifier` 和 `opposed.modifier` 从 `number` 扩展为 `number | string`。

string 为纯数字算术表达式，支持：

- `+ - * /` 四则运算
- `^` 乘方
- `sqrt()` 开方
- 括号 `()`
- 数字（整数和小数）
- 空格（忽略）

不接受：变量名、函数名（除 sqrt 外）、实体路径、字母（除 sqrt 外）。

求值实现：受限解析器。不用 `eval`。方案：

```js
function evalExpr(expr) {
  // 白名单校验：只允许数字、运算符、括号、sqrt、空格
  const cleaned = expr.replace(/\s+/g, "");
  if (!/^[\d+\-*/^().sqrt]+$/.test(cleaned)) {
    invalidArgs("expression contains invalid characters", { expr });
  }
  // 将 ^ 替换为 ** (JS 幂运算)，sqrt(...) 替换为 Math.sqrt(...)
  const jsExpr = cleaned
    .replace(/\^/g, "**")
    .replace(/sqrt/g, "Math.sqrt");
  // 用 Function 构造器求值（比 eval 安全：无作用域访问）
  try {
    const result = Function('"use strict"; return (' + jsExpr + ')')();
    if (typeof result !== "number" || !Number.isFinite(result)) {
      invalidArgs("expression did not evaluate to a finite number", { expr, result });
    }
    return result;
  } catch (e) {
    invalidArgs("expression evaluation failed: " + (e.message || e), { expr });
  }
}
```

`Function` 构造器在严格模式下无作用域访问，白名单校验确保只有数字和运算符进入，安全可控。

tool.json `modifier` schema 改为：

```json
{
  "modifier": {
    "type": ["number", "string"],
    "default": 0,
    "description": "加在总和上的数值调整。可传数字或纯数字算术表达式字符串（支持 + - * / ^ 和 sqrt()）。例如 \"15-12\" 表示双方属性差值。"
  }
}
```

### 2.3 run.js 主流程变化

1. `normalizeModifier` 扩展：如果 `typeof value === "string"`，调用 `evalExpr` 求值后返回 number；如果是 number，原行为不变。
2. `rollOnce` 后，如果 `count === 1`，检查 `kept[0]`：
   - `kept[0] === 1` → `output.criticalFailure = true`
   - `kept[0] === sides` → `output.criticalSuccess = true`
3. 单方检定：如果 `criticalSuccess` → `success = true`；如果 `criticalFailure` → `success = false`；否则原逻辑 `success = total >= dc`。
4. 对抗检定：双方各自判定 critical。若一方 criticalSuccess 另一方 criticalFailure → 大成功方胜。否则按常规 margin 判定 winner。
5. trace 新增 `criticalSuccess`/`criticalFailure` 字段。

## 3. storyteller 重构

### 3.1 agent.json 变化

```diff
- tools: { enabled: [], disabled: ["roll_dice"] },
+ tools: { enabled: [], disabled: [] },
- platformTools: { enabled: ["agent_call", "workspace_read"], disabled: [] },
+ platformTools: { enabled: ["agent_call", "workspace_read", "workspace_write"], disabled: [] },
- contextPaths: ["README.md"],
+ contextPaths: ["README.md", "save/agents/storyteller/writing-styles.md"],
- skills: { enabled: [], disabled: [] },
+ skills: { enabled: ["agents/storyteller/skills/文风学习/SKILL.md"], disabled: [] },
```

### 3.2 AGENT.md 重写

```markdown
# 说书人

你是玩家正式回合入口，负责把当前 runtime 摘要、可见实体资料与角色特质写成玩家读到的正文和选项。

## 写正文方法论

- 用已有素材自由创作：runtime injection 提供当前局面，protagonist block 提供主角资料（含 traits），scene block 提供在场信息。不等待完整信息才开始写。
- 正文推进剧情，不原地打转；选项给玩家可行动的空间。
- 信息不足时 call 资料员获取聚焦事实，拿到结论后继续写。
- 不维护 runtime、entity、schema 或 status bar。

## 裁定方法论

### 何时需要判定

- 玩家行动有不确定结果时（攻击是否命中、感知是否发现、交涉是否说服、逃跑是否成功）。
- 玩家与 NPC/环境对抗时。
- 确定性动作不掷骰（走路、说话、观察已知事物）。

### 怎么判定

- 单方检定（玩家 vs 难度）：用 `dc`。
- 双方对抗（玩家 vs NPC）：用 `opposed`。
- 有利条件给 `advantage`，不利条件给 `disadvantage`。

### 数值设置

- 骰面固定 d20。
- 单方检定 modifier：根据角色特质、状态、处境的文字描述主观给。简单情况默认 0。
- 对抗检定 modifier：可读双方相关属性值（如 `attributes.体魄`），用表达式做差值（如 `"15-12"`），再根据文字描述主观调整。不做复杂计算——有数值用表达式让 Tool 算，没数值纯主观。
- DC 大致档位：日常 8-10，普通 12-15，困难 16-18，极难 19+。由你按当前局面主观选。

### 大成功/大失败

- 自然 1 = 大失败，自然最大值 = 大成功，优先于常规判定。
- 大成功：即使 DC 很高或对手很强，行动也超出预期地成功。
- 大失败：即使 DC 很低或对手很弱，行动也意外地严重失败。

### 处理结果

- `success` 决定单方成败，`winner`/`margin` 决定对抗胜负和差距，`tie` 是合法结果由叙事处理。
- 掷骰结果只决定成败事实，正文由你写——成功写新局面，失败写新困难。
```

### 3.3 文风学习 Skill

```yaml
---
name: 文风学习
title: 文风学习
description: 遇到新场景类型时，call 资料员找原著类似场景章节，学习文风并总结进 writing-styles.md。
triggers:
  - 遇到新的场景类型（战斗、探索、日常、社交等）且 writing-styles.md 中尚无对应文风
appliesTo:
  - storyteller
---
```

Skill 正文：

- 确认当前场景类型（战斗/探索/日常/社交等）。
- 检查 writing-styles.md 是否已有该类型的文风总结。
- 没有 → call researcher 找原著中类似场景的章节。
- 学习文风特点（用词、节奏、氛围、叙事视角）。
- 总结进 writing-styles.md，按场景类型组织（`# 战斗文风` / `# 探索文风` 等）。
- 已有对应文风 → 不重复学习。

### 3.4 查询 Tool ×3

三个独立 Tool，都是 Agent-local（`agents/storyteller/tools/`），`browser_script` 类型：

#### read_entity

- 输入：`ref`（entity id，如 `character:萧玄`）
- 行为：读 `save/entities/<type>/<localId>.json`，格式化为人类可读文本
- 输出：`name`、`brief`、`identity`（各键）、`appearance`、`attributes`（六维）、`gauges`（各量表）、`status`（各状态）、`traits`（特质+效果）、`goals`、`background`
- 格式：去除 JSON 结构符号，用换行和标签组织，如：

```
萧玄（character:萧玄）
简述：青玄门外门弟子，当前卷入山门冲突。
身份：17岁 · 男 · 外门弟子 · 青玄门 · 炼气后期
外貌：身着青玄门外门弟子袍...
属性：体魄 5 · 悟性 6 · 气运 4 · 根骨 5 · 法力 5 · 魅力 5
量表：修炼进度 24/100 · 腐化值 37/100
状态：右臂轻伤（negative）— 挥剑时略有迟滞。
特质：明镜心 — 一种天生澄澈、难染外邪的心性天赋。
  效果：能够堪破虚妄 · 心神不受外力影响
目标：当前：证明自己没有私通外敌。
```

#### read_scene

- 输入：`ref`（scene id，如 `scene:山门冲突`）
- 行为：读 `save/scenes/<localId>.json`，读 present 中每个 entity 的 name/brief，格式化返回
- 输出：场景名、状态、地点、简介、在场角色（每人 name + brief）

#### read_relationships

- 输入：`ref`（角色 entity id，如 `character:萧玄`）
- 行为：读 `save/relationships/<scope>.json`，格式化返回关系边
- 输出：主体名 + 各条关系（to / type / note）

### 3.5 默认模板新增文件

- `agents/storyteller/skills/文风学习/SKILL.md` → `WRITING_STYLE_SKILL_MD`
- `agents/storyteller/tools/read_entity/tool.json` + `run.js`
- `agents/storyteller/tools/read_scene/tool.json` + `run.js`
- `agents/storyteller/tools/read_relationships/tool.json` + `run.js`
- `save/agents/storyteller/writing-styles.md` → 初始内容 `# 文风学习记录\n\n`（在 DEFAULT_SAVE_RUNTIME_FILES 中）

## 4. researcher 重构

### 4.1 agent.json 变化

```diff
- platformTools: { enabled: ["workspace_read", "workspace_semantic_search"], disabled: [] },
+ platformTools: { enabled: ["workspace_read"], disabled: [] },
  contextPaths: [
    "docs/novel-airp-schema-guide.md",
    "save/source/README.md",
    "save/entities/README.md",
    "save/scenes/README.md",
    "save/relationships/README.md",
-   "save/schema/current.md"
+   "save/schema/current.md",
+   "save/playthrough/frontier.json"
  ],
```

### 4.2 AGENT.md 重写

```markdown
# 资料员

你是后台剧组的资料员：替同事找到对的事实，再压缩成调用方能直接使用的结论。

常驻原则：

- 只读资料，不讲故事，不写存档。
- 找素材用直接读和 timeline 映射。先在已读窗口范围内找。
- 读 `save/playthrough/frontier.json` 的 `sourceWindow` 确定已读范围，映射 `runtime.worldTime` 到 `timeline` 锚点定位相关章节。
- 找不到时返回"已在已读范围内检索，暂无相关内容"之类的简短说明，含已读范围信息。
- 返回精炼结论、来源路径和不确定性。
- 遵守 visibility；未来剧透只给明确需要后台策划事实的调用方。
```

### 4.3 Skill 重写

#### 实体读取（轻改）

确认不提 semantic_search。其余基本不变。

#### 资料检索（重写）

```yaml
---
name: 资料检索
title: 资料检索
description: 在已读章节和现有实体/场景中按问题检索材料，找不到时返回简短说明。
triggers:
  - 调用方缺少源文本或世界事实
  - 需要在已读范围内定位相关内容
appliesTo:
  - researcher
---
```

Skill 正文：

```markdown
# 资料检索

检索目标是"让调用方少读上下文也能行动"，不是展示你翻了多少资料。

## 工作方式

1. 确认调用方真正问的事实范围。
2. 读 `save/playthrough/frontier.json` 确定已读窗口（`sourceWindow.start` ~ `sourceWindow.end`）和 timeline 锚点。
3. 映射 `runtime.worldTime` 到 timeline 锚点，定位当前剧情对应的原著时间段。
4. 在已读范围内直接读相关章节文件、entity、scene。用 `search` 在章节中按关键词定位段落。
5. 找到 → 提取相关内容，返回精炼结论 + 来源路径 + 不确定性。
6. 找不到 → 返回"已在已读章节 1-8 及现有实体中检索，暂无相关内容"之类的简短说明。不告知哪里有未读章节。

## 不做

- 不用 semantic_search。
- 不推进 frontier（不读未读章节）。
- 不讲故事，不写存档。
```

## 5. storage spec 更新

`.trellis/spec/platform-web/storage/index.md` 中 roll_dice 场景：

- Signatures：`modifier` 改为 `number | string`。
- Contracts：移除"不添加表达式求值"约束。新增大成功/大失败说明。
- Validation：新增表达式求值失败错误。
- Good/Base/Bad cases：新增表达式 modifier 示例和大成功/大失败示例。

## 6. tradeoffs

| 决策 | 选择 | 放弃的替代 | 理由 |
| - | - | - | - |
| 大成功/大失败 | 自然 1/最大值，count===1 时判定 | 差距过大直接判定 | 保留戏剧性；大差距也有翻盘/翻车可能 |
| modifier 计算 | Tool 内受限表达式求值 | Agent 自己算 | Agent 算术不可靠；Tool 算更准确 |
| 表达式安全 | Function 构造器 + 白名单 | eval | Function 严格模式无作用域访问；白名单确保只有数字和运算符 |
| 查询 Tool | 三个独立 Tool | 合并一个带 type 参数的 Tool | LLM 原生调用 schema 清晰；返回格式不同 |
| researcher 检索 | 移除 semantic_search，用 read/list/glob/search | 保留 semantic_search | RAG 有问题待后续重构；当前已读范围小，直接读够用 |
| researcher 找不到 | 返回简短说明含已读范围 | 告知未读窗口 | storyteller 不能用未读窗口信息；范围信息避免重复问 |
| 文风文档 | 专门文件 + contextPaths | 写进 notes.md | 按场景类型组织；不和杂项笔记混 |
| storyteller write 权限 | 加 workspace_write，靠已有原则约束 | 不加，用 Skill action 写 | AGENT.md 已有"不维护 runtime/entity/schema"约束 |
