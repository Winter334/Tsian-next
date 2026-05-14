/**
 * Debug 桥实现（B3 / D5 / D9）。
 *
 * 把 platform-web 内部的 reactive / 全局数据源统一转成 contracts `DebugBridge`
 * 定义的回调风格 API，对外**只读观测**：
 *
 *   - `subscribeWorkflow`  ← `workflow-host/outputs-store.ts` 的 `currentTurnOutputsRef`
 *     （外层 ShallowRef<TurnOutputsRef | null>，内层每轮替换）。用 Vue `watch`
 *     深一层订阅，把内层 ref.value 的 snapshot 喂给回调。
 *   - `getRetrievalDebug` ← 由 platform-host 通过 `latestRetrievalDebugProvider`
 *     注入（避免 bridge 模块反向依赖 platform-host）。
 *   - `getAiDebugRecords` ← `runtime-host/ai.ts` 的环形缓冲。
 *   - `onTurnDebugReady`  ← `debug-events.ts` 的 `subscribeTurnDebugReady`。
 *
 * 旧的 `bridge.query("ai-debug" | "retrieval-debug" | "workflow-debug")` 字符串
 * 路由保留并行（D12），不在本文件 DRY。
 */

import type {
  DebugBridge,
  RetrievalDebugRecord,
  WorkflowOutputsSnapshot,
} from "@tsian/contracts"
import { watch } from "vue"

import { subscribeTurnDebugReady } from "../debug-events"
import { getAiDebugRecords } from "../runtime-host/ai"
import { currentTurnOutputsRef } from "../workflow-host/outputs-store"

export interface CreateDebugBridgeInput {
  /**
   * 由 platform-host 注入：异步返回当前激活存档的最新一份检索调试记录，
   * 没有则解析为 null。bridge 不直接持有 retrievalDebugBySave / getActiveSaveId，
   * 避免循环依赖。
   */
  latestRetrievalDebugProvider: () => Promise<RetrievalDebugRecord | null>
}

export function createDebugBridge(input: CreateDebugBridgeInput): DebugBridge {
  return {
    subscribeWorkflow(cb) {
      // 套娃 ref：外层 `currentTurnOutputsRef.value` 是内层 `TurnOutputsRef | null`，
      // 内层 ref.value 才是 WorkflowOutputsSnapshot。
      // watch 需要在两层 ref 任一变化时重派发：
      //   - 外层换 ref（轮切换）→ source[0] 变化
      //   - 内层 snapshot 变化（节点状态机迁移）→ source[1] 变化
      const stop = watch(
        () => {
          const inner = currentTurnOutputsRef.value
          return [inner, inner ? inner.value : null] as const
        },
        ([, snapshot]) => {
          if (snapshot) {
            cb(snapshot as WorkflowOutputsSnapshot)
          }
        },
        { immediate: true, flush: "sync" },
      )
      return stop
    },

    async getRetrievalDebug() {
      return input.latestRetrievalDebugProvider()
    },

    async getAiDebugRecords() {
      return getAiDebugRecords()
    },

    onTurnDebugReady(cb) {
      return subscribeTurnDebugReady(cb)
    },
  }
}
