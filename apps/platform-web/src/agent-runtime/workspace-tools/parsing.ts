const THINK_BLOCK_PATTERNS = [
  /<thought>\s*([\s\S]*?)\s*<\/thought>/g,
  /<thinking>\s*([\s\S]*?)\s*<\/thinking>/g,
  /<think>\s*([\s\S]*?)\s*<\/think>/g,
]

/** Strip closed think blocks from text. Used at round end to clean content
 *  fed back to the model (prevent chain-of-thought from polluting context). */
export function stripThinkBlocks(text: string): string {
  let result = text
  for (const pattern of THINK_BLOCK_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result.trim()
}

/** Extract the inner content of closed think blocks. Used to collect thought
 *  processNodes (parallel to native mode's reasoning stream → thought node). */
export function extractThinkBlocks(text: string): string[] {
  const blocks: string[] = []
  for (const pattern of THINK_BLOCK_PATTERNS) {
    const reset = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = reset.exec(text)) !== null) {
      const inner = (match[1] ?? "").trim()
      if (inner) {
        blocks.push(inner)
      }
    }
  }
  return blocks
}
