/**
 * Workflow outputs store（H7 / design.md §13.7 §13.8）
 *
 * 套娃 ref 形态（D8）：
 *   - 内层（每轮）：`TurnOutputsRef = ShallowRef<WorkflowOutputsSnapshot>`，
 *     在 `createOutputsStore` 中新建，platform-host 持有局部引用，scheduler 通过
 *     `OutputsStoreWriter` 写入；前端可订阅 `currentTurnOutputsRef.value` 拿到当前轮内层。
 *   - 外层（轮切换）：`currentTurnOutputsRef`，模块级单例，每轮替换；旧 ref 在
 *     platform-host 局部变量被新轮替换后自然 GC（D3 abort 闭包隔离）。
 *
 * 写入语义（D4）：
 *   每个 writer 方法内部做"整体浅拷贝替换 + triggerRef"，节点级粒度更新。
 *   不允许节点执行过程中高频 mutation；scheduler 仅在状态迁移末尾调钩子。
 *
 * abort 关键防御（D6 第 6 项）：
 *   `abortNode` 仅对 `pending`/`running` 的节点生效；已 `succeeded`/`failed` 的节点
 *   保持原状（**关键**：apply-patch 在写入 IndexedDB 完成后才被外部 abort 时，
 *   节点已 succeeded，不应被改成 aborted）。
 *
 * 当前阶段不实现 `Map<saveId:turn, TurnOutputsRef>`（YAGNI，D8 简化版）。
 *
 * 不暴露给 PlayFrontendBridge（D7）：H7 仅做内部能力，订阅留给 H10/H11。
 */

import { shallowRef, triggerRef, type ShallowRef } from "vue"

import type {
  NodeOutputState,
  WorkflowOutputsSnapshot,
} from "@tsian/contracts"
import type { OutputsStoreWriter } from "@tsian/workflow-engine"

// ============================================================================
// 类型
// ============================================================================

// B1：调试类型已迁到 @tsian/contracts；此处 re-export 保持原 API
export type { NodeOutputState, WorkflowOutputsSnapshot }

export type TurnOutputsRef = ShallowRef<WorkflowOutputsSnapshot>

// ============================================================================
// 模块级单例：当前激活轮的 outputs ref
// ============================================================================

/**
 * 当前激活轮的内层 ref。每次 `createOutputsStore` 替换为新 ref。
 * 前端调试面板可订阅本 ref，拿到的内层 ref 也是 shallowRef，可继续订阅。
 */
export const currentTurnOutputsRef: ShallowRef<TurnOutputsRef | null> =
  shallowRef(null)

// ============================================================================
// 工厂
// ============================================================================

export interface CreateOutputsStoreInput {
  /** 当前轮序号（platform-host 在 sendMessage 入口 ++state.turn 后传入） */
  turn: number
  /** 工作流定义中所有节点 id（已通过加载期校验） */
  nodeIds: ReadonlyArray<string>
}

export interface OutputsStoreHandle {
  /** 本轮内层 ref；platform-host 局部持有，新轮替换时旧 ref 自然 GC */
  ref: TurnOutputsRef
  /** 给 scheduler 的写入钩子（D1 6 方法） */
  writer: OutputsStoreWriter
  /**
   * 兜底：把仍 pending/running 的节点统一标 aborted。
   * platform-host 在 `abortPreviousTurn` 或异常退出路径调用。
   */
  abortAllPending(): void
}

/**
 * 创建当前轮 outputs store 并替换模块级 currentTurnOutputsRef。
 *
 * 流程：
 *   1. 用 `nodeIds` 初始化 nodes 全部为 pending
 *   2. 新建内层 TurnOutputsRef（shallowRef）
 *   3. `currentTurnOutputsRef.value = newRef`
 *   4. 返回 handle（含 writer 6 方法 + abortAllPending）
 */
export function createOutputsStore(
  input: CreateOutputsStoreInput,
): OutputsStoreHandle {
  const initialNodes: Record<string, NodeOutputState> = {}
  for (const id of input.nodeIds) {
    initialNodes[id] = { status: "pending" }
  }

  const initialSnapshot: WorkflowOutputsSnapshot = {
    nodes: initialNodes,
    results: {},
    turn: input.turn,
  }

  const ref: TurnOutputsRef = shallowRef(initialSnapshot)

  // 替换模块级单例（外层 ref 触发响应式）
  currentTurnOutputsRef.value = ref

  // ---- 内部工具 ----------------------------------------------------------
  const replace = (
    mutate: (prev: WorkflowOutputsSnapshot) => WorkflowOutputsSnapshot | null,
  ): void => {
    const prev = ref.value
    const next = mutate(prev)
    if (next === null) return
    ref.value = next
    triggerRef(ref)
  }

  const updateNode = (
    nodeId: string,
    transform: (prev: NodeOutputState | undefined) => NodeOutputState | null,
  ): void => {
    replace((prev) => {
      const prevNode = prev.nodes[nodeId]
      const nextNode = transform(prevNode)
      if (nextNode === null) return null
      return {
        ...prev,
        nodes: { ...prev.nodes, [nodeId]: nextNode },
      }
    })
  }

  // ---- writer 6 方法 -----------------------------------------------------
  const writer: OutputsStoreWriter = {
    initNode(nodeId) {
      updateNode(nodeId, () => ({ status: "pending" }))
    },

    startNode(nodeId) {
      updateNode(nodeId, (prev) => ({
        ...(prev ?? { status: "pending" }),
        status: "running",
        startedAt: Date.now(),
      }))
    },

    succeedNode(nodeId, outputs) {
      updateNode(nodeId, (prev) => ({
        ...(prev ?? { status: "running" }),
        status: "succeeded",
        outputs,
        finishedAt: Date.now(),
      }))
    },

    failNode(nodeId, error) {
      updateNode(nodeId, (prev) => ({
        ...(prev ?? { status: "running" }),
        status: "failed",
        error,
        finishedAt: Date.now(),
      }))
    },

    abortNode(nodeId) {
      // 关键：仅对 pending / running 生效，已 settled 的节点保持原状
      updateNode(nodeId, (prev) => {
        if (!prev) return null
        if (prev.status !== "pending" && prev.status !== "running") return null
        return {
          ...prev,
          status: "aborted",
          finishedAt: Date.now(),
        }
      })
    },

    setResult(name, value) {
      replace((prev) => ({
        ...prev,
        results: { ...prev.results, [name]: value },
      }))
    },
  }

  // ---- abortAllPending ---------------------------------------------------
  const abortAllPending = (): void => {
    const snapshot = ref.value
    for (const [id, state] of Object.entries(snapshot.nodes)) {
      if (state.status === "pending" || state.status === "running") {
        writer.abortNode(id)
      }
    }
  }

  return { ref, writer, abortAllPending }
}
