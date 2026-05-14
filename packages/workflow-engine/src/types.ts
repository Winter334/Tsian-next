/**
 * @tsian/workflow-engine 公共类型契约
 *
 * 仅放零运行时依赖的纯接口/联合类型，调度器与外部消费者共用。
 * 调度器实现仍在 scheduler.ts；本文件只承载"形状"。
 */

/**
 * outputs 状态写入回调（H7 / design.md §13.7 §13.8）。
 *
 * 调度器在节点状态迁移时调用对应方法。所有方法都是同步语义；实现方
 * 必须自己处理"快照替换 + 触发响应式更新"的细节。本接口零 Vue 依赖，
 * platform-web/workflow-host/outputs-store.ts 提供 shallowRef 版实现。
 *
 * 时机表（与 scheduler 严格一致）：
 *   - initNode(id)         workflow.execute 入口对每个节点调用一次
 *   - startNode(id)        节点从 ready 进入 running
 *   - succeedNode(id, o)   executor resolve 成功
 *   - setResult(name, v)   succeedNode 之后，仅当节点 type === "result" 时触发
 *   - failNode(id, err)    重试用尽
 *   - abortNode(id)        abort 传播取消（仅对仍 pending/running 的节点；
 *                          已 succeeded/failed 的节点保持原状）
 *
 * 错误防御：调度器会用 try/catch 包裹本接口的每次调用，钩子异常**不会**
 * 反向打挂调度器（fail loud > fail silent 的例外，但失败会经 console.warn）。
 */
export interface OutputsStoreWriter {
  initNode(nodeId: string): void
  startNode(nodeId: string): void
  succeedNode(nodeId: string, outputs: Record<string, unknown>): void
  failNode(nodeId: string, error: { code: string; message: string }): void
  abortNode(nodeId: string): void
  setResult(name: string, value: unknown): void
}
