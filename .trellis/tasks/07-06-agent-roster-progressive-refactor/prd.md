# AIRP Agent 阵容渐进重构

## Goal

以玩家实际游玩流程为骨架，渐进重构默认 novel AIRP 的 Agent / Skill / Tool 分层：每次只处理玩家流程中的一个步骤，重写该步骤涉及 Agent 的 `AGENT.md` / `SOUL.md`，并为该步骤设计或调整必要的 Skill 与 Tool。

本任务是父任务，用来承载流程地图、跨子任务原则与最终集成验收；具体实现通过子任务逐步完成，不做一次性大重构。

## Background

已完成前置事实：

- `07-05-agent-tool-mechanism` 已归档：Tsian 已有自定义 Tool 机制，适合承载一次输入、一次输出的原子能力。
- `07-06-custom-tools-workshop-distribution` 已归档：自定义 Tool 可通过创意工坊分发。
- `07-04-action-resolution-system` 已归档：`roll_dice` 已支持对抗裁定，输出 `winner: "self" | "opposed" | "tie"` 与 `margin`；`dc` 与 `opposed` 互斥；平局由说书人叙事处理。

讨论共识：

- 跟着玩家流程推进，而不是一次性重构全部 Agent。
- 玩家游玩的第一步是前端开局操作，不涉及 Agent，本父任务不处理。
- 第一个涉及 Agent 的步骤是开局向导后续流程，涉及世界架构师与导演。
- 如果后续流程再次遇到已经重构过的 Agent，只按该步骤新增职责继续补充，不回头做大而全重写。
- `mode.json` 作为面向 Agent 的软玩法开关抽象应废弃；未来若需要玩法开关，应另行设计成卡预制 / UI 机制，而不是让 Agent 读软开关自行判断。
- 高频、单一读者、需要每轮消费的 workspace 文件应通过 `agent.json.contextPaths` 直接注入 Agent 上下文；不应伪装成 Skill。
- 不描述尚不存在的 UI / 未来能力；AI-facing 文档只描述当前事实。

## Requirements

- R1: 父任务必须维护玩家流程地图，明确每个子任务处理哪个流程步骤、涉及哪些 Agent、要调整哪些 Skill / Tool / contextPaths。
- R2: 每个子任务只覆盖一个可独立验证的流程步骤，避免把多个 Agent 阶段混成一次大重构。
- R3: 每个涉及 Agent 的步骤必须审视并必要时重写该 Agent 的：
  - `AGENT.md`：常驻职责、输入输出边界、禁止越位维护的内容。
  - `SOUL.md`：人格 / 叙事风格 / 决策底色。
  - `skills/`：只有需要按需激活的 SOP / 多步流程才做 Skill。
  - `tools/`：只有一次调用即可得到结果的原子能力才做 Tool。
  - `agent.json.contextPaths`：只有该 Agent 高频、常驻需要阅读的 workspace 文件才加入。
- R4: 第一个子任务应清理 `mode.json` 抽象，删除默认种子和 Agent-facing 引用，为后续职责重构去掉历史包袱。
- R5: 第一个真正流程重构子任务从开局向导中涉及世界架构师与导演的步骤开始。
- R6: 后续按玩家流程继续推进：开局向导 → 开局确认 / 生成 → 正式玩家回合 → 回合后维护 → 前台状态反馈等；具体顺序由父任务 PRD / 后续子任务持续更新。
- R7: 每个子任务完成后必须更新父任务的流程地图与当前 Agent / Skill / Tool 职责表，保持整体架构可读。
- R8: 不把 UI 模块、状态栏字段、人物卡、背包等前端渲染结构混入玩法 / Agent 职责重构，除非该流程步骤明确依赖它们。

## Initial Child Task Map

1. `mode.json` 抽象清理 ✅ 已归档 (`07-06-mode-json-abstraction-cleanup`)
   - 已删除默认 `save/playthrough/mode.json` 种子与默认路径登记。
   - 已删除世界架构师 `玩法启用` Skill 与 `commit_mode` 脚本；同时删除三处 `行动裁定` Skill（storyteller / stage-manager / world-architect），其为 mode.json 软开关唯一消费者，留下会成为悬挂引用。
   - 已从默认 Agent / Skill / schema guide / README 中移除所有面向 Agent 的 `mode.json` 与 `enabled/disabled/deferred` 软开关语义（零表面痕迹）。
   - 已从 stage-manager / world-architect `contextPaths` 中移除 `save/playthrough/mode.json`。
   - `roll_dice` Tool 作为通用能力保留；行动裁定规则的重新引入延后到具体玩家流程重构子任务。
   - 已知残留（不属于本任务范围）：`apps/play-frontend-dev/src/lib/source.ts:465,470` 的 `buildPlaySetupPrompt` 仍含 mode.json 三态选择与 `commit_mode` 引用文本，由 Step 4 游玩设定子任务处理。

2. Understanding 步：world-architect + director 重构 ✅ 已完成 (`07-06-understanding-step-world-architect-director`)
   - world-architect AGENT.md 补 3 条方法论（不写玩家正文/脚本重试/已读内容边界）；SOUL.md 补 2 句人格。
   - 开局建模 Skill description 精简（列产物+agent_call 导演）、triggers 收敛为一条、第8步标注不在开局建模流程执行。
   - storyteller contextPaths 从 5 条减为 2 条（移除 schema-guide/schema-current/runtime.json——前两者写正文不需要，runtime.json 已有前端 injection 优化覆盖）。
   - 5 个 Agent 显式 `tools.disabled: ["roll_dice"]`（之前未传 tools 字段导致默认全可见）。
   - director AGENT.md/SOUL.md/剧情指导维护 Skill 审视确认不改。
   - 确立设计原则：AGENT.md 写定位方法论、Skill 写流程、Tool 看复用性、contextPaths 是参考文件不是职责边界。

3. 游玩设定步：world-architect（+ storyteller 协作）重构（待启动）
   - 目标：开局向导 Step 4 游玩设定——重写 `游玩设定` Skill，清理 `buildPlaySetupPrompt` 中 mode.json 残留，审视 world-architect 在本步的职责（+ agent_call storyteller 拿开局正文的协作）。
   - 范围：只覆盖 Step 4 游玩设定 + Step 5 开局确认过渡。

4. 后续步骤待补
   - 按玩家实际流程继续拆分（开局确认/生成 → 正式玩家回合 → 回合后维护 → 前台状态反馈）；遇到已处理 Agent 时只补充当前步骤需要的职责和能力。

## Player Flow Map (working)

玩家实际流程与对应子任务归属：

| # | 玩家步骤 | 涉及 Agent | 状态 |
| - | - | - | - |
| 0 | 前端开局操作（导入源、选卡） | — 无 Agent — | 不在本任务范围 |
| 1a | 开局向导 Step 2：Understanding（初始世界建模） | world-architect, director | ✅ 已完成 |
| 1b | 开局向导 Step 4：游玩设定对话 | world-architect, storyteller (agent_call) | 待启动 |
| 1c | 开局向导 Step 5：开局确认过渡 | — 无 Agent — | 不在本任务范围 |
| 2 | 开局确认 / 生成 | world-architect, storyteller | 待规划 |
| 3 | 正式玩家回合 | storyteller, researcher | 待规划 |
| 4 | 回合后维护 | stage-manager, researcher, world-architect | 待规划 |
| 5 | 前台状态反馈 | stage-manager | 待规划 |

前置清理（`mode.json` 抽象）已归档，属于全流程共享的历史包袱清理，不绑定单一步骤。Step 1/3/5 是纯前端步骤，无 Agent 参与。

## Current Agent / Skill / Tool Ledger

`mode.json` 清理归档后，默认阵容当前状态：

- **storyteller** / 说书人：`AGENT.md` / `SOUL.md` 保留；`skills.enabled = []`（`行动裁定` Skill 已删除）。`contextPaths` 无变化。待开局向导 / 正式回合子任务重写职责。
- **researcher** / 资料员：`AGENT.md` 已移除“不判断玩法启用”，其余保留；两个 Skill（`实体读取` / `资料检索`）保留。
- **stage-manager** / 场记：`AGENT.md` 移除 `deferred 玩法` 描述；skills 从三项减为 `状态栏维护` + `schema演进检查`；`contextPaths` 移除 `mode.json`。
- **world-architect** / 世界架构师：`AGENT.md` 移除 `mode 状态`；skills 从四项减为 `开局建模` + `游玩设定`；`contextPaths` 移除 `mode.json`。待开局向导子任务重写核心职责。
- **director** / 导演：`SKILL.md` 中“需要 schema 或玩法设计”改为“需要 schema 设计”。其他不变，待开局向导子任务重写。
- **共享 Tools**：`roll_dice`（reference tool）保留不动。
- **共享 Skills 目录 (`skills/`)**：默认不放共享玩法 Skill，仅结构占位。

## Acceptance Criteria

- [ ] 父任务下的每个子任务都有明确流程步骤、涉及 Agent、交付边界与验收标准。
- [x] `mode.json` 抽象清理子任务完成并归档。
- [ ] 开局向导中涉及世界架构师与导演的步骤完成并归档。
- [ ] 每个已处理 Agent 的 `AGENT.md` / `SOUL.md` / Skill / Tool / contextPaths 分层职责在父任务中可追踪。
- [ ] 后续流程步骤不会要求一次性重构未进入该步骤的 Agent。
- [ ] 必要构建 / 检查通过。

## Out of Scope

- 本父任务不直接实施代码改动；实施应在子任务中完成。
- 不一次性重写全部 Agent 阵容。
- 不在本父任务内新增 UI。
- 不重新设计 `roll_dice`；该能力已由前置任务交付。
- 不引入“Agent 自然衍生玩法”的软开关机制。

## Notes

父任务应随每个子任务完成持续更新流程地图，而不是提前写死全量路线。目标是保持重构节奏与玩家真实流程一致，避免为了架构完整性过度设计。
