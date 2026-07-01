# Implement — Task 超时改为无响应超时

## Step 1: 类型 + 常量改名（`context-lifecycle.ts` + `index.ts`）

- [ ] `DEFAULT_TASK_TIMEOUT_MS` 改为 `DEFAULT_TASK_INACTIVITY_TIMEOUT_MS = 600_000`（10 分钟）
- [ ] `TaskTimeoutError` 构造函数消息改为"任务无响应超时"
- [ ] `WorkspaceToolLoopOptions`（index.ts:169）：`taskStartedAt` → `lastActivityAt`，`taskTimeoutMs` → `inactivityTimeoutMs`
- [ ] `AgentRuntimeTurnInput`（turn-types.ts）：`timeoutMs` → `inactivityTimeoutMs`（或保留名字只改语义，看哪个更清晰）
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 2: runtime 内部超时检查改为 lastActivityAt（`index.ts`）

- [ ] 入口路径（line 2268）：`taskStartedAt: Date.now()` → `lastActivityAt: Date.now()`
- [ ] agent_call 路径（line 1210）：同上
- [ ] native 超时检查（line 1450-1454）：`Date.now() - toolOptions.taskStartedAt > toolOptions.taskTimeoutMs` → `Date.now() - toolOptions.lastActivityAt > toolOptions.inactivityTimeoutMs`
- [ ] text 超时检查（line 1837-1841）：同上
- [ ] **活动更新点**：在 tool loop 每轮结束（round end）时更新 `toolOptions.lastActivityAt = Date.now()`——这是 runtime 内部能感知的活动信号
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 3: assistant-chat.ts 可重置计时器

- [ ] 把 `setTimeout(taskTimeoutMs)` 改为可重置计时器：定义 `let inactivityTimer: ReturnType<typeof setTimeout>`
- [ ] 定义 `resetInactivityTimer()` 函数：`clearTimeout(inactivityTimer); inactivityTimer = setTimeout(() => timeoutController.abort("task-timeout"), inactivityTimeoutMs)`
- [ ] 在 `onDelta`、`onRoundEnd`、`onTool` 回调里调 `resetInactivityTimer()`
- [ ] turn 开始时调一次 `resetInactivityTimer()` 启动计时
- [ ] finally 里 `clearTimeout(inactivityTimer)`
- [ ] `TaskTimeoutError` 构造改用新消息
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 4: invokeAgent 路径适配（`index.ts`）

- [ ] invokeAgent 的 `shouldPersist` 超时配置（`DEFAULT_TASK_TIMEOUT_MS`）改为新常量
- [ ] 验证：`npm run build --workspace platform-web` 通过

## Step 5: 全量构建 + spec 更新

- [ ] `npm run build --workspace platform-web` 通过
- [ ] 更新 `type-safety.md` 的 "Turn Token Budget And In-Turn Compression" scenario：timeout 语义从总时长改为无响应
- [ ] commit

## Validation Commands

```bash
npm run build --workspace platform-web
```

## 回滚点

每步独立 commit。Step 1-2 改 runtime 内部，Step 3 改 assistant-chat 外部计时器。两者独立可回滚。
