# 回合后维护 + frontier 推进触发

## Goal

完成父任务 `07-06-agent-roster-progressive-refactor` 的子任务 E：在正式玩家回合正文落定后，由场记维护本回合产生的 runtime/entity/scene/relationship 等状态变化，并在维护完成后由前端基于 `runtime.worldTime`、`frontier.sourceWindow` 与 `frontier.timeline` 的客观边界判断触发 world-architect 推进 source frontier、追加 timeline 锚点。

本任务承接已确认的素材库模型：小说是素材库，不是剧本；frontier 推进只扩展可用素材边界，不产生剧情方向指导；不重新引入 director/brief/mode.json。

## Background / Confirmed Facts

### 父任务上下文

- 本任务是父任务 `07-06-agent-roster-progressive-refactor` 的子任务 E，对应 Player Flow Map 步骤 3「回合后维护」与步骤 4「frontier 推进触发」（父任务 `prd.md:152-154`, `prd.md:172-174`）。
- 父任务已确认 A' 方案：前端在场记完成后检查 `worldTime` / timeline 锚点 / `sourceWindow` 边界，接近边界则用现有 `invokeAgent("world-architect")` 推进，不开发后台 agent_call 平台能力（父任务 `design.md:107-118`，父任务 `prd.md:99`）。
- 子任务 D 已刻意排除 E：正式玩家回合只到 storyteller/researcher，回合后 `triggerSyncAfterTurn` 与 stage-manager 维护属于本任务（归档 D `prd.md:44-49`, `prd.md:96-98`）。
- 已定原则不重复讨论：AGENT.md 写定位/方法论，Skill 正文写流程；contextPaths 是高频常驻参考；每个字段必须有真实消费者；已处理 Agent 只补当前步骤需要的职责。

### 已有回合后维护编排

- `useTsian` 在正式 turn 完成后调用 `triggerSyncAfterTurn(turnCount.value)`，不阻塞正文落定展示（`apps/play-frontend-dev/src/composables/useTsian.ts:170-175`）。
- `useSyncAfterTurn` 已实现模块级 `SyncPhase` 状态机、读取 `entrypoints.postTurnMaintenance`、调用维护 Agent、失败重试、完成回调（`apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts:4-17`, `apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts:33-50`, `apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts:59-98`）。
- 当前维护调用使用 `commitMode: "workspace"`，不会生成 post-maintenance checkpoint（`apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts:80-86`）。
- 平台端 `invokeAgent` 已支持 `commitMode: "workspace-with-checkpoint"`，并将 `checkpointReason` 限定为 `"post-turn-maintenance"`（`apps/platform-web/src/platform-host/index.ts:1153-1171`, `apps/platform-web/src/platform-host/index.ts:1419-1428`）。
- 存储层 `commitWorkspaceFilesWithCheckpointForSave` 已实现：创建 `post-turn-maintenance` checkpoint，并删除同 turn 的 `after-turn` checkpoint，使维护后状态成为该回合规范恢复点（`apps/platform-web/src/storage/saves.ts:220-240`, `apps/platform-web/src/storage/saves.ts:241-290`）。
- `useRuntime` 已在 sync 完成后刷新 runtime 数据（`apps/play-frontend-dev/src/composables/useRuntime.ts:6-12`, `apps/play-frontend-dev/src/composables/useRuntime.ts:137-143`）。

### stage-manager 现状

- `stage-manager` 已有 `platformTools: ["workspace_read", "workspace_write", "agent_call"]`，可写 save runtime，也可 call researcher/world-architect（`apps/platform-web/src/storage/workspace-templates.ts:1680-1682`）。
- `stage-manager/AGENT.md` 当前定位为回合后把变化维护到存档，维护 runtime/entities/scenes/relationships/memory/extensions；需要事实 call 资料员，需要 schema 设计 call 世界架构师（`apps/platform-web/src/storage/workspace-templates.ts:1685-1697`）。
- `状态栏维护` Skill 已要求维护 `runtime.worldTime`，但它目前仍是通用状态栏维护说明，没有围绕「正式回合后维护 + worldTime 驱动 frontier 触发」重写职责边界（`apps/platform-web/src/storage/workspace-templates.ts:399-424`）。
- `07-05-runtime-world-time-field` 已交付 `runtime.worldTime` 固定字段，明确字符串形态、不做完整日历系统、不做排序/换算（归档 `07-05-runtime-world-time-field/prd.md:18-28`, `design.md:8-24`）。

### stage-manager 当前上下文来源

- 前端只给一条简短 invoke input：`玩家回合 #<turn> 已完成...请维护...`（`apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts:33-42`）。重试 input 也只是“重新维护上一回合...”摘要（`apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts:45-50`）。
- `invokeAgent` 会在旁路调用开始时读取当前 save 的完整 workspace、当前 max turn、以及 `recentHistory`；因调用发生在正式 turn 完成后，`recentHistory` 已包含刚完成 turn 的 user/assistant 干净正文，但不包含完整 timeline/tool/options 细节（`apps/platform-web/src/platform-host/index.ts:1210-1215`, `apps/platform-web/src/platform-host/index.ts:1247-1256`, `apps/platform-web/src/platform-host/history-turns.ts:215-247`）。
- `persist: true` 让 stage-manager 使用持久上下文 `save/agents/stage-manager/context.json`（默认 slot），下一次回合后维护会读回该上下文（`apps/platform-web/src/platform-host/index.ts:1173-1175`, `apps/platform-web/src/platform-host/index.ts:1235-1239`）。
- Agent context assembly 会注入 AGENT.md、可选 SOUL.md、`save/agents/stage-manager/notes.md`（自动路径）和 agent.json 中声明的 contextPaths（`apps/platform-web/src/agent-runtime/context.ts:81-120`）。
- 当前 stage-manager contextPaths 只有 schema guide、schema current、runtime.json、scenes README、relationships README；不会自动注入 active scene 文件、present entities、relationship shards 或完整 turn file（`apps/platform-web/src/storage/workspace-templates.ts:1671-1680`）。这些状态事实目前需要 stage-manager 自行多次 workspace_read/list 获取。

### world-architect / frontier 现状

- `world-architect` 当前 skills 只有 `开局建模` 和 `游玩设定`，还没有 ongoing 的 frontier 推进 Skill（`apps/platform-web/src/storage/workspace-templates.ts:1704-1713`）。
- `world-architect/AGENT.md` 已有“不维护每回合 runtime，不写玩家正文，只使用已读内容”的常驻原则；这与本任务的 frontier 推进职责不冲突，但需要补充 ongoing 推进方法（`apps/platform-web/src/storage/workspace-templates.ts:1718-1732`）。
- `frontier.json` 已包含 `sourceWindow` 与 `timeline`，schema 文档明确 `sourceWindow` 记录已读窗口、`timeline` 记录时间锚点，两者通过 `chapter` 关联，推进时 `sourceWindow` 移动、`timeline` 追加（`apps/platform-web/src/storage/workspace-templates.ts:1243-1266`, `apps/platform-web/src/storage/workspace-templates.ts:1469-1494`）。
- 开局 `commit_runtime_and_frontier` 只服务 opening initialization，可校验并写入 runtime/frontier/timeline（`apps/platform-web/src/storage/workspace-templates.ts:715-787`）。本任务需要 ongoing frontier 推进能力，不能复用开局语义不加区分。
- 默认 `frontier.json` 种子目前为 `{ sourceWindow: { start: null, end: null }, extractedThrough: null, timeline: [{ chapter: 1, time: "元年", label: "开局" }] }`（`apps/platform-web/src/storage/workspace-templates.ts:2052`）。

### 已有 checkpoint / restore 约束

- 早期 `07-04-novel-frontend-stage-manager-after-turn` 设计时，`workspace-with-checkpoint` 还是缺口，故选择 `commitMode: "workspace"` 并记录 restore 不一致问题（归档 `07-04-novel-frontend-stage-manager-after-turn/design.md:207-218`）。
- 现在平台能力已补齐，E 应把回合后维护切到 `workspace-with-checkpoint`，避免恢复到“正文已存在但状态维护缺失”的旧缺口。

## Requirements (Draft)

### 回合后维护

- R1: `stage-manager` 的回合后维护职责应围绕正式玩家回合重写：读取刚完成 turn、正文结果、现有 runtime/entity/scene/relationship，维护已发生事实，不创作新剧情。
- R2: `stage-manager` 必须维护 `runtime.worldTime`：按正文中时间推进或场景变化更新为简短叙事字符串；未知或无变化时保持原值/空值，不发明完整日历系统。
- R3: `stage-manager` 继续维护 runtime/weather/location/activeSceneRefs/protagonistRef/extensions、entity、scene、relationship；entity 为权威，scene/relationship 为派生导航视图，relationship 只承载 character↔character 人物关系。
- R3a: `stage-manager` 负责 scene 生命周期与过期 scene 清理。scene 是当前/后台 playthrough 局面导航缓存，不是剧情历史、原著场景资料库或检索主索引；过往剧情检索应读正式 turn history。过期 scene 不归档为历史资料，确认不再作为 active/background 导航后可删除。frontier 推进不写 scene，实际玩家局面由 stage-manager 根据正文维护。
- R4: `stage-manager` 不负责判断是否推进 frontier，不读未读章节；frontier 推进判断由前端客观计算，推进动作由 world-architect 执行。
- R5: 回合后维护 `invokeAgent` 应使用 `commitMode: "workspace-with-checkpoint"`（默认/显式 `checkpointReason: "post-turn-maintenance"`），让维护后状态替换同 turn 的 after-turn checkpoint，成为 restore 的规范状态。
- R6: 同步失败仍保持现有行为：正文不隐藏，下一轮输入锁定，玩家可重试；不得在旧状态上继续下一轮。
- R6a: `stage-manager` 主 Skill 从 `状态栏维护` 重命名并重写为 `回合后维护`，覆盖 runtime/entity/scene/relationship/memory/extensions 的回合后事实维护；旧 `状态栏维护` Skill 不保留，避免 AI-facing Skill 名称误导或重复选择。`schema演进检查` 继续作为独立 Skill 保留。
- R6b: Tool 设计不自限于“通用共享能力”。若某个 Agent-local 专用 Tool 能显著减少多步读写/格式化/清理成本，并且能力边界清晰，也可以作为专用 Tool 提供；判据是工作效率、错误后果与职责边界，而不只是跨 Agent 通用性。
- R6d: `回合后维护` Skill 不新增万能批量写入 action。stage-manager 使用 `read_maintenance_context` 聚合事实后，通过现有 `workspace.write/edit/delete` 维护 runtime/entity/scene/relationship；同一次 invokeAgent 的 workspace mutations 由平台事务统一提交。若后续发现某类写入高频且易错，再拆小专用 action，不在本任务引入覆盖所有 schema 的大 commit 脚本。

### frontier 触发

- R7: 前端在 stage-manager 同步成功、runtime 刷新后读取 `runtime.worldTime` 与 `frontier.json`，执行客观 frontier 边界检查。
- R8: 边界检查遵循父任务 A'，但前端不做自由文本时间语义理解。触发条件采用代码可判断的客观近似：stage-manager 维护后 `runtime.worldTime` 字符串发生变化、timeline 最新锚点 chapter 距 `sourceWindow.end` 3 章以内、后续仍有未读章节，且没有相同 key 的已完成/失败未重试/进行中记录，则触发 world-architect frontier 推进。
- R9: 前端触发不把 novel AIRP 的 `frontierAdvance` 概念上升到平台 contracts / manifest entrypoints。默认 novel 前端按默认 novel AIRP 卡模板的局部约定调用 `world-architect`；这是前端与默认卡的玩法编排约定，不是平台通用能力。触发 purpose 使用 `"frontier-advance"`，contextSlot 使用独立 slot，避免污染 opening/play-setup context。
- R10: frontier 推进触发需要防抖/去重：同一 `worldTime` + `sourceWindow.end` + 最近锚点组合已经触发过或正在触发时，不重复启动。
- R11: frontier 推进为非阻塞流程：触发后不锁 Composer、不阻止玩家进入下一轮；成功后的新素材从后续回合自然生效。
- R12: frontier 推进必须有明确 Toast 提示，至少区分“正在拓展素材边界 / 已拓展 / 拓展失败”。失败态提供轻量“重试”入口，但不锁输入；玩家可继续游玩，也可手动重试拓展素材边界。
- R12a: 前端维护 save-scoped 编排状态文件 `save/playthrough/frontier-trigger-state.json`，用于记录 frontier 触发去重、最近成功/失败 key 与调试信息。该文件属于默认 novel AIRP 前端/卡约定，不进入平台 contracts / manifest entrypoints / bridge 通用 API。in-flight 状态只保存在前端内存，避免刷新后留下 stale lock。字段保持最小：`version`、`lastChecked`（turn/worldTime/sourceWindowEnd/anchorChapter/key）、`lastCompleted`（turn/key/completedAt）与 `lastFailed`（turn/key/message/failedAt 或 null）；不记录 attempts 历史数组。

### world-architect frontier 推进

- R13: 新增 world-architect ongoing Skill（名称暂定 `frontier推进`）：按当前 `frontier.sourceWindow`、`runtime.worldTime` 与 timeline，读取下一段源章节窗口，推进素材边界，并抽取与当前阶段可能相关的最小实体/人物关系/schema 增量，更新 `frontier.sourceWindow` / `extractedThrough` / `timeline`。该能力做成 Skill（流程知识 + actions），不是单个 Tool；actions 拆为 `read_frontier_window`（只读窗口）、`commit_frontier_materials`（写实体/人物关系/schema patch 增量）、`commit_frontier_state`（写 frontier 指针与 timeline）。抽取规范需防止“什么都抽”和“有用的没抽到”，详见后续设计。
- R14: frontier 推进只扩展素材库边界。AI-facing Skill 正文采用正向产物边界：产物只落在 `frontier.json`、`save/entities/`、`save/relationships/`、必要的 `save/schema/patches/pending/`，以及机械性的推进结果摘要（读到范围、抽取数量、更新路径）。不在 Skill 中设置剧情规划、阶段目标或创作指导类输出项；不写 `save/scenes/`，scene 由 stage-manager 根据玩家实际正文维护。
- R14a: frontier 状态推进必须在素材增量提交成功之后执行。流程为 `read_frontier_window` → 抽取最小素材增量 → `commit_frontier_materials` → `commit_frontier_state`；若素材提交失败，不推进 `sourceWindow` / `extractedThrough`。无可抽取素材时也需通过空 materials 提交明确完成后再推进 frontier。
- R15: 推进窗口遵循父任务既定限制：固定 10 章窗口；过去章节不倒回搜索；窗口外不读；不开发后台 agent_call 平台能力。
- R16: world-architect 推进需要使用专门脚本/Skill action 写入 frontier（以及必要实体/人物关系/schema 增量），不能把开局 `commit_runtime_and_frontier` 当作 ongoing 语义直接复用。
- R17: world-architect 仍不维护每回合 runtime；runtime.worldTime 权威由 stage-manager 更新。

### 文档与父任务同步

- R18: 更新默认模板内 Agent / Skill / schema 文档，使 stage-manager 与 world-architect 的职责表述与素材库模型一致。
- R19: 更新父任务 Player Flow Map 与 Current Agent / Skill / Tool Ledger，标记 E 完成并记录最终职责。
- R20: 不重新引入 director、brief、mode.json；不新增 UI 模块/状态栏字段/人物卡渲染，除非只是复用现有 SyncToast/状态刷新机制。

## Acceptance Criteria (Draft)

- [ ] `stage-manager/AGENT.md` 与 `回合后维护` Skill 明确回合后维护职责，包含 worldTime 维护、scene 生命周期清理，不承担 frontier 推进判断；旧 `状态栏维护` Skill 名称不再保留。
- [ ] `stage-manager` 新增 Agent-local `read_maintenance_context` Tool：默认返回目标 turn 的 user/assistant 正文、runtime、active scene、相关 entity/relationship 摘要与 scene 清理客观候选；`includeTimeline` 默认为 false；Tool 不写 workspace、不输出删除决策。
- [ ] `runtime.worldTime` 在场记维护后可被前端刷新读取，刷新路径不依赖手动重载。
- [ ] 前端实现 frontier 边界检查：读取 runtime/frontier、映射 timeline 锚点、按“距 `sourceWindow.end` 3 章以内 + worldTime 变化”触发。
- [ ] 前端用 `save/playthrough/frontier-trigger-state.json` 持久化 frontier 触发去重与最近成功/失败记录；in-flight 状态仅内存保存，刷新后不形成 stale lock。
- [ ] frontier 推进为非阻塞流程：触发期间 Composer 不因素材推进被禁用，玩家可继续下一轮。
- [ ] frontier 推进有玩家可见 Toast，覆盖进行中、成功、失败三态；失败态提供“重试”入口且不禁用 Composer。
- [ ] world-architect 新增 ongoing frontier 推进 Skill / action，能推进 `frontier.sourceWindow`、追加/维护 timeline 锚点，并按明确抽取规范写入最小相关实体/人物关系/schema 增量；Skill 产物边界不包含剧情规划、阶段目标、创作指导或 `save/scenes/` 输出项。
- [ ] researcher 的已读窗口检索模型与新 frontier 推进结果兼容：推进后 `frontier.json` 仍满足 D 中 researcher 的读取假设。
- [ ] 父任务 PRD 更新：E 标记完成，Player Flow Map 与 Ledger 反映 stage-manager/world-architect 新职责。
- [ ] 必要检查通过：涉及 contracts 则 `npm run build:contracts`；涉及 play frontend 则 `npm run build --workspace play-frontend-dev`；涉及 platform template/storage 则 `npm run build:web`。

## Out of Scope

- 不开发后台 agent_call / 真后台任务平台能力（父任务问题 C）。
- 不让 researcher 在找不到时推进 frontier；researcher 仍保持只读。
- 不新增 director、brief 或剧情方向控制文档。
- 不做完整日历系统、时间排序/换算算法。
- 不新增状态栏/人物卡/背包 UI；本任务只利用已有 sync 状态和 runtime 刷新机制。
- 不把 novel AIRP 的 `frontierAdvance` 概念写进平台 contracts、manifest entrypoints 或 bridge 通用 API；平台不硬编码玩法，frontier 推进由默认 novel 前端与默认 novel AIRP 卡模板自行约定。

## Open Questions

(none)

## Notes

- 本 PRD 是初版，会在头脑风暴回答后做 PRD convergence pass，删除已解决问题并收敛 Requirements / Acceptance Criteria。
