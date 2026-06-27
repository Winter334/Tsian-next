# Implement — Play SDK 领域 API 重设计 + injection 能力

## 执行顺序

按依赖关系从底向上：契约 → 平台能力 → SDK → 前端迁移 → 文档。

### Step 1 契约层：injection 字段 + InjectionMessage 类型

**文件**：`packages/contracts/src/runtime.ts`

1. 新增 `InjectionMessage` 接口：
   ```ts
   export interface InjectionMessage {
     role: "system" | "user" | "assistant"
     content: string
     position?: "before-input" | "after-input"
   }
   ```
2. `MessageInteractionRequest` 加 `injection?: InjectionMessage[]`
3. `InvokeAgentRequest` 加 `injection?: InjectionMessage[]`
4. 确认 `packages/contracts/src/bridge.ts` 的 `RemotePlayBridgeRequestParams` 已含 `MessageInteractionRequest`/`InvokeAgentRequest`，injection 自动覆盖（无需改 bridge.ts）。

**验证**：`pnpm --filter @tsian/contracts type-check`（或对应的 build/typecheck 命令）。

### Step 2 平台侧：上下文序列注入 injection

**文件**：`apps/platform-web/src/agent-runtime/index.ts`

1. 找到 `runAgentRuntimeTurn` 里构建上下文消息序列的函数（L833-869 区域，含 `buildWorkspaceAgentSystemPrompt` + history + 框架信息 + 玩家输入）。
2. 该函数需要能拿到 `input.injection`（从 `AgentRuntimeTurnInput` 透传，或 sendMessage host 侧把 injection 塞进 input）。
3. 按 position 分两组：
   - `before-input`（默认）：插在框架信息 user 消息之后、玩家输入之前
   - `after-input`：插在玩家输入之后
4. 每条 injection 按 `role` 构造 `RuntimeChatMessage`（`{role, content}`），保持数组顺序。
5. **缓存断点验证**：注入位置在框架信息之后（断点之后），不破坏"轮次号放后面让断点后移"的设计。实现后跑一次真实 turn 确认 provider 缓存行为正常（若 provider 报 cache miss 率异常升高，考虑 injection 合并进框架信息消息而非独立消息）。

**文件**：`apps/platform-web/src/platform-host/index.ts`
- `sendMessage`（L705）把 `input.injection` 透传给 `runAgentRuntimeTurn` 的 input。
- `invokeAgent`（L1016）同理。

**验证**：type-check。手动：构造带 injection 的 sendMessage 调用，确认 agent 上下文里出现注入内容、且位置正确（可在 ai-debug 里看 message 序列）。

### Step 3 契约 + 平台 + 桥：workspace 操作从 query.query 拆出独立 RPC

**背景**：前端 workspace 读现在塞在 `query.query` 的 resource 分支（`index.ts:522-589`），形状别扭（单文件硬包 `items:[x]`）且 catch 吞错误。write 不存在。既然 write 要加新 RPC，read/write/list/search 一起拆出来给独立 `workspace.*` method。**只影响前端 RPC 通道，agent 工具走独立路径不碰。**

#### 3a 契约层

**文件**：`packages/contracts/src/bridge.ts`

1. `RemotePlayBridgeMethod` 联合类型加 4 个：
   ```ts
   | "workspace.read" | "workspace.list" | "workspace.search" | "workspace.write"
   ```
2. `PlayFrontendBridge` 加 `workspace` 子接口：
   ```ts
   export interface WorkspaceBridge {
     read(req: WorkspaceReadRequest): Promise<WorkspaceFile | null>
     list(req: WorkspaceListRequest): Promise<WorkspaceEntry[]>
     search(req: WorkspaceSearchRequest): Promise<WorkspaceSearchResult[]>
     write(req: WorkspaceWriteRequest): Promise<WorkspaceFile>
   }
   ```
3. 定义 4 个 request 类型（`WorkspaceReadRequest` 等：path/scope/content/query 等字段）。
4. `RemotePlayBridgeRequestParams` / `RemotePlayBridgeResponseResult` 加这些类型。

#### 3b 平台 host

**文件**：`apps/platform-web/src/platform-host/index.ts`

1. `playFrontendBridge` 对象加 `workspace` 子接口，4 个方法各调 `executeWorkspaceOperationForActiveSave(..., { actorLevel: 1 })`：
   - read → operation "read"，**文件不存在返回 null，操作失败抛 error（不吞错，区别现状 L561）**
   - list → operation "list"
   - search → operation "search"
   - write → operation "write"（新增）
2. **删除** `query.query` 里的 `workspace.read`/`workspace.list`/`workspace.search` resource 分支（L522-589）。`session-history`/`checkpoints`/`history`/`agent-registry` 等真正查询留在 query。

#### 3c 桥 dispatch + normalize

**文件**：`apps/platform-web/src/bridge/remote-iframe-bridge.ts`

1. `REMOTE_PLAY_BRIDGE_METHODS` 数组加 4 个 `workspace.*`（L23-30）。
2. `dispatchRemoteBridgeRequest`（L253）加 4 个分支：
   ```ts
   if (method === "workspace.read") return bridge.workspace.read(normalizeWorkspaceReadRequest(params))
   // ...list/search/write
   ```
3. 新增 4 个 normalize 函数（校验 path 是 string、scope 合法等）。

**验证**：`pnpm --filter @tsian/contracts type-check` + `pnpm --filter @tsian/platform-web type-check`。手动：`tsian.workspace.write("save/state/test.md", "内容")` 落盘 + read 读回一致；读不存在文件返回 null 不是空数组。

### Step 4 桥 normalize：透传 injection

**文件**：`apps/platform-web/src/bridge/remote-iframe-bridge.ts`

1. `normalizeMessageInteractionRequest`（L120-133）：除了 `content`，透传 `injection`。
   - 校验 injection 是数组（或 undefined）
   - 每条：role ∈ {system,user,assistant}、content 是 string、position ∈ {before-input,after-input} 或缺省
   - 不校验语义/长度
2. `normalizeInvokeAgentRequest`（L136）：同理透传 injection。
3. 定义校验失败的 error code（如 `INVALID_INJECTION`）。

**验证**：type-check。手动：前端发带 injection 的 send，host 收到正确的 injection 结构；发畸形 injection（如 role="foo"）被桥拦下报错。

### Step 5 SDK：TsianApi 实现

**文件**：`packages/play-bridge/src/tsian-api.ts`（新建）

1. 定义 `TsianApi` 接口 + 所有子类型（`MessageDelta`/`RoundEnd`/`TurnEndResult`/`ToolEvent`/`AskRequest`/`SendOptions`/`InvokeAgentOptions`/`InjectionMessage`）。
2. `createTsian()` 实现：
   - 内部调 `createBridge()` 拿 `Bridge` 实例（包内 import，不公开导出）。
   - `send/invokeAgent`：调 `bridge.call("interaction.sendMessage"/"interaction.invokeAgent", {content/input, injection})`。
   - `onMessage`：`bridge.on({ onEvent })` 里过滤 `turn-delta` 事件，映射成 `MessageDelta`。
   - `onRoundEnd`：过滤 `turn-round-end`。
   - `onTurnEnd`：聚合 `turn-options` + `turn-stats` + `turn-completed`（缓存 options/stats，completed 时触发回调）。
   - `onTool`：过滤 `turn-tool`。
   - `onAsk`：`bridge.on({ onInteractionRequest })` 映射。
   - `answer`：调 `bridge.respondInteraction`。
   - `history.get`：调 `bridge.call("query.query", {resource: "session-history"})`，复用现有 `createSessionHistory` 逻辑（可内部调）。
   - `checkpoints.list/restore`：复用现有 `listCheckpoints`/`restoreCheckpoint` 逻辑。
   - `workspace.read`：调 `bridge.call("workspace.read", {path, scope})`（独立 RPC，不再走 query.query）。
   - `workspace.write`：调 `bridge.call("workspace.write", {path, content, scope})`。
   - `query/runAction`：调 `bridge.call("query.query"/"platform.runAction", ...)`。
   - `ready()`：轮询 `bridge.ready` 或包一个 Promise。
3. 每个订阅方法返回 unsubscribe 函数。

**文件**：`packages/play-bridge/src/index.ts`
- 导出 `createTsian` + `TsianApi` + 所有领域类型。
- `createBridge`/`Bridge`/`BridgeHandlers` 降为不公开导出（或移到 internal 子路径）。
- 现有 `createSessionHistory`/`listCheckpoints`/`restoreCheckpoint`/`parseStoryOptions` 不再顶层导出（并入 TsianApi），但 `parseStoryOptions` 是纯解析工具，可保留导出（前端流式渲染时用）。

**验证**：`pnpm --filter @tsian/play-bridge type-check` + `pnpm --filter @tsian/play-bridge build`。

### Step 6 前端迁移：play-frontend-dev

**文件**：`apps/play-frontend-dev/src/main.ts`

1. `import { createBridge, ... } from "@tsian/play-bridge"` → `import { createTsian, ... } from "@tsian/play-bridge"`。
2. `bridge.call("interaction.sendMessage", {content})` → `tsian.send(text)`。
3. `bridge.on({ onEvent: handleEvent, ... })` → 拆成 `tsian.onMessage/onRoundEnd/onTurnEnd/onTool/onAsk`。
4. `handleEvent` 里的 `turn-delta`/`turn-round-end`/`turn-completed`/`turn-tool`/`turn-stats`/`turn-options`/`interaction-request` 分发逻辑 → 各自移到对应订阅回调。
5. `createSessionHistory(bridge)` → `tsian.history.get()`。
6. checkpoint 视图的 `listCheckpoints(bridge)`/`restoreCheckpoint(bridge, id)` → `tsian.checkpoints.list/restore`。
7. `parseStoryOptions` 保留（流式渲染时用，纯工具）。
8. `vite.config.ts` 的 alias 不变（还是指向 play-bridge 源码）。

**验证**：`pnpm --filter play-frontend-dev build`。手动：dev server 跑起来，发消息、收回复、选项按钮、ask_user、checkpoint 回溯全部功能正常。

### Step 7 API 文档

**文件**：`docs/sdk/play-frontend-api.md`（新建，路径实现期可调）

按 design §5 结构写：
1. 快速开始（import + createTsian + 最小示例）
2. 生命周期
3. 发送（send + injection 用法 + invokeAgent）
4. 订阅（onMessage/onRoundEnd/onTurnEnd/onTool/onAsk + answer）
5. 数据（history/checkpoints）
6. workspace（read/write）
7. 通用入口（query/runAction）
8. 类型参考

示例用 vanilla JS，面向助手 agent 和前端开发者。

### Step 8 方向文档更新

**文件**：`docs/active/play-frontend-sdk-direction.md`

1. §1 当前答案改为"领域 API（domain API）"。
2. §2 核心定位更新：SDK 是面向游戏前端开发者的领域语言，吸收 RPC 细节。
3. 注明桥协议扩展（新增 4 个 `workspace.*` method）。

**文件**：`.trellis/spec/platform-web/frontend/type-safety.md`

4. **Spec 冲突修复**：现有 spec L67-68 写的是 "Workspace read/list/search reuse existing platform-host query behavior. Workspace write/delete and checkpoint restore reuse existing `platform.runAction` behavior." 以及 "The allowed remote methods are `interaction.sendMessage`, `interaction.invokeAgent`, `query.query`, `platform.getPlatformContext`, and `platform.runAction`." —— 本次拆出 `workspace.read/list/search/write` 独立 RPC method 后，这两句要更新：allowed remote methods 加 4 个 `workspace.*`；workspace 操作不再复用 query/runAction 通道，走独立 method。

### Step 9 全量验证

1. `pnpm --filter @tsian/contracts type-check`
2. `pnpm --filter @tsian/play-bridge type-check && build`
3. `pnpm --filter @tsian/platform-web type-check`
4. `pnpm --filter play-frontend-dev build`
5. 手动端到端：play-frontend-dev 发消息 + injection + workspace 读写 + checkpoint 回溯全部正常。

## 回滚点

- 每个 Step 独立可回滚（契约改动向后兼容——injection 是可选字段，旧前端不传不影响）。
- SDK 重设计：`createBridge` 保留为 internal，紧急时可重新公开导出回退到裸 call。
- workspace.write 是新 resource，不影响现有 read。
- injection 不落盘，回滚后无数据残留问题。
