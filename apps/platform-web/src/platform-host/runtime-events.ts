/**
 * Shared runtime event classification helpers for bridge-facing Agent Runtime
 * streams. Kept out of the barrel to avoid submodules importing index.ts.
 */
export function finishReasonToKind(finishReason: "stop" | "tool_calls"): "thought" | "final" {
  return finishReason === "tool_calls" ? "thought" : "final"
}
