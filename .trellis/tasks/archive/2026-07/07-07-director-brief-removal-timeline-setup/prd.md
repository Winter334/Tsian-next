# 导演与 brief 移除 + timeline 建立

## Goal

落实素材库模型的第一步架构转变：移除 director Agent 与 brief 文档体系，同时建立 timeline 机制的基础（frontier.json 新增 `timeline` 字段 + 开局建立第一个锚点 + `runtime.worldTime` 元年初始化）。移除与建立必须原子完成——移除 brief 后 researcher 找素材失去依据，必须同时有 timeline 替代其索引功能。

## Background

### 上游决策

父任务 `07-06-agent-roster-progressive-refactor` 在 2026-07-07 架构讨论中确立了从"原著中心模型"到"素材库模型"的转变（详见父任务 `design.md`）。核心结论：

- 导演的三个职责（剧情方向/节奏控制/伏笔管理）在新模型下全部失去依据 → 移除。
- brief 的本质是"原著走向指导"，混淆三个读者（说书人/导演/场记），无法通过重新定位修复 → 移除。
- timeline 机制替代 brief 的索引功能：元年基准 + worldTime 维护 + 锚点渐进补充 + researcher 映射找素材。

### 前置事实

- `07-07-entity-schema-prune-no-consumer-fields` 已归档：entity 的 `updatedAt`/`updatedBy`/`sourceRefs`/`origin` 四个无消费者字段已移除。B 在干净 schema 上进行。
- `07-05-runtime-world-time-field` 已归档：`runtime.worldTime` 字段已端到端交付（schema/seed/opening write/stage-manager 维护指引/前端 type+parse+inject+render）。B **不需要**重建 worldTime 维护机制，只补 timeline 锚点 + 元年初始化指引。
- `07-06-understanding-step-world-architect-director` 已归档但保留了 director 不改的结论——B 负责清理该遗留。

### 紧耦合原因

不能分两次做（先移除 brief 再建 timeline，或先建 timeline 再移除 brief）：

- 先移除 brief → researcher 找素材失去依据（中间状态无索引）。
- 先建 timeline → brief 还在，Agent 困惑该读哪个索引。

必须同一次提交同时完成移除与建立。

## Requirements

### 移除类

- R1: 移除 director Agent 的全部定义——`agent.json`、`AGENT.md`、`SOUL.md`、`剧情指导维护` Skill（含其 `SKILL.md` 文件登记）、`save/agents/director/notes.md` 种子。
- R2: 移除 brief 文档体系——`save/director/current-brief.md`、`save/director/current-brief.meta.json`、`save/director/README.md` 种子，以及 `save/director/` 目录登记。
- R3: 清理所有 Agent 对 brief 的引用——storyteller / stage-manager 的 `contextPaths` 中的 `current-brief.md`，researcher 检索 Skill 正文中的 "brief" 提及，world-architect 开局建模 Skill 中"agent_call 导演写 brief"步骤，schema guide / schema reference / 各 README 中的 brief/director 段落。
- R4: 清理 4 个 Agent（storyteller / researcher / stage-manager / world-architect）`contacts` 数组中的 `director` 条目。
- R5: 清理前端 director 残留——`UnderstandingRunning.vue` STAGES 数组中"导演正在校准剧情方向…"条目、`useSetupState.ts` `mapToolToStage` 的 `agent_call → 3` 分支及对应注释、`source.ts` `buildOpeningInitializationPrompt` 第 5 条"agent_call 导演写初始 director brief"指令。
- R6: 从 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 移除 director/brief 相关路径。

### 建立类

- R7: `frontier.json` 新增 `timeline` 字段——数据结构 `Array<{ chapter: number, time: string, label: string }>`，chapter 为原著章节号，time 为元年基准时间字符串（自由粒度，默认年+季/月），label 为一句话客观标签（非剧情摘要）。
- R8: `frontier.json` 种子初始化 `timeline: [{ chapter: 1, time: "元年", label: "开局" }]`。
- R9: `commit_runtime_and_frontier` 脚本支持写入 `timeline` 字段（从 world-architect 输入透传，脚本不硬编码锚点内容）。
- R10: `WORLD_ARCHITECT_OPENING_SKILL_MD` 补充步骤——建模末尾建立第一个 timeline 锚点 `{ chapter: 1, time: "元年", label: "开局" }` 并通过 `commit_runtime_and_frontier` 写入 frontier.json；同时将 `runtime.worldTime` 初始化为 `"元年"`。
- R11: schema guide / schema reference / `save/playthrough/README.md` 同步记录 `frontier.json.timeline` 字段。

### 边界约束

- R12: 不在 B 中做游玩设定步重构（`buildPlaySetupPrompt` 的 mode.json 残留 + agent_call storyteller 拿开局正文）——属子任务 C。
- R13: 不在 B 中做 researcher 映射 timeline 找素材逻辑、frontier 推进 Skill、A' 前端触发——分别属 D / E。
- R14: 不在 B 中重写 stage-manager 维护 worldTime 的职责指引——`07-05` 已交付，B 只确保新 timeline 步骤与既有 worldTime 指引不冲突。
- R15: `visibility` 枚举值 `director-only` 的处理见 `design.md` 决策——倾向移除（无消费者），但需在 design 中确认。

## Acceptance Criteria

- [ ] `rg -i "director|导演" apps/platform-web/src/storage/workspace-templates.ts` 仅剩历史 changelog 或零命中。
- [ ] `rg "current-brief|director brief|剧情指导" apps/platform-web/src/storage/workspace-templates.ts` 零命中。
- [ ] `rg -i "director" apps/play-frontend-dev/src` 仅剩注释清理或零命中（`source.ts:495` 已改、`UnderstandingRunning.vue` STAGES 已精简、`useSetupState.ts` agent_call 分支已移除）。
- [ ] `frontier.json` 种子含 `timeline: [{ chapter: 1, time: "元年", label: "开局" }]`。
- [ ] `COMMIT_RUNTIME_AND_FRONTIER_SCRIPT_JS` 写入的 frontier 对象含 `timeline` 字段（透传 world-architect 输入）。
- [ ] `WORLD_ARCHITECT_OPENING_SKILL_MD` 含"建第一个 timeline 锚点 + worldTime 初始化为元年"步骤，且不再出现"agent_call 导演写 brief"。
- [ ] storyteller / stage-manager 的 `contextPaths` 不再含 `current-brief.md`。
- [ ] 4 个 Agent 的 `contacts` 数组不再含 `director`。
- [ ] schema guide / schema reference / `save/playthrough/README.md` 记录 `frontier.json.timeline`。
- [ ] `npm run build --workspace play-frontend-dev` 通过。
- [ ] `npm run build:web` 通过。
- [ ] 浏览器验证：开局向导 Step 2 完成后——`save/playthrough/frontier.json` 有 `timeline` 第一个锚点；`save/playthrough/runtime.json` 的 `worldTime` 为 `"元年"`；`save/director/` 目录不存在；无 director Agent 产出。
- [ ] 父任务 PRD 的 Child Task Map 标记 B 完成；Current Agent / Skill / Tool Ledger 更新 director 为已移除、world-architect 补 timeline 职责。

## Out of Scope

- 游玩设定步重构（`buildPlaySetupPrompt` / mode.json 残留 / agent_call storyteller）——子任务 C。
- researcher 映射 timeline → 窗口找素材 → 推进 frontier 的运行时逻辑——子任务 D。
- stage-manager 回合后维护 worldTime 的职责重写（B 只确保不冲突，不重写）——子任务 E。
- frontier 推进 Skill（ongoing，非开局）+ A' 前端触发——子任务 E。
- 后台 agent 调用平台能力——另行讨论，不在本任务范围。
- `docs/active/*` 方向文档中的 director 残留（这些文档早于本次重构且不被代码消费，不作为 B 的验收项）。

## Notes

- B 的验证点是开局向导 Step 2（Understanding）——这一步浏览器可独立验证。Step 4/5 的重构属 C，不在 B 验证范围。
- 父任务 `design.md` 是 B 的共享设计参考，记录了 timeline 方案、导演移除理由、紧耦合原因的完整推理。B 的 `design.md` 只记录 B 特有的执行决策边界。
