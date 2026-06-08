/**
 * 工作流 DAG 调度器
 *
 * 当前维护来源：.trellis/spec/workflow-engine/backend/。
 *
 * H3 范围：
 *   - 拓扑调度（Kahn）+ 并发执行无依赖节点
 *   - AbortController 传播（外部 abort → 所有运行中节点 signal；新节点不再启动）
 *   - 节点级重试（默认 maxRetries=1，即至多 2 次尝试）
 *   - 输出汇总到 Map<nodeId, NodeOutputRecord>（H7 才会换成 shallowRef）
 *
 * H3 不做：
 *   - 具体节点实现（H4）
 *   - outputs-store shallowRef（H7）
 *   - token 级流式
 *
 * 节点 executor 通过 context.executors 注入（依赖反转）。
 */

import type { WorkflowDefinition, WorkflowNode } from "@tsian/contracts"
import {
  WorkflowAbortError,
  WorkflowNodeError,
  WorkflowValidationError,
} from "./errors"
import type { OutputsStoreWriter } from "./types"
import { validateWorkflowDefinition } from "./validator"

/**
 * H7：把 hook 调用包在 try/catch，钩子异常不能反向打挂调度器（fail loud 例外）。
 * 失败时仅 console.warn，不再抛。
 */
function safeHook(label: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[workflow-engine] outputsHooks.${label} threw:`, err)
  }
}

/**
 * 节点执行器契约。具体实现由 H4 在 apps/platform-web/src/workflow-host/ 注册。
 *
 * 调度器对每个待执行节点调用一次 execute；返回值进入 outputs map。
 * - inputs：所有入边按 to.inputName 收集到的端口值（已解析上游 outputs[outputName ?? "raw"]）
 * - signal：与全局 abort 共享；executor 必须在 signal.aborted 时尽快终止
 * - context：外部注入的运行上下文（H3 透传，调度器不解析）
 */
export interface NodeExecutor {
  execute(args: NodeExecuteArgs): Promise<NodeExecuteResult>
}

export interface NodeExecuteArgs {
  node: WorkflowNode
  inputs: Record<string, unknown>
  signal: AbortSignal
  context: WorkflowExecutionContext
}

export interface NodeExecuteResult {
  /** 节点输出端口 → 值。result 等无显式 outputs 的节点可返回 {}。 */
  outputs: Record<string, unknown>
}

/**
 * 工作流执行上下文。
 * H3 仅定义形状；platform-web 在 H4 起填入运行时句柄、宏、preset 解析器等。
 */
export interface WorkflowExecutionContext {
  /** 节点类型 → executor */
  executors: ReadonlyMap<string, NodeExecutor>
  /** 透传给 executor 的额外字段；H3 不解析其含义。 */
  [key: string]: unknown
}

/**
 * 调度结果（H3 极简版）。
 * - nodeOutputs：每个节点的端口 map
 * - results：type="result" 节点的 config.name → 入边值（最常见单输入端口 "value"）
 * - order：实际完成顺序
 */
export interface WorkflowResult {
  nodeOutputs: Map<string, Record<string, unknown>>
  results: Record<string, unknown>
  order: string[]
}

export interface ExecuteWorkflowOptions {
  /** 外部 abort 信号；任何时刻 abort 都会向所有运行中节点广播。 */
  signal?: AbortSignal
  /** 是否模组工作流（来源元数据），默认 false。 */
  isModWorkflow?: boolean
  /**
   * H7：outputs 写入钩子。调度器在节点状态迁移时调用对应方法。
   * 钩子异常会被 try/catch 吞掉并 console.warn，**不会**反向打挂调度器。
   * 不传则不写任何状态（H3 行为兼容）。
   */
  outputsHooks?: OutputsStoreWriter
}

interface IncomingEdgeBinding {
  fromNodeId: string
  fromOutputName: string
  toInputName: string
}

function collectNodeInputs(
  incoming: ReadonlyArray<IncomingEdgeBinding>,
  nodeOutputs: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const edge of incoming) {
    const upstreamOutputs = nodeOutputs.get(edge.fromNodeId)
    if (!upstreamOutputs) continue
    const value = upstreamOutputs[edge.fromOutputName]
    inputs[edge.toInputName] = value
  }
  return inputs
}

/**
 * 主入口：执行一个工作流定义。
 *
 * 流程：
 *   1. validateWorkflowDefinition（加载期 DAG / 节点端口校验）
 *   2. 构建入度表 + 邻接表
 *   3. while 仍有节点：
 *      a. 把所有入度=0 且未启动的节点丢进 ready 集合
 *      b. 并发启动所有 ready 节点（带重试 + abort 监听）
 *      c. await 任一节点完成；完成后扣减下游入度
 *      d. 任一节点最终失败或 signal abort → 取消其余、向上抛
 */
export async function executeWorkflow(
  def: WorkflowDefinition,
  context: WorkflowExecutionContext,
  options: ExecuteWorkflowOptions = {},
): Promise<WorkflowResult> {
  // 1. 加载期校验（fail loud）
  validateWorkflowDefinition(def, { isModWorkflow: options.isModWorkflow })

  // 2. 构图
  const nodeById = new Map<string, WorkflowNode>()
  for (const node of def.nodes) nodeById.set(node.id, node)

  // H7 钩子时机 A：所有节点初始化为 pending
  for (const node of def.nodes) {
    safeHook("initNode", () => options.outputsHooks?.initNode(node.id, node.type))
  }

  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const node of def.nodes) {
    inDegree.set(node.id, 0)
    adj.set(node.id, [])
  }
  for (const edge of def.edges) {
    inDegree.set(edge.to.nodeId, (inDegree.get(edge.to.nodeId) ?? 0) + 1)
    adj.get(edge.from.nodeId)!.push(edge.to.nodeId)
  }

  // 节点输出（端口 → 值）
  const nodeOutputs = new Map<string, Record<string, unknown>>()
  const completionOrder: string[] = []

  // 3. abort 传播
  const externalSignal = options.signal
  // 检查环境对 AbortController 的支持（Node 16+/浏览器 ES2017+ 都有）
  if (typeof AbortController === "undefined") {
    throw new Error("AbortController is required by @tsian/workflow-engine")
  }
  const internalController = new AbortController()
  const internalSignal = internalController.signal

  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new WorkflowAbortError("workflow aborted before execution start")
    }
    externalSignal.addEventListener(
      "abort",
      () => internalController.abort(externalSignal.reason),
      { once: true },
    )
  }

  // 4. 收集每条入边到 target 的反向索引（target → list of edges）
  const incomingByTarget = new Map<string, IncomingEdgeBinding[]>()
  for (const edge of def.edges) {
    const list = incomingByTarget.get(edge.to.nodeId) ?? []
    list.push({
      fromNodeId: edge.from.nodeId,
      fromOutputName: edge.from.outputName ?? "raw",
      toInputName: edge.to.inputName,
    })
    incomingByTarget.set(edge.to.nodeId, list)
  }

  // 5. 调度循环
  const running = new Map<string, Promise<{ id: string; outputs: Record<string, unknown> }>>()
  const finished = new Set<string>()
  const queued = new Set<string>()

  const enqueueReady = (): void => {
    for (const [id, deg] of inDegree) {
      if (deg === 0 && !queued.has(id) && !finished.has(id) && !running.has(id)) {
        queued.add(id)
        const incoming = incomingByTarget.get(id) ?? []
        const inputs = collectNodeInputs(incoming, nodeOutputs)
        // H7 钩子时机 B：节点从 ready 进入 running
        safeHook("startNode", () => options.outputsHooks?.startNode(id, inputs))
        const promise = runNodeWithRetry({
          node: nodeById.get(id)!,
          inputs,
          context,
          signal: internalSignal,
        }).then((outputs) => ({ id, outputs }))
        running.set(id, promise)
      }
    }
  }

  try {
    enqueueReady()

    while (running.size > 0) {
      // 任一节点完成（成功或失败）
      const settled = await Promise.race(
        Array.from(running.values()).map((p) =>
          p.then(
            (v) => ({ kind: "ok" as const, ...v }),
            (err) => ({ kind: "err" as const, err }),
          ),
        ),
      )

      if (settled.kind === "err") {
        // H7 钩子时机 D：失败节点标 failed
        if (settled.err instanceof WorkflowNodeError) {
          const ne = settled.err
          safeHook("failNode", () =>
            options.outputsHooks?.failNode(ne.nodeId, {
              code: ne.name,
              message: ne.message,
            }),
          )
        }
        // H7 钩子时机 E：仍在运行的其他节点标 aborted（仅 pending/running，已 settled 不动）
        const failedId =
          settled.err instanceof WorkflowNodeError ? settled.err.nodeId : null
        let abortCount = 0
        for (const stillId of running.keys()) {
          if (stillId === failedId) continue
          safeHook("abortNode", () => options.outputsHooks?.abortNode(stillId))
          abortCount++
        }
        // 取消未完成节点；等其全部 settle 以避免悬挂 promise
        internalController.abort(settled.err)
        if (abortCount > 0) {
          // eslint-disable-next-line no-console
          console.debug(`[workflow-engine] aborted ${abortCount} nodes`)
        }
        await Promise.allSettled(running.values())
        throw settled.err
      }

      const { id, outputs } = settled
      running.delete(id)
      queued.delete(id)
      finished.add(id)
      nodeOutputs.set(id, outputs)
      completionOrder.push(id)

      // H7 钩子时机 C：节点成功完成
      safeHook("succeedNode", () => options.outputsHooks?.succeedNode(id, outputs))
      const finishedNode = nodeById.get(id)
      if (finishedNode && finishedNode.type === "result") {
        const cfg = finishedNode.config as { name?: unknown }
        if (typeof cfg?.name === "string") {
          const resultName = cfg.name
          const resultValue = outputs.value
          safeHook("setResult", () =>
            options.outputsHooks?.setResult(resultName, resultValue),
          )
        }
      }

      // 扣减下游入度
      for (const next of adj.get(id) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
      }

      if (internalSignal.aborted) {
        // H7 钩子时机 E（abort 路径）：仍在运行的节点标 aborted
        let abortCount = 0
        for (const stillId of running.keys()) {
          safeHook("abortNode", () => options.outputsHooks?.abortNode(stillId))
          abortCount++
        }
        if (abortCount > 0) {
          // eslint-disable-next-line no-console
          console.debug(`[workflow-engine] aborted ${abortCount} nodes`)
        }
        await Promise.allSettled(running.values())
        throw new WorkflowAbortError(
          externalSignal?.aborted ? "workflow aborted by caller" : "workflow aborted internally",
        )
      }

      enqueueReady()
    }
  } catch (err) {
    if (err instanceof WorkflowValidationError) throw err
    if (err instanceof WorkflowAbortError) throw err
    if (err instanceof WorkflowNodeError) throw err
    // 兜底：把未知错误也按 NodeError 抛（不应到达）
    throw err
  }

  // 6. 汇总 result 节点
  const results: Record<string, unknown> = {}
  for (const node of def.nodes) {
    if (node.type !== "result") continue
    const cfg = node.config as { name?: string }
    if (typeof cfg?.name !== "string") continue
    // result 节点的输出按惯例放在 outputs.value（H4 实现层会保证）
    const outs = nodeOutputs.get(node.id)
    results[cfg.name] = outs?.value
  }

  return { nodeOutputs, results, order: completionOrder }
}

// ============================================================================
// 内部：单节点执行（含重试 + abort）
// ============================================================================

interface RunNodeArgs {
  node: WorkflowNode
  inputs: Record<string, unknown>
  context: WorkflowExecutionContext
  signal: AbortSignal
}

async function runNodeWithRetry(
  args: RunNodeArgs,
): Promise<Record<string, unknown>> {
  const { node, signal } = args
  const maxRetries = node.retry?.maxRetries ?? 1
  const totalAttempts = Math.max(1, maxRetries + 1)

  let lastError: unknown
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (signal.aborted) {
      throw new WorkflowAbortError(`node "${node.id}" aborted before attempt ${attempt}`)
    }
    const executor = args.context.executors.get(node.type)
    if (!executor) {
      // 缺少 executor 是配置错误，不重试，直接抛 NodeError
      throw new WorkflowNodeError(
        node.id,
        attempt,
        new Error(`no executor registered for node type "${node.type}"`),
        "UNKNOWN_NODE_TYPE",
      )
    }
    try {
      const result = await executor.execute({
        node,
        inputs: args.inputs,
        signal,
        context: args.context,
      })
      if (!result || typeof result.outputs !== "object" || result.outputs === null) {
        throw new Error(
          `executor for type "${node.type}" returned invalid result (outputs must be an object)`,
        )
      }
      return result.outputs
    } catch (err) {
      lastError = err
      // abort 立即穿透，不消耗重试次数
      if (signal.aborted) {
        throw new WorkflowAbortError(
          `node "${node.id}" aborted during attempt ${attempt}`,
        )
      }
      // 否则继续重试（如果还有次数）
    }
  }
  // 重试用尽
  throw new WorkflowNodeError(node.id, totalAttempts, lastError, "NODE_RETRY_EXHAUSTED")
}
