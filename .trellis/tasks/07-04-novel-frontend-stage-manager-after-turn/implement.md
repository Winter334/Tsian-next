# 默认 novel 前端回合后场记编排 · 实施计划

## Validation Commands

```bash
# 契约层变更（game-card.ts）
npm run build:contracts

# 前端 + play-bridge 类型检查
npm run build:web

# play-bridge 单元测试（若有 invokeAgent/onAgentInvocation 相关）
npm -w @tsian/play-bridge test
```

## Review Gates

- **G1 契约层**：`GameCardRuntimeEntrypoints.postTurnMaintenance` + bridge `card.entrypoints()` 落地后，先 review 契约形态再写前端。
- **G2 组件完成**：SyncToast 三态 + 卡片扫光视觉验收后再接 useSyncAfterTurn。
- **G3 端到端**：默认卡模板补 entrypoints 后，实际跑一轮 send→正文完成→Toast 整理中→已整理，确认无硬编码、正文不被阻塞。

## Implementation Steps

### 1. 契约层：扩展 GameCardRuntimeEntrypoints

- [ ] `packages/contracts/src/game-card.ts`：`GameCardRuntimeEntrypoints` 增 `postTurnMaintenance?: string`（带 JSDoc，说明前端通过 bridge 读取、Toast 文案不引用此 id/title、改名只动模板）。
- [ ] **G1 review**：确认字段语义、optional 兼容性。
- [ ] 验证：`npm run build:contracts` 通过。

**搜索确认**：改前 `grep -rn "GameCardRuntimeEntrypoints" packages/ contracts/ apps/` 看现有引用点，确认新增 optional 字段不破坏现有解构。

### 2. Bridge 层：暴露 card.entrypoints() 给前端

- [ ] `packages/contracts/src/bridge.ts`：确认是否需要新增 RPC 方法名 `card.getEntrypoints`（或复用已有 card manifest 读取通道——实施时 grep 现有 `card.` 前缀方法）。
- [ ] `apps/platform-web/src/platform-host/index.ts`：实现 `card.getEntrypoints` handler，从已加载卡 manifest `runtime?.entrypoints ?? {}` 返回。
- [ ] `packages/play-bridge/src/tsian-api.ts`：`TsianApi` 接口增 `readonly card: { entrypoints(): Promise<GameCardRuntimeEntrypoints> }`；实现层调 bridge。
- [ ] 验证：`npm run build:contracts` + `npm run build:web` 通过。

**搜索确认**：`grep -rn "card\.\|manifest\|entrypoints" packages/play-bridge/src/ apps/platform-web/src/platform-host/` 找现有卡 manifest 访问点，避免重复发明。

### 3. 前端类型层：SyncPhase

- [ ] `apps/play-frontend-dev/src/types.ts`：新增 `SyncPhase = "idle" | "syncing" | "synced" | "sync-failed"`，带 JSDoc 说明与 TurnPhase 正交。

### 4. 前端组件层：SyncToast.vue

- [ ] 新建 `apps/play-frontend-dev/src/components/story/SyncToast.vue`：
  - Props: `{ phase: SyncPhase }`；Emits: `{ retry: [] }`。
  - 三态渲染：syncing(`● 本回合整理中`) / synced(`◆ 已整理`) / sync-failed(`✕ 整理失败 · 重试`)。
  - 卡片扫光 `::after` 伪元素 + `card-sweep` keyframe（见 design.md CSS 规格）。
  - 复用现有 token：`--line-strong` / `--ember-bright` / `--blood` / `--prose-dim` / `--font-mono`。
  - 出现/消失过渡：opacity + translateY。
- [ ] **G2 review**：视觉验收三态 + 扫光节奏（1.8s 循环，synced 跑完一遍停，sync-failed 停）。

**实现注意**：
- `mix-blend-mode: screen` 确保扫光只提亮不遮文字。
- `pointer-events: none` 在 `::after` 上，"重试"点击穿透到内容层。
- `overflow: hidden` 在卡片容器，扫光不溢出。

### 5. 前端编排层：useSyncAfterTurn.ts

- [ ] 新建 `apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts`：
  - 暴露响应式 `syncPhase: Ref<SyncPhase>`（模块级共享，同 useTsian 模式）。
  - `triggerSyncAfterTurn(turn: number)`：读 `tsian.card.entrypoints()`，无 `postTurnMaintenance` 则直接 return（不启动）；有则 `syncPhase = syncing`，调 `tsian.invokeAgent(agentId, input, { invocationId, purpose: "post-turn-maintenance", commitMode: "workspace", persist: true })`。
  - 订阅 `tsian.onAgentInvocation`，按 invocationId 过滤：`completed` → `syncPhase = synced` + 触发状态栏刷新 + 1.5s 后 `idle`；`failed` → `syncPhase = sync-failed`。
  - `retry()`：`syncPhase = syncing`，重新 invokeAgent（同 invocationId 或新生成，实施时确认——倾向新生成 invocationId 以区分两次调用 trace）。
  - input 内容：`"玩家回合 #{turn} 已完成，正文已落定。请维护本回合的 runtime/entity/scene/relationship/memory/status bar 变动。"`
- [ ] 验证：`npm run build:web` 类型通过。

**搜索确认**：状态栏数据源 composable 尚未存在（状态栏 MVP 是独立任务）。synced 回调里先留 `// TODO: 触发状态栏数据源刷新（待 07-04-left-status-bar-mvp）`，不阻塞本任务。

### 6. 前端接入：useTsian + StoryView + Composer

- [ ] `apps/play-frontend-dev/src/composables/useTsian.ts`：
  - `onTurnEnd` 回调里，正文落定后调 `useSyncAfterTurn().triggerSyncAfterTurn(turnCount)`。
  - 暴露 `syncPhase` 给 StoryView。
- [ ] `apps/play-frontend-dev/src/components/story/StoryView.vue`：
  - `<SyncToast v-if="syncPhase !== 'idle'" :phase="syncPhase" @retry="onSyncRetry" />` 插入 `.story-scroll` 与 `<Composer>` 之间。
  - `onSyncRetry` 调 `useSyncAfterTurn().retry()`。
- [ ] `apps/play-frontend-dev/src/components/story/Composer.vue`：
  - 禁用条件从 `streaming` 扩展为 `streaming || syncing || sync-failed`（通过 props 传入，或 StoryView 计算 `disabled` 传 Composer）。
  - streaming 时 placeholder "故事正在书写…"；syncing/sync-failed 时 placeholder "整理本回合中…"（无 agent 名）。
- [ ] **G3 review**：端到端跑一轮，确认正文不被阻塞、Toast 三态正确、Composer 禁用/解锁正确。

**实现注意**：
- send 前置守卫：`if (syncPhase !== 'idle') return`，避免 sync-failed 时强发。
- stop 逻辑不触及 sync（sync 是独立 invocation，tsian.stop 只中断主 turn；若需中断场记，是独立需求，本任务不做）。

### 7. 默认卡模板：补 entrypoints

- [ ] `apps/platform-web/src/storage/workspace-templates.ts`：默认卡 manifest 增 `runtime: { entrypoints: { playerTurn: "storyteller", postTurnMaintenance: "stage-manager" } }`。
  - 确认现有 manifest 是否已有 `runtime.entrypoints.playerTurn`，若有只补 `postTurnMaintenance`。
- [ ] 验证：`npm run build:web` 通过。

**搜索确认**：`grep -n "entrypoints\|playerTurn\|runtime:" apps/platform-web/src/storage/workspace-templates.ts` 看现有 manifest 结构。

### 8. 文档更新

- [ ] `docs/sdk/play-frontend-api.md`：增 `tsian.card.entrypoints()` 条目 + 说明回合后同步流程的领域 API 用法。
- [ ] 若 `docs/active/novel-airp-workspace-schema-direction.md` 涉及前端编排，追加 post-turn sync 编排说明。

### 9. 已知缺口记录（不阻塞交付）

- [ ] 在 implement.md（本文件）或 task notes 记录：`workspace-with-checkpoint` 未实现，当前 `commitMode: "workspace"` 下 checkpoint/restore 一致性为已知待补（PRD Notes 已预见）。未来切 `workspace-with-checkpoint` 时前端编排不变，只改 commitMode + checkpointReason。

### 10. 全量验证

- [ ] `npm run build:contracts` 通过。
- [ ] `npm run build:web` 通过。
- [ ] grep 确认无硬编码：`grep -rn "stage-manager\|场记" apps/play-frontend-dev/src/` 应只在注释/类型说明出现，不在运行时调用或 Toast 文案出现。
- [ ] grep 确认 Toast 文案无 agent 名：`grep -rn "整理中\|整理失败\|已整理\|本回合" apps/play-frontend-dev/src/components/story/SyncToast.vue` 确认文案只有阶段行为。

## Rollback Points

- 步骤 1-2 后回退：删除新增字段/method，optional 兼容无破坏。
- 步骤 4-6 后回退：删除 SyncToast.vue + useSyncAfterTurn.ts + StoryView/Composer/useTsian 接入点。
- 步骤 7 后回退：卡模板删除 `postTurnMaintenance`，前端 `card.entrypoints()` 返回无此字段，同步流程自动不启动（Toast 不出现）。

## Validation Against Acceptance Criteria

| PRD 验收项 | 对应步骤 |
|---|---|
| 默认 novel 前端实现正文完成后的场记调用流程 | 5, 6 |
| UI 有状态同步中、同步失败、重试、下一轮锁定/解锁状态 | 4, 6 (SyncToast 三态 + Composer 禁用) |
| 场记调用不阻塞正文首屏/流式展示 | 6 (onTurnEnd 后才触发，正文已落定) |
| 场记完成后 runtime/entity/scene 等更新能被状态栏读取 | 5 (synced 回调触发刷新，TODO 待状态栏 MVP) |
| 场记失败不会静默丢失，且不会允许下一轮在旧状态上继续 | 5, 6 (sync-failed 持续可见 + Composer 禁用) |
| checkpoint/restore 行为与回合后维护状态一致 | 9 (已知待补，workspace-with-checkpoint 未实现) |
| 平台核心没有硬编码 novel AIRP 的说书人→场记 pipeline | 2, 5, 7 (前端从 entrypoints 读 agentId，平台只提供通用 invokeAgent) |
