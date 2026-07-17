import type { RuntimeChatMessage } from "../../runtime-host/ai"

/**
 * 消息序列整合器：合并连续相同 role 的消息，纯换行拼接内容，不加自动 XML 标签。
 *
 * 设计理由（design §消息整合器）：
 * - Claude/Gemini API 不接受连续相同 role 消息，OpenAI 接受但内部加隐式分割。合并后
 *   用换行拼接，比多条消息的前缀标注更紧凑、更省 token。
 * - 不加自动标签：酒馆预设大量使用跨条目标签（开标签在条目A、闭标签在条目B）和嵌套
 *   标签。自动加标签会破坏这些结构——给只含开标签的条目再包一层，导致双重嵌套或
 *   结构错乱。标签完全由作者在 contextPath 条目内容里显式写。
 * - 不连续的相同 role 不合并（如 [system, user, system] 保持三条）。
 *
 * 调用时机：仅在 native/text 两个工具循环每轮调用 model API 前对当前 messages 数组
 * 过一遍整合器，产出新数组传给 API。工具循环内的 splice-replace / span 定位操作的是
 * 未整合的原始数组，整合器不 mutate 原数组。
 *
 * tool 角色（native 模式）不与 assistant 合并：tool 消息有独立语义（工具 observation），
 * 且 provider native API 要求 tool 消息跟在 assistant toolCalls 之后，合并会破坏结构。
 * 整合器按 role 严格相等判断，role="tool" 只与 role="tool" 合并（实践中不会连续出现
 * 两条 tool），天然跳过与 assistant 的合并。
 */
export function mergeConsecutiveRoleMessages(
  messages: RuntimeChatMessage[],
): RuntimeChatMessage[] {
  const result: RuntimeChatMessage[] = []
  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // 合并：纯换行拼接，不加自动标签（标签由作者在内容里显式写）。
      // content 可能是 string 或 ContentPart[]；合并只处理 string content
      // （连续同 role 的注入消息都是 string；多模态 ContentPart[] 只出现在
      // 当前轮 user 输入，不会与同 role 注入消息连续）。
      if (typeof last.content === "string" && typeof msg.content === "string") {
        last.content += `\n\n${msg.content}`
      } else {
        // 多模态 content 不合并（罕见边界：同 role 连续但其中一条是 ContentPart[]）。
        result.push({ ...msg })
      }
    } else {
      result.push({ ...msg })
    }
  }
  return result
}

/**
 * 剥离消息内容开头的内部标记前缀（`<!-- tsian-layer: -->` 和 `<!-- source: -->`）。
 * 在 mergeConsecutiveRoleMessages 之后、API 调用之前执行——模型看到的是干净内容。
 * 只剥离消息**开头**的标记（`^` 锚定），不剥离消息内部合法的 HTML 注释。
 * 只处理 string content；ContentPart[]（多模态）不处理。
 */
export function stripInternalMarkers(messages: RuntimeChatMessage[]): RuntimeChatMessage[] {
  const layerRe = /^<!-- tsian-layer: [^>]* -->\n?/
  const sourceRe = /^<!-- source: [^>]* -->\n?/
  return messages.map(msg => {
    if (typeof msg.content !== "string") return msg
    let content = msg.content
    // 可能同时有 layer 和 source 前缀（理论上不会，但防御性循环 2 次）
    for (let i = 0; i < 2; i++) {
      if (layerRe.test(content)) {
        content = content.replace(layerRe, "")
      } else if (sourceRe.test(content)) {
        content = content.replace(sourceRe, "")
      } else {
        break
      }
    }
    return { ...msg, content }
  })
}
