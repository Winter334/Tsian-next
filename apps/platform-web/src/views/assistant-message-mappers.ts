import type {
  AgentContextToolCall,
  ConversationMessageRecord,
  TurnProcessNode,
  TurnToolOutput,
} from "@tsian/contracts"
import type { ChatMessage, AssistantTimelineNode } from "@/composables/useAssistantTimeline"

/**
 * 提取 agent_call 工具卡片的玩家可读内容（title + response）。
 * 普通 tool（output 为 string）返回 null —— 按需求统一不显 output，只显状态。
 * agent_call 成功返回 { title, response }；失败返回 { title, error }。
 */
export function agentCallDisplay(output: TurnToolOutput | undefined): {
  title: string
  response: string
  failed: boolean
} | null {
  if (typeof output !== "object" || output.type !== "agent_call") {
    return null
  }
  return {
    title: output.targetAgent.title || output.targetAgent.id || "agent_call",
    response: output.status === "failed"
      ? output.error?.message ?? "agent_call 失败"
      : output.response,
    failed: output.status === "failed",
  }
}

/**
 * 把会话消息存储的 ConversationMessageRecord[] 映射为 ChatMessage[].
 * assistant 消息带 toolCalls 时,重建历史 tool 节点到 timeline(折叠态可展开),
 * 让玩家刷新/重进会话后能回看历史工具调用(与 ZCode 客户端跨会话保留一致).
 * 数据源 = 会话消息存储(不压缩完整保留),非 context.json(压缩后丢早期).
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
    // 从 processNodes 重建 timeline(1:1 顺序保留,TurnProcessNode → AssistantTimelineNode 同构映射).
    if (msg.processNodes && msg.processNodes.length > 0) {
      base.timeline = msg.processNodes.map((node): AssistantTimelineNode => {
        if (node.type === "thought") {
          return { type: "thought", id: node.id, round: node.round, text: node.text, collapsed: node.collapsed }
        }
        if (node.type === "interim") {
          return { type: "interim", id: node.id, round: node.round, text: node.text, collapsed: node.collapsed }
        }
        // tool
        return {
          type: "tool",
          id: node.id,
          round: node.round,
          name: node.name,
          status: node.status,
          collapsed: node.collapsed,
          ...(node.output !== undefined ? { output: node.output } : {}),
        }
      })
    }
    return base
  })
}

/** 尝试把 agent_call 工具的 observation(JSON 字符串)解析为 TurnToolOutput 结构化形态.
 *  解析失败则降级为字符串 output(普通 tool 渲染). */
export function tryParseAgentCallOutput(call: AgentContextToolCall): { output: TurnToolOutput } {
  try {
    const parsed = JSON.parse(call.observation) as TurnToolOutput
    if (typeof parsed === "object" && parsed !== null && parsed.type === "agent_call") {
      return { output: parsed }
    }
  } catch {
    // 降级
  }
  return { output: call.observation as TurnToolOutput }
}

/**
 * 把 ChatMessage[] 映射回 ConversationMessageRecord[](供 AssistantView 持久化).
 * assistant 消息的 timeline 节点转回 processNodes(按发生顺序,TurnProcessNode 形态)
 * + toolCalls(agent 层用,从 tool 节点提取 observation).
 * turn 成功后 host 已写消息(含 toolCalls),AssistantView 再写一次补上 processNodes
 * (host 不持有 thought/interim 采集,UI 层 timeline 是唯一源).后写覆盖,无竞态.
 */
export function chatToStoredMessages(msgs: ChatMessage[]): ConversationMessageRecord[] {
  return msgs.map((msg) => {
    const base: ConversationMessageRecord = {
      role: msg.role,
      content: msg.content,
      ...(msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
    }
    if (msg.role === "assistant" && msg.timeline && msg.timeline.length > 0) {
      // processNodes: timeline 1:1 映射(AssistantTimelineNode → TurnProcessNode 同构).
      base.processNodes = msg.timeline.map((node): TurnProcessNode => {
        if (node.type === "thought") {
          return { type: "thought", id: node.id, round: node.round, text: node.text, collapsed: node.collapsed }
        }
        if (node.type === "interim") {
          return { type: "interim", id: node.id, round: node.round, text: node.text, collapsed: node.collapsed }
        }
        // tool (含 ask 节点?不,ask 不持久化到 processNodes——finalize 后 ask 节点仍在 timeline,
        // 但 ask 是交互记录非过程,这里也存入 processNodes 让它可回看).
        if (node.type === "ask") {
          // ask 节点用 interim 形态存(只读 Q&A 记录,展开显示问题+答案).
          return { type: "interim", id: node.id, round: node.round, text: `**提问**: ${node.question}\n**回答**: ${node.cancelled ? "已取消" : (node.answer ?? "")}`, collapsed: node.collapsed }
        }
        // tool
        return {
          type: "tool",
          id: node.id,
          round: node.round,
          name: node.name,
          status: node.status,
          collapsed: node.collapsed,
          ...(node.output !== undefined ? { output: node.output } : {}),
        }
      })
      // toolCalls(agent 层用):从 tool 节点提取 observation 文本化.
      const toolCalls: AgentContextToolCall[] = []
      for (const node of msg.timeline) {
        if (node.type === "tool") {
          const observation = typeof node.output === "string"
            ? node.output
            : JSON.stringify(node.output)
          toolCalls.push({
            id: node.id.startsWith("hist-tool-") ? node.id.replace(/^hist-tool-\d+-/, "") : node.id,
            name: node.name,
            arguments: "",
            observation,
            ...(node.status === "failed" ? { failed: true } : {}),
          })
        }
      }
      if (toolCalls.length > 0) base.toolCalls = toolCalls
    }
    return base
  })
}
