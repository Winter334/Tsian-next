import type { AssistantTimelineNode } from "@/composables/useAssistantTimeline"

export type AssistantProcessStatus = "idle" | "running" | "success" | "failed"

export interface AssistantProcessSummary {
  toolCount: number
  status: AssistantProcessStatus
}

export type AssistantContentSegment =
  | { kind: "text"; text: string }
  | { kind: "thought"; text: string }

type ToolNode = Extract<AssistantTimelineNode, { type: "tool" }>

export function summarizeAssistantProcess(
  timeline: readonly AssistantTimelineNode[],
): AssistantProcessSummary {
  const tools = timeline.filter((node): node is ToolNode => node.type === "tool")
  if (tools.length === 0) {
    return { toolCount: 0, status: "idle" }
  }
  if (tools.some((tool) => tool.status === "loading" || tool.status === "running")) {
    return { toolCount: tools.length, status: "running" }
  }
  if (tools.some((tool) => tool.status === "failed")) {
    return { toolCount: tools.length, status: "failed" }
  }
  return { toolCount: tools.length, status: "success" }
}

export function assistantToolLabel(tool: ToolNode): string {
  return tool.displayName ?? tool.name
}

export function assistantToolStatusLabel(
  status: ToolNode["status"],
): "运行中" | "成功" | "失败" {
  if (status === "success") return "成功"
  if (status === "failed") return "失败"
  return "运行中"
}

export function assistantProcessStatusLabel(
  status: AssistantProcessStatus,
): "运行中" | "成功" | "失败" | "" {
  if (status === "idle") return ""
  return assistantToolStatusLabel(status)
}

export function assistantContentSegments(content: string): AssistantContentSegment[] {
  const segments: AssistantContentSegment[] = []
  const pattern = /<think>([\s\S]*?)(?:<\/think>|$)/gi
  let cursor = 0
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      const text = content.slice(cursor, index).trim()
      if (text) segments.push({ kind: "text", text })
    }
    const thought = (match[1] ?? "").trim()
    if (thought) segments.push({ kind: "thought", text: thought })
    cursor = index + match[0].length
  }
  if (cursor < content.length) {
    const text = content.slice(cursor).trim()
    if (text) segments.push({ kind: "text", text })
  }
  return segments.length > 0 ? segments : [{ kind: "text", text: content }]
}
