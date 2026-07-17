import type {
  AgentContextEntry,
  ContextInjection,
} from "@tsian/contracts"
import type { RuntimeChatMessage } from "../../runtime-host/ai"

export const CONTEXT_META_TAG = "<!-- tsian-layer: context-meta -->"
export const TOOL_MEMORY_TAG = "<!-- tsian-layer: tool-memory -->"
export const TURN_RUNTIME_TAG = "<!-- tsian-layer: turn-runtime -->"
export const PLAYER_INPUT_TAG = "<!-- tsian-layer: player-input -->"

function formatSkillIndex(context: AgentContextEntry): string {
  if (context.skillIndex.length === 0) {
    return "（暂无可见 Skill）"
  }

  return context.skillIndex
    .map((skill) => {
      const triggers = skill.triggers.length
        ? ` triggers=${skill.triggers.join(", ")}`
        : ""
      return `- ${skill.name}: ${skill.description || skill.summary || "（无描述）"}${triggers}`
    })
    .join("\n")
}

/**
 * 把一组 ContextInjection 编译成逐条 RuntimeChatMessage。每条注入消息用 HTML 注释
 * 前缀标注来源（`<!-- source: xxx -->`），供 locateHistorySpan 扫描识别 prelude
 * 注入消息，以及 debug 时辨别来源。注释在合并时被保留（整合器只做 role 合并 + 换行
 * 拼接，不删注释），模型将 HTML 注释视为元信息，不影响理解。
 *
 * 每个 injection 产出一条独立消息（不合并），合并由 mergeConsecutiveRoleMessages
 * 整合器在发送给模型前统一处理。保持逐条产出是为了 locateHistorySpan/replaceHistorySpan
 * 等基于未整合数组的边界扫描逻辑不受整合器影响。
 */
export function contextInjectionsToMessages(
  injections: ContextInjection[],
): RuntimeChatMessage[] {
  return injections.map((inj) => ({
    role: inj.role,
    content: `<!-- source: ${inj.source} -->\n${inj.content}`,
  }))
}

/**
 * 构建 prelude 段消息：上下文元信息（Skill Index）+ prelude position 注入文件。
 * 放在 system 之后、history 之前——跨轮稳定内容命中前缀缓存。
 */
export function buildPreludeMessages(
  context: AgentContextEntry,
  label: "Workspace Agent 上下文" | "目标 Agent 上下文",
  metaRole: "system" | "user" | "assistant" = "user",
): RuntimeChatMessage[] {
  const messages: RuntimeChatMessage[] = [
    { role: metaRole, content: `${CONTEXT_META_TAG}\n${label}（元信息）：\n${formatContextMeta(context)}` },
  ]
  messages.push(...contextInjectionsToMessages(context.contextInjectionsByPosition.prelude))
  return messages
}

/**
 * 构建 runtime 段消息：runtime position 注入文件（runtime.json、frontier.json 等）。
 * 放在 history 之后、turn-runtime 之前——每轮可能变化的状态文件。
 */
export function buildRuntimeMessages(
  context: AgentContextEntry,
): RuntimeChatMessage[] {
  return contextInjectionsToMessages(context.contextInjectionsByPosition.runtime)
}

/**
 * 上下文元信息部分（Skill Index）。精简后只含 skill 索引，跨轮稳定。
 */
function formatContextMeta(context: AgentContextEntry): string {
  return [
    "可见 Skill Index（仅摘要，未加载 Skill 详情）：",
    formatSkillIndex(context),
  ].join("\n")
}
