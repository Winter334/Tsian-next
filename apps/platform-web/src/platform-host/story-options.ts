// 剧情选项块解析与剥离.
//
// master agent 在正文末尾用 [[选项]]...[[/选项]] 标记剧情选项,块内用 markdown
// 列表(- / * / + 无序 或 1. 数字有序)分隔每个选项,长选项可续行(非列表开头的
// 非空行拼入上一选项).无列表前缀的非空行兜底当作独立选项(AI 不按格式输出时不丢).
// host 侧 turn 收尾时调用 extractStoryOptions:
//   - 提取 options[](给前端渲染按钮)
//   - 剥离选项块得到 cleanText(存入 snapshot/turn 文件/context.json,agent 上下文干净)
//
// 外层 [[选项]]...[[/选项]] 是类 BBCode 配对标记,避开 markdown [text](url)
// 单方括号链接冲突;内层复用 markdown 列表,AI 生成最可靠且流式可读.

/** 选项块解析结果. */
export interface StoryOptions {
  /** 提取出的选项文本(每项一个,trim,续行保留换行). */
  options: string[]
  /** 剥离所有选项块后的正文(多换行收敛为最多两个换行). */
  cleanText: string
}

// 匹配所有 [[选项]]...[[/选项]] 块(非贪婪,跨行).
const STORY_OPTIONS_BLOCK_RE = /\[\[选项\]\]([\s\S]*?)\[\[\/选项\]\]/g
// 块内选项起点:markdown 无序(- * +，含 -. -) 变体)或有序(数字 + . )列表前缀.
const OPTION_LINE_RE = /^\s*[-*+][\s.)]+\s*|^\s*\d+\.\s+/

/**
 * 解析单个选项块内容为选项数组.
 * - 有列表前缀行(- * + 或 1.) → 每个前缀行一个选项,非前缀非空行续行拼入上一选项.
 * - 块内完全无列表前缀行 → 兜底:每个非空行当独立选项(避免 AI 不按格式输出时丢失).
 * - 空行忽略.
 */
function parseBlockContent(blockContent: string): string[] {
  const lines = blockContent.split("\n").map((line) => line.trim()).filter((line) => line !== "")
  // 先扫描块内是否有任何列表前缀行,决定走"列表模式"还是"纯文本兜底模式".
  const hasListPrefix = lines.some((line) => OPTION_LINE_RE.test(line))
  const options: string[] = []
  for (const trimmed of lines) {
    const prefixMatch = trimmed.match(OPTION_LINE_RE)
    if (hasListPrefix) {
      if (prefixMatch) {
        options.push(trimmed.slice(prefixMatch[0].length).trim())
      } else if (options.length > 0) {
        // 续行:拼入上一选项,保留换行
        options[options.length - 1] += "\n" + trimmed
      }
      // 列表模式下,列表前的孤立行(无上一选项)忽略(如"你可以选择："标题)
    } else {
      // 纯文本兜底模式:每行一个独立选项
      options.push(trimmed)
    }
  }
  return options
}

/**
 * 从正文中提取剧情选项并剥离选项块.
 * 无块 → { options: [], cleanText: 原文 }
 * 有块但块内无有效选项 → options 为空,仍剥离块(清掉空标记).
 */
export function extractStoryOptions(text: string): StoryOptions {
  const options: string[] = []
  let cleanText = text
  let match: RegExpExecArray | null
  // 正则全局匹配需先 clone(避免 lastIndex 状态污染)
  const re = new RegExp(STORY_OPTIONS_BLOCK_RE.source, "g")
  while ((match = re.exec(text)) !== null) {
    options.push(...parseBlockContent(match[1]))
  }
  if (options.length > 0 || re.lastIndex > 0) {
    // 有块(无论是否提取到选项)都剥离
    cleanText = text.replace(STORY_OPTIONS_BLOCK_RE, "")
  }
  // 收敛多换行:3+ 个连续换行 → 2 个
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n")
  // 末尾多余空白收敛
  cleanText = cleanText.replace(/\s+$/, "\n")
  return { options, cleanText }
}
