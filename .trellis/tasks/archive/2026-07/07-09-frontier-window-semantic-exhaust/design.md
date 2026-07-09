# 技术设计：frontier 推进窗口语义化与读完短路

> 本文记录 `07-09-frontier-window-semantic-exhaust` 的技术设计：窗口语义化方案、读完短路机制、AI-facing 内容清理、兼容性。

## 1. 窗口语义化

### 1.1 问题

source 锚点是语义剧情节点，但推进窗口是固定 10 章。两种小说会导致问题：

- **节点密集的小说**：10 章里可能有 5-6 个节点，但窗口固定，推进粒度与语义不对齐。
- **节点跨度大的小说**（如游戏小说）：一个节点可能跨 20-30 章，10 章读不到一个完整节点，推进后建锚点困难。

### 1.2 方案：语义目标 + 章节硬上限 + 超读提取约束（路线 A）

不改触发链路、不改 commit 脚本，只改"读多少 + Skill 怎么指导 agent"：

- `windowSize`：10 → 15（硬上限，防爆闸）。
- Skill 指导 agent：**语义目标覆盖 1-2 个剧情节点**后即可提交 `sourceWindow.end`，不必读到上限。
- `sourceWindow.end` 由 agent 语义决定，可 < 实际读到的最后一章。
- 超出 `sourceWindow.end` 的章节仅供判断"是否还有下一个节点"使用，不抽实体、不建锚点（spoiler-safe）。
- 上限内读不到 2 个完整节点：提交到上限，就已有显著变化点建锚点，剩余节点延续到下次。

### 1.3 为什么选路线 A（而非迭代扩展读）

路线 B（新增 extend 动作，agent 迭代扩展读）无超读、无剧透风险，但：
- 多一个脚本动作 + agent 迭代判断逻辑（Skill 更复杂）。
- 多次脚本往返（更多 token/延迟）。

路线 A 的超读风险被约束在 world-architect（后台素材 agent，不直接面向玩家），且通过 Skill 文案明确"超出 end 的章节只用于判断节点存在性，不抽实体"控制。agent 下次推进会重读 end+1..15，但这是跨会话（不是同回合），可接受。

### 1.4 为什么 15 章而不是更多

- 10 章是现有值，15 是温和放宽，给大节点更多命中机会。
- 受 `maxCharacters = 120000` 独立兜底约束：长章节小说（每章 8000-10000 字）15 章约 12-15 万字，会自然被字符数截断到 12-13 章。15 章上限在短章节小说里生效、长章节小说里被字符数兜底——双层约束，无需额外逻辑。

### 1.5 为什么不改 maxCharacters

`maxCharacters = 120000` 是防 token 爆炸的硬约束，与章节上限正交。两个约束各管一维：
- `windowSize` 管章节数上限（防爆闸语义边界）。
- `maxCharacters` 管总字符数上限（防 token 爆炸）。

保持 120000 不变，让长章节小说被字符数自然约束，符合现有设计意图。

## 2. 读完短路

### 2.1 问题

源章节读完后，`checkFrontierAdvance` 每回合仍白跑 4 个 `workspace.read`（runtime/frontier/manifest/trigger-state）+ 1 次 trigger-state 写。不会白调 `invokeAgent`（两个 return 在 L205/L210，均在 L229 之前），但文件 IO 是纯浪费。

### 2.2 方案：exhausted 终态标记

复用现有 `trigger-state` 机制，新增 `exhausted: boolean`：

```
checkFrontierAdvance 流程（改后）：
  1. isInFlight? → return              ← 内存判断，不读文件
  2. 读 trigger-state（只读这一个文件）
  3. exhausted === true? → return       ← 短路，不再读 runtime/frontier/manifest
  4. 读 runtime.plotOrder
  5. 读 frontier.json → lastSourceOrder + sourceWindow.end
  6. 读 manifest → totalChapters
  7. 去重（lastCompleted/lastFailed）
  8. plotOrder <= lastSourceOrder? → return
  9. sourceWindow.end >= totalChapters? → 置 exhausted=true 持久化 → return
  10. invokeAgent
```

读完前：4 读 + 1 写（不变）。
读完后：1 读 + 0 写。

### 2.3 为什么用 trigger-state 而不是内存标记

`isInFlight` 是内存标记，刷新后重置。但"读完"是存档级终态——刷新不应让系统忘记"已读完"重新白跑。必须持久化，所以放 `trigger-state.json`。

### 2.4 与连载追加更新（follow-up）的衔接

未来增量导入新章节后，需要重置 `exhausted = false`。这是 follow-up 任务的边界：导入逻辑负责在 chapter index 增长时重置该标记。本次不做导入流程，但 design 记录这个衔接点。

## 3. AI-facing 内容清理

遵循 `ai-facing-content-changes.md` spec：不能 downgrade-and-keep（"optional / defaults to 10" 是最坏状态）。"10 章"必须彻底替换为"15 章"或语义表述，不留残留。

确认无残留：所有"10 章"约定集中在 `workspace-templates.ts` 一个文件，schema 文档、其他 agent notes、前端类型均未提及窗口大小（Explore 确认）。改这一个文件即可。

## 4. 改动范围与边界

| 文件 | 改动 | 不改 |
|---|---|---|
| `workspace-templates.ts` | windowSize 10→15、Skill 文案语义化、action description、脚本注释 | maxCharacters、commit 脚本校验逻辑、触发条件、其他 agent notes、schema 文档 |
| `useFrontierAdvance.ts` | trigger-state 加 exhausted、短路逻辑、条件2 置标记 | 触发条件逻辑、invokeAgent 调用、去重逻辑 |

### 不改动的文件

- `useFrontierAdvance.ts` 触发条件（`plotOrder > lastSourceOrder AND sourceWindow.end < totalChapters`）——与窗口大小无关。
- `commit_frontier_state` 脚本——校验基于 agent 提交的 input.sourceWindow，天然兼容 `end < 读取末尾`。
- `commit_frontier_materials` 脚本——与窗口大小无关。
- `frontier-types.ts` / `parse-frontier.ts`——类型与解析不涉及窗口大小。

## 5. 兼容性与回滚

### 5.1 兼容性

- `trigger-state` 新增 `exhausted` 字段：旧存档缺省时 `loadTriggerState` 兜底 `false`，不破坏现有存档。
- `windowSize` 变更对已推进过的存档无影响：`read_frontier_window` 基于当前 `sourceWindow.end` 计算下一段，不依赖历史 windowSize。
- agent Skill 文案变更通过 `workspace-templates.ts` 种子更新生效。已有存档的 Skill 文件不会自动更新（workspace 文件不迁移），新存档生效——这是 workspace-templates 的既有行为，与 07-08 一致。

### 5.2 回滚点

- R1（windowSize）：改回 `10`。
- R2-R6（Skill 文案）：还原文本。
- R7-R10（exhausted）：删除字段 + 短路逻辑，或临时手动把存档的 `exhausted` 改回 `false`。

### 5.3 风险文件

- `workspace-templates.ts`：大文件，改动密集，务必先 grep 定位行号再改。
- `useFrontierAdvance.ts`：短路逻辑改变流程顺序，需确认 trigger-state 读取位置正确。
