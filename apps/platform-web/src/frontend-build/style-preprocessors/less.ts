import type { StylePreprocessorInput, StylePreprocessorResult } from "./index"
import { stylePreprocessorError } from "./diagnostics"
import {
  assertStyleSourceIsText,
  canonicalStylePath,
  existingStyleCandidates,
  pickUniqueStyleCandidate,
  readStyleSource,
  resolveStylePath,
  styleDirectory,
  StyleVfsError,
} from "./vfs"

interface LessLoadOptions {
  ext?: string
  isPlugin?: boolean
}

interface LessLoadResult {
  filename: string
  contents: string
}

interface LessFileManager {
  supports(filename: string): boolean
  supportsSync(): boolean
  getPath(filename: string): string
  join(basePath: string, laterPath: string): string
  pathDiff(url: string, baseUrl: string): string
  isPathAbsolute(filename: string): boolean
  alwaysMakePathsAbsolute(): boolean
  loadFile(
    filename: string,
    currentDirectory?: string,
    options?: LessLoadOptions,
  ): Promise<LessLoadResult>
}

interface LessRenderError extends Error {
  filename?: string
  line?: number | null
  column?: number | null
  extract?: string[]
  request?: string
}

interface LessRenderResult {
  css: string
  imports?: string[]
}

interface LessApi {
  PluginLoader: new (less: LessApi) => unknown
  render(source: string, options: Record<string, unknown>): Promise<LessRenderResult>
}

type LessFactory = (
  environment: Record<string, unknown>,
  fileManagers: LessFileManager[],
  version: string,
) => LessApi

let lessFactoryPromise: Promise<LessFactory> | null = null

function loadLessFactory(): Promise<LessFactory> {
  if (!lessFactoryPromise) {
    lessFactoryPromise = import("less/lib/less/index.js")
      .then((module) => module.default as LessFactory)
  }
  return lessFactoryPromise
}

class DisabledLessPluginLoader {
  constructor(_less: LessApi) {}

  loadPlugin(filename: string): Promise<never> {
    return Promise.reject(new Error(`Less @plugin 不受支持: ${filename}`))
  }

  evalPlugin(): never {
    throw new Error("Less @plugin 不受支持")
  }
}

function relativeDirectory(fromDirectory: string, toDirectory: string): string {
  const from = fromDirectory.replace(/\/$/, "").split("/").filter(Boolean)
  const to = toDirectory.replace(/\/$/, "").split("/").filter(Boolean)
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++
  return `${"../".repeat(from.length - shared)}${to.slice(shared).join("/")}${to.length > shared ? "/" : ""}`
}

function createFileManager(
  input: StylePreprocessorInput,
  dependencies: Set<string>,
  policyErrors: StyleVfsError[],
  onResolved: (request: string, resolvedPath: string) => void,
): LessFileManager {
  return {
    // This is the only registered file manager. Claim every attempted import so
    // Less can never fall through to XHR or another ambient loader.
    supports() { return true },
    supportsSync() { return false },
    getPath(filename) { return styleDirectory(filename) },
    join(basePath, laterPath) {
      if (!basePath) return laterPath
      const containingPath = `${basePath.replace(/\/$/, "")}/__containing__.less`
      return resolveStylePath(laterPath, containingPath)
    },
    pathDiff(url, baseUrl) {
      // Less passes canonical directories here. Return the imported directory
      // relative to the entry directory so rewriteUrls:"all" rebases nested
      // url(...) references back to the entry stylesheet's resolve context.
      return relativeDirectory(baseUrl, url)
    },
    isPathAbsolute(filename) {
      return filename.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(filename)
    },
    alwaysMakePathsAbsolute() { return false },
    async loadFile(filename, currentDirectory = "", options = {}) {
      try {
        if (options.isPlugin || options.ext === ".js") {
          throw new StyleVfsError(
            "invalid",
            filename,
            `Less @plugin 不受支持: ${JSON.stringify(filename)}`,
          )
        }
        const containingPath = currentDirectory
          ? `${currentDirectory.replace(/\/$/, "")}/__containing__.less`
          : input.filename
        const resolved = resolveStylePath(filename, containingPath)
        const hasExplicitExtension = /\.[^/]+$/.test(resolved)
        const candidates = hasExplicitExtension
          ? [resolved]
          : [`${resolved}.less`]
        for (const candidate of candidates) {
          assertStyleSourceIsText(input.sources, candidate, filename)
        }
        const path = pickUniqueStyleCandidate(
          filename,
          existingStyleCandidates(input.sources, candidates),
        )
        if (!path) {
          throw new StyleVfsError(
            "missing",
            filename,
            `Less import 未找到 ${JSON.stringify(filename)}（从 ${currentDirectory || input.filename}）`,
          )
        }
        const contents = readStyleSource(input.sources, path, filename)
        dependencies.add(path)
        onResolved(filename, path)
        return { filename: path, contents }
      } catch (error) {
        if (error instanceof StyleVfsError && error.kind !== "missing") {
          policyErrors.push(error)
        }
        throw error
      }
    },
  }
}

function sourceLine(source: string, oneBasedLine: number): string {
  return source.split(/\r?\n/)[oneBasedLine - 1] ?? ""
}

function lessImportRequestAtError(error: LessRenderError): string | undefined {
  const sourceLine = error.extract?.[1]
  if (!sourceLine) return undefined
  return /@import\s+(?:\([^)]*\)\s*)?(?:url\()?\s*["']([^"']+)["']/.exec(sourceLine)?.[1]
}

function sourceLocation(
  input: StylePreprocessorInput,
  path: string,
  oneBasedLine: number,
  zeroBasedColumn: number,
): { line: number; column: number; lineText: string } {
  const isEntry = path === canonicalStylePath(input.filename)
  if (!isEntry) {
    const source = input.sources.get(path)
    return {
      line: oneBasedLine,
      column: zeroBasedColumn,
      lineText: typeof source === "string" ? sourceLine(source, oneBasedLine) : "",
    }
  }
  const line = oneBasedLine + (input.sourceLineOffset ?? 0)
  const fullSource = input.sources.get(path)
  return {
    line,
    column: zeroBasedColumn + (oneBasedLine === 1 ? input.sourceColumnOffset ?? 0 : 0),
    lineText: typeof fullSource === "string"
      ? sourceLine(fullSource, line)
      : sourceLine(input.source, oneBasedLine),
  }
}

export async function compileLess(
  input: StylePreprocessorInput,
): Promise<StylePreprocessorResult> {
  const filename = canonicalStylePath(input.filename)
  const dependencies = new Set<string>()
  const policyErrors: StyleVfsError[] = []
  const requestByPath = new Map<string, string>()
  const fileManager = createFileManager(
    input,
    dependencies,
    policyErrors,
    (request, resolvedPath) => requestByPath.set(resolvedPath, request),
  )

  try {
    const createLess = await loadLessFactory()
    const less = createLess({}, [fileManager], "4.6.7")
    less.PluginLoader = DisabledLessPluginLoader
    const result = await less.render(input.source, {
      filename,
      rewriteUrls: "all",
      rootpath: "",
      urlArgs: "",
      javascriptEnabled: false,
      disablePluginRule: true,
      sourceMap: false,
      syncImport: false,
    })
    if (policyErrors.length > 0) throw policyErrors[0]
    const compilerImports = result.imports ?? []
    return {
      css: result.css,
      dependencies: [
        ...new Set([
          ...dependencies,
          ...compilerImports.filter((path) => input.sources.has(path)),
        ]),
      ],
    }
  } catch (error) {
    const policyError = policyErrors[0]
    const lessError = (policyError ?? error) as LessRenderError
    let errorFilename = filename
    if (lessError.filename) {
      try {
        errorFilename = canonicalStylePath(lessError.filename)
      } catch {
        errorFilename = filename
      }
    }
    const line = lessError.line
    const column = lessError.column
    const missingImport = /^Less import 未找到/.test(lessError.message ?? "")
      ? /Less import 未找到\s+"([^"]+)"/.exec(lessError.message ?? "")?.[1]
      : undefined
    throw stylePreprocessorError({
      language: "less",
      filename,
      importPath: policyError?.request
        ?? missingImport
        ?? lessImportRequestAtError(lessError)
        ?? requestByPath.get(errorFilename),
      message: lessError.message ?? String(lessError),
      ...(typeof line === "number" && typeof column === "number"
        ? {
            location: {
              file: errorFilename,
              ...sourceLocation(input, errorFilename, line, column),
            },
          }
        : {}),
      cause: error,
    })
  }
}
