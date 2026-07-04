# 默认 novel 前端回合后场记编排 · 技术设计

## Scope

默认 novel 前端在说书人正文流式完成后，发起一次回合后维护 Agent 调用（场记），维护 runtime/entity/scene/relationship/memory/status bar，并通过同步 Toast 向玩家传达"整理中 / 已整理 / 整理失败"三态。本任务实现前端编排、状态机扩展、同步 Toast 组件、契约层入口配置扩展与 bridge 读取。平台核心不硬编码 novel AIRP 的说书人→场记 pipeline。

## Design Goals

- **朴素且好用的同步 Toast**：克制结构 + 一个签名细节（整卡 ember 扫光），不喧宾夺主。
- **不硬编码 Agent 名称**：前端从卡配置读 `entrypoints.postTurnMaintenance`（agent id），Toast 文案只描述阶段行为本身（"本回合整理中"），不出现任何 agent displayName。你不展示的东西就无法硬编码。
- **缓解等待焦虑**：只有一个 ember 扫光循环 + 单脉冲点，无进度条、无 spinner、无工具细节。
- **正文优先**：正文流式完成立即展示，场记调用不阻塞首屏；同步期间禁用下一轮输入，避免在旧状态上继续。

## Architecture

### 状态机扩展

现有 `TurnPhase = "idle" | "streaming" | "standby"` 不够表达回合后同步阶段。新增**正交的** `SyncPhase`，不污染 TurnPhase：

```text
types.ts 新增：

/** 回合后同步阶段（与 TurnPhase 正交，独立的状态轴）。 */
export type SyncPhase =
  | "idle"          // 无同步任务（空闲 / 正文进行中）
  | "syncing"       // 场记调用进行中，Toast 显示"整理中"
  | "synced"        // 场记完成，Toast 显示"已整理"短暂淡出
  | "sync-failed"   // 场记失败，Toast 显示"整理失败 · 重试"
```

为什么不把 sync 塞进 TurnPhase？因为它们是两条独立的状态轴：
- TurnPhase 描述"主回合推进"（idle→streaming→standby）
- SyncPhase 描述"回合后维护"（standby 后才可能 idle→syncing）

两条轴解耦后，Composer 禁用逻辑 = `streaming || syncing || sync-failed`，互不干扰。

```text
完整时序：

idle ──send──▶ streaming ──onTurnEnd──▶ standby
                                           │
                                  entrypoints.postTurnMaintenance 存在?
                                           ├─ 否 ─▶ 保持 standby（无同步流程）
                                           └─ 是 ─▶ syncing（invokeAgent 调场记）
                                                       ├─ onAgentInvocation completed ─▶ synced ─▶ (1.5s) ─▶ idle
                                                       └─ onAgentInvocation failed    ─▶ sync-failed
                                                                                          ├─ 重试 ─▶ syncing
                                                                                          └─ (无操作则停留)
```

### 组件结构

```text
apps/play-frontend-dev/src/
├── components/
│   └── story/
│       └── SyncToast.vue          ← 新增：同步 Toast 组件（卡片扫光三态）
├── composables/
│   ├── useTsian.ts                ← 扩展：syncPhase 状态 + triggerSyncAfterTurn()
│   └── useSyncAfterTurn.ts        ← 新增：回合后同步编排逻辑（读入口、invokeAgent、事件驱动）
└── types.ts                       ← 扩展：SyncPhase 类型
```

### SyncToast.vue 组件设计

**职责**：纯展示组件，接收 `syncPhase` props，渲染三态。不包含业务逻辑。

**Props**：
```ts
defineProps<{
  phase: SyncPhase      // 当前同步阶段
}>()
defineEmits<{
  retry: []             // 用户点击"重试"
}>()
```

**视觉规格**（复用现有设计 token）：

| 属性 | 值 | 说明 |
|---|---|---|
| 容器 | `position: relative; overflow: hidden` | 容纳扫光伪元素 |
| 尺寸 | `max-width: 52em; width: fit-content` | 与正文列同宽，内容自适应 |
| 背景 | `rgba(10, 5, 6, 0.7) + backdrop-filter: blur(8px)` | 暗色玻璃 |
| 边框 | `1px solid var(--line-strong)` | ember 细边 |
| 文字 | `var(--font-mono); 0.78rem; var(--prose-dim)` | mono 标签 |
| 位置 | 正文流末尾下方，Composer 上方，居中 | flex 列内 |
| 出现 | `opacity 0→1; translateY(8px→0); 300ms` | 浮入 |
| 消失 | `opacity 1→0; 500ms` | synced/sync-failed→idle 时 |

**三态内容**：

| phase | 标记 | 文案 | 额外 |
|---|---|---|---|
| syncing | `●`（ember 脉冲点 2.5s breathe） | `本回合整理中` | 卡片扫光循环 |
| synced | `◆`（--ember-bright 一闪） | `已整理` | 扫光跑完最后一遍停 |
| sync-failed | `✕`（--blood） | `整理失败` + inline `·  重试` | 扫光停止，边框 --blood |

**卡片扫光（签名细节）**：

```css
/* 伪元素覆盖整张卡片表面，ember 光带横扫 */
.sync-toast::after {
  content: "";
  position: absolute;
  inset: 0;                    /* 覆盖整张卡片 */
  pointer-events: none;        /* 不挡点击 */
  mix-blend-mode: screen;      /* 只提亮不遮文字 */
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(232, 169, 72, 0.12) 40%,
    rgba(232, 169, 72, 0.22) 50%,
    rgba(232, 169, 72, 0.12) 60%,
    transparent 100%
  );
  background-size: 40% 100%;   /* 光带宽度 = 卡片 40% */
  background-repeat: no-repeat;
  animation: card-sweep 1.8s ease-in-out infinite;
  /* 同源缓动：复用 Composer ink-sweep 的 ease-in-out 节奏 */
}
@keyframes card-sweep {
  0%   { background-position: -40% 0; }
  100% { background-position: 140% 0; }
}

/* synced 态：跑完最后一遍停 */
.sync-toast.synced::after {
  animation: card-sweep 1.8s ease-in-out 1 forwards;
}
/* sync-failed 态：扫光停止 */
.sync-toast.sync-failed::after {
  animation: none;
  opacity: 0;
}
```

**为什么用 `background-position` 而非 `transform: translateX`**：`translateX` 需要一个独立子元素而非 `::after`（伪元素本身就是覆盖层），`background-position` 配合 `background-size` 更干净地实现"光带在覆盖层内移动"，且 `mix-blend-mode: screen` 语义清晰。这是与 Composer `ink-sweep`（用 transform 移动子 div）的实现差异，但视觉同源。

## Contract Changes

### 1. `GameCardRuntimeEntrypoints` 扩展（contracts）

```ts
// packages/contracts/src/game-card.ts
export interface GameCardRuntimeEntrypoints {
  /** Agent id used by tsian.send() / interaction.sendMessage formal player turns. */
  playerTurn?: string
  /**
   * Agent id invoked by the default novel frontend after each player turn's
   * prose is finalized, to perform runtime/entity/scene/memory/status bar
   * maintenance. Omit to disable post-turn sync (no Toast, no invokeAgent).
   *
   * The frontend reads this via the bridge (see card.entrypoints) and calls
   * invokeAgent with this id; it never hardcodes an agent name. Toast labels
   * describe the phase behavior ("本回合整理中") and never reference this id
   * or any agent title, so renaming the agent only touches the card template.
   */
  postTurnMaintenance?: string
}
```

**为何只存 id 不存 title**：前端 Toast 文案不出现 agent 名（设计决策），所以不需要 title。id 用于 `invokeAgent(agentId, ...)` 调用。改名只动模板里的 id + agent.json，前端零改动。

### 2. Bridge 暴露 entrypoints 读取（play-bridge + platform-host）

**问题**：当前 `TsianApi` 没有读取卡 manifest / entrypoints 的方法。前端无法获知 `postTurnMaintenance` 该调哪个 agent。

**方案**：新增领域 API `tsian.card.entrypoints()`，返回 `GameCardRuntimeEntrypoints`。用专用方法而非 `query()` 逃逸口——entrypoints 是稳定的领域概念，值得一等公民 API。

```ts
// packages/play-bridge/src/tsian-api.ts
export interface TsianApi {
  // ... 现有 ...

  // ── 卡配置 ──
  readonly card: {
    /** 当前卡 runtime 入口配置。前端用它决定调用哪个 agent，不硬编码。 */
    entrypoints(): Promise<GameCardRuntimeEntrypoints>
  }
}
```

**Bridge 协议层**：新增 RPC 方法 `card.getEntrypoints`（或复用现有 card 读取通道，视 platform-host 已有的卡 manifest 访问点而定——实施时确认）。

**Platform-host 实现**：从已加载的卡 manifest `runtime.entrypoints` 读取返回。若卡未配置 `runtime.entrypoints`，返回 `{}`（前端据此判断无 postTurnMaintenance，跳过同步流程）。

**为何不用 `workspace.read("manifest.json")` 让前端自己解析**：manifest 是卡级元数据不是 workspace 文件，路径契约不匹配；且领域 API 应封装解析，让前端只拿领域语义（entrypoints）不接触文件结构。

### 3. `InvokeAgentOptions` 复用（无需扩展）

场记调用用现有 `invokeAgent(agentId, input, options)`：

```ts
tsian.invokeAgent(postTurnMaintenanceAgentId, input, {
  invocationId: selfGenerated,         // 用于 onAgentInvocation 过滤
  purpose: "post-turn-maintenance",    // 仅供日志/调试，前端不依赖
  commitMode: "workspace",             // 见下方提交策略
  persist: true,                       // 场记需跨调用累积 context
})
```

**input 内容**：最小化，只指示"刚完成第 N turn，请维护本回合状态变动"。场记自行读取 turn history、runtime、active scene、相关实体（PRD R3）。示例：
```text
"玩家回合 #{turn} 已完成，正文已落定。请维护本回合的 runtime/entity/scene/relationship/memory/status bar 变动。"
```

## Commit / Checkpoint Strategy

**现状**：`workspace-with-checkpoint` 已预留但未实现（`platform-host/index.ts:1108` 直接 throw "not implemented yet"）。`workspace` 模式可用——场记写入会落盘到 save workspace。

**MVP 路径**：本任务用 `commitMode: "workspace"`。场记维护的 workspace 写入正常落盘；主 turn 的 after-turn checkpoint（`saves.ts:124` 已有 `checkpointReason: "after-turn"`）在 sendMessage 完成时创建。

**缺口与待补验证**（记录进 implement.md，PRD Notes 已预见）：
- 当前 `workspace` 模式下，场记维护的写入**不在**主 turn 的 after-turn checkpoint 范围内——checkpoint 在 sendMessage 完成时创建，场记 invokeAgent 之后才写入。
- 这意味着 restore 到该 checkpoint 时，正文在但场记维护的状态可能缺失。
- **本任务不实现 `workspace-with-checkpoint`**（那是平台层独立任务），但在 implement.md 记录此缺口，并在 PRD 验收时明确：checkpoint/restore 一致性为"已知待补"，不阻塞本任务交付。
- 未来 `workspace-with-checkpoint` 实现后，本任务只需把 `commitMode` 改为 `"workspace-with-checkpoint"` + 传 `checkpointReason: "post-turn-maintenance"`，前端编排不变。

## Data Flow

```text
1. onTurnEnd 触发（正文已落定，turnPhase → standby）
2. useSyncAfterTurn 检查 entrypoints.postTurnMaintenance
   ├─ 无 → 不启动同步，保持 standby
   └─ 有 → syncPhase = syncing，invokeAgent(agentId, input, options)
3. onAgentInvocation 事件按 invocationId 过滤：
   ├─ type: "completed" → syncPhase = synced
   │   ├─ 刷新状态栏数据源（复用 loadCheckpoints 同款机制触发状态栏 reactive 更新）
   │   ├─ 1.5s 后 syncPhase = idle（Toast 淡出）
   │   └─ turnPhase 仍 standby（等待玩家下一轮 send）
   └─ type: "failed" → syncPhase = sync-failed
       └─ Toast 显示"重试"，用户点击 → 回 syncing，重新 invokeAgent
4. 下一轮 send 时：
   ├<arg_value> syncPhase 必须为 idle（syncing/sync-failed 时 Composer 禁用）
   └─ send 触发 turnPhase → streaming，syncPhase 保持 idle
```

**状态栏刷新机制**：synced 后需要刷新状态栏数据源（runtime/entity/scene 更新）。现有 `loadCheckpoints()` 在 onTurnEnd/restore 时触发 checkpoint 列表 reactive 更新；状态栏数据源（来自 workspace read）需同款刷新机制。实施时确认状态栏数据读取的 composable，在 synced 回调里触发其重新读取。

## Toast Position & DOM Structure

```text
StoryView.vue 现有结构（简化）：
<section class="story-view">
  <div class="story-scroll">          ← 滚动区
    <div class="story-inner">         ← 52em 居中正文流
      ...mergedStream / streamingText / TurnMeta / StoryOptions...
    </div>
  </div>
  <SyncToast                          ← 新增：正文流末尾与 Composer 之间
    v-if="syncPhase !== 'idle'"
    :phase="syncPhase"
    @retry="onSyncRetry"
  />
  <Composer ... />                    ← 现有
</section>
```

SyncToast 放在 `.story-scroll` 与 `Composer` 之间，flex 列内，`max-width: 52em; margin: 0 auto` 与正文列对齐。不进滚动区——它应固定在视口内 Composer 上方，随滚动区内容流动会脱离视线。

## Non-goals

- 不实现 `workspace-with-checkpoint`（平台层独立任务，本任务记录缺口）。
- 不在 Toast 暴露场记的工具/思维链/delta 过程（设计决策：朴素防焦虑）。
- 不实现状态栏 UI 本身（状态栏 MVP 是独立子任务 `07-04-left-status-bar-mvp`）；本任务只在 synced 回调触发状态栏数据源刷新。
- 不重构开局向导多 Agent 编排（`07-04-opening-multi-agent-orchestration`）。
- 不解耦正式回合入口 / 替换 master（已由 `07-04-agent-entrypoint-id-decoupling` 完成）。
- 不硬编码 agent 名：前端不出现 "stage-manager" / "场记" 字面量。

## Compatibility

- 项目未上线，无需兼容旧卡。默认 novel 卡模板需在 `workspace-templates.ts` 的 manifest 里加 `runtime.entrypoints.postTurnMaintenance: "stage-manager"`（id 来自已归档的模板重写任务）。
- `GameCardRuntimeEntrypoints.playerTurn` 现有语义不变，只新增字段。
- `invokeAgent` / `onAgentInvocation` API 不变（已由归档的流式化任务完成）。
- 现有 `onAgentActivity` 心跳不被本任务触及（旧心跳清理是 `07-04-setup-invoke-agent-streaming` 的范围）。

## Rollout / Rollback Shape

- **Rollout**：契约层新增字段（向后兼容，optional）→ bridge 新增方法 → 前端新增组件 + composable → 默认卡模板补 entrypoints。分层推进，每层可独立验证。
- **Rollback**：删除 SyncToast 组件 + useSyncAfterTurn composable + 回退 TurnPhase/Composer 禁用逻辑。契约层 `postTurnMaintenance` 字段保留无害（optional，旧前端不读）。卡模板 entrypoints 删除即可禁用同步流程。
