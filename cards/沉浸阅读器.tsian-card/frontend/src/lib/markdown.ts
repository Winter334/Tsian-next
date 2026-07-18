import { marked } from "marked"

/**
 * markdown.ts — marked 配置（烛火书卷风格渲染）。
 *
 * prd 屏3：标题 Cinzel --ember-bright / 引用 --ember 左条 / 代码 --void-deep + --ember 边 mono。
 * 用 marked renderer 自定义这几类元素的 HTML class，scoped 样式在 NarrativeMessage.vue 里匹配。
 */

const renderer = new marked.Renderer()

// 标题：Cinzel 琥珀
renderer.heading = ({ tokens, depth }: { tokens: any[]; depth: number }) => {
  const text = tokens.map((t) => t.raw ?? "").join("")
  return `<h${depth} class="md-heading">${text}</h${depth}>`
}

// 引用：ember 左条
renderer.blockquote = ({ tokens }: { tokens: any[] }) => {
  const text = tokens.map((t) => t.raw ?? "").join("")
  return `<blockquote class="md-quote">${text}</blockquote>`
}

// 代码块：void-deep + ember 边 mono
renderer.code = ({ text }: { text: string }) => {
  return `<pre class="md-code"><code>${escapeHtml(text)}</code></pre>`
}

// 行内代码
renderer.codespan = ({ text }: { text: string }) => {
  return `<code class="md-codespan">${escapeHtml(text)}</code>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

marked.use({ renderer })

/** 渲染 markdown 为 HTML（同步）。 */
export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string
}
