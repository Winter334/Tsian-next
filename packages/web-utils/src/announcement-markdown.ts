import DOMPurify from "dompurify"
import { Marked, Renderer } from "marked"
import { markedHighlight } from "marked-highlight"
import hljs from "highlight.js/lib/core"
import json from "highlight.js/lib/languages/json"
import javascript from "highlight.js/lib/languages/javascript"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import css from "highlight.js/lib/languages/css"
import yaml from "highlight.js/lib/languages/yaml"
import markdown from "highlight.js/lib/languages/markdown"
import bash from "highlight.js/lib/languages/bash"
import plaintext from "highlight.js/lib/languages/plaintext"

function registerLanguage(name: string, language: Parameters<typeof hljs.registerLanguage>[1]) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language)
  }
}

registerLanguage("plaintext", plaintext)
registerLanguage("text", plaintext)
registerLanguage("json", json)
registerLanguage("javascript", javascript)
registerLanguage("js", javascript)
registerLanguage("typescript", typescript)
registerLanguage("ts", typescript)
registerLanguage("xml", xml)
registerLanguage("html", xml)
registerLanguage("css", css)
registerLanguage("yaml", yaml)
registerLanguage("yml", yaml)
registerLanguage("markdown", markdown)
registerLanguage("md", markdown)
registerLanguage("bash", bash)
registerLanguage("sh", bash)

const renderer = new Renderer()

renderer.html = (token: { text?: string; raw?: string }) => escapeHtml(token.text ?? token.raw ?? "")

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext"
      try {
        return hljs.highlight(code, { language }).value
      } catch {
        return escapeHtml(code)
      }
    },
  }),
)

marked.use({ renderer })
marked.setOptions({
  gfm: true,
  breaks: true,
})

export function renderAnnouncementMarkdown(content: string): string {
  const rawHtml = marked.parse(content, { async: false }) as string
  const sanitized = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  })
  return normalizeRenderedHtml(sanitized)
}

function normalizeRenderedHtml(html: string): string {
  const template = document.createElement("template")
  template.innerHTML = html
  normalizeRenderedLinks(template.content)
  normalizeRenderedLists(template.content)
  return template.innerHTML
}

function normalizeRenderedLinks(root: DocumentFragment): void {
  for (const link of root.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? ""
    const url = safeUrl(href)
    if (!url) {
      link.removeAttribute("href")
      link.removeAttribute("target")
      link.removeAttribute("rel")
      continue
    }

    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      if (url.origin !== window.location.origin || url.protocol === "mailto:") {
        link.setAttribute("target", "_blank")
        link.setAttribute("rel", "noreferrer noopener")
      }
    }
  }
}

function normalizeRenderedLists(root: DocumentFragment): void {
  for (const item of root.querySelectorAll("li")) {
    const parent = item.parentElement
    if (!parent) continue

    const marker = document.createElement("span")
    marker.className = "announcement-list-marker"
    marker.setAttribute("aria-hidden", "true")
    marker.textContent = listMarkerText(parent, item)
    item.insertBefore(marker, item.firstChild)
  }
}

function listMarkerText(parent: Element, item: Element): string {
  if (parent.tagName.toLowerCase() === "ol") {
    const start = Number.parseInt(parent.getAttribute("start") ?? "1", 10)
    const offset = Array.from(parent.children).filter((child) => child.tagName.toLowerCase() === "li").indexOf(item)
    return `${Number.isFinite(start) ? start + offset : offset + 1}.`
  }

  const depth = listDepth(parent)
  if (depth >= 3) return "▪"
  if (depth === 2) return "◦"
  return "•"
}

function listDepth(list: Element): number {
  let depth = 1
  let current = list.parentElement
  while (current) {
    if (current.tagName.toLowerCase() === "li" && current.parentElement?.tagName.toLowerCase() === "ul") {
      depth++
    }
    current = current.parentElement
  }
  return depth
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value, window.location.origin)
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url
    }
  } catch {
    // Invalid URLs are stripped below.
  }
  return null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
