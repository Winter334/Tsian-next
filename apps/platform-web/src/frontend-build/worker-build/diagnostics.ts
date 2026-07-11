import type { ParserPlugin } from "@babel/parser"
import type { PartialMessage } from "esbuild-wasm"
import type { GlobTransformLoader } from "../glob-transform"

export interface DirectWorkerConstructorInput {
  code: string
  importer: string
  loader: GlobTransformLoader
  sourceLineOffset?: number
  sourceColumnOffset?: number
  diagnosticSource?: string
}

interface SourcePosition {
  line: number
  column: number
}

interface SourceLocation {
  start: SourcePosition
  end: SourcePosition
}

interface AstNode {
  type: string
  start?: number | null
  end?: number | null
  loc?: SourceLocation | null
  [key: string]: unknown
}

export class DirectWorkerConstructorError extends Error {
  readonly messageDetail: PartialMessage

  constructor(messageDetail: PartialMessage, cause?: unknown) {
    super(messageDetail.text)
    this.name = "DirectWorkerConstructorError"
    this.messageDetail = messageDetail
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        configurable: true,
      })
    }
  }
}

const IGNORED_AST_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "innerComments",
  "trailingComments",
  "comments",
  "tokens",
  "errors",
])

const DIRECT_WORKER_TEXT_PATTERN = /\bnew\b/
const WORKER_IMPORT_TEXT_PATTERN = /\?(?:[^"'`\s]*&)?(?:worker|sharedworker)\b/

let parserPromise: Promise<typeof import("@babel/parser")> | null = null

function parserPlugins(loader: GlobTransformLoader): ParserPlugin[] {
  const plugins: ParserPlugin[] = ["importMeta"]
  if (loader === "ts" || loader === "tsx") plugins.push("typescript")
  if (loader === "jsx" || loader === "tsx") plugins.push("jsx")
  return plugins
}

function isNode(value: unknown): value is AstNode {
  return Boolean(value && typeof value === "object" && typeof (value as AstNode).type === "string")
}

function walkNode(
  node: AstNode,
  parent: AstNode | null,
  visit: (node: AstNode, parent: AstNode | null) => void,
): void {
  visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (IGNORED_AST_KEYS.has(key)) continue
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) walkNode(child, node, visit)
      }
    } else if (isNode(value)) {
      walkNode(value, node, visit)
    }
  }
}

function unwrapParenthesized(node: unknown): unknown {
  let current = node
  while (isNode(current) && current.type === "ParenthesizedExpression") {
    current = current.expression
  }
  return current
}

function identifierName(node: unknown): string | undefined {
  const unwrapped = unwrapParenthesized(node)
  if (!isNode(unwrapped)) return undefined
  if (unwrapped.type === "Identifier" && typeof unwrapped.name === "string") return unwrapped.name
  if ((unwrapped.type === "StringLiteral" || unwrapped.type === "Literal") && typeof unwrapped.value === "string") return unwrapped.value
  return undefined
}

function isSupportedGlobalObject(node: unknown): boolean {
  const name = identifierName(node)
  return name === "window" || name === "globalThis" || name === "self"
}

function directWorkerConstructorName(node: unknown): "Worker" | "SharedWorker" | undefined {
  const unwrapped = unwrapParenthesized(node)
  const name = identifierName(unwrapped)
  if (name === "Worker" || name === "SharedWorker") return name
  if (!isNode(unwrapped) || unwrapped.type !== "MemberExpression") return undefined
  const property = identifierName(unwrapped.property)
  if (property !== "Worker" && property !== "SharedWorker") return undefined
  return isSupportedGlobalObject(unwrapped.object) ? property : undefined
}

function staticSourceValue(node: unknown): string | undefined {
  if (!isNode(node)) return undefined
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  return undefined
}

function nodeHasWorkerQuery(node: unknown): boolean {
  const source = staticSourceValue(node)
  if (!source) return false
  const query = source.includes("?") ? source.slice(source.indexOf("?") + 1).split("#")[0] : ""
  if (!query) return false
  const params = new URLSearchParams(query)
  return params.has("worker") || params.has("sharedworker")
}

function importHasOnlyDefaultSpecifier(node: AstNode): boolean {
  const specifiers = Array.isArray(node.specifiers) ? node.specifiers : []
  return specifiers.length === 1 && isNode(specifiers[0]) && specifiers[0].type === "ImportDefaultSpecifier"
}

function importHasUnsupportedMetadata(node: AstNode): boolean {
  const importKind = typeof node.importKind === "string" ? node.importKind : "value"
  if (importKind !== "value") return true
  const attributes = Array.isArray(node.attributes) ? node.attributes : []
  const assertions = Array.isArray(node.assertions) ? node.assertions : []
  return attributes.length > 0 || assertions.length > 0
}

function importExpressionSource(node: AstNode): unknown {
  if ("source" in node) return node.source
  const args = Array.isArray(node.arguments) ? node.arguments : []
  return args[0]
}

function locationFor(input: DirectWorkerConstructorInput, node?: AstNode): PartialMessage["location"] | undefined {
  if (!node?.loc) return undefined
  const lineOffset = input.sourceLineOffset ?? 0
  const columnOffset = input.sourceColumnOffset ?? 0
  const localLine = node.loc.start.line
  const line = localLine + lineOffset
  const column = node.loc.start.column + (localLine === 1 ? columnOffset : 0)
  const diagnosticSource = input.diagnosticSource ?? input.code
  const lineText = diagnosticSource.split(/\r?\n/)[line - 1] ?? input.code.split(/\r?\n/)[localLine - 1] ?? ""
  const length = typeof node.start === "number" && typeof node.end === "number"
    ? Math.max(1, node.end - node.start)
    : undefined
  return { file: input.importer, line, column, lineText, length }
}

function failDirectWorkerConstructor(
  input: DirectWorkerConstructorInput,
  node: AstNode | undefined,
  constructorName: "Worker" | "SharedWorker" | undefined,
  cause?: unknown,
): never {
  const location = locationFor(input, node)
  const position = location ? `${location.file}:${location.line}:${(location.column ?? 0) + 1}` : input.importer
  const api = constructorName ?? "Worker"
  throw new DirectWorkerConstructorError({
    text: `源码构建暂不支持直接 new ${api}(...)；请使用 import WorkerCtor from "./worker?worker" 后 new WorkerCtor(options)，且首版会强制 module worker: ${position}`,
    ...(location ? { location } : {}),
  }, cause)
}

function failWorkerImportSyntax(
  input: DirectWorkerConstructorInput,
  node: AstNode | undefined,
  reason: string,
): never {
  const location = locationFor(input, node)
  const position = location ? `${location.file}:${location.line}:${(location.column ?? 0) + 1}` : input.importer
  throw new DirectWorkerConstructorError({
    text: `Worker 导入语法暂不支持: ${position}: ${reason}；首版只支持 import WorkerCtor from "./x?worker" 默认构造器导入`,
    ...(location ? { location } : {}),
  })
}

function failWorkerSyntaxCheckParse(
  input: DirectWorkerConstructorInput,
  node: AstNode | undefined,
  error: unknown,
): never {
  const location = locationFor(input, node)
  const position = location ? `${location.file}:${location.line}:${(location.column ?? 0) + 1}` : input.importer
  const message = error instanceof Error ? error.message : String(error)
  throw new DirectWorkerConstructorError({
    text: `Worker 构造器/导入语法检查无法解析源码: ${position}: ${message}`,
    ...(location ? { location } : {}),
  }, error)
}

async function parseProgram(input: DirectWorkerConstructorInput): Promise<AstNode> {
  parserPromise ??= import("@babel/parser")
  const parser = await parserPromise
  try {
    return parser.parse(input.code, {
      sourceType: "unambiguous",
      plugins: parserPlugins(input.loader),
      ranges: true,
      createParenthesizedExpressions: true,
    }).program as unknown as AstNode
  } catch (error) {
    const parseError = error as Error & { loc?: { line?: number; column?: number } }
    const loc = parseError.loc
    const node: AstNode | undefined = loc && typeof loc.line === "number" && typeof loc.column === "number"
      ? {
          type: "ParseError",
          loc: {
            start: { line: loc.line, column: loc.column },
            end: { line: loc.line, column: loc.column },
          },
        }
      : undefined
    failWorkerSyntaxCheckParse(input, node, error)
  }
}

export async function assertNoDirectWorkerConstructors(
  input: DirectWorkerConstructorInput,
): Promise<void> {
  const mayContainDirectConstructor = input.code.includes("Worker") && DIRECT_WORKER_TEXT_PATTERN.test(input.code)
  const mayContainWorkerImport = input.code.includes("?worker")
    || input.code.includes("?sharedworker")
    || WORKER_IMPORT_TEXT_PATTERN.test(input.code)
  if (!mayContainDirectConstructor && !mayContainWorkerImport) return

  const program = await parseProgram(input)
  let directMatch: { node: AstNode; constructorName: "Worker" | "SharedWorker" } | undefined
  let importMatch: { node: AstNode; reason: string } | undefined
  walkNode(program, null, (node) => {
    if (!directMatch && node.type === "NewExpression") {
      const constructorName = directWorkerConstructorName(node.callee)
      if (constructorName) {
        directMatch = { node, constructorName }
      }
    }

    if (!importMatch && node.type === "ImportDeclaration" && nodeHasWorkerQuery(node.source)) {
      if (importHasUnsupportedMetadata(node)) {
        importMatch = { node, reason: "?worker 导入必须是普通值导入，不能使用 type import 或 import attributes" }
      } else if (!importHasOnlyDefaultSpecifier(node)) {
        importMatch = { node, reason: "?worker 导入必须且只能使用默认导入" }
      }
    }

    if (!importMatch
      && (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration")
      && nodeHasWorkerQuery(node.source)) {
      importMatch = { node, reason: "?worker re-export 不在首版支持范围" }
    }

    if (!importMatch && node.type === "ImportExpression" && nodeHasWorkerQuery(importExpressionSource(node))) {
      importMatch = { node, reason: "动态 import(...?worker) 不在首版支持范围" }
    }

    if (!importMatch && node.type === "CallExpression") {
      const callee = isNode(node.callee) ? node.callee : undefined
      if (callee?.type === "Import" && nodeHasWorkerQuery(importExpressionSource(node))) {
        importMatch = { node, reason: "动态 import(...?worker) 不在首版支持范围" }
      }
    }
  })
  if (directMatch) failDirectWorkerConstructor(input, directMatch.node, directMatch.constructorName)
  if (importMatch) failWorkerImportSyntax(input, importMatch.node, importMatch.reason)
}

export function toDirectWorkerConstructorMessage(
  error: unknown,
  fallback: Pick<DirectWorkerConstructorInput, "importer">,
): PartialMessage {
  if (error instanceof DirectWorkerConstructorError) {
    return error.messageDetail
  }
  return {
    text: `Worker 构造器检查失败: ${fallback.importer}: ${error instanceof Error ? error.message : String(error)}`,
  }
}
