/**
 * types.ts — Tsian 前端共享类型。
 *
 * 跨组件共享的接口/类型集中放此，避免在 SFC 间互相 import 造成循环。
 */

/** 轮次状态机：idle 等待输入 / streaming 助手回复中 / standby 轮次结束待下一轮。 */
export type TurnPhase = "idle" | "streaming" | "standby"

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
