import type { NativeToolCall } from "./types"

export function finalizeStreamedToolCalls(
  accumulator: Map<number, { id: string; name: string; args: string }>,
): NativeToolCall[] {
  const calls: NativeToolCall[] = []
  const indices = [...accumulator.keys()].sort((a, b) => a - b)
  for (const index of indices) {
    const entry = accumulator.get(index)!
    let argumentsRecord: Record<string, unknown> = {}
    if (entry.args) {
      try {
        const parsed = JSON.parse(entry.args)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          argumentsRecord = parsed as Record<string, unknown>
        }
      } catch {
        // Leave empty arguments; runtime surfaces a structured error.
      }
    }
    calls.push({ id: entry.id, name: entry.name, arguments: argumentsRecord })
  }
  return calls
}

const DISPLAY_PROTOCOL_PATTERNS = [
  /<tsian-tool-calls>\s*[\s\S]*?\s*<\/tsian-tool-calls>/g,
  /<tsian-tool-call-records>\s*[\s\S]*?\s*<\/tsian-tool-call-records>/g,
  /<tsian-executed-tools>\s*[\s\S]*?\s*<\/tsian-executed-tools>/g,
  /<tsian-tool-observations>\s*[\s\S]*?\s*<\/tsian-tool-observations>/g,
  /<tsian-tool-protocol-error>\s*[\s\S]*?\s*<\/tsian-tool-protocol-error>/g,
]
const DISPLAY_THINK_PATTERNS = [
  /<thought>\s*[\s\S]*?\s*<\/thought>/g,
  /<thinking>\s*[\s\S]*?\s*<\/thinking>/g,
  /<think>\s*[\s\S]*?\s*<\/think>/g,
]

export function stripForDisplay(text: string): string {
  let result = text
  for (const pattern of DISPLAY_PROTOCOL_PATTERNS) {
    result = result.replace(pattern, "")
  }
  for (const pattern of DISPLAY_THINK_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result
}
