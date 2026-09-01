# Design — Play SDK 领域 API 重设计 + injection 能力

## 1. 架构决策

### 1.1 一层领域 API，协议层留包内

`@tsian/play-bridge` 分两层：
- **协议层**（内部，不公开导出）：`bridge.ts` 的 `createBridge`/`Bridge`/`call`——postMessage 握手、RPC id 匹配、消息路由。保持现状不动。
- **领域层**（对外导出）：`createTsian()` 返回 `TsianApi` 对象，方法名是前端开发者心智里的动词（`send`/`onMessage`/`history`...），内部调 `bridge.call`。

现有 `createSessionHistory`/`listCheckpoints`/`restoreCheckpoint`/`parseStoryOptions` 并入 `TsianApi`，不再顶层单独导出。

### 1.2 维持前端 import 包

不做平台注入。理由：packaged 前端走 Service Worker（`packaged-frontend.ts:48-57`），注入要改 SW HTML 改写；remote 前端平台控不了 HTML。注入复杂度 > "多 import 一个包"的负担。

### 1.3 SDK 是翻译层不是决策层

平台所有能力都暴露，只是用前端能懂的语言。高频能力走语义化方法，冷门/未来新增走 `tsian.query`/`tsian.runAction` 通用入口（领域语言里的"查资源/执行动作"，不暴露 RPC method 字符串）。

## 2. TsianApi 接口设计

```ts
export interface TsianApi {
  // ── 生命周期 ──
  /** 握手是否完成。 */
  readonly ready: boolean
  /** 等握手完成（resolve 后可通信）。 */
  ready(): Promise<void>
  /** 当前会话 id（握手后可用）。 */
  readonly sessionId: string | null

  // ── 发送 ──
  /** 玩家行动，推进剧情（走 master）。injection 注入独立于玩家输入的上下文。 */
  send(text: string, options?: SendOptions): Promise<void>
  /** 旁路调任意 agent（不推进 turn、不写历史，结果直接返回）。 */
  invokeAgent(agentId: string, input: string, options?: InvokeAgentOptions): Promise<InvokeAgentResult>

  // ── 订阅（每个返回 unsubscribe 函数）──
  /** 流式增量。msg.kind 区分 reasoning(思维链)/content(可见文本)。 */
  onMessage(cb: (msg: MessageDelta) => void): () => void
  /** 每轮边界。kind=thought(中间轮/工具轮) → 这一轮的 content 是 interim；kind=final → content 是最终正文。 */
  onRoundEnd(cb: (round: RoundEnd) => void): () => void
  /** 回合定稿。options 是剧情选项，stats 是 token 消耗。 */
  onTurnEnd(cb: (result: TurnEndResult) => void): () => void
  /** 工具调用过程。status: loading/running/success/failed。 */
  onTool(cb: (tool: ToolEvent) => void): () => void
  /** AI 向玩家提问（ask_user）。用 answer() 回复。 */
  onAsk(cb: (ask: AskRequest) => void): () => void
  /** 回答 ask_user。 */
  answer(requestId: string, text: string, cancelled?: boolean): Promise<void>

  // ── 数据 ──
  readonly history: { get(): Promise<SessionHistory> }
  readonly checkpoints: {
    list(): Promise<CheckpointSummary[]>
    restore(checkpointId: string): Promise<void>
  }

  // ── workspace（前端自己维护状态）──
  readonly workspace: {
    read(path: string, scope?: WorkspaceScope): Promise<WorkspaceFile | null>
    write(path: string, content: string, scope?: WorkspaceScope): Promise<WorkspaceFile>
  }

  // ── 通用入口（覆盖冷门/未来新增能力，不暴露 RPC）──
  query(resource: string, params?: Record<string, unknown>): Promise<unknown>
  runAction(action: string, params?: Record<string, unknown>): Promise<unknown>
}

export interface SendOptions {
  injection?: InjectionMessage[]
  attachments?: ...   // 复用现有附件机制
}

export interface InvokeAgentOptions {
  injection?: InjectionMessage[]
}

export interface InjectionMessage {
  role: "system" | "user" | "assistant"
  content: string
  position?: "before-input" | "after-input"   // 默认 "before-input"
}

export interface MessageDelta {
  kind: "reasoning" | "content"
  delta: string
  agentId: string
  round: number
}

export interface RoundEnd {
  kind: "thought" | "final"
  round: number
  agentId: string
}

export interface TurnEndResult {
  options?: string[]
  stats?: TurnStats
}

export interface ToolEvent {
  agentId: string
  round: number
  callId: string
  name: string
  status: "loading" | "running" | "success" | "failed"
  output?: TurnToolOutput
}

export interface AskRequest {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
}
```

### 2.1 事件订阅三粒度的依据

从 `play-frontend-dev/main.ts` 反推：
- `onMessage`（增量）：对应 `turn-delta` 事件，`kind` 区分 reasoning/content。但 content 在 thought 轮是 interim、在 final 轮才是正文——单靠 onMessage 分不清。
- `onRoundEnd`（轮边界）：对应 `turn-round-end`，`kind=thought` 告诉前端"这轮 content 是 interim"，`kind=final` 告诉"这轮 content 是最终正文"。每轮触发，不是回合结束才触发。
- `onTurnEnd`（回合定稿）：对应 `turn-completed` + `turn-options` + `turn-stats` 三个事件聚合。SDK 内部把 options/stats 缓存，turn-completed 时合并成一个回调。

`onTool` 对应 `turn-tool`，`onAsk` 对应 `interaction-request`。

### 2.2 SDK 事件聚合逻辑

`onTurnEnd` 聚合三个平台事件：
1. `turn-options` 到达 → 缓存 options 到当前 turn 的 pending 状态
2. `turn-stats` 到达 → 缓存 stats
3. `turn-completed` 到达 → 用缓存的 options/stats 触发 onTurnEnd 回调，清空 pending

这吸收了 `play-frontend-dev/main.ts:1126` "turn-options 先于 turn-completed 缓存"的逻辑，前端不用自己管。

## 3. injection 能力设计

### 3.1 契约层改动

`packages/contracts/src/runtime.ts`:

```ts
export interface MessageInteractionRequest {
  content: string
  injection?: InjectionMessage[]
}

export interface InvokeAgentRequest {
  agentId: string
  input: string
  injection?: InjectionMessage[]
}

export interface InjectionMessage {
  role: "system" | "user" | "assistant"
  content: string
  position?: "before-input" | "after-input"
}
```

### 3.2 平台侧注入点

`agent-runtime/index.ts` 的上下文序列构建（L833-869），当前结构：
```
[0] system        ← AGENT.md + 工具说明
[1..N] history    ← 剧情历史
[N+1] user        ← 框架信息(轮次号 + contextPaths + notes + skillIndex)
[N+2] user        ← 玩家本轮输入
```

injection 注入：
- `before-input`（默认）：插入在 `[N+1]` 框架信息之后、`[N+2]` 玩家输入之前
- `after-input`：插入在 `[N+2]` 玩家输入之后（序列末尾，工具循环之前）

实现：在 L860-863 之间插 before-input 组，L868 之后插 after-input 组。保持 injection 数组顺序（多条同 position 按数组顺序排列）。

**缓存断点考量**（`index.ts:851-853` 注释）：轮次号在框架信息 user 消息里，放后面让缓存断点后移。injection 插在框架信息之后不破坏这个——缓存断点仍在框架信息处，injection 在断点之后（每轮变化的内容本就在断点之后）。实现期需验证 provider 缓存行为不受影响。

### 3.3 不落盘 / 不进快照

- injection 只本轮有效，不写入 turn 文件的 timeline（那是玩家视角历史，injection 是 agent 上下文注入，不该进玩家可见历史）。
- 不进 `AgentContextSnapshot`（context.json）——它是跨 turn 累积的剧情/任务摘要，injection 是前端每轮现带的临时背景。
- 平台不解释 injection 语义——role/content/position 全由前端定，平台只负责按 role+position 放进消息序列。

### 3.4 桥 normalize 层

`remote-iframe-bridge.ts` 的 `normalizeMessageInteractionRequest`（L120-133）和 `normalizeInvokeAgentRequest`（L136）：
- 透传 `injection` 字段
- 校验：是数组、每条有合法 role（system/user/assistant）+ string content、position 合法（before-input/after-input 或缺省）
- 不校验语义、不限制内容长度（超出 provider 限制由 provider 报错）

## 4. workspace 操作从 query.query 拆出 — 独立 RPC method

### 4.1 现状问题

前端 workspace 读目前塞在 `query.query` 的 resource 分支里（`index.ts:522-589`）：
- `workspace.read` — 读文件，结果硬包成 `items: [content]` 单元素数组凑 `DeepQueryResult` 形状
- `workspace.list` / `workspace.search` — 同样套 query 形状
- **catch 块吞错误返回空 items**（L561）——读失败和"文件不存在"分不清
- workspace **写不存在**（`executePlatformAction` 只有 `restore-checkpoint`）

把"读文件"塞进叫"query"的通道名实不符；write 塞进去更怪（写不是查询）。

### 4.2 决策：拆出独立 `workspace.*` RPC method

既然 write 本来就要加新 RPC，read/write/list/search 一起从 `query.query` 拆出来，给独立的 RPC method，比"write 新增、read 留 query"的半新半旧干净。

**新增 4 个 RPC method**（`RemotePlayBridgeMethod` 联合类型）：
```
"workspace.read"   | "workspace.list"
"workspace.search" | "workspace.write"
```

各自有明确的 request/response 形状，不再套 `DeepQueryResult`：
- `workspace.read` → `{ path, scope? }` → `WorkspaceFile | null`（null = 文件不存在，错误走 error 不吞）
- `workspace.list` → `{ path?, scope? }` → `WorkspaceEntry[]`
- `workspace.search` → `{ query?, pattern?, scope?, limit? }` → `WorkspaceSearchResult[]`
- `workspace.write` → `{ path, content, scope? }` → `WorkspaceFile`

### 4.3 关键：只影响前端通道，不碰 agent 工具

agent 的 `workspace_read`/`workspace_write` 工具走 `agent-runtime/workspace-tools.ts` 的 `executeRuntimeWorkspaceToolCall` → `executeWorkspaceOperation`，**不经过桥的 `query.query`**。两条路径完全独立。所以拆 `query.query` 的 workspace resource **只动前端 RPC 通道**，agent 工具零影响。

### 4.4 host 侧实现

`platform-host/index.ts` 的 `playFrontendBridge` 加 `workspace` 子接口：
```ts
workspace: {
  read(req): Promise<WorkspaceFile | null>    // 调 executeWorkspaceOperationForActiveSave, actorLevel 1
  list(req): Promise<WorkspaceEntry[]>
  search(req): Promise<WorkspaceSearchResult[]>
  write(req): Promise<WorkspaceFile>           // 新增
}
```
- 全部 actorLevel 1（游戏级）。save-runtime editLevel=1 放行；card-content editLevel=2 被权限层挡——前端只到 save-runtime，这是预期边界。
- **read 的错误不再吞**：文件不存在返回 null，操作失败抛 error（区别于现状的 catch 吞错）。
- `PlayFrontendBridge` 契约（`contracts/bridge.ts`）加 `workspace` 子接口。
- `query.query` 的 `workspace.read/list/search` resource 分支删除（session-history/checkpoints/history/agent-registry 等真正的查询留在 query）。

### 4.5 桥层

`remote-iframe-bridge.ts`：
- `REMOTE_PLAY_BRIDGE_METHODS` 数组加 4 个 `workspace.*`。
- `dispatchRemoteBridgeRequest` 加 4 个 dispatch 分支，各自 normalize 后调 `bridge.workspace.*`。
- 各自的 normalize 函数（校验 path 是 string 等）。

### 4.6 SDK

`tsian.workspace.read/write` 内部调 `bridge.call("workspace.read"/"workspace.write", {path, scope, content})`，不再是 `query.query`。list/search 如果 SDK 暴露也走独立 method（初版可只暴露 read/write，list/search 走 `tsian.query` 通用入口或后续补）。

### 4.7 权限边界

前端 workspace.write 只能写 save-runtime（actorLevel 1）。够用——前端维护状态（角色卡、设置）是 save-runtime 文件。写 card-content 是助手 agent（level 4）的事，不是游戏前端的事。

## 5. API 文档结构

产出 `docs/sdk/play-frontend-api.md`（或 `packages/play-bridge/API.md`，实现期定），结构：

1. **快速开始** — import + createTsian + 最小示例（发消息 + 渲染回复）
2. **生命周期** — ready / sessionId
3. **发送** — send（含 injection 用法 + 示例）/ invokeAgent
4. **订阅** — onMessage / onRoundEnd / onTurnEnd / onTool / onAsk + answer（每个含回调形状 + 渲染示例）
5. **数据** — history / checkpoints
6. **workspace** — read / write（含"前端自己维护状态"的用法）
7. **通用入口** — query / runAction（何时用、和语义化方法的区别）
8. **类型参考** — 全部接口/类型的完整定义

面向助手 agent 和前端开发者：示例用 vanilla JS（不绑框架），说明每个方法"什么时候用、怎么用"。

## 6. 现有前端迁移

`apps/play-frontend-dev/src/main.ts` 从裸 `bridge.call` + `BridgeHandlers` 迁移到 `tsian.*`：
- `bridge.call("interaction.sendMessage", {content})` → `tsian.send(text)`
- `bridge.on({ onEvent: handleEvent, ... })` → `tsian.onMessage/onRoundEnd/onTurnEnd/onTool/onAsk`
- `createSessionHistory(bridge)` → `tsian.history.get()`
- `listCheckpoints(bridge)` / `restoreCheckpoint(bridge)` → `tsian.checkpoints.list/restore`

迁移是验证 API 可用性的关键——如果现有前端能顺畅切到新 API 且不丢功能，说明 API 设计到位。

## 7. 方向文档更新

`docs/active/play-frontend-sdk-direction.md`：
- §1 当前答案从"薄 SDK 封装"改为"领域 API（domain API）"
- §2 核心定位：SDK 不只是协议封装，而是面向游戏前端开发者的领域语言，吸收 RPC 细节，暴露前端心智里的动词
- **桥协议变更需注明**：本次新增 4 个 `workspace.*` RPC method（read/list/search/write），从 `query.query` 拆出 workspace 操作。这是桥协议的扩展（加 method），不是破坏性改动。

## 8. 文件改动范围

| 层 | 文件 | 改动 |
|---|---|---|
| 契约 | `packages/contracts/src/runtime.ts` | `MessageInteractionRequest`/`InvokeAgentRequest` 加 `injection?`；新增 `InjectionMessage` |
| 契约 | `packages/contracts/src/bridge.ts` | `RemotePlayBridgeMethod` 加 4 个 `workspace.*`；`PlayFrontendBridge` 加 `workspace` 子接口；`RemotePlayBridgeRequestParams`/`ResponseResult` 加 workspace 请求/响应类型 |
| SDK | `packages/play-bridge/src/tsian-api.ts`（新建）| `TsianApi` 接口 + `createTsian()` 实现 |
| SDK | `packages/play-bridge/src/index.ts` | 导出 `createTsian` + 领域类型；`createBridge`/`Bridge` 降为不公开导出 |
| 平台 | `apps/platform-web/src/agent-runtime/index.ts` | 上下文序列构建插入 injection（L860-869 区域） |
| 平台 | `apps/platform-web/src/platform-host/index.ts` | `playFrontendBridge` 加 `workspace` 子接口（read/list/search/write）；删除 `query.query` 的 workspace resource 分支 |
| 桥 | `apps/platform-web/src/bridge/remote-iframe-bridge.ts` | `REMOTE_PLAY_BRIDGE_METHODS` 加 4 个；dispatch 加 4 分支 + normalize；normalize 透传 injection |
| 前端 | `apps/play-frontend-dev/src/main.ts` | 迁移到 `tsian.*` |
| 文档 | `docs/sdk/play-frontend-api.md`（新建）| API 文档 |
| 文档 | `docs/active/play-frontend-sdk-direction.md` | 更新定位 + 注明桥协议扩展 |
| 桥 | `apps/platform-web/src/bridge/remote-iframe-bridge.ts` | normalize 透传 injection + 校验 |
| 前端 | `apps/play-frontend-dev/src/main.ts` | 迁移到 `tsian.*` |
| 文档 | `docs/sdk/play-frontend-api.md`（新建）| API 文档 |
| 文档 | `docs/active/play-frontend-sdk-direction.md` | 更新定位 |

## 9. 不做

- 不做平台注入 SDK（维持 import）
- 不做 injection 落盘 / 进 context.json
- 不做 injection 内容语义校验
- 不做 invokeAgent "慎用"标注
- 不改桥协议本身（`tsian.play-bridge.v1` method 名不变，injection 是 params 扩展）
- 不做前端 workspace 写 card-content（actorLevel 1 只到 save-runtime）
