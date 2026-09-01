# 正式玩家回合重构

## Goal

在素材库模型下重构正式玩家回合：storyteller 重写为具备裁定方法论、文风学习、快速查询能力的正文写作者；researcher 重写为不依赖 RAG、靠直接读 + timeline 映射在已读范围内检索的资料员；扩展 roll_dice Tool 支持大成功/大失败和简单计算表达式。

## Background / Confirmed Facts

### 父任务上下文

- 本任务是父任务 `07-06-agent-roster-progressive-refactor` 的子任务 D，Player Flow Map 步骤 2「正式玩家回合」。
- 依赖 B（导演/brief 移除 + timeline 建立）和 C（游玩设定步重构 + traits[]）均已完成。
- 父任务 design.md §4.3 A' 方案（前端检查边界触发 invokeAgent 推进 frontier）属子任务 E，不在 D 范围。D 只做 researcher 被 call 时在已读范围内的素材检索 + timeline 映射定位。researcher 不推进 frontier。
- 父任务原则：AGENT.md 写定位与方法论；SOUL.md 写人格底色不绑步骤；Skill 正文写流程；已处理 Agent 只按当前步骤补充。

### storyteller 现状

- `agent.json`：`contacts = ["researcher"]`，`contextPaths = ["README.md"]`，`skills.enabled = []`，`platformTools = ["agent_call", "workspace_read"]`，`tools.disabled = ["roll_dice"]`，`entryMode: "persistent"`，`system: true`。
- `AGENT.md`：玩家正式回合入口，读 runtime/schema/可见实体资料写正文和选项；信息不足 call 资料员；不维护 runtime/entity/schema/status bar；保持沉浸、克制剧透、保留玩家能动性。
- `SOUL.md`：临场说书人，从玩家当下视角铺陈，重视选择权。
- 无 Agent-local Skill。
- 上下文注入由前端 `buildContextInjection` 提供：runtime/world block + scene blocks + protagonist block（含 identity/appearance/attributes/gauges/status/traits/goals）。
- 正式回合通过 `tsian.send(text, { injection })` → 后端 `runAgentRuntimeTurn({ agentId: "storyteller", compressionMode: "narrative" })`。
- notes.md 通过 `assembleAgentContext` 自动注入；当前 `contextPaths` 只有 `README.md`。

### researcher 现状

- `agent.json`：`contacts = ["storyteller", "stage-manager", "world-architect"]`，`contextPaths` 含 schema-guide/source-README/entities-README/scenes-README/relationships-README/schema-current（不含 frontier.json），`platformTools = ["workspace_read", "workspace_semantic_search"]`（无 agent_call、无 write）。
- `AGENT.md`：后台资料员，只读不写，先明确问题范围再读 source/entity/scene/relationship/schema，返回精炼结论+来源路径+不确定性，遵守 visibility。
- `SOUL.md`：替同事省上下文窗口，找对材料压成一句能用的结论。
- 两个 Skill：`实体读取`（读 entity/scene/relationship 文件）+ `资料检索`（semantic_search + read source）。
- 未使用 timeline/frontier。

### roll_dice Tool 现状

- `tools/roll_dice/tool.json` + `run.js` 播种于 `workspace-templates.ts`。
- 支持 `sides`/`count`/`modifier`(number)/`dc`/`advantage`/`disadvantage`/`opposed`/`reason`。
- `dc` 与 `opposed` 互斥。`opposed` 返回 `margin`/`winner`。
- 所有 Agent `tools.disabled: ["roll_dice"]`。
- storage spec 明确写"不添加表达式求值"——本任务反转此约束。
- `modifier` 只接受 number，不支持 string 表达式。

### 正式回合生命周期

1. 玩家输入 → `useTsian.send()` → `buildContextInjection`（runtime + scenes + protagonist）→ `tsian.send(text, { injection })`。
2. 后端 `interaction.sendMessage` → 解析 `playerTurn = storyteller` → `runAgentRuntimeTurn`（narrative compression）。
3. storyteller 读 contextPaths + injection + persistent context.json；信息不足时 `agent_call` researcher。
4. researcher 在 DELEGATED guard 下只读运行，返回 observation 给 storyteller。
5. storyteller 写最终正文 + `[[选项]]` → 后端 strip options → 持久化 turn 文件 + 更新 context.json。
6. `onTurnEnd` → `triggerSyncAfterTurn` → `invokeAgent("stage-manager", ...)` 回合后维护（子任务 E）。

### 关键机制约束

- storyteller `entryMode: "persistent"`：context.json 跨回合累积，`compressionMode: "narrative"` 在接近 token budget 时触发压缩。
- researcher 无 `agent_call`：不能回调 storyteller或 call world-architect。`maxDepth: 2`，researcher 是叶子节点。
- frontier.json 的 `sourceWindow`（已读章节窗口）+ `timeline`（锚点数组 `{ chapter, time, label }`）已在 B 中建立。
- `workspace_read` 暴露 `read`/`list`/`glob`/`search` 操作，覆盖移除 semantic_search 后的检索需求。

## Requirements

### roll_dice Tool 扩展

- R1: 新增大成功/大失败：`count === 1` 时，自然 1 = 大失败（`criticalFailure: true`），自然最大值 = 大成功（`criticalSuccess: true`）。优先于 `success`/`winner` 常规判定——大成功时无论 DC 都算成功，大失败时无论 DC 都算失败；对抗时双方各自独立判定。`count > 1` 时不判定。
- R2: `modifier` 从 `number` 扩展为 `number | string`；string 为纯数字算术表达式，支持 `+ - * / ^`（乘方）和 `sqrt()`。Agent 从 context injection 读数值拼表达式，Tool 做计算。求值失败返回 `ROLL_DICE_INVALID_ARGS`。不接受变量名、函数名（除 sqrt 外）、实体路径。
- R3: `opposed.modifier` 同样扩展为 `number | string`。
- R4: 不改 `dc`/`opposed` 互斥、平局合法、`reason`、`advantage`/`disadvantage` 行为。
- R5: 更新 storage spec 中 roll_dice 场景的 Signatures / Contracts / Validation，移除"不添加表达式求值"约束。

### storyteller 重构

- R6: AGENT.md 重写，包含写正文方法论和裁定方法论：
  - 写正文方法论：用已有素材（runtime injection + entity + traits）自由创作，不受预设剧情方向约束；正文推进剧情不原地打转；选项给玩家可行动空间；信息不足 call 资料员。
  - 裁定方法论：何时需要判定（玩家行动有不确定结果时；确定性动作不掷骰）；怎么判定（单方 dc / 双方 opposed / advantage disadvantage）；数值设置（骰面固定 d20；单方 modifier 根据 traits/status/处境文字描述主观给，简单情况默认 0；对抗 modifier 可读双方属性值用表达式做差值如 `"15-12"`，再主观调整；DC 大致档位日常 8-10/普通 12-15/困难 16-18/极难 19+，主观选）；大成功/大失败（自然 1 和自然最大值优先于常规判定，有戏剧性后果）；处理结果（success/winner/margin/tie 决定成败事实，掷骰结果只决定成败正文由 Agent 写）；不做复杂计算（有数值用表达式让 Tool 算，没数值纯主观）。
- R7: 启用 roll_dice：从 `tools.disabled` 中移除 `roll_dice`。
- R8: `platformTools` 新增 `workspace_write`，使 storyteller 能写自己的 notes 和 writing-styles 文件。AGENT.md 已有"不维护 runtime、entity、schema 或 status bar"原则约束写入范围，不需额外专门约束。
- R9: `contextPaths` 新增 `save/agents/storyteller/writing-styles.md`，默认模板创建该文件。
- R10: 新增文风学习 Skill：storyteller 遇到新场景类型（战斗、探索、日常等）时启用，call researcher 找原著中类似场景章节，学习文风并总结进 `writing-styles.md`（按场景类型组织），该文件通过 contextPaths 每回合固定注入。
- R11: 新增实体快速读取 Tool：输入 entity ref，返回去除 JSON 冗余结构符号的格式化文本（name/brief/identity/status/traits 等），省 token 省往返。
- R12: 新增场景信息查询 Tool：读 scene 文件并格式化返回（在场角色、地点、状态），避免 storyteller 自己 read scene 再 read 每个实体。
- R13: 新增关系查询 Tool：读 `save/relationships/*.json` 并格式化返回角色间关系，供社交场景使用。
- R14: SOUL.md 不改（人格底色已正确）。

### researcher 重构

- R15: researcher 全面重构，不是在现有 Skill 上打补丁。移除 RAG（semantic_search）依赖——当前 RAG 有待后续重构，暂时不用。`platformTools` 移除 `workspace_semantic_search`，保留 `workspace_read`。
- R16: researcher AGENT.md 重写：素材库模型下的资料员定位——只读检索，不写不讲故事；找素材用直接读和 timeline 映射，不用 semantic_search；在已读窗口范围内找；找不到时返回"已在已读范围内检索，未找到相关内容"之类的简短说明（含已读范围信息），让调用方知道在哪找过但确实没有；返回精炼结论，不倒原文；遵守 visibility。
- R17: researcher Skill 重写：
  - 《实体读取》保留并轻改：直接读 entity/scene/relationship 文件返回摘要，不依赖 RAG，确认不提 semantic_search。
  - 《资料检索》重写：从"semantic_search + read"改为"timeline 映射 + read"。流程：确认问题范围 → 在已读范围内直接读相关章节/entity/scene → 找不到时读 frontier.json 映射 worldTime 到 timeline 锚点定位相关章节窗口 → 在窗口内已读章节中查找 → 找到提取返回，找不到返回"已在已读范围内检索，暂无相关内容"之类的简短说明。timeline 映射是检索过程内部步骤（帮定位更准），不告知调用方"哪里有未读"。
- R18: researcher `contextPaths` 新增 `save/playthrough/frontier.json`，使其常驻可读 frontier/timeline。
- R19: researcher 保持只读边界：不新增 `workspace_write` 或 `agent_call`。
- R20: researcher SOUL.md 不改（人格底色已正确）。
- R21: researcher 不新增配套 Tool。移除 semantic_search 后靠 `workspace_read` 的 `read`/`list`/`glob`/`search` 操作覆盖检索需求。更高效的检索工具留给后续 RAG 重构时一并考虑。

### 通用约束

- R22: 不新增前端 UI、状态栏字段、人物卡渲染。
- R23: 不实现回合后 stage-manager 维护 worldTime 或前端触发 frontier 推进（子任务 E）。
- R24: 不重新引入 director、brief、mode.json。

## Acceptance Criteria

- [ ] `roll_dice` Tool 支持 `count === 1` 时大成功/大失败（`criticalSuccess`/`criticalFailure`），优先于常规 `success`/`winner` 判定。
- [ ] `roll_dice` Tool `modifier` 和 `opposed.modifier` 接受 `number | string`，string 为纯数字算术表达式（`+ - * / ^` + `sqrt()`），求值失败返回 `ROLL_DICE_INVALID_ARGS`。
- [ ] storage spec 中 roll_dice 场景更新，移除"不添加表达式求值"约束，新增大成功/大失败和表达式 modifier 说明。
- [ ] storyteller `agent.json` 的 `tools.disabled` 不再包含 `roll_dice`；`platformTools` 新增 `workspace_write`。
- [ ] storyteller `contextPaths` 新增 `save/agents/storyteller/writing-styles.md`，默认模板创建该文件。
- [ ] storyteller AGENT.md 包含写正文方法论和裁定方法论。
- [ ] storyteller 新增文风学习 Skill（call researcher 找章节 → 总结进 writing-styles.md → contextPaths 注入）。
- [ ] storyteller 新增实体快速读取 Tool（输入 ref → 格式化文本返回）。
- [ ] storyteller 新增场景信息查询 Tool（读 scene → 格式化返回）。
- [ ] storyteller 新增关系查询 Tool（读 relationships → 格式化返回）。
- [ ] researcher `platformTools` 移除 `workspace_semantic_search`。
- [ ] researcher AGENT.md 重写为素材库模型定位（直接读 + timeline 映射，不用 semantic_search）。
- [ ] researcher《实体读取》Skill 轻改（确认不提 semantic_search）。
- [ ] researcher《资料检索》Skill 重写为 timeline 映射 + read 流程。
- [ ] researcher `contextPaths` 新增 `save/playthrough/frontier.json`。
- [ ] researcher 保持只读，不新增 write/agent_call。
- [ ] 父任务流程地图与 Ledger 更新 D 完成。
- [ ] 必要构建/类型检查通过。

## Out of Scope

- 回合后 stage-manager 维护 worldTime + 前端触发 frontier 推进（子任务 E）。
- world-architect 推进 frontier Skill（子任务 E）。
- 新增前端 UI、状态栏字段、人物卡渲染。
- 新增后台 agent_call 平台能力或异步 agent 调用机制。
- 重新引入 director、brief、mode.json。
- 前端预算加成值写入 workspace 的机制（未来可能方向，本任务不实现）。
- RAG 重构（后续任务，本任务只移除依赖不用）。

## Notes

- researcher 找不到素材时的返回应含已读范围信息（如"已在已读章节 1-8 及现有实体中检索，暂无相关内容"），让调用方知道在哪找过但确实没有，而非只返回"未找到"。
- 文风学习 Skill 的 writing-styles.md 按场景类型组织（如 # 战斗文风 / # 探索文风 / # 日常文风），随 storyteller 遇到新场景类型逐步积累。
