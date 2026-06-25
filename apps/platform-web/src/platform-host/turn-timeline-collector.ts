import type { TurnProcessNode, TurnToolOutput } from "@tsian/contracts"

/**
 * turn 过程节点累积器:把 runtime 的 onDelta/onRoundEnd/onTool 事件流
 * 累积成 `TurnProcessNode[]`,供 host 层 turn 收尾时写入 workspace turn 文件.
 *
 * 纯逻辑复刻 `composables/useAssistantTimeline` 的累积规则,去掉 Vue 依赖
 * 和 onUpdate 回调.节点带 `agentId`(区分 entry agent / delegated agent_call
 * 目标),与 `AssistantTimelineNode`(无 agentId)同构 + 多 agentId 字段.
 *
 * interim 语义只能从事件流重建:turn-round-end 的 kind=thought(tool_calls 轮)
 * 把该轮累积的 content delta 固化为 interim 节点(过渡叙事),kind=final(stop 轮)
 * 的 streamingText 是最终正文(不入 timeline).runtimeMessages 里 assistant.content
 * 无法区分过渡叙事 vs 最终回复,所以必须用事件流而非 runtimeMessages.
 *
 * text-protocol 路径不发这三个事件 → collector 不被调用 → processNodes 为空,
 * 与现状一致(text 模式前端本就无过程显示).
 */
export function createTurnTimelineCollector() {
  const timeline: TurnProcessNode[] = []
  let streamingText = ""
  let streamingReasoning = ""

  const onDelta = (
    agentId: string,
    delta: string,
    _round: number,
    kind: "reasoning" | "content",
  ): void => {
    if (kind === "reasoning") {
      streamingReasoning += delta
    } else {
      streamingText += delta
    }
  }

  const onRoundEnd = (
    agentId: string,
    round: number,
    finishReason: "stop" | "tool_calls",
  ): void => {
    const reasoning = streamingReasoning
    if (finishReason === "tool_calls") {
      // 工具调用轮:content delta 累积的是过渡文本 → interim 节点(始终展开)
      const interimText = streamingText
      if (interimText.trim()) {
        timeline.push({
          type: "interim",
          id: `interim-r${round}`,
          round,
          agentId,
          text: interimText,
          collapsed: false,
        })
      }
      // 思维链 → thought 节点(默认折叠)
      if (reasoning.trim()) {
        timeline.push({
          type: "thought",
          id: `thought-r${round}`,
          round,
          agentId,
          text: reasoning,
          collapsed: true,
        })
      }
    } else {
      // 最终轮:streamingText 是最终回复(不入 timeline,host 层用 result.replyText);
      // 若该轮有 reasoning 也折叠为 thought 节点.
      if (reasoning.trim()) {
        timeline.push({
          type: "thought",
          id: `thought-r${round}`,
          round,
          agentId,
          text: reasoning,
          collapsed: true,
        })
      }
    }
    streamingReasoning = ""
    streamingText = ""
  }

  const onTool = (
    agentId: string,
    round: number,
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: TurnToolOutput,
  ): void => {
    // 按 callId 去重:同一工具调用的 loading→success/failed 更新同一节点
    const existing = timeline.find(
      (n): n is TurnProcessNode & { type: "tool" } => n.type === "tool" && n.id === callId,
    )
    if (existing) {
      existing.status = status
      if (output !== undefined) {
        existing.output = output
      }
    } else {
      timeline.push({
        type: "tool",
        id: callId,
        round,
        agentId,
        name,
        status,
        collapsed: false,
        ...(output !== undefined ? { output } : {}),
      })
    }
  }

  /** 返回累积的过程节点(timeline 原始引用,调用方应在 turn 结束后取一次). */
  const getProcessNodes = (): TurnProcessNode[] => timeline

  return { onDelta, onRoundEnd, onTool, getProcessNodes }
}
