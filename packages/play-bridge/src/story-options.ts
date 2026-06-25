// @tsian/play-bridge — 剧情选项块解析
//
// 与 host 侧 extractStoryOptions 同语义的纯解析函数,供前端流式渲染时实时解析用.
// 前端不依赖 platform-web 包,所以这里独立一份(协议层提供,表现层 import).
//
// master agent 在正文末尾用 [[选项]]...[[/选项]] 标记剧情选项,块内用 markdown
// 无序列表(- )分隔每个选项,长选项可续行(非 - 开头的非空行拼入上一选项).
// 前端在 turn 结束时调用 parseStoryOptions:
//   - 用 cleanText 替换流式累积的原始正文(剥离块,显示干净剧情)
//   - 用 options[] 渲染选项按钮(玩家点选 = 填入输入框发送 = 正常新 turn)

/** 选项块解析结果. */
export interface ParsedStoryOptions {
  /** 提取出的选项文本(每项一个,trim,续行保留换行). */
  options: string[]
  /** 剥离所有选项块后的正文(多换行收敛为最多两个换行). */
  cleanText: string
}

// 匹配所有 [[选项]]...[[/选项]] 块(非贪婪,跨行).
const STORY_OPTIONS_BLOCK_RE = /\[\[选项\]\]([\s\S]*?)\[\[\/选项\]\]/g
// 块内选项起点:- 开头(markdown 无序列表).
const OPTION_LINE_RE = /^\s*[-]\s+/

/**
 * 解析单个选项块内容为选项数组.
 * - 开头行 = 新选项(去掉 - 前缀);非 - 非空行 = 上一选项续行(拼入,保留换行);空行忽略.
 */
function parseBlockContent(blockContent: string): string[] {
  const lines = blockContent.split("\n")
  const options: string[] = []
  for (const line of lines) {
    if (line.trim() === "") continue
    if (OPTION_LINE_RE.test(line)) {
      options.push(line.replace(OPTION_LINE_RE, "").trim())
    } else if (options.length > 0) {
      // 续行:拼入上一选项,保留换行
      options[options.length - 1] += "\n" + line.trim()
    }
    // 块内 - 之前的孤立行(无上一选项)忽略
  }
  return options
}

/**
 * 从正文中提取剧情选项并剥离选项块.
 * 无块 → { options: [], cleanText: 原文 }
 * 有块但块内无有效选项 → options 为空,仍剥离块(清掉空标记).
 */
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
  // 收敛多换行:3+ 个连续换行 → 2 个
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n")
  // 末尾多余空白收敛
  cleanText = cleanText.replace(/\s+$/, "\n")
  return { options, cleanText }
}
