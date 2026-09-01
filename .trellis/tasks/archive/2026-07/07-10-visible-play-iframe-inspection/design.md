# 技术设计：可见 Play iframe 前端自检

## 1. 设计目标

本任务把 `inspect_frontend` 重新定义为“桌面助手接管当前真实 Play iframe 的调试会话”。它不再拥有独立 iframe、独立 bridge 或临时 save，而是借用 `PlayView` 已经挂载的 packaged iframe，观察真实 bridge 请求并在结束时恢复调试前 save-runtime baseline。

核心约束：

1. **真实现场唯一**：只能操作当前 Play mount，不创建替代现场。
2. **真实路径优先**：发送消息必须由前端 UI 自己发起。
3. **回滚边界明确**：只回滚 save-runtime；卡内容与前端源码保留。
4. **不理解卡业务**：运行链稳定只由通用 bridge activity 判定。
5. **恢复可验证**：finish 恢复后重挂 Play，并返回一次性恢复快照。
6. **不保留旧行为**：删除隐藏/ephemeral 分支，而不是加 target 模式。

## 2. 现有实现与改造边界

### 2.1 当前所有权

- `PlayView.vue` 的 `frontendMount` 是 Play iframe 的真实所有者；packaged 与 remote 都调用 `mountRemoteIframeFrontend`。
- `mountRemoteIframeFrontend` 创建 iframe、生成 bridge sessionId、处理 RPC、转发 streaming/debug/invocation 事件并返回 disposer。
- `frontend-inspector.ts` 目前重复调用 mount 函数创建隐藏 iframe，再自行持有 session/dispose/ephemeral save。

新设计保持所有权单一：

- `PlayView` 仍是 iframe 唯一 owner；
- bridge 层提供只读/订阅式 mount handle；
- inspector 只借用 handle，不调用其 `dispose()`。

### 2.2 依赖方向

目标依赖图：

```text
PlayView
  -> remote-iframe-bridge (create mount handle)
  -> play-frontend-target registry (register/unregister handle)

frontend-inspector
  -> play-frontend-target registry (borrow current handle)
  -> frontend-debug-session storage (baseline marker)
  -> checkpoints/saves/platform events
  -> inspector DOM + diagnostics helpers

checkpoints/saves
  -> frontend-debug-session storage (read protected baseline only)
```

禁止：

- bridge/storage 导入 `frontend-inspector.ts`；
- PlayView 或 inspector 通过 `.desktop-window iframe` DOM selector 猜目标；
- 在 Dexie 中保存 iframe、Window、bridge sessionId 或 generation handle。

## 3. Play mount handle 与目标注册表

### 3.1 `MountedRemoteIframeFrontend`

将 `mountRemoteIframeFrontend` 的返回值由 disposer 函数升级为 handle：

```ts
interface MountedRemoteIframeFrontend {
  readonly iframe: HTMLIFrameElement
  readonly sessionId: string
  readonly status: "loading" | "ready" | "error" | "disposed"
  readonly activitySequence: number
  readonly inFlightRequestCount: number
  subscribeStatus(listener: (status: MountStatus) => void): () => void
  subscribeActivity(listener: (entry: RemoteBridgeActivityEntry) => void): () => void
  waitForReady(timeoutMs: number): Promise<boolean>
  dispose(): void
}
```

说明：

- `sessionId` 仅为内存 mount identity；registry/inspector 可用它区分 generation，但不落盘、不出现在 AI result。
- `status` 由 hello 握手标记 ready；load 只代表文档加载，不代表 bridge ready。
- dispose 幂等，清理 window message、streaming/debug/invocation subscriptions 与 iframe。
- 为减少调用方破坏风险，若需要可以把 `dispose` 只交给 owner，registry 暴露不含 dispose 的 `PlayFrontendTargetHandle` 视图。

### 3.2 通用 bridge activity

父层在 `handleRemoteRequest` 边界产生 activity：

```ts
interface RemoteBridgeActivityEntry {
  sequence: number
  requestId: string
  method: RemotePlayBridgeMethod
  phase: "started" | "completed" | "failed"
  at: number
  error?: { code: string; message: string }
}
```

顺序：

```text
收到合法 request
  -> inFlight++
  -> emit started
  -> await bridge method
  -> post response
  -> sendMessage 时 post real turn-completed
  -> emit completed / failed
  -> inFlight--
```

- 仅记录 metadata；不保留 params/result。
- 不将 activity 加入现有 `streaming-events.ts`：该模块明确只服务 turn/invocation 流，不应扩成通用总线。
- listener Set 属于 mount 实例，iframe 重挂后自然隔离。
- failed activity 使用现有 `toBridgeError` 的 code/message。

### 3.3 target registry

新增 `bridge/play-frontend-target.ts`：

```ts
interface PlayFrontendTarget {
  generation: number
  kind: "packaged" | "remote"
  gameCardId: string
  entry?: string
  mount: ReadonlyMountedRemoteIframeFrontend
}

registerPlayFrontendTarget(target): () => void
getPlayFrontendTarget(): PlayFrontendTarget | null
subscribePlayFrontendTarget(listener): () => void
waitForNextReadyPlayFrontendTarget(afterGeneration, timeoutMs): Promise<PlayFrontendTarget | null>
```

- registry 是模块级内存单例，符合平台已有单例桥状态模式。
- generation 单调递增；unregister 使用 identity guard，旧 mount cleanup 不得清掉新 mount。
- packaged 与 remote 都注册：inspector 能区分 `TARGET_UNAVAILABLE` 与 `REMOTE_UNSUPPORTED`。
- `PlayView` 在 mount 返回后立即 register；onBridgeReady 改变 handle status，inspector 自行等待。
- `unmountFrontend` 先 unregister，再由 owner dispose。
- Play minimized 不注销；return launcher、close、unmount、replacement 均注销。

## 4. 调试 baseline 存储

### 4.1 marker shape

新增 `storage/frontend-debug-session.ts`，使用现有 `meta` 表，不改 DB schema：

```ts
const FRONTEND_DEBUG_SESSION_KEY = "frontend-debug-session"

interface FrontendDebugSessionRecord {
  schema: "tsian.frontend-debug-session.v1"
  saveId: string
  gameCardId: string
  checkpointId: string
  baselineTurn: number
  startedAt: number
}
```

API：

- `getFrontendDebugSession()`：严格 parse/normalize；损坏时返回结构化 invalid 状态，供 inspector 报错后 clear。
- `setFrontendDebugSession(record)`
- `clearFrontendDebugSession()`
- `getProtectedFrontendDebugCheckpointId(saveId)`：供 storage prune/replace 使用，只返回同 save 的 checkpointId。

选择 meta 而非新增表：

- 全局只允许一条 marker；
- 不需要索引；
- 避免 schema/DB name/SW DB literal 变更；
- marker 是平台本地调试状态，不属于 save workspace，也不能随 checkpoint 回滚。

### 4.2 baseline 建立

首次 inspect 的前置检查顺序：

1. 读取 marker：
   - 有效且 save 匹配 → 沿用；
   - 有效但 active save 不同 → fail，保留 marker；
   - marker 损坏、save/checkpoint 不存在 → fail 一次并 clear；
   - 无 marker → 继续建立。
2. 取得 ready packaged target，验证 target card 与 active save 的 gameCardId 一致。
3. 验证 build status 非 building、mount 当前无 in-flight 且已过 quiet window。
4. 读取 active save workspace turn files，计算 `currentTurn`。
5. 列出该 save checkpoints，只看 `turn === currentTurn`：
   - `currentTurn > 0`：按 createdAt 最新选择 `post-turn-maintenance`，没有则 `after-turn`；
   - `currentTurn === 0`：最新 `manual`，没有则 `initial`；
   - 都没有 → fail，不使用较早 checkpoint。
6. 持久化 marker。
7. 创建内存 frame session/diagnostics，再执行 actions。

严格 currentTurn 可防止把“调试前已有但尚未 checkpoint 的正式回合”误判成测试数据。第一版仍接受同 turn 检查点之后可能存在 direct workspace write 的已知限制；工具结果明确 `rollbackScope:"save-runtime"` 和具体 baseline。

## 5. baseline 保护

### 5.1 prune

`pruneCheckpointsForSave(saveId)` 读取 protected checkpoint ID，先加入 `keepIds`。其余 recent/sparse/current 规则不变；GC 读取 remaining manifests，因此受保护 baseline 的 blobs 仍被引用。

### 5.2 maintenance replace

`commitWorkspaceFilesWithCheckpointForSave` 删除同 turn `after-turn` 时排除 protected ID。这样已锁定的 pre-maintenance baseline 不会被后续测试 maintenance 替换。

### 5.3 turn-0 initial replace

`replaceInitialCheckpointForSave` 删除 initial 时同样排除 protected ID，避免 setup/手动 checkpoint 流程移除调试 baseline。

### 5.4 restore 下界

平台 `restore-checkpoint` action 在恢复前读取 marker：

- marker.saveId 与 active save 相同且 target checkpoint.turn < baselineTurn → 返回 `FRONTEND_DEBUG_BASELINE_FLOOR`；
- target turn >= baselineTurn → 允许既有恢复；
- 恢复 baseline 本身不自动 clear marker。

这层必须在 platform-host action 边界实施，而非 storage helper，因为它是“当前 active 调试会话”的业务规则。

## 6. Inspector 模块拆分

当前 `frontend-inspector.ts` 同时包含运行时编排、隐藏 mount、ephemeral Agent turn、DOM/ARIA、diagnostics 和 diff。删除旧链路后按自然接缝拆分：

### 6.1 `frontend-inspector.ts`

负责：

- `createFrontendInspector` / operation normalize 后的业务编排；
- marker/target/save/build 校验；
- frame session 取得/替换；
- runtime-settled；
- finish；
- result/error 组装与截断。

### 6.2 `frontend-inspector-dom.ts`

移动并保留：

- action types 的执行、auto-wait、action snapshots；
- `collectStructure`、ARIA serializer、computed styles、renderedText；
- diff 的纯函数与 snapshot 类型。

修复：

- `doc.defaultView.MouseEvent/Event/KeyboardEvent`；
- focus/scroll/input/change 均使用目标 realm；
- structured action error 被顶层识别，而非转为 `[object Object]`。

### 6.3 `frontend-inspector-diagnostics.ts`

提供：

```ts
interface DiagnosticsCollectorHandle {
  snapshot(bridgeReady: boolean): InspectFrontendDiagnostics
  dispose(): void
}
```

- error/unhandledrejection/resource listener 使用具名函数，dispose 移除。
- console wrapper 保留原函数引用；dispose 仅在当前 console 方法仍等于自己的 wrapper 时恢复，避免覆盖其它调试工具后装 wrapper。
- iframe realm 的 Error 用 duck typing；资源元素按 tagName 取 src/href。
- arrays 使用有界 ring 或 push 后裁剪，防止长会话增长。
- 初始化时读取当前 performance entries；之后只捕获新事件。

### 6.4 内存 frame session

可放在 inspector 文件或独立 `frontend-inspector-session.ts`：

```ts
interface LiveInspectFrameSession {
  generation: number
  targetSessionId: string
  diagnostics: DiagnosticsCollectorHandle
  activity: bounded entries
  lastSnapshot: InspectSnapshot | null
  activeChain: RuntimeActivityChain | null
  unsubscribeActivity(): void
  dispose(): void
}
```

- 与持久化 debug marker 分离：刷新后 marker 存在，但 frame session 重新建立。
- target generation 变化时 dispose 旧 session、建立新 session，diagnostics/activity/diff 清零。
- target 暂时不存在时 dispose 内存 session但不清 marker。

## 7. runtime-settled 状态机

### 7.1 链路建立

frame session 订阅全部 activity：

- 观察到 `interaction.sendMessage / started`：若无 active chain 则创建；已有则增加 sendCount。
- active chain 存在时，所有 started/completed/failed activity 都写入 chain ring。
- started 增加 pending request IDs；completed/failed 删除。
- 每个 activity 更新 `lastActivityAt`；failed 记录失败 metadata。

### 7.2 等待规则

```text
waitWithActions:
  cursor = current sequence
  execute actions
  wait short trigger window for send started after cursor
  no send -> INSPECT_RUNTIME_NOT_TRIGGERED
  wait active chain settled

waitWithoutActions:
  active/unfinished chain exists -> continue wait
  none -> INSPECT_RUNTIME_NOT_ACTIVE
```

settled 条件：

```text
pendingRequestIds.size === 0
AND Date.now() - lastActivityAt >= 2000ms
```

- polling 或 session-local condition waiter 都可；优先 listener + timer，避免 16ms 长轮询。
- timeoutMs 默认 300000，normalize 为正整数并设最大值（建议 900000）。
- timeout 时不 dispose chain，后续可续等；返回 `runtime.status:"timeout"` 和当前 activity。
- settled 后保留最后 chain summary 供本次结果，随后标记 inactive；新的 send 建新 chain。
- request failed 不阻止 settled，只将 runtime.status 设为 `settled-with-failures`。

### 7.3 2 秒静默的边界

当前 onTurnEnd 后立即读取 entrypoints 并 invoke maintenance，会自然落入静默窗口。未来任意连续 bridge 后处理同样被覆盖。超过 2 秒才由前端定时器发起的新工作是新链/独立活动，不属于本次保证，PRD 已列为 out of scope。

## 8. inspect operation

处理顺序：

1. validate operation 字段组合；
2. resolve/establish marker；
3. resolve current ready target 与 frame session；
4. 若 build status building 或 target replacement 中 → transient busy；
5. 若 wait+actions，先记录 activity cursor；
6. 顺序执行 actions；每步 autoWait，必要时 microtick + snapshot；
7. wait runtime-settled 或立即返回；
8. collect current structure + cumulative diagnostics；
9. 计算同 generation diff；
10. build file-line map；
11. 返回 debugSession、frameGeneration、activity、runtime、snapshots、truncated。

`bridgeState` 不再通过隐藏 mount 局部布尔值推断，而来自 handle status + active chain：loading / ready / turn-active / error。

## 9. finish operation

### 9.1 前置校验

- marker 存在且合法；否则 `DEBUG_SESSION_NOT_ACTIVE` 或 invalid-marker error。
- active save === marker.saveId；save/card/checkpoint 均存在。
- ready packaged target 已挂载且对应原 save/card。
- build 不在 building/reloading。
- handle 当前 `inFlight === 0` 且已静默 2 秒；否则 `DEBUG_SESSION_BUSY`。

### 9.2 恢复顺序

```text
capture old generation
  -> dispose inspector frame session (不 dispose Play mount)
  -> restoreCheckpointForSave(saveId, checkpointId)
  -> restore success
  -> clear persisted marker
  -> emitTurnDebugReady(restoredTurn)
  -> emitFrontendReload()
  -> wait registry generation > old && ready (10s)
  -> collect one-shot restored snapshot
  -> dispose one-shot diagnostics
  -> return finish result
```

关键语义：

- finish 的 restore 必须以精确 baseline record 为边界：除现有 `turn > baselineTurn` 外，还删除同一 turn 上 `createdAt > baseline.createdAt` 的 checkpoint。否则 turn-0 setup/manual 或 same-turn maintenance 测试会在回滚后留下“未来检查点”。更早的同 turn checkpoint 保留。
- restore 失败：marker 保留，允许重试。
- restore 成功但 clear marker 失败：返回结构化 partial failure；下一次读取 marker 时可再次恢复同一 checkpoint（storage restore 是同目标幂等），但实现应优先保证 meta delete 成功。
- restore + clear 成功后，reload 失败/超时：返回 `restored:true, reloadReady:false`，marker 不恢复。
- finish 快照不走普通 inspect 建 baseline 路径。

## 10. 工具契约

### 10.1 Input

```ts
interface InspectFrontendInput {
  operation?: "inspect" | "finish"
  actions?: InspectDomAction[]
  observeBetween?: boolean
  autoWait?: boolean
  wait?: "runtime-settled"
  timeoutMs?: number
}
```

normalize：

- unknown operation/wait fail loud；
- finish 带其它字段 fail `INSPECT_FINISH_ARGUMENT_CONFLICT`；
- timeoutMs 仅在 runtime-settled 时合法；
- 旧 send/refresh/runtime/screenshot 作为未知/显式已删除字段报清晰参数错误，不静默忽略。

### 10.2 Result

建议：

```ts
interface InspectFrontendResult {
  ok: boolean
  operation: "inspect" | "finish"
  cardId: string
  entry: string
  frameGeneration?: number
  debugSession?: {
    active: boolean
    saveId: string
    baselineCheckpointId: string
    baselineTurn: number
    startedAt: number
    rollbackScope: "save-runtime"
  }
  structure: InspectFrontendStructure
  diagnostics: InspectFrontendDiagnostics
  activity?: InspectFrontendActivityEntry[]
  runtime?: {
    status: "not-requested" | "active" | "settled" | "settled-with-failures" | "timeout"
    sendCount: number
    inFlight: number
    quietMs: number
  }
  restored?: {
    restored: boolean
    restoredTurn: number
    reloadReady: boolean
  }
  actionSnapshots?: InspectFrontendActionSnapshot[]
  fileLineMap?: ...
  diff?: ...
  truncated?: boolean
  error?: ...
}
```

finish 部分成功可保持 `ok:true` 并通过 `restored.reloadReady:false` + diagnostics/error detail 表达；前置失败 `ok:false`。

旧 `InspectFrontendTimelineEntry` 删除，替换为 activity 类型。

## 11. AI-facing 清理

必须同步修改：

- `workspace-tools-types.ts`
- `workspace-tools.ts` normalize
- `tool-schemas.ts`
- `tool-controls.ts`
- native/text 工具列表与例子
- `storage/local-assistant-files.ts` 中桌面助手前端编辑说明
- 当前方向文档 `docs/active/assistant-frontend-inspection-direction.md`

描述应教助手：

1. 玩家先打开真实 Play/save；
2. 首次 inspect 自动建立 baseline；
3. 用 DOM actions 走真实 UI；
4. 需要时 `wait:"runtime-settled"`；
5. 修改源码、等构建完成、继续 inspect；
6. 最后必须 `operation:"finish"` 恢复测试运行时。

不向模型解释 marker 的存储、prune、sessionId 或静默实现细节；只描述必要操作语义。

## 12. 错误矩阵

| 场景 | 结果 |
|---|---|
| 无 Play / 启动器态 | `INSPECT_FRONTEND_TARGET_UNAVAILABLE` |
| remote | `INSPECT_FRONTEND_REMOTE_UNSUPPORTED` |
| building/reloading | `INSPECT_FRONTEND_TARGET_BUSY` |
| target 非 ready/文档不可读 | `INSPECT_FRONTEND_TARGET_NOT_READY` |
| runtime 正忙时首次建 baseline | `INSPECT_FRONTEND_RUNTIME_BUSY` |
| currentTurn 无规范 checkpoint | `INSPECT_FRONTEND_BASELINE_UNAVAILABLE` |
| active save 与 marker 不同 | `INSPECT_FRONTEND_SAVE_MISMATCH`，保留 marker |
| marker 损坏/save或checkpoint消失 | 一次 invalid 错误并 clear |
| actions 未触发 send | `INSPECT_RUNTIME_NOT_TRIGGERED` |
| 无 active chain 续等 | `INSPECT_RUNTIME_NOT_ACTIVE` |
| runtime wait 超时 | 成功返回 timeout 快照，不取消运行 |
| finish 无 marker | `DEBUG_SESSION_NOT_ACTIVE` |
| finish runtime busy | `DEBUG_SESSION_BUSY`，保留 marker |
| finish restore 成功但 reload 超时 | `ok:true`, `restored:true`, `reloadReady:false` |
| restore 到 baseline 之前 | `FRONTEND_DEBUG_BASELINE_FLOOR` |

## 13. 兼容与迁移

- 不迁移旧 inspector 输入，也不保留隐藏模式。
- 无数据库 schema 变更；meta 新 key 对旧本地数据是自然空值。
- `mountRemoteIframeFrontend` 的两个调用点（PlayView + 旧 inspector）中，旧 inspector 调用会被删除；PlayView 迁移到 handle。若有外部 barrel export，保持函数名稳定即可。
- contracts 层当前不承载 inspector 输入/结果，因此预计只需 `platform-web` 构建；若实施时把 activity/handle 提升到共享 contracts，再补 contracts 构建，但设计优先保持它们平台内部。

## 14. 失败恢复与回滚

实施采用分阶段绿色构建：

1. 先加 mount handle/registry，不改 inspector 行为；PlayView 正常即稳定点。
2. 加 marker/保护逻辑；检查点行为验证后稳定点。
3. 重写 inspector/契约并删除旧链路。
4. 加 finish 与文档清理。

任一阶段失败可回滚该阶段，不需要迁移本地数据。若开发中留下 marker，删除 meta key 即可；不得删除用户 save/checkpoint 作为清理手段。
