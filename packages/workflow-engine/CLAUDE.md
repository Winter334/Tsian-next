# @tsian/workflow-engine — 模块 CLAUDE.md

[根目录](../../CLAUDE.md) > [packages](../) > **workflow-engine**

---

## 1. 模块职责

工作流 DAG 调度器骨架。负责拓扑调度、AbortController 传播、节点级重试与加载期校验；不实现任何具体节点。

包名：`@tsian/workflow-engine`，依赖 `@tsian/contracts`，无运行时第三方依赖。

设计来源：`openspec/changes/prompt-preset-and-workflow-engine/design.md` §5（重试机制）+ §13.4（加载期校验）+ §13.5（错误冒泡）+ §13.7（输出生命周期约束）。

---

## 2. 入口与启动

| 入口 | 路径 |
|------|------|
| 包入口 | `src/index.ts` |
| 调度器 | `src/scheduler.ts` |
| 校验器 | `src/validator.ts` |
| 错误类型 | `src/errors.ts` |
| 公共类型 | `src/types.ts`（H7：`OutputsStoreWriter` 接口） |
| 构建命令 | `npm run build:workflow-engine` |

---

## 3. 对外 API

```ts
// 主入口
executeWorkflow(
  def: WorkflowDefinition,
  context: WorkflowExecutionContext,
  options?: ExecuteWorkflowOptions,
): Promise<WorkflowResult>

// 加载期校验（独立可调）
validateWorkflowDefinition(
  def: WorkflowDefinition,
  options?: { isModWorkflow?: boolean },
): string[]   // 返回拓扑序

// 错误类型
class WorkflowValidationError extends Error  // code: WorkflowValidationCode
class WorkflowAbortError extends Error
class WorkflowNodeError extends Error        // nodeId / attempts / cause / code
                                             // 默认 code = "NODE_RETRY_EXHAUSTED"；调用方可自定义（如 "UNKNOWN_NODE_TYPE"）—— H11 新增

// 节点 executor 协议（H4 注册）
interface NodeExecutor {
  execute(args: NodeExecuteArgs): Promise<NodeExecuteResult>
}

// outputs 写入钩子（H7 注入；零 Vue 依赖）
interface OutputsStoreWriter {
  initNode(nodeId: string): void
  startNode(nodeId: string): void
  succeedNode(nodeId: string, outputs: Record<string, unknown>): void
  failNode(nodeId: string, error: { code: string; message: string }): void
  abortNode(nodeId: string): void
  setResult(name: string, value: unknown): void
}
```

---

## 4. 关键设计决策

### 4.1 拓扑调度（Kahn 算法）

- 入度=0 的节点立刻进 ready 队列；
- 用 `Promise.race` 等任一节点完成；完成后扣减下游入度，再次 enqueue；
- 同一时刻所有 ready 节点并发执行；
- 完成顺序记录到 `WorkflowResult.order`。

### 4.2 AbortController 传播

- 调度器内部新建 `internalController`，所有节点 executor 收到 `internalSignal`；
- 外部 `options.signal` abort → 转发到 internal；
- 任意节点抛错 → 立即 internal abort 取消其余；
- 所有 in-flight 节点都会被 `Promise.allSettled` 收尾，避免悬挂 promise；
- 最终向上抛 `WorkflowAbortError` 或原 `WorkflowNodeError`。

### 4.3 节点级重试

- 默认 `maxRetries = 1`（即首次失败再尝试一次，共 2 次）；
- 节点 `retry.maxRetries` 覆盖；
- 重试前检查 `signal.aborted`，已 abort 则不再重试；
- 重试用尽后抛 `WorkflowNodeError(nodeId, attempts, cause)`。

### 4.4 节点 executor 注入

- H3 仅定义 `NodeExecutor` 协议；具体 executor 通过 `context.executors: Map<NodeKind, NodeExecutor>` 由调用方（H4 起 platform-web/workflow-host）注入；
- 节点类型未注册 → 抛 `WorkflowNodeError`（不重试）。

### 4.5 边解析与 condition

- 入边按 `to.varName` 收集到 `inputs` 字典；
- `edge.condition` 走简单字符串等值（design §13.2）：`String(upstreamValue) === condition` 不匹配则该边丢弃，varName 不进 inputs。

### 4.6 result 节点汇总

- `result` 节点输出按惯例放在 `outputs.value`（H4 实现层保证）；
- 调度器在结束时收集所有 `result` 节点的 `config.name → outputs.value` 到 `WorkflowResult.results`。

### 4.7 outputs 写入钩子（H7）

- `ExecuteWorkflowOptions.outputsHooks?: OutputsStoreWriter`（接口在 `src/types.ts`，零 Vue 依赖）；
- 调度器在 6+1 时机调钩子（`initNode` 一次 / `startNode` 进入 running / `succeedNode` 成功 / `setResult` 仅 result 节点 / `failNode` 重试用尽 / `abortNode` 仅对仍 pending/running 的节点；abort 路径再扫一遍兜底）；
- 所有钩子调用经 `safeHook` try/catch 包裹，钩子异常仅 `console.warn`，**不会**反向打挂调度器（fail loud 例外，但失败信息可见）；
- 接口本身在 workflow-engine 包内，**不**新增任何依赖，纯调度器定位保持不变；具体 shallowRef 实现在 `apps/platform-web/src/workflow-host/outputs-store.ts`。

---

`isModWorkflow` 是调用方来源元数据；当前不参与节点类型权限判断。已退休的旧节点类型会按 `UNKNOWN_NODE_TYPE` fail loud。

## 5. 加载期校验（design §13.4）

任一失败立即 throw `WorkflowValidationError`：

| # | 校验 | 错误码 |
|---|------|--------|
| 1 | 节点 ID 全局唯一 | `DUPLICATE_NODE_ID` |
| 2 | 节点类型必须在平台支持集合内 | `UNKNOWN_NODE_TYPE` |
| 3 | 无悬挂边（edge.from/to.nodeId 必须在 nodes 内） | `DANGLING_EDGE` |
| 4 | 无环（拓扑排序成功） | `CYCLE_DETECTED` |
| 5 | 至少 1 个 result 节点 | `MISSING_RESULT_NODE` |
| 6 | result 节点 `config.name` 唯一 | `DUPLICATE_RESULT_NAME` |

支持的内置节点类型：`ai-call` / `result` / `switch` / `compute` / `memory-query` / `memory-write` / `template-compose` / `record-filter` / `record-merge` / `record-format`。

---

## 6. 与其它包协作

- **@tsian/contracts**：所有类型来源（`WorkflowDefinition / WorkflowNode / WorkflowEdge / NodeOutputDeclaration / WorkflowNodeType / *NodeConfig`）。
- **apps/platform-web/src/workflow-host/**（H4 起）：注册内置 executor（ai-call / result / switch / compute / memory-query / memory-write / template-compose / record-filter / record-merge / record-format），提供 `WorkflowExecutionContext.executors`。
- **apps/platform-web/src/workflow-host/outputs-store.ts**（H7 已落地）：实现 `OutputsStoreWriter` 接口（套娃 shallowRef），platform-host 在 H8 通过 `ExecuteWorkflowOptions.outputsHooks` 注入。
- **apps/platform-web/src/runtime-host/patch-applier.ts**（I1 已落地）：桥/API patch 兼容写入口共享的 applier；不再作为 workflow executor 暴露。

---

## 7. 改动注意事项（fail loud）

1. **不要在校验/调度路径加 `try/catch` 吞错**——原则 fail loud > fail silent（项目 CLAUDE.md §7）。允许的 catch 只有：
   - 调度循环里捕获节点 promise 错误以触发取消（必须再 throw）；
   - 重试循环里 catch 后立即决策"继续 / 抛出"。
2. **不要在此包实现具体节点**——具体节点形态属于 H4 范围，且依赖浏览器/runtime-engine 句柄，违背包的运行时无关定位。
3. **不要在此包碰 outputs shallowRef / Vue**——H7 仅以 `OutputsStoreWriter` 接口形式承接（接口零 Vue 依赖）；shallowRef 实现位于 `apps/platform-web/src/workflow-host/outputs-store.ts`。
4. **不引入第三方依赖**——DAG / 拓扑排序自己写，包尺寸/行为可控。
5. **`MaintenancePatchDocument` 不要在此包导入**——patch 解析与 applier 调用属于 platform bridge/runtime 兼容层，调度器只校验 DAG 与节点类型、透传 inputs/outputs。

---

## 8. 测试与质量

- H3 阶段：`npm run build:workflow-engine` 必须 0 error；
- H12 阶段：`test/sc-crit.test.ts` 8 测试覆盖 SC-CRIT 不变量；
- I6 阶段：`test/p-i-1.test.ts` 静态证明 P-I-1（桥 API 的 `applyPatch / updateGlobals` 共用同一份 `applyMaintenancePatch`，append 例外不走 applier）；
- 运行命令：`cd packages/workflow-engine && npm test`（vitest，当前 14 / 14 passed）；
- 后续：H10/H12 通过 platform-web 主链 + 调试面板验证调度行为；PBT 属性 P-H-1/2/3/4 在 `_research-notes.md` 已登记。

---

## 9. 相关文件清单

- `src/index.ts` — 公共导出
- `src/scheduler.ts` — 调度主逻辑
- `src/validator.ts` — 6 条加载期校验
- `src/errors.ts` — 三类错误
- `src/types.ts` — `OutputsStoreWriter` 接口（H7）
- `package.json`、`tsconfig.json`

---

## 10. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-05-10 | H3 新建包：DAG 调度器 + AbortController 传播 + 节点级重试 + 6 条加载期校验 |
| 2026-05-10 | H7 新增 `OutputsStoreWriter` 接口（`src/types.ts`）+ 调度器 6+1 时机钩子（`safeHook` try/catch 包裹，纯调度器定位保持不变） |
| 2026-05-11 | I6：新增 `test/p-i-1.test.ts` 静态证明桥 API（`platform-host` 的 `applyPatch / updateGlobals`）共用同一份 `applyMaintenancePatch`；`appendUserMessage / appendAssistantMessage` 属 append 例外，不走 applier |

---

_文档生成时间：2026-05-10_
