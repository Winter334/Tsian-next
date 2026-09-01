# 实现计划：回合后维护 + frontier 推进触发

> 有序实现检查清单。每个阶段完成后运行验证命令。涉及 `workspace-templates.ts` 的改动密集，务必先 grep 定位再改。

## 阶段 0：前置确认

- [x] 0.1 确认当前在 master 分支，工作区干净
- [x] 0.2 确认 `task.py current` 指向本任务（或尚未 start，后续 1.4 做）
- [x] 0.3 通读 design.md，确认 order 系统、触发数据流、agent 职责边界无歧义

## 阶段 1：schema 变更 + 种子更新（workspace-templates.ts）

> 先改数据模型，让后续 agent/skill 改动有字段可用。

- [x] 1.1 frontier.json schema 文档更新：timeline 锚点新增 `kind`/`order`/`turn`/`alignment`/`sourceRef` 字段说明
  - 定位：`NOVEL_AIRP_SCHEMA_GUIDE_MD`（约 1243-1266）和 `NOVEL_AIRP_SCHEMA_REFERENCE_MD`（约 1469-1494）
  - source 锚点字段：`{ kind: "source", order, chapter, time, label }`
  - player 锚点字段：`{ kind: "player", order, turn, time, label, alignment, sourceRef }`
  - 补充 order 线性递增说明、alignment 三值语义
- [x] 1.2 runtime.json schema 文档更新：新增 `plotOrder` 字段说明
  - 定位：搜索 runtime.json 的 schema 文档段落
  - 说明：数字，单调递增，表示玩家当前走到哪个 source order
- [x] 1.3 frontier.json 种子更新：timeline 第一个锚点加 `kind:"source", order:1`
  - 定位：`workspace-templates.ts:2052` 附近
  - 改为 `{ kind: "source", order: 1, chapter: 1, time: "元年", label: "开局" }`
- [x] 1.4 runtime.json 种子更新：新增 `plotOrder: 1`
  - 定位：搜索 runtime.json 种子定义
- [x] V1: `npm run build:web` — 确认模板变更编译通过

## 阶段 2：stage-manager 改造（workspace-templates.ts）

> 改 agent 定义、Skill、Tool。改动集中在 stage-manager agent block（约 1671-1701）和 Skill 定义（约 399-444）。

- [x] 2.1 stage-manager contextPaths 加入 `save/playthrough/frontier.json`
  - 定位：`workspace-templates.ts:1677`
  - 在现有 5 项后追加 `"save/playthrough/frontier.json"`
- [x] 2.2 stage-manager AGENT.md 重写：围绕正式回合后维护 + plotOrder 映射 + player 锚点追加 + scene 生命周期
  - 定位：`workspace-templates.ts:1685-1697`
  - 保留"需要事实 call researcher，需要 schema 设计 call world-architect"
  - 新增"维护 runtime.plotOrder：读 frontier.json timeline，映射玩家当前到哪个 source order"
  - 新增"追加 player 锚点：偏离/并回/结果不同时建 `{kind:"player",...}`"
  - 明确"不判断是否推进 frontier，不读未读章节，不写 source 锚点"
- [x] 2.3 `状态栏维护` Skill 重命名为 `回合后维护` 并重写
  - 定位：`workspace-templates.ts:399-424`（常量 `STAGE_MANAGER_STATUS_SKILL_MD`）
  - 常量名改为 `STAGE_MANAGER_MAINTENANCE_SKILL_MD`
  - Skill name 改为 `回合后维护`
  - 正文覆盖：runtime（worldTime + plotOrder）/ entity / scene / relationship / memory / extensions 维护 + plotOrder 映射方法 + player 锚点追加判据 + scene 清理
  - 同步更新 agent.json skills.enabled 中的路径引用（`workspace-templates.ts:1678`）：`agents/stage-manager/skills/状态栏维护/SKILL.md` → `agents/stage-manager/skills/回合后维护/SKILL.md`
  - 同步更新 Skill 文件 emit 路径（`workspace-templates.ts:1740`）
- [x] 2.4 新增 `read_maintenance_context` Tool 定义
  - 定位：在 stage-manager tools 区域新增（参考 storyteller read_entity/scene/relationships 的定义模式，约 133-370）
  - tool.json：name `read_maintenance_context`，description，inputSchema（turn: number, includeTimeline: boolean default false）
  - run.js：聚合目标 turn 的 user/assistant 正文、runtime、active scenes、相关 entities/relationships、scene cleanup candidates、optional timeline
  - Tool 不写 workspace、不输出删除决策
  - 在 stage-manager agent.json tools.enabled 中加入该 Tool（`workspace-templates.ts:1679`）
- [x] V2: `npm run build:web` — 确认模板变更编译通过

## 阶段 3：world-architect frontier推进 Skill（workspace-templates.ts）

> 新增 ongoing Skill + 3 个 script action。改动集中在 world-architect agent block（约 1704-1736）和新增 Skill 定义。

- [x] 3.1 新增 `frontier推进` Skill 定义（SKILL.md 内容）
  - 在 world-architect Skill 区域新增常量（参考 `WORLD_ARCHITECT_OPENING_SKILL_MD` 模式，约 1040+）
  - Skill name: `frontier推进`
  - 正文：推进流程（read_frontier_window → 识别剧情节点 + 抽取素材 → commit_frontier_materials → commit_frontier_state）
  - 抽取规范：抽什么（entity/relationship/schema patch）、不抽什么（scene/player anchor/剧情规划）
  - source 锚点建立规范：识别剧情节点、无时间词时估算 time、label 客观标签
  - order 赋值规范：严格大于现有最后 source order
- [x] 3.2 新增 3 个 script action 定义
  - `read-frontier-window.js`：读 frontier.json 当前 sourceWindow → 计算 next 10 章 → 读 `save/source/chapters/` → 返回章节文本 + frontier 状态
  - `commit-frontier-materials.js`：校验 entities/relationships/schemaPatches 增量 → 写入对应目录
  - `commit-frontier-state.js`：校验 order 递增、sourceWindow 顺序推进、timeline 锚点 chapter 在窗口内 → 写入 frontier.json
- [x] 3.3 world-architect agent.json skills.enabled 加入 `frontier推进`
  - 定位：`workspace-templates.ts:1711`
  - 追加 `"agents/world-architect/skills/frontier推进/SKILL.md"`
- [x] 3.4 world-architect AGENT.md 补充 ongoing 推进方法论
  - 定位：`workspace-templates.ts:1718-1732`
  - 保留现有常驻原则
  - 新增"ongoing 推进：被前端触发时读下一段源章节，建 source 锚点，抽最小素材增量"
  - 明确"不写 runtime，不写 player 锚点，不写 scene"
- [x] 3.5 Skill 文件 emit 路径注册
  - 在模板 emit 区域（约 1742+）注册新 Skill 文件 + script 文件的 emit
- [x] V3: `npm run build:web` — 确认模板变更编译通过

## 阶段 4：useSyncAfterTurn checkpoint 切换（play-frontend-dev）

- [x] 4.1 commitMode 从 `"workspace"` 改为 `"workspace-with-checkpoint"`，加 `checkpointReason: "post-turn-maintenance"`
  - 定位：`useSyncAfterTurn.ts:85`
- [x] 4.2 invoke input 微调（可选）：措辞可提及 plotOrder/timeline 维护，但不做前端判断
  - 定位：`useSyncAfterTurn.ts:41`
- [x] V4: `npm run build --workspace play-frontend-dev` — 确认前端编译通过

## 阶段 5：useFrontierAdvance composable（play-frontend-dev）

> 新增 frontier 触发逻辑，全新文件，不影响现有维护流程。

- [x] 5.1 新增 `apps/play-frontend-dev/src/composables/useFrontierAdvance.ts`
  - 模块级状态：phase（idle/advancing/succeeded/failed）、isInFlight（仅内存）
  - `checkFrontierAdvance()`：读 runtime.plotOrder → 读 frontier.json → 计算 lastSourceOrder → 读 source manifest totalChapters → 去重检查 → 条件判断 → invokeAgent("world-architect", { purpose:"frontier-advance", contextSlot:"frontier-advance", persist:true, commitMode:"workspace" })
  - `retryFrontierAdvance()`：手动重试，忽略 lastFailed key 去重
  - onAgentInvocation 事件订阅（同 useSyncAfterTurn 模式）：completed → succeeded + 更新 trigger-state，failed → failed + 更新 trigger-state
  - Toast 三态文案
- [x] 5.2 frontier-trigger-state.json 读写
  - loadTriggerState()：读 `save/playthrough/frontier-trigger-state.json`，不存在返回默认
  - saveTriggerState()：写 lastChecked/lastCompleted/lastFailed
  - in-flight 不持久化
- [x] 5.3 集成到 useRuntime 或 useSyncAfterTurn
  - 在 sync 完成且 runtime 刷新后调用 checkFrontierAdvance()
  - 确保 runtime 数据已刷新再检查（refresh 是 async，需 await）
- [x] 5.4 Toast UI：复用现有 SyncToast 机制，新增 frontier advance 三态
  - 定位：搜索现有 Toast 组件（SyncToast 或类似）
  - 进行中："正在拓展素材边界…"
  - 成功："已拓展素材边界"（1.5s 淡出）
  - 失败："素材边界拓展失败" + "重试"按钮（不锁 Composer）
- [x] V5: `npm run build --workspace play-frontend-dev` — 确认前端编译通过

## 阶段 6：集成验证

- [x] 6.1 `npm run build:web` — 全量平台编译
- [x] 6.2 `npm run build --workspace play-frontend-dev` — 全量前端编译
- [x] 6.3 `npm run build:contracts` — contracts 编译（确认未误改 contracts）
- [ ] 6.4 浏览器手动验证（待用户手测）：
  - 开局 → 确认 frontier.json 种子有 order/kind 字段
  - 玩一回合 → 确认 stage-manager 维护后 runtime 有 plotOrder
  - 推进剧情到越过最后 source 锚点 → 确认 frontier 触发 + Toast + world-architect 推进
  - 确认推进期间 Composer 不锁
- [x] 6.5 researcher 兼容性检查：确认 D 中 researcher 的 frontier.json 读取假设仍满足（sourceWindow/timeline 结构兼容）

## 阶段 7：文档与父任务同步

- [x] 7.1 更新父任务 07-06 PRD：E 标记完成，Player Flow Map 与 Ledger 反映 stage-manager/world-architect 新职责
- [x] 7.2 确认 schema 文档（guide + reference）已反映新字段（阶段 1 已做，此处复核）
- [x] 7.3 记录 journal

## 验证命令汇总

```bash
npm run build:web                    # 平台模板/存储编译
npm run build --workspace play-frontend-dev  # 前端编译
npm run build:contracts              # contracts 编译（应无变化）
```

## 风险点

1. **workspace-templates.ts 改动密集**：stage-manager block、world-architect block、Skill 定义、Tool 定义、schema 文档、种子——多处改动在同一大文件。每处改动前 grep 定位确认行号，改后立即 build 验证。
2. **Skill 重命名连锁**：`状态栏维护` → `回合后维护` 涉及常量名、Skill 正文、agent.json skills.enabled 路径、emit 路径——全部要同步，遗漏任一会导致 Skill 文件缺失。
3. **useRuntime refresh async 集成**：refresh 是 async，setOnSynced 回调当前不 await。frontier 检查依赖 runtime 已刷新，需确保调用顺序。可能需要改 setOnSynced 为 async 或在 useRuntime 中链式调用。
4. **frontier.json 读取路径**：前端通过 `tsian.workspace.read({ path: "save/playthrough/frontier.json" })` 读取。确认 bridge 支持 workspace.read（应该是现有能力）。
5. **source manifest totalChapters**：确认 `save/source/manifest.json` 的字段名（totalChapters? chapters.length?），前端需正确读取总章节数。

## 回滚点

1. 阶段 1-3 的模板改动 → git revert workspace-templates.ts
2. 阶段 4 的 commitMode → 改回 `"workspace"`
3. 阶段 5 的 useFrontierAdvance → 删除新文件 + 移除集成调用
4. 无生产存档迁移需求（开发阶段）

## 完成情况

> 代码于 2026-07-09 落地（commit `d874b11` 为主提交，`3189a29`/`d4db46c`/`8fc74f9` 为后续精修），本节事后补记。

- **阶段 0–5**：全部完成。schema 文档与种子、stage-manager 改造（contextPaths / AGENT.md / Skill 重命名 / read_maintenance_context Tool）、world-architect frontier推进 Skill + 3 script action、useSyncAfterTurn checkpoint 切换、useFrontierAdvance composable + FrontierToast + useRuntime 集成，均已落地并通过构建。
- **阶段 6.1–6.3**：`build:contracts` / `build:web` / `build --workspace play-frontend-dev` 三套构建均通过。
- **阶段 6.4**：浏览器手动验证（开局种子字段、维护后 plotOrder、frontier 触发 + Toast、推进期间 Composer 不锁）待用户手测，本环境无法执行。
- **阶段 6.5**：researcher 兼容性——frontier.json timeline 新增 `kind`/`order` 为附加字段，researcher 读取用的 `time`/`chapter` 仍保留；D 中 researcher Skill 已按 timeline 映射重写，构建通过确认类型兼容。运行时完整验证归入 6.4 手测。
- **阶段 7.1**：父任务 07-06 PRD 已更新——Child Task Map E 标记 ✅、Player Flow Map Step 3/4 标记完成、Current Agent/Skill/Tool Ledger 注明"E 完成后更新"、相关验收标准已勾选。
- **阶段 7.2**：schema 文档（guide + reference）已在阶段 1 反映新字段，此处复核确认无遗漏。

> **行号偏移说明**：本文档阶段 1–3 引用的行号（如 `workspace-templates.ts:1677/1685-1697/2052/1711/1718-1732/1742+`）为计划撰写时的快照。文件已增长至 2692 行，实际位置整体下移约 580–620 行（stage-manager block 在 2258+，world-architect block 在 2313+，种子在 2674/2676）。不影响实现正确性。
