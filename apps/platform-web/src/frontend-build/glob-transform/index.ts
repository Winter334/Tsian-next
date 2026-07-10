import type { Loader, PartialMessage } from "esbuild-wasm"

export type GlobTransformLoader = Extract<Loader, "js" | "jsx" | "ts" | "tsx">

export interface GlobTransformInput {
  code: string
  importer: string
  loader: GlobTransformLoader
  sources: Map<string, string | Uint8Array>
  sourceLineOffset?: number
  sourceColumnOffset?: number
  diagnosticSource?: string
  bindingPrefix?: string
}

export interface GlobTransformResult {
  code: string
  changed: boolean
}

export class ImportMetaGlobError extends Error {
  readonly messageDetail: PartialMessage

  constructor(messageDetail: PartialMessage, cause?: unknown) {
    super(messageDetail.text)
    this.name = "ImportMetaGlobError"
    this.messageDetail = messageDetail
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        configurable: true,
      })
    }
  }
}

let transformPromise: Promise<typeof import("./transform")> | null = null

const IMPORT_META_TOKEN_PATTERN = /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\.(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*meta\b/

export async function transformImportMetaGlob(
  input: GlobTransformInput,
): Promise<GlobTransformResult> {
  const mayContainGlob = input.code.includes("glob") && IMPORT_META_TOKEN_PATTERN.test(input.code)
  if (!mayContainGlob) {
    return { code: input.code, changed: false }
  }
  transformPromise ??= import("./transform")
  return (await transformPromise).transformImportMetaGlob(input)
}

export function toImportMetaGlobMessage(
  error: unknown,
  fallback: Pick<GlobTransformInput, "importer">,
): PartialMessage {
  if (error instanceof ImportMetaGlobError) {
    return error.messageDetail
  }
  return {
    text: `import.meta.glob 转换失败: ${fallback.importer}: ${error instanceof Error ? error.message : String(error)}`,
  }
}
