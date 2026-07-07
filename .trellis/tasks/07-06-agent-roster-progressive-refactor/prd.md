# AIRP Agent 阵容渐进重构

## Goal

以玩家实际游玩流程为骨架，渐进重构默认 novel AIRP 的 Agent / Skill / Tool 分层：每次只处理玩家流程中的一个步骤，重写该步骤涉及 Agent 的 `AGENT.md` / `SOUL.md`，并为该步骤设计或调整必要的 Skill 与 Tool。

本任务是父任务，用来承载流程地图、跨子任务原则与最终集成验收；具体实现通过子任务逐步完成，不做一次性大重构。

## Background

### 已完成前置事实

- `07-05-agent-tool-mechanism` 已归档：Tsian 已有自定义 Tool 机制，适合承载一次输入、一次输出的原子能力。
- `07-06-custom-tools-workshop-distribution` 已归档：自定义 Tool 可通过创意工坊分发。
- `07-04-action-resolution-system` 已归档：`roll_dice` 已支持对抗裁定，输出 `winner: "self" | "opposed" | "tie"` 与 `margin`；`dc` 与 `opposed` 互斥；平局由说书人叙事处理。

### 架构方向转变（2026-07-07 讨论确立）

验证 Understanding 步产出时发现 brief 混淆了三个读者（说书人/导演/场记），进而反思出整个架构方向需要转变：

**旧模型（原著中心）→ 新模型（素材库模型）**：

| 维度 | 旧模型 | 新模型 |
| - | - | - |
| 原著定位 | 剧本，要跟着走 | 素材库，按需取用 |
| 剧情主体 | 原著剧情 + 玩家分支 | 玩家剧情 |
| 伏笔利用 | 导演控制节奏 | 信息边界天然隔离 + 渐进阅读自然实现 |
| 导演 | 需要（控制方向/节奏/伏笔） | **移除**（无消费者） |
| brief | 需要（指导创作方向） | **移除**（timeline 替代其索引功能） |

**素材库模型的核心**：
- 小说是素材库不是剧本。玩家剧情是主体，原著不一定都用得上。
- 渐进阅读按需取用，不全本理解。理由：①减少开局等待；②不提前暴露伏笔/悬念；③利用小说的伏笔和长线剧情安排。
- 伏笔利用是架构自然发生的——1-20 章的伏笔，说书人随便发挥也不会触及第 50 章的揭晓；等提取到第 50 章，看当前剧情是否已自己给出答案，不强求。

### 渐进阅读触发机制（AD 结合 + A' + C）

**找素材流程**：
1. 任一 Agent call researcher 查素材。
2. researcher 在已读章节找 → 找到返回。
3. 找不到 → 用 `runtime.worldTime` 映射 timeline 锚点 → 从锚点 chapter + 10 章窗口找。过去章节不找，窗口外不读。
4. 窗口内未读章节 → 推进 frontier 读 → 找到提取返回，找不到返回无。

**frontier 推进触发（A'）**：
- 前端在场记完成后检查：`worldTime` 变了？映射的锚点 chapter 接近 `sourceWindow.end`？
- 接近 → 前端 invokeAgent("world-architect", purpose:"frontier-advance")。
- 不依赖 Agent 主观判断，前端做客观计算。

**后台推进（C，需平台能力开发）**：
- agent_call 支持"先返回再后台继续"，推进不阻塞玩家。
- **暂记，待平台能力讨论后确定**。

### 时间线方案

```
runtime.json:
  worldTime: "二年秋"    // 场记每回合维护，元年基准，自由字符串粒度（默认年+季/月）

frontier.json 新增:
  timeline: [
    { chapter: 1, time: "元年春", label: "飞星坠落，海岛修行开始" },
    { chapter: 8, time: "二年秋", label: "飞星下山" }
  ]
```

- **开局**：world-architect 建第一个锚点 `{ chapter: 1, time: "元年", label: "开局" }`，`runtime.worldTime` 初始化为"元年"。
- **每回合**：场记根据说书人正文更新 `worldTime`（元年基准，相对推算，不依赖原著时间体系）。
- **推进 frontier 时**：world-architect 追加 timeline 锚点。
- **label 约束**：一句话标签，不是剧情摘要（防止滑向 brief）。
- **映射**：researcher 用 `worldTime` 对比 timeline 锚点的 `time`，定位最近但不超前的锚点。锚点少（5-10 个），Agent 对比成本极低。

### 设计原则（讨论确认）

- **AGENT.md**：写 Agent 的定位与方法论，不写具体步骤。
- **SOUL.md**：写人格底色与决策风格，泛化不绑步骤。
- **Skill description**：该 Skill 对应流程的准确精简描述，列产物与流程节点，无额外解释。
- **Skill triggers**：关于使用时机的精简描述，配合前端 invoke 提示词稳定触发。
- **Skill 正文**：专注此流程——需要做什么、怎么做、出问题怎么办。不出现设计决策，不大而全。
- **Tool 判断**：通用复用 → Tool；服务 Skill 工作流程、不通用不复用 → Skill 脚本。
- **contextPaths**：该 Agent 高频常驻需要读的参考文件，不是职责边界声明。Agent 可灵活直读（一次工具调用能拿的事实不必强制 call researcher），不设死规则。
- **每个字段必须有一个真实消费者**（`airp-data-capability-design-principles.md` 原则 9）：无消费者的字段直接删，不降级保留。

### 跨子任务共识

- 跟着玩家流程推进，而不是一次性重构全部 Agent。
- 如果后续流程再次遇到已经重构过的 Agent，只按该步骤新增职责继续补充，不回头做大而全重写。
- 高频、单一读者、需要每轮消费的 workspace 文件应通过 `agent.json.contextPaths` 直接注入 Agent 上下文；不应伪装成 Skill。
- 不描述尚不存在的 UI / 未来能力；AI-facing 文档只描述当前事实。
- 渐进重构的验证环节会暴露 schema/架构问题——这些问题不绑定玩家流程某一步骤，属于跨步骤的演进，单独拆子任务处理。

## Requirements

- R1: 父任务必须维护玩家流程地图，明确每个子任务处理哪个流程步骤、涉及哪些 Agent、要调整哪些 Skill / Tool / contextPaths。
- R2: 每个子任务只覆盖一个可独立验证的流程步骤，避免把多个 Agent 阶段混成一次大重构。
- R3: 每个涉及 Agent 的步骤必须审视并必要时重写该 Agent 的 AGENT.md / SOUL.md / skills / tools / contextPaths。
- R4: 架构方向转变（素材库模型）后，导演 Agent 和 brief 文档需移除。移除工作按玩家流程逐步进行——哪个步骤涉及导演/brief 就在该步骤清理，不一次性全删。
- R5: timeline 机制（元年基准 + worldTime 维护 + 锚点渐进补充 + researcher 映射找素材）随相关步骤逐步建立，不一次性全建。
- R6: 每个子任务完成后必须更新父任务的流程地图与当前 Agent / Skill / Tool 职责表，保持整体架构可读。
- R7: 不把 UI 模块、状态栏字段、人物卡、背包等前端渲染结构混入玩法 / Agent 职责重构，除非该流程步骤明确依赖它们。
- R8: 后台 agent 调用（问题 1）作为平台能力另行讨论，不阻塞当前 Agent 重构进度；在平台能力就绪前，frontier 推进走串行路径。

## Initial Child Task Map

1. `mode.json` 抽象清理 ✅ 已归档 (`07-06-mode-json-abstraction-cleanup`)
   - 已删除默认 `save/playthrough/mode.json` 种子与默认路径登记。
   - 已删除世界架构师 `玩法启用` Skill 与 `commit_mode` 脚本；同时删除三处 `行动裁定` Skill。
   - 已从默认 Agent / Skill / schema guide / README 中移除所有面向 Agent 的 `mode.json` 与软开关语义。
   - 已知残留：`apps/play-frontend-dev/src/lib/source.ts:465,470` 的 `buildPlaySetupPrompt` 仍含 mode.json 残留，由 Step 4 游玩设定子任务处理。

2. Understanding 步：world-architect + director 重构 ✅ 已完成 (`07-06-understanding-step-world-architect-director`)
   - world-architect AGENT.md 补 3 条方法论；SOUL.md 补 2 句人格。
   - 开局建模 Skill description/triggers 精简；第8步标注不在开局建模流程执行。
   - storyteller contextPaths 从 5 条减为 2 条（移除 schema-guide/schema-current/runtime.json）。
   - 5 个 Agent 显式 `tools.disabled: ["roll_dice"]`。
   - ⚠️ 架构转变后需重新审视：该子任务保留了 director 不改的结论——新模型下导演要移除，需在后续子任务中清理。

3. entity schema 精简（`07-07-entity-schema-prune-no-consumer-fields`，已创建待实现）
   - 移除 entity 的 `updatedAt`/`updatedBy`/`sourceRefs`/`origin` 四个无消费者字段。
   - 修复 commit-entities 脚本与 schema guide 字段名不一致。
   - 源于 Understanding 步验证发现，按"每个字段必须有一个真实消费者"原则判断。

4. 游玩设定步：world-architect（+ storyteller 协作）重构（待启动）
   - 目标：开局向导 Step 4 游玩设定——重写 `游玩设定` Skill，清理 `buildPlaySetupPrompt` 中 mode.json 残留，审视 world-architect 在本步的职责（+ agent_call storyteller 拿开局正文的协作）。
   - 范围：只覆盖 Step 4 游玩设定 + Step 5 开局确认过渡。
   - 新模型影响：本步原涉及导演（agent_call 写 brief）→ 需移除导演参与，审视 brief 在本步的角色。

5. 导演与 brief 移除（待规划）
   - 目标：移除 director Agent（agent.json/AGENT.md/SOUL.md/剧情指导维护 Skill）、移除 brief 文档（current-brief.md/.meta.json）、清理所有 Agent 对 brief 的引用（contextPaths/Skill 正文）。
   - 范围：架构层面清理，但作为独立子任务因为它跨多个步骤。
   - 前置：timeline 机制需先在某个步骤建立，否则 researcher 找素材失去映射依据。

6. timeline 机制建立（待规划）
   - 目标：在 frontier.json 新增 timeline 字段，world-architect 开局建第一个锚点，建立 `runtime.worldTime` 元年基准初始化逻辑。
   - 范围：schema 变更 + Understanding 步开局建模 Skill 补充 timeline 建立步骤。
   - 可能与游玩设定步或导演移除合并，视具体拆分而定。

7. 正式玩家回合：storyteller + researcher 重构（待规划）
   - 目标：正式玩家回合——storyteller 用已有素材自由创作、researcher 检索 + 推进 frontier 找新素材。
   - 新模型核心：storyteller 不再读 brief，用 runtime injection + entity 素材创作。researcher 新增"找不到时映射 timeline 推进 frontier"职责。

8. 回合后维护：stage-manager 重构（待规划）
   - 目标：场记整理变动 + 维护 `worldTime`（元年基准推算）。
   - 新模型核心：场记不再检测 brief 刷新，改为维护 worldTime。

9. frontier 推进触发（待规划，依赖平台能力 C）
   - 目标：前端在场记完成后检查 worldTime/锚点/sourceWindow 边界，触发 world-architect 推进。
   - 平台依赖：若 agent_call 后台调用就绪，推进不阻塞玩家；否则串行。

10. 后续步骤待补
    - 按玩家实际流程继续拆分；遇到已处理 Agent 时只补充当前步骤需要的职责和能力。

## Player Flow Map (working)

玩家实际流程与对应子任务归属（新模型）：

| # | 玩家步骤 | 涉及 Agent | 状态 |
| - | - | - | - |
| 0 | 前端开局操作（导入源、选卡） | — 无 Agent — | 不在本任务范围 |
| 1a | 开局向导 Step 2：Understanding（初始世界建模 + timeline 建立） | world-architect | ✅ 已完成（timeline 待补） |
| 1b | 开局向导 Step 4：游玩设定对话 | world-architect, storyteller (agent_call) | 待启动 |
| 1c | 开局向导 Step 5：开局确认过渡 | — 无 Agent — | 不在本任务范围 |
| 2 | 正式玩家回合 | storyteller, researcher | 待规划 |
| 3 | 回合后维护 | stage-manager | 待规划 |
| 4 | frontier 推进触发 | world-architect (前端触发) | 待规划（依赖平台能力 C） |

新模型下导演不在 Player Flow Map 中——它被移除。Step 1/3/5 是纯前端步骤，无 Agent 参与。

前置清理（`mode.json` 抽象）已归档。entity schema 精简、导演/brief 移除、timeline 建立是跨步骤的架构演进，单独拆子任务处理。

## Current Agent / Skill / Tool Ledger

当前默认阵容状态（含架构转变影响标注）：

- **storyteller** / 说书人：`AGENT.md` / `SOUL.md` 保留；`skills.enabled = []`；`contextPaths = [README.md, current-brief.md]`。⚠️ 新模型下 contextPaths 的 `current-brief.md` 要移除（brief 废弃）。待正式玩家回合子任务重写职责。
- **researcher** / 资料员：`AGENT.md` 保留；两个 Skill（`实体读取` / `资料检索`）保留。⚠️ 新模型下需新增"找不到时映射 timeline 推进 frontier"职责。待正式玩家回合子任务处理。
- **stage-manager** / 场记：`AGENT.md` 保留；skills = `状态栏维护` + `schema演进检查`；`contextPaths` 含 `current-brief.md`。⚠️ 新模型下 contextPaths 的 `current-brief.md` 要移除；需新增"维护 worldTime"职责。待回合后维护子任务处理。
- **world-architect** / 世界架构师：`AGENT.md` 已补方法论；skills = `开局建模` + `游玩设定`。⚠️ 新模型下需新增"推进 frontier + 维护 timeline"职责。待相关子任务处理。
- **director** / 导演：⚠️ **新模型下标记为待移除**。`AGENT.md` / `SOUL.md` / `剧情指导维护` Skill / `current-brief.md` / `.meta.json` 全部待清理。导演移除作为独立子任务（Child Task Map #5）。
- **共享 Tools**：`roll_dice` 已对所有 Agent `tools.disabled`。保留为通用能力。
- **共享 Skills 目录 (`skills/`)**：默认不放共享玩法 Skill，仅结构占位。

## Acceptance Criteria

- [ ] 父任务下的每个子任务都有明确流程步骤、涉及 Agent、交付边界与验收标准。
- [x] `mode.json` 抽象清理子任务完成并归档。
- [x] Understanding 步 world-architect + director 重构完成（导演保留部分待后续清理）。
- [ ] entity schema 精简完成。
- [ ] 导演与 brief 移除完成。
- [ ] timeline 机制建立完成。
- [ ] 游玩设定步完成。
- [ ] 正式玩家回合 storyteller + researcher 重构完成。
- [ ] 回合后维护 stage-manager 重构完成。
- [ ] 每个已处理 Agent 的 AGENT.md / SOUL.md / Skill / Tool / contextPaths 分层职责在父任务中可追踪。
- [ ] 后续流程步骤不会要求一次性重构未进入该步骤的 Agent。
- [ ] 必要构建 / 检查通过。

## Out of Scope

- 本父任务不直接实施代码改动；实施应在子任务中完成。
- 不一次性重写全部 Agent 阵容。
- 不在本父任务内新增 UI。
- 不重新设计 `roll_dice`；该能力已由前置任务交付。
- 不引入"Agent 自然衍生玩法"的软开关机制。
- 后台 agent 调用（问题 1）作为平台能力另行讨论，不在本父任务范围。

## Notes

父任务应随每个子任务完成持续更新流程地图，而不是提前写死全量路线。目标是保持重构节奏与玩家真实流程一致，避免为了架构完整性过度设计。

渐进重构的验证环节会暴露 schema/架构问题——这些问题不绑定玩家流程某一步骤，属于跨步骤的演进，单独拆子任务处理。验证发现可能导致架构方向转变（如 2026-07-07 的素材库模型转变），届时需重新规划 Player Flow Map 和 Child Task Map，但核心方法论（玩家流程逐步重构）不变。

架构设计原则沉淀在 `airp-data-capability-design-principles.md`，每条含"原则 + 可操作判据 + 执行手段"。后续设计决策应对照该 spec 验证。
