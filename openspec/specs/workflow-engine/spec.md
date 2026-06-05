# Capability: workflow-engine

> 由 OPSX change `prompt-preset-and-workflow-engine` 引入的新 capability。本规约声明引擎对外行为契约；实现细节见 `design.md §4-§10` 与 `§13.4 / §13.7 / §13.8`。

## 1. Purpose

把 Tsian 一轮交互的"检索 → 正文 → 维护"三段链路抽象为可声明、可调度、可中断、可调试的 DAG。平台按 save workflow override / mod `workflowPresetId` / deprecated `manifest.workflow` / `default-workflow.ts` 的顺序解析工作流；内置模组必须通过资源库 workflow preset 引用工作流。

## 2. Public API

```ts
// packages/workflow-engine/src/index.ts
export interface WorkflowEngine {
  validate(definition: WorkflowDefinition): void; // 加载期校验，throw on invalid
  execute(
    definition: WorkflowDefinition,
    context: WorkflowExecutionContext,
  ): Promise<OutputsByName>;
}

export interface WorkflowExecutionContext {
  macros: Record<string, string>;
  abortSignal: AbortSignal;
  outputsStore: ShallowRef<OutputsByName>;
  // platform-side adapters
  applyMaintenancePatch: (input: ApplyMaintenancePatchInput) => Promise<ApplyPatchOutput>;
  callOpenAi: (req: OpenAiRequest) => Promise<OpenAiResponse>;
  appendUserMessage: (content: string) => Promise<void>;
  appendAssistantMessage: (content: string) => Promise<void>;
}
```

## 3. Node Types

平台只接受 contracts 中声明的内置节点类型；模组中出现其它类型在加载期 throw（§13.4）。当前内置集合为 `ai-call` / `result` / `switch` / `apply-patch` / `compute` / `memory-query` / `memory-write` / `template-compose` / `record-filter` / `record-merge` / `record-format`。

### 3.1 `ai-call`
- Config: `{ presetRef, modelRef, appendUserInput?: boolean, retry? }`
- 行为：调 prompt-engine 组装 messages → 调 OpenAI 兼容 endpoint
- Output ports: `text`, `messages`, `usage`, `debug`
- Error: HTTP 错误、超时、消息组装失败 → 节点 `failed`，错误透传

### 3.2 `result`
- Config: `{ name: string, value: NodeOutputExtractRule }`
- 行为：把上游端口值写入 `outputsStore[config.name]`
- 加载期校验：同一工作流内 `name` 必须唯一（§13.4 项 6）
- Output ports: 无（只写 store）

### 3.3 `switch`
- Config: `{ condition: string }`
- 行为：`String(upstreamValue) === condition` 时下游边激活，否则不激活
- 不支持字段路径访问（§13.2）；要按 `globals.x` 分支必须先用 `compute` 提取
- Output ports: `match: boolean`, `value: any`

### 3.4 `apply-patch`
- Config: `{ patchVarName: string, pushCheckpointReason?: "after-turn" | "manual" | "none" }`
- 行为：取上游 `patch` 端口（`MaintenancePatchDocument`）调 `context.applyMaintenancePatch`
- Checkpoint：默认 `none`；平台回合成功后统一创建 after-turn checkpoint，节点本地 checkpoint 只允许显式开启。
- Output ports（与 `ApplyPatchOutput` 字段严格对齐，§13.3）：
  - `appliedArchives: string[]`
  - `appliedEventIds: string[]`
  - `globalsChanged: boolean`
  - `currentTimeChanged: boolean`
- 加载期校验：`apply-patch` 必须声明非空 `patchVarName`，且必须有入边绑定该 varName；mod 来源不再构成禁用条件。
- Error: applier 抛错时节点 `failed`，错误向上抛（§13.1 fail loud）

### 3.5 `compute`
- Config: `{ source: string, timeout?: number }`
- 行为：`new Function('macros', source)`，返回值通过 `value` 端口
- 沙箱约束（P-H-8）：`source` 内 `this`、`arguments`、词法作用域均不可达 RuntimeEngine、bridge、IndexedDB
- 超时（P-H-7）：超时后 reject with code `TIMEOUT`，setTimeout 句柄须清理
- Output ports: `value`

### 3.6 `memory-query`
- Config: `{ source: "collection" | "event-archive", namespace?, collection?, queryVarName?, query?, limit? }`
- `collection` 是 save-scoped generic memory records 的主路径；`event-archive` 是兼容来源，不属于默认 AIRP 主链。
- Output ports: `collection` 输出 `records` / `count`；`event-archive` 兼容输出 `prompt` / `directEntities` / `archives` / `debug`。

### 3.7 `memory-write`
- Config: `{ operationsVarName: string, namespace?, collection?, pushCheckpointReason?: "after-turn" | "manual" | "none" }`
- 行为：取上游 operations 写入 save-scoped generic memory records；AIRP 内置 schema 覆盖的 collection 走 schema normalize/validation。
- Checkpoint：默认 `none`；平台回合成功后统一创建 after-turn checkpoint，节点本地 checkpoint 只允许显式开启。

## 4. Edge Contract

```ts
interface WorkflowEdge {
  from: { nodeId: string; outputName?: string };
  to: { nodeId: string; varName: string };
}
```

- `varName` 在目标节点执行前作为 macro 注入（覆盖前两层，§13.5）
- 加载期校验：from/to 的 nodeId 必须存在于 `nodes`（§13.4 项 3）

## 5. Execution Model

- 拓扑排序确定执行批次；同一批次内并行（fanout 充分利用 Promise.all）
- 每个节点独立 Promise；上游全部 settled（succeeded / failed / aborted）后才能开始
- AbortController 透传所有 fetch 与 setTimeout（节点必须正确响应）
- 节点失败默认**不**短路工作流（HC-5 per-node independent failure）；仅当下游节点必需的端口不存在时下游进入 `skipped`

## 6. Failure Model

- 单节点失败：节点状态 `failed`，错误对象进入 `outputsStore` 的元数据；不抹除其他节点已写入的输出
- 工作流整体失败 = abort（外部 abort 或 致命系统错误）
- abort 后任何节点不再进入 `succeeded`（P-H-2）

## 7. Load-time Validation (§13.4)

`validate(definition)` 必须执行下列加载期校验；任一失败立即 throw：

1. 节点 ID 全局唯一
2. 无环（拓扑排序成功）
3. 无悬挂边（`from.nodeId` 与 `to.nodeId` 都在 `nodes`）
4. 节点类型在平台支持集合内
5. `apply-patch` 的 `patchVarName` 必须被入边绑定
6. 至少存在一个 `result` 节点
7. `result.config.name` 唯一

## 8. Retry Policy (`design.md §5`)

- Per-node `retry?: { max: number; backoffMs: number }`
- 重试只在节点 `failed` 时触发；`aborted` 状态**不**重试
- 重试间隔遵守 abortSignal —— abort 期间不睡眠

## 9. Reactive Outputs Store (`§13.7 / §13.8`)

- 类型：`ShallowRef<OutputsByName>`
- 生命周期：每轮 `sendMessage` 入口创建新 ref；上轮被 abort 的节点若延迟 settle，**不能**写入新 ref（实例隔离）
- 触发节奏：仅在节点状态机迁移（`pending → running → succeeded/failed/aborted`）时调 `triggerRef`
- token 级流式：接口预留但本变更**不实现**

## 10. PBT Properties

| ID | INVARIANT |
|----|-----------|
| P-H-1 | DAG 任意 N，N 启动晚于 N 上游所有边 source 的 settled |
| P-H-2 | abort 后无节点进入 `succeeded` |
| P-H-3 | 含环工作流加载期 throw |
| P-H-4 | 悬挂边加载期 throw |
| P-H-5 | 节点 succeeded 后 outputs 在本轮内不变 |
| P-H-6 | 同名 result 加载期 throw |
| P-H-7 | compute 超时返回 `failed` with `TIMEOUT` 在 timeout+ε 内 |
| P-H-8 | compute 不可达 RuntimeEngine 引用 |
| P-H-9 | apply-patch：events 失败时 archives 仍落地，错误抛出 |

## 11. Cross-references

- design.md §4（NodeOutputExtractRule）、§5（retry）、§6（outputs store）、§7（manifest / legacy manifest compatibility）、§8（default workflow）、§10（compute 沙箱）、§13.x、§14
- _research-notes.md HC-1..15、SC-CRIT-1..7、R-1..6

## 12. Out of Scope
- 工作流可视化编辑器
- 工作流持久化与版本管理（原型期一次性加载）
- 跨轮工作流（每轮独立执行实例）
