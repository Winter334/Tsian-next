export type WorkspaceStyleSourceContent = string | Uint8Array

export type StylePreprocessorLanguage = "scss" | "sass" | "less"

export interface StylePreprocessorInput {
  language: StylePreprocessorLanguage
  source: string
  filename: string
  sources: Map<string, WorkspaceStyleSourceContent>
  /** Number of source lines preceding an inline source such as a Vue style block. */
  sourceLineOffset?: number
  /** Zero-based column offset when an inline source starts mid-line. */
  sourceColumnOffset?: number
}

export interface StylePreprocessorResult {
  css: string
  dependencies: string[]
  sourceMap?: unknown
}

export async function compileStylePreprocessor(
  input: StylePreprocessorInput,
): Promise<StylePreprocessorResult> {
  if (typeof input.source !== "string") {
    throw new TypeError(`${input.language} 样式源码必须是文本: ${input.filename}`)
  }
  switch (input.language) {
    case "scss":
    case "sass": {
      const { compileSass } = await import("./sass")
      return compileSass(input)
    }
    case "less": {
      const { compileLess } = await import("./less")
      return compileLess(input)
    }
  }
}

export { StylePreprocessorError, toStylePreprocessorMessage } from "./diagnostics"
