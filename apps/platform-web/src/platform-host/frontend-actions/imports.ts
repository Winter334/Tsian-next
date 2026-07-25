import type { File, Node } from "@babel/types"
import { parse } from "@babel/parser"
import type { BoundFrontendActionResource, ResolvedFrontendAction } from "./registry"
import { FrontendActionRuntimeError } from "./errors"

interface ParsedImportScripts {
  readonly source: string
  readonly importedResources: readonly BoundFrontendActionResource[]
}

interface StaticImportCall {
  readonly start: number
  readonly end: number
  readonly paths: readonly string[]
}

interface ParsedStaticImports {
  readonly source: string
  readonly calls: readonly StaticImportCall[]
}

type RangedNode = Node & {
  start: number | null
  end: number | null
}

const STATIC_IMPORT_LOADER_PROPERTY = "__tsian:frontend-action:static-imports:v1"

function manifestInvalid(diagnostics: unknown): FrontendActionRuntimeError {
  return new FrontendActionRuntimeError("FRONTEND_ACTION_MANIFEST_INVALID", {
    diagnostics,
  })
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") continue
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === "object" && typeof (entry as Node).type === "string") {
          walk(entry as Node, visit)
        }
      }
      continue
    }
    if (value && typeof value === "object" && typeof (value as Node).type === "string") {
      walk(value as Node, visit)
    }
  }
}

function parseProgram(source: string): File {
  try {
    return parse(source, {
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      ranges: true,
    })
  } catch (error) {
    throw manifestInvalid({ diagnostic: "Executor source could not be parsed.", cause: error })
  }
}

function importedHelperPath(rootDirectory: string, value: string): string {
  if (
    value.length === 0
    || value.trim() !== value
    || value.includes("\\")
    || value.includes("\0")
    || value.startsWith("/")
    || value.includes(":")
    || /%(?:2f|2F|5c|5C|00)/.test(value)
  ) {
    throw manifestInvalid("importScripts path is invalid.")
  }

  let authored = value
  if (authored.startsWith(`${rootDirectory}/`)) {
    authored = authored.slice(rootDirectory.length + 1)
  } else if (authored.startsWith("./")) {
    authored = authored.slice(2)
  }
  const parts = authored.split("/")
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..")
    || parts.some((part) => {
      try {
        const decoded = decodeURIComponent(part)
        return decoded === "."
          || decoded === ".."
          || decoded.includes("/")
          || decoded.includes("\\")
          || decoded.includes("\0")
      } catch {
        return true
      }
    })
  ) {
    throw manifestInvalid("importScripts path escapes or is not canonical.")
  }
  return `${rootDirectory}/${parts.join("/")}`
}

function parseStaticImports(
  source: string,
  action: ResolvedFrontendAction,
  helpersByPath: ReadonlyMap<string, BoundFrontendActionResource>,
): ParsedStaticImports {
  const calls: StaticImportCall[] = []
  walk(parseProgram(source).program, (node) => {
    if (node.type === "OptionalCallExpression") {
      if (node.callee.type === "Identifier" && node.callee.name === "importScripts") {
        throw manifestInvalid("importScripts does not support optional calls.")
      }
      return
    }
    if (node.type !== "CallExpression") return
    if (node.callee.type !== "Identifier" || node.callee.name !== "importScripts") return
    if (node.optional || node.arguments.length === 0) {
      throw manifestInvalid("importScripts requires static string literal arguments.")
    }

    const paths: string[] = []
    for (const argument of node.arguments) {
      if (argument.type !== "StringLiteral") {
        throw manifestInvalid("Every importScripts argument must be a string literal.")
      }
      const path = importedHelperPath(action.rootDirectory, argument.value)
      if (!helpersByPath.has(path)) {
        throw manifestInvalid("importScripts may reference only declared helpers.")
      }
      paths.push(path)
    }

    const ranged = node as RangedNode
    if (ranged.start === null || ranged.end === null) {
      throw manifestInvalid("importScripts source range is unavailable.")
    }
    calls.push({ start: ranged.start, end: ranged.end, paths })
  })
  return { source, calls }
}

function replaceStaticImportCalls(parsed: ParsedStaticImports): string {
  let transformed = parsed.source
  const loader = `globalThis[${JSON.stringify(STATIC_IMPORT_LOADER_PROPERTY)}]`
  for (const call of [...parsed.calls].sort((left, right) => right.start - left.start)) {
    const args = call.paths.map((path) => JSON.stringify(path)).join(", ")
    transformed = `${transformed.slice(0, call.start)}${loader}(${args})${transformed.slice(call.end)}`
  }
  return transformed
}

function createStaticImportRuntime(
  executorSource: string,
  helperSources: ReadonlyMap<string, string>,
): string {
  if (helperSources.size === 0) return executorSource

  const entries = Array.from(helperSources.entries())
  const property = JSON.stringify(STATIC_IMPORT_LOADER_PROPERTY)
  return `
const __tsianFrontendActionImportSources = new Map(${JSON.stringify(entries)});
const __tsianFrontendActionImportLoader = (...paths) => {
  for (const path of paths) {
    const importedSource = __tsianFrontendActionImportSources.get(path);
    if (importedSource === undefined) throw new Error("Static Frontend Action helper is unavailable.");
    (0, eval)(importedSource);
  }
};
const __tsianFrontendActionPreviousImportLoader = Object.getOwnPropertyDescriptor(globalThis, ${property});
Object.defineProperty(globalThis, ${property}, {
  value: __tsianFrontendActionImportLoader,
  writable: false,
  configurable: true,
  enumerable: false,
});
try {
  return await (async () => {
${executorSource}
  })();
} finally {
  if (__tsianFrontendActionPreviousImportLoader === undefined) {
    Reflect.deleteProperty(globalThis, ${property});
  } else {
    Object.defineProperty(globalThis, ${property}, __tsianFrontendActionPreviousImportLoader);
  }
}
`
}

/**
 * Statically validates direct importScripts calls and replaces each call with a
 * manifest-confined loader invocation at that exact source location. Declared
 * helpers that are never referenced are neither embedded nor returned as
 * dependencies. Duplicate calls execute repeatedly, matching native
 * importScripts behavior, while imported resource dependencies are deduplicated.
 */
export function validateAndInlineFrontendActionImports(
  action: ResolvedFrontendAction,
): ParsedImportScripts {
  const helpersByPath = new Map(
    action.resources.helpers.map((resource) => [resource.file.path, resource]),
  )
  const importedByPath = new Map<string, BoundFrontendActionResource>()
  const parsedHelpers = new Map(
    action.resources.helpers.map((helper) => [
      helper.file.path,
      parseStaticImports(helper.file.content, action, helpersByPath),
    ]),
  )

  const discoverImports = (parsed: ParsedStaticImports): void => {
    for (const call of parsed.calls) {
      for (const path of call.paths) {
        if (importedByPath.has(path)) continue
        const helper = helpersByPath.get(path)
        if (!helper) {
          throw manifestInvalid("importScripts may reference only declared helpers.")
        }
        importedByPath.set(path, helper)
        const helperImports = parsedHelpers.get(path)
        if (!helperImports) {
          throw manifestInvalid("Imported helper source is unavailable.")
        }
        discoverImports(helperImports)
      }
    }
  }

  const executorImports = parseStaticImports(
    action.resources.executor.file.content,
    action,
    helpersByPath,
  )
  discoverImports(executorImports)

  const helperSources = new Map<string, string>()
  for (const path of importedByPath.keys()) {
    const parsed = parsedHelpers.get(path)
    if (!parsed) throw manifestInvalid("Imported helper source is unavailable.")
    helperSources.set(path, replaceStaticImportCalls(parsed))
  }

  return {
    source: createStaticImportRuntime(
      replaceStaticImportCalls(executorImports),
      helperSources,
    ),
    importedResources: Object.freeze(Array.from(importedByPath.values())),
  }
}
