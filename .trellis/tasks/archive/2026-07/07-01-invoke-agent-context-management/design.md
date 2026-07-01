# Design — 旁路调用上下文管理完善

## 架构总览

```
前端 useSetupState
  │  invokeAgent("world-architect", prompt, { contextSlot: "understanding", persist: false })
  ▼
play-bridge tsian-api.ts          ← InvokeAgentOptions { contextSlot?, persist? }
  │  bridge.call("interaction.invokeAgent", { agentId, input, contextSlot, persist })
  ▼
contracts bridge.ts (wire)        ← InvokeAgentRequest { agentId, input, injection?, contextSlot?, persist? }
  │
  ▼
platform-host remote-iframe-bridge.ts  ← normalizeInvokeAgentRequest()
  │
  ▼
platform-host index.ts invokeAgent()
  │  ① 排队:同 agentId:slot 串行 (Map<string, Promise>)
  │  ② shouldPersist = input.persist === true (默认 false)
  │  ③ slot = input.contextSlot
  │  ④ shouldPersist → readAgentContextFromWorkspace(files, saveId, agentId, slot)
  │  ⑤ runAgentRuntimeTurn(...)
  │  ⑥ shouldPersist → stageAgentContextFile(tx, { ..., agentId, slot })
  ▼
history-turns.ts                  ← readAgentContextFromWorkspace(..., slot?) / stageAgentContextFile({ ..., slot? })
  │
  ▼
context-lifecycle.ts              ← agentContextPath(agentId, slot?) → "save/agents/<id>/context[-slot].json"
```

## 变更清单（按依赖顺序）

### 1. context-lifecycle.ts — `agentContextPath` 扩展

当前签名 `agentContextPath(agentId: string): string`，扩展为：

```ts
export function agentContextPath(agentId: string, slot?: string): string {
  const base = `save/agents/${agentId}`
  if (!slot) return `${base}/context.json`
  // sanitize slot: 只允许 [a-zA-Z0-9_-]，其余替换为 "-"，防止路径注入
  const safeSlot = slot.replace(/[^a-zA-Z0-9_-]/g, "-")
  return `${base}/context-${safeSlot}.json`
}
```

- **向后兼容**：`agentContextPath("master")` → `save/agents/master/context.json`（不变）。
- **新路径**：`agentContextPath("world-architect", "understanding")` → `save/agents/world-architect/context-understanding.json`。
- **slot 消毒**：前端传入的 slot 是未受信字符串，直接拼进文件路径。用正则替换保留 `[a-zA-Z0-9_-]`，其余字符替换为 `-`，防止 `../` 路径穿越和特殊字符。

### 2. history-turns.ts — `readAgentContextFromWorkspace` + `stageAgentContextFile` 加 slot

**`readAgentContextFromWorkspace`** 增加可选 `slot?: string` 参数（默认 undefined）：

```ts
export function readAgentContextFromWorkspace(
  workspaceFiles: WorkspaceFile[],
  saveId: string,
  agentId: string = "master",
  slot?: string,           // NEW
): AgentContextSnapshot | null {
  const file = workspaceFiles.find((f) => f.path === agentContextPath(agentId, slot))
  if (!file) return null
  return parseAgentContext(file.content, saveId, { agentId })
}
```

**`stageAgentContextFile`** 的 input 类型增加可选 `slot?: string`：

```ts
export function stageAgentContextFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    saveId: string
    turn: number
    user: string
    assistant: string
    compressedContext?: AgentContextSnapshot
    agentId?: string
    slot?: string           // NEW
  },
): WorkspaceFile {
  const agentId = input.agentId ?? "master"
  const slot = input.slot   // NEW
  const base =
    input.compressedContext
    ?? readAgentContextFromWorkspace(workspaceTransaction.workspaceFiles, input.saveId, agentId, slot)
    ?? createEmptyAgentContext(input.saveId, { agentId })
  // ... appendTurnToContext ...
  return workspaceTransaction.write({
    path: agentContextPath(agentId, slot),   // NEW: 传 slot
    content: serializeAgentContext(updated),
  })
}
```

- **内部调用链**：`stageAgentContextFile` 内部的 `readAgentContextFromWorkspace` 调用（line 119）也需要传 `slot`，确保读写同一个 slot 文件。
- **向后兼容**：主 turn 调用点（index.ts:778、965）和 frontend-inspector（:771）不传 slot，行为不变。

### 3. contracts/runtime.ts — `InvokeAgentRequest` 扩展

```ts
export interface InvokeAgentRequest {
  agentId: string
  input: string
  injection?: InjectionMessage[]
  /** 上下文隔离 slot。不同 slot 读写不同 context-<slot>.json，防止不同调用方上下文串。
   *  省略时用默认路径 save/agents/<agentId>/context.json（向后兼容）。 */
  contextSlot?: string
  /** 是否持久化上下文。true = 读写 context-slot.json（跨调用持久化）；
   *  false/省略 = 不读不写（一次性调用）。默认 false。 */
  persist?: boolean
}
```

### 4. play-bridge/tsian-api.ts — `InvokeAgentOptions` + 实现扩展

```ts
export interface InvokeAgentOptions {
  injection?: InjectionMessage[]
  contextSlot?: string      // NEW
  persist?: boolean         // NEW
}
```

实现：

```ts
async invokeAgent(agentId: string, input: string, options?: InvokeAgentOptions): Promise<InvokeAgentResult> {
  const params: Record<string, unknown> = { agentId, input }
  if (options?.injection && options.injection.length > 0) {
    params.injection = options.injection
  }
  if (options?.contextSlot !== undefined) {
    params.contextSlot = options.contextSlot
  }
  if (options?.persist !== undefined) {
    params.persist = options.persist
  }
  return bridge.call<InvokeAgentResult>("interaction.invokeAgent", params as never)
},
```

### 5. remote-iframe-bridge.ts — `normalizeInvokeAgentRequest` 扩展

```ts
function normalizeInvokeAgentRequest(value: unknown): InvokeAgentRequest {
  // ... 现有 agentId / input 校验不变 ...
  const injection = normalizeInjection(record.injection)
  const contextSlot =
    typeof record.contextSlot === "string" && record.contextSlot.trim()
      ? record.contextSlot.trim()
      : undefined
  const persist = typeof record.persist === "boolean" ? record.persist : undefined
  return {
    agentId: record.agentId,
    input: record.input,
    ...(injection ? { injection } : {}),
    ...(contextSlot ? { contextSlot } : {}),
    ...(persist !== undefined ? { persist } : {}),
  }
}
```

### 6. platform-host/index.ts — `invokeAgent` 核心改造

#### 6a. 模块级排队 Map

在 `createPlatformHostBridge` 函数体顶部（或模块级）声明：

```ts
/** 旁路调用排队锁：同一 agentId + slot 串行执行，避免 context.json 读写竞争。
 *  key = `${agentId}:${slot ?? "default"}`，value = 当前正在执行的 Promise。
 *  不同 agent 或不同 slot 可真并行。条目在执行完成后自动清理。 */
const invokeAgentQueue = new Map<string, Promise<unknown>>()
```

放在 `createPlatformHostBridge` 闭包内（与 `previousTurnController` 等闭包变量同级），因为它的生命周期跟 bridge 实例一致。

#### 6b. invokeAgent 方法改造

核心变化：
- **不再读 `entryMode`**：`shouldPersist = input.persist === true`（默认 false）。
- **slot 传递**：`slot = input.contextSlot`，透传给 read/stage。
- **排队**：同 `agentId:slot` 串行，不同 key 并行。

```ts
async invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult> {
  const agentId = input.agentId.trim()
  if (!agentId) {
    throw new Error("interaction.invokeAgent requires a non-empty agentId.")
  }
  const userInput = input.input
  if (!userInput) {
    throw new Error("interaction.invokeAgent requires non-empty input.")
  }

  const slot = input.contextSlot
  const shouldPersist = input.persist === true
  const queueKey = `${agentId}:${slot ?? "default"}`

  // 同 slot 串行排队：前一个完成（成功/失败）后后一个才开始。
  // .catch(() => {}) 吞掉前一个的错误，不影响当前执行。
  const previous = invokeAgentQueue.get(queueKey) ?? Promise.resolve()
  const currentPromise = previous
    .catch(() => {})
    .then(() => executeInvokeAgentBody())

  invokeAgentQueue.set(queueKey, currentPromise)
  // 执行完成后清理（只有当 map 里还是自己时才删，避免删到后续排队的 promise）
  currentPromise.finally(() => {
    if (invokeAgentQueue.get(queueKey) === currentPromise) {
      invokeAgentQueue.delete(queueKey)
    }
  })
  return currentPromise as Promise<InvokeAgentResult>

  // ── 实际执行体（闭包，捕获上方所有变量）──
  async function executeInvokeAgentBody(): Promise<InvokeAgentResult> {
    // ... 现有 invokeAgent 的全部 try/catch 逻辑 ...
    // 变更点：
    //   isPersistent → shouldPersist
    //   readAgentContextFromWorkspace(..., agentId) → readAgentContextFromWorkspace(..., agentId, slot)
    //   stageAgentContextFile({ ..., agentId }) → stageAgentContextFile({ ..., agentId, slot })
    //   ...(shouldPersist ? { taskStartedAt, timeoutMs } : {}) 用 shouldPersist 替换 isPersistent
  }
}
```

**排队正确性分析**：

1. Call A 启动 → `map.set(key, promiseA)` → A 执行
2. Call B 启动（A 运行中）→ `previous = promiseA` → B 等 A 完成 → `map.set(key, promiseB)` → B 在 A 之后执行
3. A 完成 → `promiseA.finally` → `map.get(key) === promiseA`? 否（是 promiseB）→ 不删 ✓
4. B 完成 → `promiseB.finally` → `map.get(key) === promiseB`? 是 → 删除 ✓
5. 无 B 时 A 完成 → `map.get(key) === promiseA`? 是 → 删除 ✓
6. A 失败 → `promiseA` reject → B 的 `.catch(() => {})` 吞掉 → B 正常执行 ✓

#### 6c. 具体替换点（invokeAgent 体内）

| 行号 | 旧 | 新 |
|------|----|----|
| 1093-1097 | `const isPersistent = targetContext.agent.entryMode === "persistent"` + 三元 | `const shouldPersist = input.persist === true` + 三元用 `shouldPersist` |
| 1096 | `readAgentContextFromWorkspace(workspaceFiles, activeSaveId, agentId)` | `readAgentContextFromWorkspace(workspaceFiles, activeSaveId, agentId, slot)` |
| 1118 | `...(isPersistent ? { taskStartedAt: ..., timeoutMs: ... } : {})` | `...(shouldPersist ? { taskStartedAt: ..., timeoutMs: ... } : {})` |
| 1230 | `if (isPersistent && result.contextUpdate)` | `if (shouldPersist && result.contextUpdate)` |
| 1231-1238 | `stageAgentContextFile(tx, { ..., agentId })` | `stageAgentContextFile(tx, { ..., agentId, slot })` |

### 7. useSetupState.ts — 前端适配

```ts
// 旧：
const result = await tsian.invokeAgent("world-architect", prompt)
// 新：
const result = await tsian.invokeAgent("world-architect", prompt, {
  contextSlot: "understanding",
  persist: false,
})
```

`persist: false` 是默认值，显式传出于可读性（让读者明确知道这是一次性调用）。

### 8. source-import.legacy.ts — legacy 适配

```ts
// 旧：
await tsian.invokeAgent("world-architect", prompt)
// 新：
await tsian.invokeAgent("world-architect", prompt, {
  contextSlot: "understanding",
  persist: false,
})
```

## 不变的部分

- **agent.json `entryMode` 字段**：保留在 schema 中不改，但 invokeAgent 不再读取它。主 turn（sendMessage）走 master agent，不受影响。
- **agent_call（工具调用）**：完全不读写 context.json，不需要改。
- **旁路 trace 路径**：`formatAgentTracePath(agentId, timestamp)` 只有 agentId + timestamp，不受 slot 影响。
- **context.json 读写逻辑**：`parseAgentContext`、`createEmptyAgentContext`、`appendTurnToContext`、`compressContext`、`compressTaskContext` 全部不变——它们操作 `AgentContextSnapshot` 对象，不关心文件路径。
- **主 turn 的 context 读写**：`index.ts:778`（read）、`index.ts:965`（stage）不传 slot，路径不变。
- **frontend-inspector**：`:771` 不传 slot，路径不变。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| slot 字符串含路径穿越字符 | `agentContextPath` 内部消毒：`[^a-zA-Z0-9_-]` → `-` |
| 排队 Map 内存泄漏 | `finally` 自动清理已完成条目；最坏情况是少量 stale resolved promise，无实际泄漏 |
| 默认 false 破坏现有 persistent 调用方 | 当前唯一调用点（understanding）本就不需要持久化；未来需要持久化的调用方须显式 `persist: true` |
| 并行调用不同 slot 写同一 agent 目录 | 文件名不同（`context-<slot>.json`），无写竞争；目录级操作由 workspace transaction 保证一致性 |
