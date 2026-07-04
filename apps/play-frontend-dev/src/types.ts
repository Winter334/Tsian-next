/**
 * types.ts — Tsian 前端共享类型。
 *
 * 跨组件共享的接口/类型集中放此，避免在 SFC 间互相 import 造成循环。
 */

/** 轮次状态机：idle 等待输入 / streaming 助手回复中 / standby 轮次结束待下一轮。 */
export type TurnPhase = "idle" | "streaming" | "standby"

/**
 * 回合后同步阶段（与 TurnPhase 正交，独立的状态轴）。
 *
 * 主回合正文落定（onTurnEnd）后，若卡配置了 entrypoints.postTurnMaintenance，
 * 前端发起一次回合后维护 Agent 调用，此状态轴描述该同步流程：
 * - idle：无同步任务（空闲 / 正文进行中 / 卡未配置 postTurnMaintenance）
 * - syncing：维护 Agent 调用进行中，Toast 显示"整理中"
 * - synced：维护完成，Toast 显示"已整理"短暂淡出后回 idle
 * - sync-failed：维护失败，Toast 显示"整理失败 · 重试"，重试回 syncing
 *
 * 与 TurnPhase 解耦：Composer 禁用 = streaming || syncing || sync-failed。
 */
export type SyncPhase = "idle" | "syncing" | "synced" | "sync-failed"

/** 过程节点（thought/tool/interim），按发生顺序，带 agentId。 */
export interface ProcessNode {
  type: "thought" | "tool" | "interim"
  id: string
  round?: number
  name?: string
  status?: "loading" | "running" | "success" | "failed"
  collapsed: boolean
  agentId?: string | null
  text?: string
}

/** 单轮状态：过程节点时间线 + 流式文本 + 最终内容 + 资源消耗。 */
export interface TurnState {
  timeline: ProcessNode[]
  streamingText: string
  streamingReasoning: string
  content: string
  stats?: {
    elapsedMs?: number
    tokens?: number
  }
}

export {}
