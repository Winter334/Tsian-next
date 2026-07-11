# 技术设计：回合后维护 + frontier 推进触发

> 本文记录 `07-08-post-turn-maintenance-frontier-trigger` 的技术设计：order 系统、触发数据流、agent 职责边界、schema 变更、兼容性与回滚。

## 1. 核心设计：order 系统

### 1.1 问题

前端需要判断"故事是否走过了素材覆盖范围"来触发 frontier 推进。可用信号中，`runtime.worldTime` 是自由文本字符串（前端无法比较大小），timeline 锚点只在推进时更新（推进之间静态），sourceWindow.end 只在推进时变。纯字符串不等（worldTime 变了就推）在细粒度时间场景下会疯狂推进；纯回合冷却太机械。

### 1.2 方案：线性 order 坐标轴

timeline 是我们建立的线性轴，表示剧情事件先后顺序。每个锚点有 `order`（单调递增整数），与原著精确时间标记无关。

- **source 锚点**：world-architect 推进时建立，标记原著剧情节点。order 是其在原著时间轴上的位置，递增赋值。
- **player 锚点**：stage-manager 维护时追加，标记玩家视角显著事件。order 等于玩家当前所在 source 区间的起始 source order。
- **runtime.plotOrder**：玩家当前走到了哪个 source order。stage-manager 每回合映射维护。

触发条件：`plotOrder > 最后 source 锚点 order`——故事走过了素材覆盖的最远剧情节点。

### 1.3 为什么不卡死

`plotOrder` 单调递增（stage-manager 不可能把时间往回拨）。最后 source 锚点 order 在推进后固定。一旦 plotOrder 越过它，条件必然满足。唯一"不触发"的情况是故事完全停滞（plotOrder 不变），此时没有推进的必要。

### 1.4 为什么不疯狂推进

plotOrder 只在"跨剧情节点"时变。细粒度时间抖动（"第三天清晨→中午→黄昏"）不跨剧情节点，plotOrder 不动。stage-manager 判断"剧情时间是否跨过了下一个 source 锚点的 time"来更新 plotOrder——这是语义判断，但 stage-manager 已经在做语义判断（读正文、理解时间推进、维护 worldTime）。

### 1.5 偏离原著正常触发

玩家不去原著剧情节点，worldTime 仍按剧情推进 → stage-manager 仍推进 plotOrder → 越过最后 source 锚点 → 触发。新 source 锚点可能落在玩家永远不会去的剧情上，但推进只扩大素材边界、不强制使用（父 design.md §7 接受此浪费）。

### 1.6 worldTime 与 plotOrder 的分离

| 信号 | 类型 | 作用 | 维护者 | 消费者 |
|---|---|---|---|---|
| `runtime.worldTime` | 自由字符串 | 玩家感受：时间流逝感 | stage-manager | 前端展示 |
| `runtime.plotOrder` | 数字 | 机器判断：触发推进 | stage-manager | 前端触发逻辑 |

worldTime 给玩家看，plotOrder 给机器判断。两者独立维护，互不依赖。

## 2. timeline 数据模型

### 2.1 统一锚点形态

```typescript
// source 锚点（world-architect 推进时写）
interface SourceAnchor {
  kind: "source"
  order: number       // 单调递增，world-architect 赋值
  chapter: number     // 原著章节号
  time: string        // 游戏时间字符串（可估计，给玩家/场记参考）
  label: string       // 一句话客观标签（不是剧情摘要）
}

// player 锚点（stage-manager 维护时追加）
interface PlayerAnchor {
  kind: "player"
  order: number       // = 玩家当前所在 source 区间的起始 source order
  turn: number        // 游戏回合号（分支内排序 + 后续精确找 turn 正文）
  time: string        // 游戏时间字符串（显示用）
  label: string       // 一句话客观描述
  alignment: "diverged" | "rejoined" | "aligned"
  sourceRef: number | null  // 关联的 source order（见下方语义）
}
```

### 2.2 alignment 语义

| 值 | 含义 | sourceRef | 建立时机 |
|---|---|---|---|
| `diverged` | 玩家偏离原著 | 分叉自的 source order，或 null（原创区间） | 玩家从 source 事件分叉，或在原创区间发生显著事件 |
| `rejoined` | 从分支并回主干 | 并回的 source order | 玩家重新遇到 source 事件且结果相近 |
| `aligned` | 经历 source 事件且结果相近 | 该 source order | **可选**——完美跟随时不需要建，source 锚点本身代表那段故事 |

stage-manager 只在有意义的时刻建 player 锚点：偏离、并回、或经历 source 事件但结果不同（此时用 `diverged` + sourceRef，表示"遇到了同一事件但走了不同方向"）。

### 2.3 order 分配规则

- source 锚点：world-architect 推进时递增赋值。开局第一个锚点 order=1（`{chapter:1, time:"元年", label:"开局"}`）。每次推进读 10 章后，按识别到的剧情节点数量追加，order 严格连续递增。
- player 锚点：order = 玩家当前所在 source 区间的起始 source order。同一 source 区间内的多个 player 锚点共享相同 order，前端按 turn 排序展开。

### 2.4 渲染兼容性（本任务不做渲染，但字段设计兼容）

```
主干:  S1(order:1)---S2(order:2)---S3(order:3)---[触发推进]---S4(order:4)...
                    \                          /
分支:                P1(order:2,turn:8)---P2---P3(order:3,turn:30,rejoined)
```

- source 锚点在整数 x 轴位置
- player 锚点在对应 order 区间内按 turn 散开
- 分叉/并回靠 alignment + sourceRef 画线
- aligned 可选，避免主干上堆满重复点

## 3. 触发数据流

### 3.1 完整时序

```
1. 正式玩家回合正文落定（useTsian onTurnEnd）
2. void triggerSyncAfterTurn(turnCount)           ← 不阻塞正文展示
3. useSyncAfterTurn → invokeAgent("stage-manager", {
     commitMode: "workspace-with-checkpoint",      ← R5: 切换 checkpoint 模式
     checkpointReason: "post-turn-maintenance",
     persist: true,
     contextSlot: 默认                              ← 维护用默认 slot
   })
4. stage-manager 执行回合后维护 Skill：
   a. read_maintenance_context → 聚合事实
   b. 维护 runtime（worldTime + plotOrder）/ entity / scene / relationship
   c. 追加 player 锚点（如有显著事件）
   d. workspace.write/edit/delete 提交
5. 平台事务提交 + 创建 post-turn-maintenance checkpoint + 删除同 turn after-turn checkpoint
6. useSyncAfterTurn handleSynced → setOnSynced 回调 → useRuntime.refresh()
7. runtime 刷新后，前端执行 frontier 边界检查：
   a. 读 runtime.plotOrder
   b. 读 frontier.json → timeline.filter(kind="source") → max(order) = lastSourceOrder
   c. 读 frontier.json → sourceWindow.end
   d. 读 save 源章节总数（source manifest）
   e. 条件: plotOrder > lastSourceOrder AND sourceWindow.end < totalChapters AND 去重
8. 满足 → invokeAgent("world-architect", {
     purpose: "frontier-advance",
     contextSlot: "frontier-advance",              ← R9: 独立 slot
     persist: true,
     commitMode: "workspace"                       ← 推进只写 frontier/materials，不需要 checkpoint
   })
9. world-architect 执行 frontier推进 Skill：
   a. read_frontier_window → 读下 10 章源文
   b. 识别剧情节点 + 抽取最小素材增量
   c. commit_frontier_materials → 写 entities/relationships/schema patches
   d. commit_frontier_state → 写 sourceWindow/extractedThrough/timeline source 锚点（order 递增）
10. Toast 更新：进行中 → 成功/失败
```

### 3.2 非阻塞保证

- 步骤 2 的 `void` 前缀确保维护调用不阻塞正文展示。
- 步骤 7-10 的 frontier 触发在 `setOnSynced` 回调中发起，是独立 Promise，不阻塞 Composer。玩家可在推进期间继续下一轮。
- 步骤 9 的 world-architect 调用是独立 invokeAgent 通道、独立 transaction，不影响主回合。

### 3.3 去重机制

- `frontier-trigger-state.json` 记录 `lastCompleted.key` 和 `lastFailed.key`，key = `plotOrder`。
- in-flight 状态仅内存（`isFrontierAdvanceInFlight` boolean），避免刷新后 stale lock。
- 触发前检查：`plotOrder` 与 lastCompleted.key 相同 → 跳过（已推进过）。推进成功后 lastSourceOrder 增加，条件自然变 false。
- 失败后：相同 plotOrder 不自动重试（需手动点"重试"）；plotOrder 继续增大（故事推进）→ 新 key → 自然触发。

### 3.4 边界检查的调用时机

在 `useRuntime` 的 `setOnSynced` 回调中触发。当前 `setOnSynced` 已被 useRuntime 注册了 `refresh()` 回调。方案：在 useRuntime refresh 完成后链式调用 frontier 检查，或在 useSyncAfterTurn 的 handleSynced 中追加 frontier 检查。

选择在 handleSynced 中追加（而非 useRuntime），因为 frontier 检查依赖 runtime 数据已刷新——handleSynced 先调 `onSyncedCallback?.()`（触发 useRuntime.refresh），但 refresh 是 async 的，callback 不会等它完成。

**解决方案**：将 `setOnSynced` 改为支持 async 回调，或新增独立 `setOnSyncedAsync`。frontier 检查在 runtime 刷新完成后执行。具体实现：
- `useSyncAfterTurn` 的 `handleSynced` 中，`onSyncedCallback?.()` 如果返回 Promise，await 之。
- `useRuntime` 注册的回调改为 `async () => { await refresh(); await checkFrontierAdvance() }`。
- 或者：useRuntime refresh 完成后自行调用 frontier 检查（frontier 检查逻辑放在独立 composable `useFrontierAdvance`，由 useRuntime 在 refresh 后调用）。

倾向后者：`useFrontierAdvance` composable，`useRuntime` refresh 后调用 `checkFrontierAdvance()`，职责分离清晰。

## 4. Agent 职责边界

### 4.1 stage-manager

**新增职责：**
- 维护 `runtime.plotOrder`：读 frontier.json timeline，判断玩家当前走到哪个 source 锚点之后，设 plotOrder。
- 追加 player 锚点到 timeline：偏离/并回/结果不同时建 `{kind:"player", order, turn, time, label, alignment, sourceRef}`。
- 读 frontier.json（加入 contextPaths）。

**不变职责：**
- 维护 runtime（worldTime/weather/location/activeSceneRefs/protagonistRef/extensions）、entity、scene、relationship、memory。
- 需要事实 call researcher，需要 schema 设计 call world-architect。

**明确不做：**
- 不判断是否推进 frontier（前端做）。
- 不读未读章节（frontier 推进才读）。
- 不写 source 锚点（world-architect 写）。
- 不写 sourceWindow/extractedThrough（world-architect 写）。

**contextPaths 变更：**
```
当前: ["docs/novel-airp-schema-guide.md", "save/schema/current.md", "save/playthrough/runtime.json", "save/scenes/README.md", "save/relationships/README.md"]
新增: "save/playthrough/frontier.json"
```

### 4.2 world-architect

**新增职责：**
- ongoing frontier 推进 Skill：读下 10 章源文，识别剧情节点建 source 锚点（order 递增，无时间词时估算 time），抽取最小素材增量，推进 sourceWindow/extractedThrough/timeline。

**不变职责：**
- 开局建模、游玩设定。
- 不维护每回合 runtime，不写玩家正文。
- 只使用已读内容，不推断未读未来剧情。

**明确不做：**
- 不维护 runtime（worldTime/plotOrder 由 stage-manager 写）。
- 不写 player 锚点（stage-manager 写）。
- 不写 scene（stage-manager 写）。
- 不判断是否该推进（前端判断，world-architect 被调用时才推进）。

## 5. read_maintenance_context Tool 设计

### 5.1 定位

Agent-local Tool（stage-manager 专用），减少 stage-manager 多步 workspace_read 聚合事实的成本。只读不写。

### 5.2 输入

```json
{
  "turn": number,           // 目标回合号（默认当前 max turn）
  "includeTimeline": boolean // 默认 false；true 时包含 frontier.json timeline 摘要
}
```

### 5.3 输出

```json
{
  "turnBody": {
    "user": "string",
    "assistant": "string"
  },
  "runtime": { /* runtime.json 全文 */ },
  "activeScenes": [ /* active scene 文件摘要：ref, name, location, presentEntities */ ],
  "entities": [ /* 相关 entity 摘要：ref, name, brief, status */ ],
  "relationships": [ /* 相关 relationship 摘要：subject, to, type */ ],
  "sceneCleanupCandidates": [ /* 客观候选：不再 active/background 的 scene ref + 理由 */ ],
  "timeline": null | { /* includeTimeline=true 时：source 锚点列表 + player 锚点列表 */ }
}
```

### 5.4 边界

- Tool 不输出删除决策——只给客观候选（sceneCleanupCandidates），由 stage-manager 自行判断是否删除。
- Tool 不写 workspace。
- `includeTimeline` 默认 false：多数回合不需要看 timeline 全貌，只在需要映射 plotOrder 或追加 player 锚点时由 stage-manager 自行 workspace_read frontier.json 或传 includeTimeline=true。

## 6. world-architect frontier推进 Skill 设计

### 6.1 Skill 结构

```
frontier推进/
  SKILL.md          ← 流程知识 + 抽取规范
  scripts/
    read-frontier-window.js        ← read_frontier_window action
    commit-frontier-materials.js   ← commit_frontier_materials action
    commit-frontier-state.js       ← commit_frontier_state action
```

### 6.2 read_frontier_window

输入：无（从 frontier.json 读当前 sourceWindow，计算下一段 10 章窗口）。
行为：读 `save/source/chapters/` 下 next 10 章，返回章节文本 + 当前 frontier 状态。
不写 workspace。

### 6.3 commit_frontier_materials

输入：entities/relationships/schemaPatches 增量。
行为：校验增量格式，写入 `save/entities/`、`save/relationships/`、`save/schema/patches/pending/`。
校验 entity ref 格式、relationship subject/to 为 character:<localId>。

### 6.4 commit_frontier_state

输入：sourceWindow（新 start/end/chapters）、extractedThrough、timeline source 锚点数组（含 order）。
行为：
- 校验 order 严格大于现有最后 source 锚点 order。
- 校验 sourceWindow.start = 现有 sourceWindow.end + 1（顺序推进）。
- 校验 timeline 锚点 chapter 在新窗口范围内。
- 写入 frontier.json（合并新 source 锚点到 timeline 数组）。

### 6.5 抽取规范（Skill 正文）

**抽取什么：**
- 新登场角色（entity）：identity/appearance/attributes，不抽 sourceRefs/origin（父任务 A 已删除）。
- 角色关系（relationship）：仅 character↔character，不抽地点/组织/物品关联。
- schema 增量：仅在发现需要新字段/结构时写 pending patch。

**不抽取什么：**
- 不抽场景（scene 由 stage-manager 维护）。
- 不抽剧情摘要/阶段目标/创作指导。
- 不抽 player 锚点（stage-manager 维护）。
- 不全量提取窗口内所有内容——只抽"与当前阶段可能相关的最小增量"。

**source 锚点建立规范：**
- 识别剧情节点（不是每章都建，只在有显著事件变化的节点建）。
- 原文有明确时间词 → 直接用。
- 原文无时间词 → 从剧情推断估计时间（如"赶路翻三座山"→ 估"数周后"→ 按当前时间线推算）。
- label 一句话客观标签，不是剧情摘要（父 design.md §5.5）。

## 7. schema 变更

### 7.1 frontier.json

```diff
{
  "sourceWindow": { "start": number|null, "end": number|null, "chapters": [...] },
  "extractedThrough": string|null,
- "timeline": [{ "chapter": number, "time": string, "label": string }]
+ "timeline": [
+   { "kind": "source", "order": number, "chapter": number, "time": string, "label": string },
+   { "kind": "player", "order": number, "turn": number, "time": string, "label": string, "alignment": "diverged"|"rejoined"|"aligned", "sourceRef": number|null }
+ ]
  "notes": string,
  "updatedAt": string,
  "updatedBy": string
}
```

### 7.2 runtime.json

```diff
{
  "turn": number,
  "worldTime": string,
+ "plotOrder": number,
  "weather": string,
  "location": string,
  "activeSceneRefs": [...],
  "protagonistRef": string,
  "extensions": {...}
}
```

### 7.3 默认种子

frontier.json 种子 timeline 第一个锚点变为：
```json
{ "kind": "source", "order": 1, "chapter": 1, "time": "元年", "label": "开局" }
```

runtime.json 种子新增 `plotOrder: 1`（开局时玩家在 source 锚点 1）。

### 7.4 向后兼容

frontier.json 和 runtime.json 是 save-scoped 数据文件，不是平台 contracts。默认种子更新只影响新存档。现有存档（如果有）的 timeline 锚点缺少 `kind`/`order` 字段——但当前还在开发阶段，无生产存档需要迁移。如果需要迁移，可在 stage-manager 首次维护时检测旧格式并补全（kind="source", order=按 chapter 排序递增）。

## 8. 前端新增 composable

### 8.1 useFrontierAdvance

```typescript
// apps/play-frontend-dev/src/composables/useFrontierAdvance.ts

interface FrontierAdvanceState {
  phase: "idle" | "advancing" | "succeeded" | "failed"
  lastError: string | null
}

// 模块级状态（同 useSyncAfterTurn 模式）
const phase = ref<FrontierAdvanceState["phase"]>("idle")
const isInFlight = ref(false)  // 仅内存，不持久化

export async function checkFrontierAdvance(): Promise<void> {
  if (isInFlight.value) return  // 去重：进行中不重复触发
  
  const tsian = getTsianClient()
  
  // 1. 读 runtime.plotOrder
  const runtime = await tsian.workspace.read({ path: "save/playthrough/runtime.json" })
  const plotOrder = runtime.plotOrder
  
  // 2. 读 frontier.json
  const frontier = await tsian.workspace.read({ path: "save/playthrough/frontier.json" })
  const sourceAnchors = frontier.timeline.filter(a => a.kind === "source")
  const lastSourceOrder = Math.max(...sourceAnchors.map(a => a.order))
  
  // 3. 读源章节总数
  const manifest = await tsian.workspace.read({ path: "save/source/manifest.json" })
  const totalChapters = manifest.totalChapters  // 或 chapters.length
  
  // 4. 去重检查
  const triggerState = await loadTriggerState()
  const key = plotOrder
  if (triggerState.lastCompleted?.key === key) return  // 已推进过
  if (triggerState.lastFailed?.key === key && !isManualRetry) return  // 失败等手动重试或 plotOrder 变化
  
  // 5. 触发条件
  if (plotOrder <= lastSourceOrder) return  // 还在覆盖范围内
  if (frontier.sourceWindow.end >= totalChapters) return  // 没有未读章节
  
  // 6. 触发推进
  isInFlight.value = true
  phase.value = "advancing"
  await tsian.invokeAgent("world-architect", input, {
    purpose: "frontier-advance",
    contextSlot: "frontier-advance",
    persist: true,
    commitMode: "workspace",
  })
  // 成功/失败由 onAgentInvocation 事件驱动（同 useSyncAfterTurn 模式）
}

export async function retryFrontierAdvance(): Promise<void> {
  // 手动重试：忽略 lastFailed key 去重
  ...
}
```

### 8.2 frontier-trigger-state.json

```json
{
  "version": 1,
  "lastChecked": {
    "turn": 25,
    "plotOrder": 4,
    "lastSourceOrder": 3,
    "key": 4
  },
  "lastCompleted": {
    "turn": 25,
    "key": 4,
    "completedAt": "2026-07-09T..."
  },
  "lastFailed": null
}
```

### 8.3 Toast

复用现有 SyncToast 机制。新增 frontier advance 的三态文案：
- 进行中："正在拓展素材边界…"
- 成功："已拓展素材边界"（1.5s 淡出，同 synced）
- 失败："素材边界拓展失败" + "重试" 按钮（不锁 Composer）

### 8.4 useRuntime 集成

```typescript
// useRuntime.ts 中，refresh 完成后调用 frontier 检查
setOnSynced(async () => {
  await refresh()
  await checkFrontierAdvance()  // 链式调用
})
```

或保持 useRuntime 不变，在 useSyncAfterTurn handleSynced 中追加。具体实现时择优。

## 9. useSyncAfterTurn 变更

### 9.1 commitMode 切换

```diff
- commitMode: "workspace",
+ commitMode: "workspace-with-checkpoint",
+ checkpointReason: "post-turn-maintenance",
  persist: true,
```

### 9.2 invoke input 调整

当前 input 是通用维护说明。本任务需要让 stage-manager 知道维护 plotOrder 和 player 锚点。但 input 不应包含 frontier 判断逻辑（R4）。input 保持简短，具体职责由 AGENT.md + Skill 正文承载。可微调 input 措辞提及 plotOrder/timeline，但不做前端判断。

## 10. 兼容性与回滚

### 10.1 兼容性

- `InvokeAgentRequest` 的 `contextSlot` 字段已存在（`packages/contracts/src/runtime.ts:772-793`），无需改 contracts。
- `commitMode: "workspace-with-checkpoint"` 已支持，无需改平台。
- frontier.json / runtime.json 是 save-scoped 数据，不是平台 contracts——schema 变更不影响平台编译。
- entrypoints 不新增字段（R9），不涉及 contracts 变更。

### 10.2 回滚点

1. **stage-manager Skill/Tool 改动**：workspace-templates.ts 中的模板字符串，改回即可。
2. **useSyncAfterTurn commitMode**：改回 `"workspace"`。
3. **useFrontierAdvance**：新增 composable，删除即可回滚。触发逻辑是增量，不影响现有维护流程。
4. **frontier.json/runtime.json schema**：种子文件改回，但已运行的存档不会自动回滚（无生产存档，可忽略）。
5. **world-architect frontier推进 Skill**：新增 Skill + scripts，从 agent.json skills.enabled 移除即可禁用。

### 10.3 风险文件

- `workspace-templates.ts`：大文件，多处改动（stage-manager agent block、world-architect agent block、Skill 定义、Tool 定义、schema 文档、种子）。改动密集，需小心定位。
- `useSyncAfterTurn.ts`：commitMode 切换，影响 checkpoint 行为。
- `useRuntime.ts`：refresh 回调集成 frontier 检查。

## 11. 父任务 A' 方案的演进

父任务 design.md §4.3 A' 方案原文："前端在场记完成后检查 worldTime/锚点/sourceWindow 边界 → 接近则前端 invokeAgent("world-architect") 推进。"

本任务将 A' 的"接近"判断从模糊的"worldTime 变了 + 锚点距窗口末端 3 章"演进为"plotOrder > 最后 source 锚点 order"——用我们建立的线性 order 坐标轴做精确数字比较，替代模糊的字符串变动 + chapter 距离 buffer。这是 A' 方案的具体实现，不改变 A' 的核心（前端客观计算 + invokeAgent 推进 + 不改平台）。

## 12. 父任务 §5.4 日历否决的边界

§5.4 否决："完整日历系统、时间排序/换算算法"。

本任务的 `order` 不是日历系统：
- 不是日历：是单调递增整数序号，无年/月/日结构。
- 不是排序/换算：前端做一次 `>` 比较，不做排序、不做 time 字符串换算。
- time 仍是自由字符串：§5.4 保留的"自由字符串、场记每回合维护、可调粒度"全部不变。

`order` 附加在锚点上，不改 `time` 字段的自由字符串性质。§5.4 的约束完全保留。
