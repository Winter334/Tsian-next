import type { PartialMessage } from "esbuild-wasm"
import type { StylePreprocessorLanguage } from "./index"

export interface StylePreprocessorLocation {
  file: string
  line: number
  column: number
  lineText?: string
  length?: number
}

interface StylePreprocessorErrorInput {
  language: StylePreprocessorLanguage
  filename: string
  message: string
  importPath?: string
  location?: StylePreprocessorLocation
  cause?: unknown
}

function languageLabel(language: StylePreprocessorLanguage): string {
  switch (language) {
    case "scss":
      return "SCSS"
    case "sass":
      return "Sass"
    case "less":
      return "Less"
  }
}

export class StylePreprocessorError extends Error {
  readonly language: StylePreprocessorLanguage
  readonly filename: string
  readonly importPath?: string
  readonly location?: StylePreprocessorLocation

  constructor(input: StylePreprocessorErrorInput) {
    const locationText = input.location
      ? ` (${input.location.file}:${input.location.line}:${input.location.column + 1})`
      : ""
    const importText = input.importPath
      ? `，import ${JSON.stringify(input.importPath)}`
      : ""
    super(
      `${languageLabel(input.language)} 预处理失败: ${input.filename}${importText}${locationText}: ${input.message}`,
    )
    if (input.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: input.cause,
        configurable: true,
      })
    }
    this.name = "StylePreprocessorError"
    this.language = input.language
    this.filename = input.filename
    this.importPath = input.importPath
    this.location = input.location
  }
}

export function stylePreprocessorError(input: StylePreprocessorErrorInput): StylePreprocessorError {
  return new StylePreprocessorError(input)
}

export function toStylePreprocessorMessage(
  error: unknown,
  fallback: Pick<StylePreprocessorErrorInput, "language" | "filename">,
): PartialMessage {
  const normalized = error instanceof StylePreprocessorError
    ? error
    : stylePreprocessorError({
        ...fallback,
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      })

  return {
    text: normalized.message,
    ...(normalized.location
      ? {
          location: {
            file: normalized.location.file,
            line: normalized.location.line,
            column: normalized.location.column,
            lineText: normalized.location.lineText ?? "",
            length: normalized.location.length,
          },
        }
      : {}),
  }
}
