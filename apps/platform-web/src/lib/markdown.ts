import { Marked } from "marked"
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

// Register only the languages the assistant is likely to emit, to keep bundle small.
hljs.registerLanguage("plaintext", plaintext)
hljs.registerLanguage("text", plaintext)
hljs.registerLanguage("json", json)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("js", javascript)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("ts", typescript)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("html", xml)
hljs.registerLanguage("css", css)
hljs.registerLanguage("yaml", yaml)
hljs.registerLanguage("yml", yaml)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("md", markdown)
hljs.registerLanguage("bash", bash)
hljs.registerLanguage("sh", bash)

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext"
      try {
        return hljs.highlight(code, { language }).value
      } catch {
        return code
      }
    },
  }),
)

marked.setOptions({
  gfm: true,
  breaks: true,
})

/** Render assistant markdown content into HTML. */
export function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string
}
