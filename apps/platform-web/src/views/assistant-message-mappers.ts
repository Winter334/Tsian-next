import type {
  ConversationMessageRecord,
  TurnTimelineItem,
  UiToolPresentation,
} from "@tsian/contracts"
import type { ChatMessage, AssistantTimelineNode } from "@/composables/useAssistantTimeline"

/**
 * 提取 agent_call 工具卡片的玩家可读内容（title + response）。
 * 普通 tool 没有 presentation，只显示名称和状态。
 * agent_call 成功返回 { title, response }；失败返回 { title, error }。
 */
export function agentCallDisplay(presentation: UiToolPresentation | undefined): {
  title: string
  response: string
  failed: boolean
} | null {
  if (!presentation || presentation.type !== "agent_call") {
    return null
  }
  return {
    title: presentation.targetAgent.title || presentation.targetAgent.id || "agent_call",
    response: presentation.status === "failed"
      ? presentation.error?.message ?? "agent_call 失败"
      : presentation.response,
    failed: presentation.status === "failed",
  }
}

/**
 * 把会话消息存储的 ConversationMessageRecord[] 映射为 ChatMessage[].
 * 从 presentation-only timeline 重建历史工具节点。
 * 历史节点 id 加 hist-tool- 前缀防与流式节点 callId 冲突.
 */
export function mapStoredMessagesToChat(stored: ConversationMessageRecord[]): ChatMessage[] {
  return stored.map((msg) => {
    const role = msg.role === "user" ? "user" as const : "assistant" as const
    const base: ChatMessage = {
      role,
      content: msg.content,
      ...(msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
    }
    if (role !== "assistant") return base
    // 从 timeline 重建 AssistantTimelineNode[](1:1 顺序保留,TurnTimelineItem → AssistantTimelineNode 映射).
    if (msg.timeline && msg.timeline.length > 0) {
      base.timeline = msg.timeline
        .filter((item) => item.kind === "thought" || item.kind === "interim" || item.kind === "tool")
        .map((item): AssistantTimelineNode => {
          if (item.kind === "thought") {
            return { type: "thought", id: item.id, round: item.round, text: item.text, collapsed: item.collapsed }
          }
          if (item.kind === "interim") {
            return { type: "interim", id: item.id, round: item.round, text: item.text, collapsed: item.collapsed }
          }
          // tool
          return {
            type: "tool",
            id: item.id,
            round: item.round,
            name: item.name,
            status: item.status,
            collapsed: item.collapsed,
            ...(item.presentation !== undefined ? { presentation: item.presentation } : {}),
          }
        })
    }
    return base
  })
}

/**
 * 把 ChatMessage[] 映射回 ConversationMessageRecord[](供 AssistantView 持久化).
 * assistant 消息的 timeline 节点转回 timeline(TurnTimelineItem 形态,process items)
 * 只写 timeline 展示投影，不从 UI 节点反造模型工具历史。
 */
export function chatToStoredMessages(msgs: ChatMessage[]): ConversationMessageRecord[] {
  return msgs.map((msg) => {
    const base: ConversationMessageRecord = {
      role: msg.role,
      content: msg.content,
      ...(msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
    }
    if (msg.role === "assistant" && msg.timeline && msg.timeline.length > 0) {
      // timeline: AssistantTimelineNode → TurnTimelineItem 1:1 映射(process items).
      base.timeline = msg.timeline
        .map((node): TurnTimelineItem => {
          if (node.type === "thought") {
            return { kind: "thought", id: node.id, round: node.round, text: node.text, collapsed: node.collapsed }
          }
          if (node.type === "interim") {
            return { kind: "interim", id: node.id, round: node.round, text: node.text, collapsed: node.collapsed }
          }
          // ask 节点用 interim 形态存(只读 Q&A 记录,展开显示问题+答案).
          if (node.type === "ask") {
            return { kind: "interim", id: node.id, round: node.round, text: `**提问**: ${node.question}\n**回答**: ${node.cancelled ? "已取消" : (node.answer ?? "")}`, collapsed: node.collapsed }
          }
          // tool
          return {
            kind: "tool",
            id: node.id,
            round: node.round,
            name: node.name,
            status: node.status,
            collapsed: node.collapsed,
            ...(node.presentation !== undefined ? { presentation: node.presentation } : {}),
          }
        })
    }
    return base
  })
}
