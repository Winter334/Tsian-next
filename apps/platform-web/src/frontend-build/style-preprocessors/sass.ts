import type { Importer, Syntax } from "sass"
import type { StylePreprocessorInput, StylePreprocessorResult } from "./index"
import { stylePreprocessorError } from "./diagnostics"
import {
  assertStyleSourceIsText,
  canonicalStylePath,
  existingStyleCandidates,
  pickUniqueStyleCandidate,
  readStyleSource,
  stylePathToUrl,
  styleUrlToPath,
  StyleVfsError,
} from "./vfs"

let sassPromise: Promise<typeof import("sass")> | null = null

function loadSass(): Promise<typeof import("sass")> {
  if (!sassPromise) sassPromise = import("sass")
  return sassPromise
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash < 0 ? "" : path.slice(0, slash + 1)
}

function withPartial(path: string): string {
  return `${dirname(path)}_${basename(path)}`
}

function extension(path: string): ".scss" | ".sass" | ".css" | "" {
  const match = /\.(scss|sass|css)$/i.exec(basename(path))
  return match ? `.${match[1].toLowerCase()}` as ".scss" | ".sass" | ".css" : ""
}

function importOnly(path: string): string {
  const ext = extension(path)
  return ext ? `${path.slice(0, -ext.length)}.import${ext}` : path
}

function sassCandidateTiers(path: string, fromImport: boolean): string[][] {
  const ext = extension(path)
  if (ext === ".css") return [[path]]

  const hasExplicitSassExtension = ext === ".scss" || ext === ".sass"
  const directSass = hasExplicitSassExtension
    ? [path, withPartial(path)]
    : [
        `${path}.scss`,
        `${path}.sass`,
        withPartial(`${path}.scss`),
        withPartial(`${path}.sass`),
      ]
  const indexSass = hasExplicitSassExtension
    ? []
    : [
        `${path}/index.scss`,
        `${path}/index.sass`,
        `${path}/_index.scss`,
        `${path}/_index.sass`,
      ]

  const tiers: string[][] = []
  if (fromImport) {
    tiers.push(directSass.map(importOnly))
    if (indexSass.length > 0) tiers.push(indexSass.map(importOnly))
  }
  tiers.push(directSass)
  if (indexSass.length > 0) tiers.push(indexSass)

  // CSS is a fallback only after every Sass candidate tier is empty.
  if (!hasExplicitSassExtension) {
    tiers.push([`${path}.css`], [`${path}/index.css`])
  }
  return tiers
}

function resolveSassCandidate(
  input: StylePreprocessorInput,
  request: string,
  fromImport: boolean,
): string | undefined {
  const requestUrl = new URL(request)
  let unresolvedPath: string
  try {
    unresolvedPath = styleUrlToPath(requestUrl)
  } catch (error) {
    if (
      error instanceof StyleVfsError
      && error.kind === "outside-root"
      && requestUrl.protocol === "tsian-vfs:"
    ) {
      throw new StyleVfsError(
        "outside-root",
        request,
        `Sass import 越出 frontend/src/: ${request}`,
      )
    }
    throw error
  }
  for (const tier of sassCandidateTiers(unresolvedPath, fromImport)) {
    // A binary candidate is an invalid style source, not a missing candidate
    // that may be skipped in favor of a lower-precedence text file.
    for (const candidate of tier) {
      assertStyleSourceIsText(input.sources, candidate, request)
    }
    const match = pickUniqueStyleCandidate(
      request,
      existingStyleCandidates(input.sources, tier),
    )
    if (match) return match
  }
  return undefined
}

function syntaxFor(path: string): Syntax {
  const ext = extension(path)
  if (ext === ".sass") return "indented"
  if (ext === ".css") return "css"
  return "scss"
}

function sourceLine(source: string, zeroBasedLine: number): string {
  return source.split(/\r?\n/)[zeroBasedLine] ?? ""
}

function sourceLocation(
  input: StylePreprocessorInput,
  path: string,
  zeroBasedLine: number,
  zeroBasedColumn: number,
): { line: number; column: number; lineText: string } {
  const isEntry = path === canonicalStylePath(input.filename)
  if (!isEntry) {
    const source = input.sources.get(path)
    return {
      line: zeroBasedLine + 1,
      column: zeroBasedColumn,
      lineText: typeof source === "string" ? sourceLine(source, zeroBasedLine) : "",
    }
  }
  const lineOffset = input.sourceLineOffset ?? 0
  const line = zeroBasedLine + 1 + lineOffset
  const fullSource = input.sources.get(path)
  return {
    line,
    column: zeroBasedColumn + (zeroBasedLine === 0 ? input.sourceColumnOffset ?? 0 : 0),
    lineText: typeof fullSource === "string"
      ? sourceLine(fullSource, line - 1)
      : sourceLine(input.source, zeroBasedLine),
  }
}

function importRequestFromSpan(spanText: string | undefined): string | undefined {
  if (!spanText) return undefined
  return /@(use|forward|import)\s+(?:url\()?\s*["']([^"']+)["']/.exec(spanText)?.[2]
}

function isUnsupportedSassImport(request: string | undefined): request is string {
  return Boolean(request && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(request))
}

export async function compileSass(
  input: StylePreprocessorInput,
): Promise<StylePreprocessorResult> {
  const filename = canonicalStylePath(input.filename)
  const dependencies = new Set<string>()
  const requestByPath = new Map<string, string>()
  let failedImport: string | undefined
  const importer: Importer<"async"> = {
    canonicalize(url, context) {
      try {
        if (!url.startsWith("tsian-vfs:")) {
          throw new StyleVfsError(
            "invalid",
            url,
            `Sass import scheme 或 package import 不受支持: ${url}`,
          )
        }
        const candidate = resolveSassCandidate(input, url, context.fromImport)
        if (!candidate) {
          throw new StyleVfsError(
            "missing",
            url,
            `Sass import 未找到: ${url}`,
          )
        }
        requestByPath.set(candidate, url)
        return stylePathToUrl(candidate)
      } catch (error) {
        failedImport = url
        if (error instanceof StyleVfsError) throw error
        throw new StyleVfsError(
          "invalid",
          url,
          error instanceof Error ? error.message : String(error),
        )
      }
    },
    load(canonicalUrl) {
      const path = styleUrlToPath(canonicalUrl)
      const contents = readStyleSource(input.sources, path, requestByPath.get(path) ?? path)
      dependencies.add(path)
      return {
        contents,
        syntax: syntaxFor(path),
        sourceMapUrl: canonicalUrl,
      }
    },
  }

  try {
    const sass = await loadSass()
    const result = await sass.compileStringAsync(input.source, {
      syntax: input.language === "sass" ? "indented" : "scss",
      url: stylePathToUrl(filename),
      importer,
      sourceMap: false,
    })
    return {
      css: result.css,
      dependencies: [...dependencies],
    }
  } catch (error) {
    const sassError = error as {
      sassMessage?: string
      span?: {
        start?: { line?: number; column?: number }
        text?: string
        url?: URL
      }
    }
    let spanPath = filename
    if (sassError.span?.url?.protocol === "tsian-vfs:") {
      try {
        spanPath = styleUrlToPath(sassError.span.url)
      } catch {
        spanPath = filename
      }
    }
    const line = sassError.span?.start?.line
    const column = sassError.span?.start?.column
    const spanImport = importRequestFromSpan(sassError.span?.text)
    const missingImport = /^Sass import 未找到:/.test(sassError.sassMessage ?? "")
      ? /Sass import 未找到:\s*(.+)$/.exec(sassError.sassMessage ?? "")?.[1]
      : undefined
    const unsupportedImport = isUnsupportedSassImport(spanImport)
      ? spanImport
      : undefined
    const message = unsupportedImport
      ? `Sass import scheme、authority 或 package import 不受支持: ${unsupportedImport}`
      : sassError.sassMessage ?? (error instanceof Error ? error.message : String(error))
    throw stylePreprocessorError({
      language: input.language,
      filename,
      importPath: missingImport ?? spanImport ?? (
        spanPath === filename
          ? failedImport
          : requestByPath.get(spanPath)
      ),
      message,
      ...(typeof line === "number" && typeof column === "number"
        ? {
            location: {
              file: spanPath,
              ...sourceLocation(input, spanPath, line, column),
              length: sassError.span?.text?.length,
            },
          }
        : {}),
      cause: error,
    })
  }
}
