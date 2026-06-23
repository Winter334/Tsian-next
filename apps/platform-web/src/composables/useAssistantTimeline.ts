import type { AttachmentRef } from "@tsian/contracts"

/**
 * 过程事件节点:assistant 回合内按发生顺序排列的思考/工具.
 * 每个节点独立折叠/展开,纵向平铺呈现 agent 的行为顺序(非分类堆叠).
 * 最终回复不入时间线——它是 content,渲染在过程节点之后.
 * 不持久化——刷新/切换会话后消失,只留 content(最终回复).
 *
 * 类型定义集中在 composable 导出,视图层 import 复用,避免循环依赖.
 */
export type AssistantTimelineNode =
  | { type: "thought"; id: string; round: number; text: string; collapsed: boolean }
  | { type: "tool"; id: string; round: number; name: string; status: "loading" | "running" | "success" | "failed"; output?: string; collapsed: boolean }

/**
 * 聊天消息(单条).user/assistant 共用结构;assistant 额外承载
 * timeline(过程节点,不持久化)和流式缓冲(不持久化).
 * 与 composable 同处导出,避免视图 ↔ composable 循环 import.
 */
export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** 附件引用元数据(用户消息). 图片附件显示缩略图,文本附件显示文件标识. */
  attachments?: AttachmentRef[]
  // 过程事件(native 模式按发生顺序;不持久化,刷新后消失).
  timeline?: AssistantTimelineNode[]
  // 当前轮 content 流式文本(可见回复 provisional;onRoundEnd stop→写入 content).
  // 不持久化——回合结束即清空,只作为流式期 UI 占位.
  streamingText?: string
  // 当前轮 reasoning 流式文本(思维链;累积不显示,onRoundEnd tool_calls→折叠 thought).
  // 不持久化——回合结束即清空.
  streamingReasoning?: string
}

/**
 * 纯流式解析 composable:把 runtime 的 onDelta/onRoundEnd/onTool 回调
 * 转成 timeline 节点 + streamingText/streamingReasoning 缓冲.
 *
 * 严格遵守 hook-guidelines:只管可复用的流式状态解析,不碰 DOM 滚动、
 * 不碰持久化、不碰 host 调用——这些由调用方(视图层)持有.
 *
 * `onUpdate` 在每次产生可见变化(流式正文累积、节点增删、轮结束)时触发,
 * 让视图层决定是否 maybeScrollToBottom(composable 不直接碰 DOM).
 */
export function useAssistantTimeline(
  assistantMsg: ChatMessage,
  onUpdate?: () => void,
) {
  const timeline = assistantMsg.timeline!

  const onDelta = (_agentId: string, _delta: string, _round: number, kind: "reasoning" | "content") => {
    if (kind === "reasoning") {
      // 思维链累积,不流式显示(默认折叠);onRoundEnd tool_calls 时落为 thought 节点.
      assistantMsg.streamingReasoning = (assistantMsg.streamingReasoning ?? "") + _delta
    } else {
      // 可见回复流式累积;onRoundEnd stop 时写入 content.
      assistantMsg.streamingText = (assistantMsg.streamingText ?? "") + _delta
      onUpdate?.()
    }
  }

  const onRoundEnd = (_agentId: string, round: number, finishReason: "stop" | "tool_calls") => {
    const reasoning = assistantMsg.streamingReasoning ?? ""
    if (finishReason === "tool_calls") {
      // 思考轮:把累积的思维链折叠为 thought 节点(空白则跳过,不渲染空思考块).
      // tool_calls 轮的 content delta 是工具调用前后的噪声(不是最终回复),丢弃.
      if (reasoning.trim()) {
        timeline.push({ type: "thought", id: `thought-r${round}`, round, text: reasoning, collapsed: true })
      }
    } else {
      // 最终轮:streamingText 即最终回复,写入 content(渲染层在过程节点之后展示).
      // 若该轮有 reasoning(部分模型在 stop 轮也吐思维链),也折叠为 thought 节点.
      if (reasoning.trim()) {
        timeline.push({ type: "thought", id: `thought-r${round}`, round, text: reasoning, collapsed: true })
      }
      assistantMsg.content = assistantMsg.streamingText ?? ""
    }
    // 清空两个缓冲:下一轮 onDelta 重新累积(或回合已结束).
    assistantMsg.streamingReasoning = ""
    assistantMsg.streamingText = ""
    onUpdate?.()
  }

  const onTool = (
    _agentId: string,
    round: number,
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: string,
  ) => {
    // 按 callId 去重:同一工具调用的 loading→success/failed 更新同一节点.
    const existing = timeline.find(
      (n): n is AssistantTimelineNode & { type: "tool" } => n.type === "tool" && n.id === callId,
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
        name,
        status,
        collapsed: false,
        ...(output !== undefined ? { output } : {}),
      })
    }
    onUpdate?.()
  }

  /**
   * 把仍在流式的 provisional 文本落盘,避免中止/出错时丢失用户已见进度:
   *   - streamingReasoning → 折叠为 thought 节点(若非空,保留已产出的思维链)
   *   - streamingText → content(已见的回复正文)
   * 切会话时也调用,防半截回复丢失.
   */
  function flushStreaming(): void {
    const reasoning = assistantMsg.streamingReasoning ?? ""
    if (reasoning.trim()) {
      timeline.push({
        type: "thought",
        id: `thought-flush-${timeline.length}`,
        round: -1,
        text: reasoning,
        collapsed: true,
      })
    }
    assistantMsg.streamingReasoning = ""
    if (assistantMsg.streamingText) {
      assistantMsg.content = assistantMsg.streamingText
      assistantMsg.streamingText = ""
    }
  }

  /**
   * 回合结束:折叠所有仍展开的 thought/tool 节点(过程完成,保留可展开回看),
   * 清空流式缓冲.在 finally 段调用.
   */
  function finalize(): void {
    for (const node of timeline) {
      if (node.type === "thought" || node.type === "tool") {
        node.collapsed = true
      }
    }
    assistantMsg.streamingText = ""
    assistantMsg.streamingReasoning = ""
  }

  return {
    timeline,
    onDelta,
    onRoundEnd,
    onTool,
    flushStreaming,
    finalize,
  }
}
