# Understanding 步：世界架构师 + 导演重构

## Parent

`07-06-agent-roster-progressive-refactor`（Player Flow Map #1：开局向导 / 世界建模）。

## Goal

按玩家实际流程的第一个 Agent 步骤——开局向导 Step 2 Understanding——审视并补充 `world-architect` 的 `AGENT.md` / `SOUL.md` 方法论，精简 `开局建模` Skill 的 description/triggers，审视 `剧情指导维护` Skill 与 `director` 的 AGENT.md/SOUL.md，并给 5 个 Agent 显式禁用无用的 `roll_dice` Tool。本子任务只覆盖 Step 2 Understanding 涉及的 AI-facing 文本与配置，不改前端、不引入新能力。

## Background

### 玩家视角：Step 2 Understanding 发生什么

玩家在 Step 1 导入小说并确认切分后，点"开始理解"。前端 `useSetupState.startOpeningUnderstanding` 调用：

```ts
tsian.invokeAgent("world-architect", prompt, {
  invocationId,
  purpose: "opening-understanding",
  contextSlot: "understanding",
  persist: false,
})
```

`prompt` 由 `buildOpeningInitializationPrompt`（`apps/play-frontend-dev/src/lib/source.ts:482`）生成，要求 world-architect：
1. 用 `inspect_source_opening` / `read_opening_slice` 读源文本。
2. 按 Skill《开局建模》步骤 commit 实体 → 场景+关系 → runtime+frontier → understanding-summary。
3. agent_call 导演写初始 `save/director/current-brief.md`；world-architect 不代写 brief。
4. 保持 spoiler-safe，只使用开头窗口内容。

前端订阅 `onAgentInvocation` 的 tool 事件驱动 4 阶段文案（观察/阅读/整理写入/导演校准），完成后读 `understanding-summary.json` 确认成功。

### 涉及的 Agent 与当前状态

- **world-architect**（主角）：`skills.enabled = ["开局建模", "游玩设定"]`；`contextPaths = [schema-guide, source/README, source/manifest.json, schema/current.md, schema/changelog.md, playthrough/frontier.json, scenes/README, relationships/README]`。`AGENT.md` 是 mode.json 清理后版本（职责为"设计世界资料结构：schema、实体、场景、关系、runtime 指针"）。`SOUL.md` 未动。
- **director**（被 agent_call）：`skills.enabled = ["剧情指导维护"]`；`contextPaths = [schema-guide, director/current-brief.md, current-brief.meta.json, playthrough/runtime.json, schema/current.md, source/README]`。`AGENT.md` / `SOUL.md` 未动。Skill 文本已说明"被 world-architect 通过 agent_call 调用时：基于对方提供的建模结果写初始 brief，不需要自己重新读源文本"。
- **storyteller / researcher / stage-manager**：本步骤不参与，不在本子任务范围。

### 关键 Skill 与脚本（本步骤实际使用的）

`开局建模` Skill（`WORLD_ARCHITECT_OPENING_SKILL_MD`）：
- `inspect_source_opening` / `read_opening_slice`：读源。
- `commit_entities` / `commit_scenes_and_relationships` / `commit_runtime_and_frontier` / `commit_understanding_summary`：写开局产物。
- 执行步骤 1-7 明确（第 7 步是 agent_call 导演写 brief）。
- `commit_opening_narrative` 脚本虽属于本 Skill，但本步骤不调用（Step 4 收尾才用）——需确认 Skill 文本是否准确反映这一点。

`剧情指导维护` Skill（`DIRECTOR_BRIEF_SKILL_MD`）：
- 维护 `current-brief.md` + `.meta.json`。
- `triggers` 含"开局建模后需要写初始剧情方向"与"场记标记 brief 过期"。
- 已说明被 agent_call 时不重读源文本。

### 父任务约束

- R3：每个涉及 Agent 的步骤必须审视并必要时重写 `AGENT.md` / `SOUL.md` / `skills/` / `tools/` / `contextPaths`。
- R2：每个子任务只覆盖一个可独立验证的流程步骤。
- 用户方法论：从玩家视角一步步重构沿途相关内容，每做一步都能浏览器验证。

### 关键事实

- `roll_dice` Tool 当前在共享 `tools/` 作用域，5 个 Agent 都未传 `tools` 字段 → 运行时 `enabledTools` 解析为空 → `isToolEnabledForAgent`（`apps/platform-web/src/agent-runtime/registry.ts:1288-1302`）走 `return true` 分支 → roll_dice 对所有 Agent 默认可见。Understanding 步及当前已实现步骤均不需要骰子。
- mode.json 抽象已清理归档，本步骤不重新引入任何玩法开关。
- 前端 Step 2 的 `invokeAgent` 调用签名、`understanding-summary.json` 文件契约、4 阶段文案映射是既有产物，本子任务不改前端，只审视 Agent/Skill 一侧。
- `ai-facing-content-changes.md`：AI-facing 文档只描述当前事实，不描述未来计划。
- `AgentConfig.tools`（`packages/contracts/src/runtime.ts:420`）是 Agent-scoped Tool whitelist/blacklist；`tools: { enabled: [], disabled: ["roll_dice"] }` 是显式禁用 roll_dice 的正确写法。
- contextPaths 注入走 `agent-runtime/context.ts` + `index.ts:732 buildAgentContextMessages_split`：每个 contextPath 文件作为独立 user message 注入原文（`Workspace 文件 <path>：\n<完整内容>`）。
- storyteller 另有前端 injection 优化路径（`07-04-runtime-summary-injection`）：`apps/play-frontend-dev/src/lib/context-injection.ts` 的 `buildContextInjection` 在玩家 send 前基于 runtime.json 派生去结构化友好文本（runtime/world、active scene、protagonist blocks），通过 `tsian.send(text, { injection })` 注入。两套路径并存导致 storyteller 的 runtime.json 双源注入——contextPaths 原文与前端 injection 重叠。

## Requirements

### 设计原则（讨论确认）

- **AGENT.md**：写 Agent 的定位与方法论，不写具体步骤。具体流程归 Skill。
- **SOUL.md**：写人格底色与决策风格，泛化不绑步骤。
- **Skill description**：该 Skill 对应流程的准确精简描述，列产物与流程节点，无额外解释。
- **Skill triggers**：关于使用时机的精简描述，配合前端 invoke 提示词稳定触发，无多余解释。
- **Skill 正文**：专注此流程的说明与指导——需要做什么、怎么做、出问题怎么办。不出现设计决策，不大而全。
- **Tool 判断**：通用复用 → Tool；服务 Skill 工作流程、不通用不复用 → Skill 脚本。
- **contextPaths**：该 Agent 高频常驻需要读的文件参考，不是职责边界声明。Agent 可能跨步骤灵活直读文件（一次工具调用能拿的事实不必强制 call researcher），不设死规则。
- **职责边界是方法论不是死规则**：AGENT.md 写方法论原则引导 Agent 行为，但不写"绝对禁止 X"之类会堵死灵活变通路径的硬规则。

### 具体要求

- R1：补充 `world-architect/AGENT.md` 方法论原则——脚本校验失败按错误修正重试、只使用已读内容不推断未读未来、不写玩家正文。不点出具体步骤（"开局时..."），不写绝对禁止规则。现有原则（最小可用模型、pending patch、call 资料员、不维护每回合 runtime）保留。
- R2：补充 `world-architect/SOUL.md` 人格底色——尊重已读内容边界（泛化，不写"开局窗口"）、脚本错误当建模对话重试。现有人格保留。
- R3：`director/AGENT.md` 审视确认——现状已符合"定位+方法论"原则，无具体步骤污染。**不改。**
- R4：`director/SOUL.md` 审视确认——现状已符合。**不改。**
- R5：精简 `开局建模` Skill 的 `description`（列产物+agent_call 导演，无解释）与 `triggers`（留一条 Understanding 步触发，删第二条）。正文第 8 步 `commit_opening_narrative` 加"不在开局建模流程执行"标注。其余正文（可用脚本、执行步骤 1-7、产物落点、重试策略、spoiler-safe）保留。不新增 Skill，不删除脚本。
- R6：审视 `剧情指导维护` Skill——description 精简准确，triggers 覆盖两场景，正文符合"此流程怎么做"。**不改。**
- R7：`contextPaths` 审视——按"该 Agent 高频常驻需要读的参考文件"判断，发现两处冗余：
  - storyteller 的 `docs/novel-airp-schema-guide.md` 与 `save/schema/current.md`：写正文不需要 schema 字段定义/速查，移除。
  - storyteller 的 `save/playthrough/runtime.json`：前端 `07-04-runtime-summary-injection` 任务已实现 `buildContextInjection`（`apps/play-frontend-dev/src/lib/context-injection.ts`），在玩家发送行动前基于 runtime.json 派生多条去结构化的 storyteller 友好 injection message（runtime/world、active scene、protagonist blocks），通过 `tsian.send(text, { injection })` 注入。contextPaths 的 runtime.json 原文注入与之重叠冗余，移除。
  - storyteller 最终 contextPaths 从 5 条减为 2 条：`README.md` + `save/director/current-brief.md`。
  - researcher / stage-manager / world-architect / director 的 contextPaths：无 injection 优化覆盖（路径 B 只针对 storyteller send），runtime.json 原文注入是唯一路径，全部保留。
- R8：给 5 个 Agent 的 `agent.json` 显式加 `tools: { enabled: [], disabled: ["roll_dice"] }`。当前 5 个 Agent 都未传 `tools` 字段，运行时 `enabledTools` 为空 → roll_dice 对所有 Agent 默认可见（`registry.ts:1301`）。roll_dice 在 Understanding 步及当前已实现步骤中均无用，显式 disabled 避免误调。（storyteller/stage-manager 未来是否启用 roll_dice 由后续行动裁定规则子任务决定。）
- R9：不改动前端 Step 2 状态机、`buildOpeningInitializationPrompt`、`invokeAgent` 调用签名、`understanding-summary.json` 文件契约。
- R10：不引入新 Tool；不重新引入 mode.json 或任何玩法开关；不引入行动裁定规则；不触碰 Step 4 游玩设定相关的 `游玩设定` Skill / `buildPlaySetupPrompt` / `setup-summary.json` / `opening-narrative.json` 契约。
- R11：AI-facing 文本零未来承诺——不描述尚不存在的 UI 或后续子任务能力。

## Acceptance Criteria

- [ ] `world-architect/AGENT.md` 补充方法论原则（脚本重试、已读内容边界、不写玩家正文），不点出具体步骤，无 mode.json/玩法开关残留。
- [ ] `world-architect/SOUL.md` 补充人格底色（已读内容边界、脚本错误当建模对话），泛化不绑步骤。
- [ ] `director/AGENT.md` / `SOUL.md` 经审视确认无需改动（现状已符合定位+方法论原则）。
- [ ] `开局建模` Skill 的 description 精简（列产物+agent_call 导演，无解释）、triggers 收敛为一条、第 8 步标注"不在开局建模流程执行"。
- [ ] `剧情指导维护` Skill 经审视确认无需改动。
- [ ] 5 个 Agent 的 `agent.json` 显式 `tools: { enabled: [], disabled: ["roll_dice"] }`，roll_dice 不再默认可见。
- [ ] 5 个 Agent 的 `contextPaths`：storyteller 移除 3 条冗余（schema-guide.md / schema/current.md / runtime.json），保留 2 条（README.md / current-brief.md）；其余 4 个 Agent 全部保留。
- [ ] 前端 Step 2 行为不变（不改 `useSetupState.startOpeningUnderstanding` / `buildOpeningInitializationPrompt` / invokeAgent 调用）。
- [ ] `npm run build:web` 通过。
- [ ] 浏览器验证：导入一本小说 → 点开始理解 → world-architect 跑完 `开局建模` → agent_call 导演写 brief → `understanding-summary.json` 产出 → 前端进 Step 3 角色设定。
- [ ] 父任务 PRD 的 Player Flow Map #1a 标记为已完成，Current Agent / Skill / Tool Ledger 更新。

## Out of Scope

- 不重写 Step 4 游玩设定（`游玩设定` Skill / `buildPlaySetupPrompt` / `setup-summary.json` / `opening-narrative.json`）——拆到下个子任务。
- 不重写 storyteller / researcher / stage-manager 的 AGENT.md/SOUL.md（属于后续玩家流程子任务）；本子任务只给它们加 roll_dice disabled。
- 不改动前端向导状态机、文件契约、组件结构。
- 不新增 Skill / Tool / contextPath。
- 不重新引入 mode.json、玩法开关、行动裁定规则。
- 不决定 storyteller/stage-manager 未来是否启用 roll_dice（由后续行动裁定规则子任务决定）。
- 不处理 Understanding 步之后（Step 3 角色设定 / Step 4 / Step 5 / 正式回合 / 回合后维护 / 前台状态反馈）的任何 Agent 职责。

## Notes

- 本子任务是父任务 Player Flow Map #1a 的真正落地，完成后应在父任务 PRD 标记并更新 Ledger。
- 发现的 Step 4 残留（`buildPlaySetupPrompt` 中 mode.json 漏网文本，`apps/play-frontend-dev/src/lib/source.ts:465,470`）已记录到父任务 Child Task Map #1 与 #3，由下一个子任务（Step 4 游玩设定）处理。
- 设计原则"AGENT.md 写定位方法论、Skill 写流程、Tool 看复用性、contextPaths 是参考文件不是职责边界"由本子任务确立，后续子任务沿用。
