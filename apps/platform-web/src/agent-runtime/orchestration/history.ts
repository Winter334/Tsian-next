import type {
  AgentContextSnapshot,
  ContentPart,
} from "@tsian/contracts"
import type { RuntimeChatMessage } from "../../runtime-host/ai"
import { isTextToolInteractionMessage } from "../text-tool-protocol"

export const LAYER_PREFIX = "<!-- tsian-layer:"

/** 消息形状(content 放宽以兼容多模态). 历史段/工具交互段的 content 在实践中始终是 string
 *  (多模态 ContentPart 只出现在当前轮 user 输入),但类型层面需要兼容. */
export type MessageLike = { role: string; content: string | ContentPart[]; toolCalls?: unknown[] }

function messageContentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

/**
 * 把 agent 会话上下文快照展开为对话正文 message 序列。
 *
 * summary(若有)作一条 user message 前言(早期任务/剧情摘要);recentTurns 每条
 * 展开为独立 user/assistant message。新结构中 recentTurns 只承载文本对话，
 * 历史工具行动痕迹由 top-level toolMemories 另行渲染为普通工作日志，不再
 * 还原为 provider tool protocol 历史消息。
 */
export function buildAgentContextMessages(
  context: AgentContextSnapshot,
  isAssistant: boolean,
  historySummaryRole: "system" | "user" | "assistant" = "user",
): RuntimeChatMessage[] {
  const messages: RuntimeChatMessage[] = []
  if (context.summary) {
    const summaryLabel = isAssistant ? "早期任务摘要" : "早期剧情摘要"
    messages.push({ role: historySummaryRole, content: `${summaryLabel}：\n${context.summary}` })
  }
  if (context.recentTurns.length === 0) {
    if (!context.summary) {
      messages.push({ role: historySummaryRole, content: "（暂无历史对话）" })
    }
  } else {
    for (const entry of context.recentTurns) {
      messages.push({ role: entry.role, content: entry.content })
    }
  }
  return messages
}

/**
 * 定位工具循环 messages 里的剧情正文段边界,供 turn 内压剧情后 slice+替换用
 * (design §2.4).剧情段 = prelude 段之后、runtime 段之前的独立 message
 * 序列(summary + recentTurns).顺序:system → prelude → history → runtime
 * → turn.runtime → turn.input ...,故 history 段在 prelude 之后开始.
 * 框架信息锚点:当前回合:/当前问答轮次:(runtime 段在 history 之后,
 * 属动态段,不再是 history 的一部分).
 *
 * 返回 { start, end }(半开区间),start<0 表示无独立剧情段可压,调用方跳过压缩:
 * - entry 稳态路径(注入了 agentContext):start=prelude 后, end=框架信息前.
 * - entry 兜底路径(未注入,剧情段首条是"最近对话："拍扁文本):{-1,-1}.
 * - delegated agent 路径(调用方 Agent 非剧情段,无独立剧情段可压):{-1,-1}.
 * - 无框架信息锚点(结构不符):{-1,-1}.
 */
export function locateHistorySpan(
  messages: ReadonlyArray<MessageLike>,
): { start: number; end: number } {
  if (messages.length <= 1) {
    return { start: -1, end: -1 }
  }
  // prelude 段（context-meta 元信息 + prelude position 注入）插在 systemPrompt 和
  // history 之间。prelude 注入消息以 `<!-- source: xxx -->` 前缀开头，context-meta 头
  // 以 `<!-- tsian-layer: context-meta -->` 前缀开头。扫描跳过这两种前缀的消息，
  // 找到 history 段起点。无 prelude 注入时：messages[1] 不含这两种前缀 → start 停在 1。
  let start = 1
  while (start < messages.length) {
    const text = messageContentToText(messages[start].content)
    if (text.startsWith("<!-- source:") || text.startsWith(LAYER_PREFIX)) {
      start += 1
      continue
    }
    break
  }
  // 扫描后 start 指向第一条非 prelude 消息。若已越界，结构异常。
  if (start >= messages.length) {
    return { start: -1, end: -1 }
  }
  const firstHistoryText = messageContentToText(messages[start].content)
  // 兜底路径(未注入 agentContext):剧情段首条是"最近对话："拍扁文本,无独立 message 序列.
  if (firstHistoryText.startsWith("最近对话：")) {
    return { start: -1, end: -1 }
  }
  // delegated agent:history 段首条是"最近对话窗口："（buildDelegatedAgentMessages 产出），
  // 无独立剧情 message 序列可压（delegated 无 agentContext 快照注入）。
  // 注意：delegated 路径的"调用方 Agent："在 prelude 注入之后，已被上面的前缀扫描跳过；
  // 无 prelude 时 start=1 仍指向"调用方 Agent："。
  if (firstHistoryText.startsWith("调用方 Agent：")) {
    return { start: -1, end: -1 }
  }
  // end: 扫描第一条带 <!-- tsian-layer: 前缀的消息（固定层标记），即为 history 段终点。
  // history 之后的第一个固定层是 runtime 段的 context-meta 头（如果 runtime 段有注入
  // 文件，它们以 <!-- source: 开头，不带固定层标记，会被跳过——end 会扫到 turn-runtime）。
  // 不依赖 role——固定层的 role 可由 messageLayers 配置改变。
  let end = -1
  for (let i = start + 1; i < messages.length; i += 1) {
    const text = messageContentToText(messages[i].content)
    if (text.startsWith(LAYER_PREFIX)) {
      end = i
      break
    }
  }
  if (end === -1) {
    return { start: -1, end: -1 }
  }
  return { start, end }
}

/**
 * 用压缩后的快照重建剧情段并 splice 替换原段(design §2.4).两种循环都直接用
 * buildAgentContextMessages 的结果(native 产 RuntimeChatMessage[],text 产同结构).
 * buildAgentContextMessages 产出的 AiChatMessage[].system / 框架信息 /
 * 本轮输入 / 后续 tool 交互保留不动.
 */
export function replaceHistorySpan<T extends MessageLike>(
  messages: T[],
  span: { start: number; end: number },
  newMessages: T[],
): void {
  messages.splice(span.start, span.end - span.start, ...newMessages)
}

/**
 * 列举一个 message 是否属于"工具交互"(供 locateTaskInteractionSpan 从末尾向前扫描).
 * - native 形态:`role === "tool"` 或 `role === "assistant" && toolCalls?.length > 0`.
 * - text 形态：Text Tool Protocol v2 的单条 executed-tools + observations
 *   执行报告或 protocol-error 消息；识别不依赖 message role。
 *
 * 框架段 user(含历史窗口/目标上下文/请求等 section)不含这些标签,不会被误判为工具交互.
 */
function isTaskInteractionMessage(
  message: MessageLike,
  mode: "native" | "text",
): boolean {
  if (mode === "native") {
    if (message.role === "tool") return true
    if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      return true
    }
    return false
  }
  // text
  return isTextToolInteractionMessage(message)
}

/**
 * 定位任务型 messages 的工具交互段边界,供任务压缩 slice+替换用(design §2.8).
 * 工具交互段 = 框架段之后到 messages 末尾(native structured round 或 text runtime report/correction).
 * 从末尾向前扫描,跳过所有"工具交互 message",定位到第一条"非工具交互"message 的下一索引.
 *
 * 两种 messages 结构都适用(delegated 单条框架 user / assistant entry 多条框架),扫描逻辑
 * 不依赖框架段锚点,只依赖工具交互的 message 形态.兜底(无工具交互)→ {-1,-1},跳过压缩.
 */
export function locateTaskInteractionSpan(
  messages: ReadonlyArray<MessageLike>,
  mode: "native" | "text",
): { start: number; end: number } {
  if (messages.length === 0) return { start: -1, end: -1 }
  let idx = messages.length - 1
  while (idx >= 0 && isTaskInteractionMessage(messages[idx], mode)) {
    idx -= 1
  }
  // idx 指向最后一条"非工具交互"message(或 -1 表示全是工具交互,异常结构).
  // 工具交互段起点 = idx + 1.若 idx+1 >= messages.length → 无工具交互段.
  const start = idx + 1
  if (start >= messages.length) return { start: -1, end: -1 }
  return { start, end: messages.length }
}
