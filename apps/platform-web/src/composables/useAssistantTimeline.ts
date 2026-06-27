import type { AttachmentRef, TurnToolOutput } from "@tsian/contracts"

/**
 * 过程事件节点:assistant 回合内按发生顺序排列的思考/工具/过渡文本.
 * 每个节点独立折叠/展开,纵向平铺呈现 agent 的行为顺序(非分类堆叠).
 * 最终回复不入时间线——它是 content,渲染在过程节点之后.
 * 不持久化——刷新/切换会话后消失,只留 content(最终回复).
 *
 * - thought: tool_calls 轮的推理思维链,默认折叠.
 * - tool: 工具调用节点,按 callId 去重.
 * - interim: tool_calls 轮模型在调用工具前输出的过渡文本(如"我先看一下…"),
 *   当正常可见回复处理,始终展开(collapsed 固定 false),平铺在该轮工具节点之前.
 *
 * 类型定义集中在 composable 导出,视图层 import 复用,避免循环依赖.
 */
export type AssistantTimelineNode =
  | { type: "thought"; id: string; round: number; text: string; collapsed: boolean }
  | { type: "tool"; id: string; round: number; name: string; status: "loading" | "running" | "success" | "failed"; output?: TurnToolOutput; collapsed: boolean }
  | { type: "interim"; id: string; round: number; text: string; collapsed: boolean }
  | {
      type: "ask"
      id: string
      round: number
      requestId: string
      question: string
      options?: string[]
      allowCustom?: boolean
      /** 玩家回答后填入（resolveInteractionRequest 的 answer）。 */
      answer?: string
      /** 玩家取消时 true。 */
      cancelled?: boolean
      collapsed: boolean
    }

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
      // 工具调用轮:模型常在调用工具前输出一段过渡文本(如"我先看一下游戏卡内容"),
      // 流式期用户已见,这里保留为 interim 节点(始终展开,正文样式渲染),不再丢弃.
      const interimText = assistantMsg.streamingText ?? ""
      if (interimText.trim()) {
        timeline.push({ type: "interim", id: `interim-r${round}`, round, text: interimText, collapsed: false })
      }
      // 思维链折叠为 thought 节点(空白则跳过,不渲染空思考块).
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
    output?: TurnToolOutput,
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
        collapsed: true,
        ...(output !== undefined ? { output } : {}),
      })
    }
    onUpdate?.()
  }

  /**
   * ask_user 交互结束（玩家回答或取消）后，把这次 Q&A 作为只读记录写入
   * timeline（由 AssistantView 在 resolveInteractionRequest 后调用）。
   *
   * 活跃提问期间不在 timeline 渲染交互卡片——提问 UI 由 footer 输入框变形
   * 承载（问题常驻焦点位，不与普通输入框并存）。仅在回答/取消后才落 timeline，
   * 保留对话历史可回看。已答/已取消节点在 finalize 时折叠。
   */
  function recordAskNode(input: {
    requestId: string
    question: string
    options?: string[]
    allowCustom?: boolean
    answer?: string
    cancelled?: boolean
  }): void {
    timeline.push({
      type: "ask",
      id: `ask-${input.requestId}`,
      round: timeline.length,
      requestId: input.requestId,
      question: input.question,
      collapsed: false,
      ...(input.options ? { options: input.options } : {}),
      ...(input.allowCustom !== undefined ? { allowCustom: input.allowCustom } : {}),
      ...(input.answer !== undefined ? { answer: input.answer } : {}),
      ...(input.cancelled ? { cancelled: true } : {}),
    })
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
    // 过渡文本(tool_calls 轮的 content):中止时也落为 interim 节点(与 onRoundEnd 一致),
    // 避免中止/切会话时过渡文本丢失.若已是 stop 轮最终回复则落 content.
    if (assistantMsg.streamingText) {
      const text = assistantMsg.streamingText
      assistantMsg.streamingText = ""
      if (assistantMsg.content) {
        // 已有最终 content(极少见),追加而非覆盖.
        assistantMsg.content = `${assistantMsg.content}\n\n${text}`
      } else {
        timeline.push({
          type: "interim",
          id: `interim-flush-${timeline.length}`,
          round: -1,
          text,
          collapsed: false,
        })
      }
    }
  }

  /**
   * 回合结束:折叠所有仍展开的 thought/tool 节点(过程完成,保留可展开回看),
   * 清空流式缓冲.在 finally 段调用.
   */
  function finalize(): void {
    for (const node of timeline) {
      // 折叠 thought/tool(过程完成,保留可展开回看);interim 始终展开(当正常回复).
      if (node.type === "thought" || node.type === "tool") {
        node.collapsed = true
      }
      // ask 节点:已回答/已取消的折叠(过程完成),未交互的保持展开(等玩家).
      if (node.type === "ask" && (node.answer !== undefined || node.cancelled)) {
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
    recordAskNode,
    flushStreaming,
    finalize,
  }
}
