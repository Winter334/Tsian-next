import { parse, type ParserPlugin } from "@babel/parser"
import MagicString from "magic-string"
import picomatch from "picomatch/posix"
import {
  ImportMetaGlobError,
  type GlobTransformInput,
  type GlobTransformResult,
} from "./index"
import { GlobPathError, globMatchFor, resolveGlobPattern, type GlobMatch } from "./path"

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

interface GlobCall {
  node: AstNode
  eager: boolean
  matches: GlobMatch[]
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

function parserPlugins(loader: GlobTransformInput["loader"]): ParserPlugin[] {
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

function isIdentifier(node: unknown, name: string): boolean {
  return isNode(node) && node.type === "Identifier" && node.name === name
}

function isImportMeta(node: unknown): node is AstNode {
  return isNode(node)
    && node.type === "MetaProperty"
    && isIdentifier(node.meta, "import")
    && isIdentifier(node.property, "meta")
}

function isParenthesizedImportMeta(node: unknown): boolean {
  return isNode(node)
    && node.type === "ParenthesizedExpression"
    && isImportMeta(node.expression)
}

function isGlobProperty(node: unknown): boolean {
  if (!isNode(node)) return false
  if (node.type === "Identifier" || node.type === "StringLiteral" || node.type === "Literal") {
    return node.name === "glob" || node.value === "glob"
  }
  if (node.type === "TemplateLiteral") {
    const expressions = Array.isArray(node.expressions) ? node.expressions : []
    const quasis = Array.isArray(node.quasis) ? node.quasis : []
    if (expressions.length !== 0 || quasis.length !== 1 || !isNode(quasis[0])) return false
    const value = quasis[0].value
    if (!value || typeof value !== "object") return false
    return (value as { cooked?: unknown }).cooked === "glob"
      || (value as { raw?: unknown }).raw === "glob"
  }
  return false
}

function isDirectGlobMember(node: unknown): node is AstNode {
  return isNode(node)
    && node.type === "MemberExpression"
    && node.computed === false
    && isImportMeta(node.object)
    && isIdentifier(node.property, "glob")
}

function isAnyGlobMember(node: unknown): node is AstNode {
  if (!isNode(node) || (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression")) {
    return false
  }
  if (!isImportMeta(node.object) && !isParenthesizedImportMeta(node.object)) return false
  return isGlobProperty(node.property)
}

function objectPatternExtractsGlob(node: unknown): boolean {
  if (!isNode(node) || node.type !== "ObjectPattern" || !Array.isArray(node.properties)) return false
  return node.properties.some((property) => {
    if (!isNode(property) || property.type !== "ObjectProperty") return false
    return isGlobProperty(property.key)
  })
}

function isImportMetaGlobExtraction(node: AstNode, parent: AstNode | null): boolean {
  if (!isImportMeta(node)) return false
  if (parent?.type === "VariableDeclarator" && parent.init === node) {
    return objectPatternExtractsGlob(parent.id)
  }
  if (parent?.type === "AssignmentExpression" && parent.right === node) {
    return objectPatternExtractsGlob(parent.left)
  }
  return false
}

function locationFor(input: GlobTransformInput, node?: AstNode): {
  file: string
  line: number
  column: number
  lineText: string
  length?: number
} | undefined {
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

function fail(
  input: GlobTransformInput,
  node: AstNode | undefined,
  reason: string,
  cause?: unknown,
): never {
  const location = locationFor(input, node)
  const position = location ? `${location.file}:${location.line}:${location.column + 1}` : input.importer
  throw new ImportMetaGlobError({
    text: `import.meta.glob 转换失败: ${position}: ${reason}`,
    ...(location ? { location } : {}),
  }, cause)
}

function stringPattern(input: GlobTransformInput, node: AstNode | undefined): string {
  if (!node) fail(input, node, "缺少静态 pattern")
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value
  if (node.type === "TemplateLiteral") {
    const expressions = Array.isArray(node.expressions) ? node.expressions : []
    const quasis = Array.isArray(node.quasis) ? node.quasis : []
    if (expressions.length === 0 && quasis.length === 1) {
      const value = isNode(quasis[0]) ? quasis[0].value : undefined
      if (value && typeof value === "object") {
        const cooked = (value as { cooked?: unknown }).cooked
        const raw = (value as { raw?: unknown }).raw
        if (typeof cooked === "string") return cooked
        if (typeof raw === "string") return raw
      }
    }
  }
  fail(input, node, "pattern 必须是单个静态字符串或无插值 template literal；变量、数组和动态表达式不受支持")
}

function eagerOption(input: GlobTransformInput, node: AstNode | undefined): boolean {
  if (!node) return false
  if (node.type !== "ObjectExpression") {
    fail(input, node, "options 必须是静态对象，且只允许 boolean eager")
  }
  const properties = Array.isArray(node.properties) ? node.properties : []
  let eager: boolean | undefined
  for (const property of properties) {
    if (!isNode(property)) continue
    if (property.type === "SpreadElement") fail(input, property, "options spread 不受支持")
    if (property.type === "ObjectMethod" || property.method === true) {
      fail(input, property, "options method 不受支持")
    }
    if (property.type !== "ObjectProperty" && property.type !== "Property") {
      fail(input, property, "options 只能包含静态 eager 属性")
    }
    if (property.computed === true) fail(input, property, "computed option key 不受支持")
    if (property.shorthand === true) fail(input, property, "shorthand option 不受支持")

    const key = isNode(property.key)
      ? property.key.type === "Identifier"
        ? property.key.name
        : property.key.type === "StringLiteral"
          ? property.key.value
          : undefined
      : undefined
    if (key !== "eager") {
      fail(input, property, `未知 option ${JSON.stringify(key ?? "<dynamic>")}；首版只支持 eager`)
    }
    if (eager !== undefined) fail(input, property, "duplicate eager option 不受支持")
    if (!isNode(property.value) || property.value.type !== "BooleanLiteral") {
      fail(input, property, "eager 必须是静态 boolean literal")
    }
    eager = property.value.value as boolean
  }
  return eager ?? false
}

function usedIdentifierNames(program: AstNode, source: string): Set<string> {
  const names = new Set<string>()
  walkNode(program, null, (node) => {
    if (node.type === "Identifier" && typeof node.name === "string") names.add(node.name)
  })
  for (const identifier of source.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    names.add(identifier)
  }
  return names
}

function uniqueBindingName(
  used: Set<string>,
  prefix: string,
  callIndex: number,
  matchIndex: number,
): string {
  const base = `__tsian_glob_${prefix}${callIndex}_${matchIndex}`
  let candidate = base
  let suffix = 0
  while (used.has(candidate)) {
    suffix += 1
    candidate = `${base}_${suffix}`
  }
  used.add(candidate)
  return candidate
}

function matchedFiles(input: GlobTransformInput, node: AstNode, pattern: string): GlobMatch[] {
  let resolved: ReturnType<typeof resolveGlobPattern>
  try {
    resolved = resolveGlobPattern(pattern, input.importer)
  } catch (error) {
    if (error instanceof GlobPathError) fail(input, node, error.message, error)
    throw error
  }

  let matcher: (value: string) => boolean
  try {
    matcher = picomatch(resolved.canonicalPattern, {
      dot: false,
      nocase: false,
      nonegate: true,
      posix: true,
      strictBrackets: true,
      windows: false,
    })
  } catch (error) {
    fail(input, node, `pattern ${JSON.stringify(pattern)} 无效: ${error instanceof Error ? error.message : String(error)}`, error)
  }

  const importerKey = input.importer
    .replace(/^workspace:/, "")
    .replace(/^\/+/, "")
    .replace(/^frontend\/src\//, "")
  return [...input.sources.keys()]
    .filter((path) => path !== importerKey && matcher(path))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .map((path) => globMatchFor(resolved, path))
}

function objectCode(entries: Array<{ key: string; value: string }>): string {
  if (entries.length === 0) return "{}"
  return `{\n${entries.map(({ key, value }) => `  ${JSON.stringify(key)}: ${value}`).join(",\n")}\n}`
}

function parseProgram(input: GlobTransformInput): AstNode {
  try {
    return parse(input.code, {
      sourceType: "module",
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
    fail(input, node, `源码解析失败: ${parseError.message}`, error)
  }
}

export async function transformImportMetaGlob(
  input: GlobTransformInput,
): Promise<GlobTransformResult> {
  const program = parseProgram(input)
  const calls: Array<{ node: AstNode; args: AstNode[] }> = []

  walkNode(program, null, (node, parent) => {
    if (node.type === "CallExpression" && isDirectGlobMember(node.callee)) {
      const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : []
      if (args.length < 1 || args.length > 2 || args.length !== (node.arguments as unknown[]).length) {
        fail(input, node, "调用只接受 pattern 和可选 options 两个普通参数")
      }
      calls.push({ node, args })
      return
    }
    if (isImportMetaGlobExtraction(node, parent)) {
      fail(input, node, "只支持直接调用 import.meta.glob(...)；从 import.meta 提取 glob 不受支持")
    }
    if (isAnyGlobMember(node)) {
      const isSupportedCallee = parent?.type === "CallExpression"
        && parent.callee === node
        && isDirectGlobMember(node)
      if (!isSupportedCallee) {
        fail(input, node, "只支持直接调用 import.meta.glob(...)；computed access、optional call、提取引用或其他非直接用法不受支持")
      }
    }
  })

  if (calls.length === 0) return { code: input.code, changed: false }

  const usedNames = usedIdentifierNames(program, input.diagnosticSource ?? input.code)
  const replacements: GlobCall[] = calls.map(({ node, args }) => {
    const pattern = stringPattern(input, args[0])
    return {
      node,
      eager: eagerOption(input, args[1]),
      matches: matchedFiles(input, args[0], pattern),
    }
  })

  const transformed = new MagicString(input.code)
  const eagerImports: string[] = []
  replacements.forEach((call, callIndex) => {
    if (typeof call.node.start !== "number" || typeof call.node.end !== "number") {
      fail(input, call.node, "parser 未提供可替换的 source range")
    }
    const entries = call.matches.map((match, matchIndex) => {
      const specifier = JSON.stringify(match.importSpecifier)
      if (!call.eager) {
        return { key: match.key, value: `() => import(${specifier})` }
      }
      const binding = uniqueBindingName(
        usedNames,
        input.bindingPrefix ?? "",
        callIndex,
        matchIndex,
      )
      eagerImports.push(`import * as ${binding} from ${specifier};`)
      return { key: match.key, value: binding }
    })
    transformed.overwrite(call.node.start, call.node.end, objectCode(entries))
  })

  if (eagerImports.length > 0) {
    transformed.prepend(`${eagerImports.join("\n")}\n\n`)
  }
  return { code: transformed.toString(), changed: true }
}
