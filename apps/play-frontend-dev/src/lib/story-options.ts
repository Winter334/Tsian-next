// 默认 play frontend — 剧情选项块解析
//
// 这是默认游戏卡/默认前端的显示约定，不是平台 runtime/host 契约。
// 平台不再为新 turn 解析或剥离 [[选项]] 块；默认前端在显示层自行解析。
//
// master agent 可在正文末尾用 [[选项]]...[[/选项]] 标记行动选项，块内用 markdown
// 列表(- / * / + 无序 或 1. 数字有序)分隔每个选项，长选项可续行(非列表开头的
// 非空行拼入上一选项)。无列表前缀的非空行兜底当作独立选项。

/** 选项块解析结果。 */
export interface ParsedStoryOptions {
  /** 提取出的选项文本(每项一个,trim,续行保留换行)。 */
  options: string[]
  /** 剥离所有选项块后的正文(多换行收敛为最多两个换行)。 */
  cleanText: string
}

// 匹配所有 [[选项]]...[[/选项]] 块(非贪婪,跨行)。
const STORY_OPTIONS_BLOCK_RE = /\[\[选项\]\]([\s\S]*?)\[\[\/选项\]\]/g
// 块内选项起点:markdown 无序(- * +，含 -. -) 变体)或有序(数字 + . )列表前缀。
const OPTION_LINE_RE = /^\s*[-*+][\s.)]+\s*|^\s*\d+\.\s+/

function parseBlockContent(blockContent: string): string[] {
  const lines = blockContent.split("\n").map((line) => line.trim()).filter((line) => line !== "")
  const hasListPrefix = lines.some((line) => OPTION_LINE_RE.test(line))
  const options: string[] = []
  for (const trimmed of lines) {
    const prefixMatch = trimmed.match(OPTION_LINE_RE)
    if (hasListPrefix) {
      if (prefixMatch) {
        options.push(trimmed.slice(prefixMatch[0].length).trim())
      } else if (options.length > 0) {
        options[options.length - 1] += "\n" + trimmed
      }
    } else {
      options.push(trimmed)
    }
  }
  return options
}

/** 从正文中提取剧情选项并剥离选项块。 */
export function parseStoryOptions(text: string): ParsedStoryOptions {
  const options: string[] = []
  let hasBlock = false
  let match: RegExpExecArray | null
  const re = new RegExp(STORY_OPTIONS_BLOCK_RE.source, "g")
  while ((match = re.exec(text)) !== null) {
    hasBlock = true
    options.push(...parseBlockContent(match[1]))
  }
  let cleanText = text
  if (hasBlock) {
    cleanText = text.replace(STORY_OPTIONS_BLOCK_RE, "")
  }
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n")
  cleanText = cleanText.replace(/\s+$/, "\n")
  return { options, cleanText }
}
