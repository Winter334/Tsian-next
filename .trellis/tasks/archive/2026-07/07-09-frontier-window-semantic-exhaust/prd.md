# frontier 推进窗口语义化与读完短路

## Goal

将 frontier 推进从"固定 10 章窗口"改为"语义节点驱动 + 15 章硬上限"，使推进粒度对齐 source 锚点（语义故事节点）而非固定章数。同时为源章节读完状态加 `exhausted` 终态短路，避免每回合白跑文件 IO。

## Background

当前 frontier 推进每次固定读 10 章源文（`workspace-templates.ts` 的 world-architect `frontier推进` Skill + `read-frontier-window.js` 脚本，`windowSize = 10`）。但 source 锚点是语义剧情节点，固定章数与语义粒度不匹配。

10 章这个数字来自 07-08 任务的 R15（"遵循父任务既定限制：固定 10 章窗口"），但父任务 `06-27` design.md 原文只是"e.g. the first N chapters"——是示例值，无强语义依据。改为语义节点驱动 + 硬上限不违背原始设计意图。

读完后当前行为：触发条件两个 `return`（`useFrontierAdvance.ts:205-214`）都在 `invokeAgent`（L229）之前，**不会白调 API**，但每回合白跑 4 个 `workspace.read` + 1 次 `trigger-state` 写，属纯文件 IO 浪费。

## Confirmed Facts（代码探索）

- "固定 10 章"约定完全集中在 `workspace-templates.ts` 一个文件，5 处：L1407（Skill 步骤 1）、L1437（窗口限制段）、L1449（action description）、L1480（脚本注释）、L1496（`const windowSize = 10`）。
- schema 文档（`NOVEL_AIRP_SCHEMA_GUIDE_MD` / `NOVEL_AIRP_SCHEMA_REFERENCE_MD`）、其他 agent notes、前端类型、spec 均未提及窗口大小——无需同步（Explore 确认）。
- `maxCharacters = 120000`（L1502）是独立字符兜底，与章节上限正交。脚本返回 `window.end = 实际读到的最后一章 index`（L1524），受字符数截断时可能 < windowSize。
- `commit_frontier_state` 校验 `anchor.chapter ∈ [newStart, newEnd]`，newStart/newEnd 来自 agent 提交的 input——天然兼容 `end < 实际读取末尾`。
- `trigger-state` 结构（`useFrontierAdvance.ts:52-71`）已有 `lastChecked`/`lastCompleted`/`lastFailed`，`isInFlight` 是内存判断（L136）不读文件。
- 前端触发条件（L205-214）：条件 1 `plotOrder <= lastSourceOrder` 先判，条件 2 `sourceWindow.end >= totalChapters` 后判，均 `return` 在 `invokeAgent` 之前。

## Requirements

### 窗口语义化（`workspace-templates.ts`）

- R1: `windowSize` 从 `10` 改为 `15`（`read-frontier-window.js` L1496）。
- R2: Skill 文案从"固定 10 章窗口"改为语义节点驱动表述：
  - 单次推进最多读 15 章（硬上限）。
  - 语义目标：覆盖至少 1-2 个剧情节点后即可提交 `sourceWindow.end`，不必读到上限。
  - 上限内读不到 2 个完整节点时，提交到上限章节，就已有显著变化点建锚点，剩余节点延续到下次推进。
  - `sourceWindow.end` 由 agent 语义决定，可小于实际读到的最后一章。
  - 超出 `sourceWindow.end` 的章节仅供判断"是否还有下一个剧情节点"使用，**不从中抽实体、不建 source 锚点**（spoiler-safe）。
  - 窗口还受总字符数兜底（约 12 万字），长章节小说实际读到的章数可能少于 15——以 `read_frontier_window` 返回的 `window.end` 为准。
  - 过去章节不倒回搜索。窗口外不读。
- R3: `read_frontier_window` action description 中"10 章"改"最多 15 章"。
- R4: 脚本注释中"10 章"改"最多 15 章"。
- R5: `maxCharacters` 保持 `120000` 不变——作为独立字符兜底，与章节上限正交。
- R6: 无残留"10 章"表述（遵循 ai-facing-content-changes spec——不能 downgrade-and-keep，必须彻底替换）。

### 读完短路（`useFrontierAdvance.ts`）

- R7: `trigger-state` 新增 `exhausted: boolean` 字段（默认 `false`）。
- R8: `checkFrontierAdvance` 在 `isInFlight` 判断后，先读 `trigger-state`；若 `exhausted === true` → 直接 `return`，不再读 runtime/frontier/manifest。
- R9: 条件 2 命中（`totalChapters <= 0 || sourceWindowEndNum >= totalChapters`）时，置 `exhausted = true` 并持久化。
- R10: `defaultTriggerState()` 返回 `exhausted: false`；`loadTriggerState` 对旧存档缺省 `exhausted` 兜底为 `false`。

### 不改动

- R11: 不改前端触发条件逻辑（`plotOrder > lastSourceOrder AND sourceWindow.end < totalChapters`）。
- R12: 不改 `commit_frontier_state` 脚本（校验基于 agent 提交的 input，天然兼容 `end < 读取末尾`）。
- R13: 不改 `commit_frontier_materials` 脚本。
- R14: 不改前端 `invokeAgent` 调用。

## Acceptance Criteria

- [ ] `workspace-templates.ts` 中 `windowSize = 15`，无残留"10 章"/"固定 10 章"字样。
- [ ] Skill 文案描述语义节点驱动（至少 1-2 节点 + 15 章上限 + 超读提取约束 + 上限内不足兜底）。
- [ ] `read_frontier_window` action description 与脚本注释更新为"最多 15 章"。
- [ ] `trigger-state` 新增 `exhausted` 字段；旧存档缺省时兜底 `false`。
- [ ] `exhausted === true` 时 `checkFrontierAdvance` 短路：只读 `trigger-state` 一个文件，不读 runtime/frontier/manifest。
- [ ] 条件 2 命中时置 `exhausted = true` 并持久化。
- [ ] `npm run build --workspace @tsian/platform-web` 通过。
- [ ] `npm run build --workspace @tsian/play-frontend-dev` 通过。

## Out of Scope

- **连载追加更新**：增量导入新章节到现有存档、不重置 frontier/runtime、保持 chapter 号稳定映射。记为 follow-up，不入本次。
- **"读完"UI 提示**：不向玩家/storyteller/researcher 传递"素材已到顶"信号。读完对游戏体验静默，只做后端短路。
- **stage-manager plotOrder 边界**：不补"超过最后 source 锚点时 plotOrder 怎么维护"的指导——当前读完后 plotOrder 卡在 lastSourceOrder 是可接受行为（不触发推进、不调 API）。
