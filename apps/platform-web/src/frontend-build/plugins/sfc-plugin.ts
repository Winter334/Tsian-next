import type { Loader, PartialMessage, Plugin } from "esbuild-wasm"
import {
  compileStylePreprocessor,
  toStylePreprocessorMessage,
  type StylePreprocessorLanguage,
} from "../style-preprocessors"
import type {
  SFCDescriptor,
  SFCParseResult,
  SFCScriptBlock,
  SFCStyleBlock,
  SFCTemplateCompileOptions,
  SFCStyleCompileResults,
} from "@vue/compiler-sfc"

/**
 * Vue 3 SFC plugin — compiles `.vue` single-file components into JS modules
 * inside esbuild-wasm. Uses `@vue/compiler-sfc` (npm, inlined into the
 * platform bundle via dynamic import → lazy-loaded chunk; not fetched from a
 * CDN so the build toolchain ships with the platform).
 *
 * Per SFC: parse → compileScript (handles <script setup>) → compileTemplate
 * → compileStyleAsync per <style> block. Styles are emitted as virtual CSS
 * imports so esbuild's CSS pipeline can still rewrite relative `url(...)`
 * assets into frontend/dist outputs. Source-level `import './x.css'` still
 * goes through esbuild's css loader and produces a separate CSS file (see
 * write-back.ts).
 *
 * The sources map is passed via the factory (closed over), so concurrent
 * builds of different cards don't cross-contaminate.
 *
 * Design ref: task 06-30 §5.1 (B3 scoped CSS JS injection; now upgraded to
 * virtual CSS modules to preserve asset URL rewriting).
 */

const VUE_NAMESPACE = "workspace"
const SOURCE_PREFIX = "frontend/src/"
const STYLE_QUERY_KEY = "tsian-style"

export interface SfcPluginInput {
  sources: Map<string, string | Uint8Array>
}

interface SourceRequest {
  path: string
  query: string
}

/** Generate a stable scope id for a component (data-v-xxxxxxxx). */
function scopeIdFor(source: string): string {
  let hash = 0
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/** Lazily import @vue/compiler-sfc (keeps it out of the main bundle chunk). */
let compilerPromise: Promise<typeof import("@vue/compiler-sfc")> | null = null
function loadCompiler(): Promise<typeof import("@vue/compiler-sfc")> {
  if (!compilerPromise) {
    compilerPromise = import("@vue/compiler-sfc")
  }
  return compilerPromise
}

function splitSourceRequest(path: string): SourceRequest {
  const queryIndex = path.indexOf("?")
  if (queryIndex < 0) {
    return { path, query: "" }
  }
  return {
    path: path.slice(0, queryIndex),
    query: path.slice(queryIndex + 1),
  }
}

function normalizeWorkspaceSourcePath(path: string): string {
  const request = splitSourceRequest(path)
  const normalized = request.path.replace(/^workspace:/, "").replace(/\\/g, "/").replace(/^\/+/, "")
  if (normalized.startsWith(SOURCE_PREFIX)) {
    return normalized.slice(SOURCE_PREFIX.length)
  }
  const sourceIndex = normalized.indexOf(`/${SOURCE_PREFIX}`)
  return sourceIndex >= 0
    ? normalized.slice(sourceIndex + SOURCE_PREFIX.length + 1)
    : normalized
}

function toLocalRenderFunction(renderCode: string): string {
  return renderCode.replace(/export\s+(function\s+render\b)/, "$1")
}

function errorMessage(filename: string, error: string | Error): string {
  const message = typeof error === "string" ? error : error.message
  return `${filename}: ${message}`
}

function styleImportPath(filename: string, index: number): string {
  return `@/${filename}?${STYLE_QUERY_KEY}=${index}`
}

function styleModuleName(styleBlock: SFCStyleBlock): string | undefined {
  if (!styleBlock.module) return undefined
  return typeof styleBlock.module === "string" ? styleBlock.module : "$style"
}

function styleLanguage(styleBlock: SFCStyleBlock): "css" | StylePreprocessorLanguage | undefined {
  const language = styleBlock.lang?.toLowerCase() ?? "css"
  return language === "css" || language === "scss" || language === "sass" || language === "less"
    ? language
    : undefined
}

function validateStyleBlock(descriptor: SFCDescriptor, index: number, filename: string): string | undefined {
  const styleBlock = descriptor.styles[index]
  if (!styleBlock) {
    return `SFC style 不存在: ${filename}?${STYLE_QUERY_KEY}=${index}`
  }
  if (styleBlock.src) {
    return `SFC style src 暂不支持: ${filename}`
  }
  if (typeof styleBlock.module === "string" && !styleBlock.module.trim()) {
    return `SFC CSS module 名称无效: ${filename}`
  }
  if (!styleLanguage(styleBlock)) {
    return `SFC style lang=\"${styleBlock.lang}\" 暂不支持: ${filename}`
  }
  return undefined
}

/** Compile a .vue SFC source into a JS module string. */
async function compileSfc(
  source: string,
  filename: string,
): Promise<{ js: string; errors: string[] }> {
  const compiler = await loadCompiler()
  const errors: string[] = []

  // 1. Parse → descriptor (template/script/style blocks).
  const parseResult: SFCParseResult = compiler.parse(source, { filename })
  for (const e of parseResult.errors) {
    errors.push(errorMessage(filename, e))
  }
  if (errors.length > 0) {
    return { js: "", errors }
  }
  const descriptor: SFCDescriptor = parseResult.descriptor
  const id = scopeIdFor(source)
  const scopeIdAttr = `data-v-${id}`
  const hasScopedStyle = descriptor.styles.some((styleBlock) => styleBlock.scoped)

  for (let i = 0; i < descriptor.styles.length; i++) {
    const styleError = validateStyleBlock(descriptor, i, filename)
    if (styleError) errors.push(styleError)
  }
  if (errors.length > 0) {
    return { js: "", errors }
  }

  // 2. Compile <script> / <script setup> → JS module body.
  let scriptContent = ""
  let scriptBlock: SFCScriptBlock | null = null
  if (descriptor.script || descriptor.scriptSetup) {
    try {
      // Use compiler-sfc's official local-binding output. This covers plain
      // <script>, <script setup>, and TypeScript syntax without parsing exports
      // ourselves.
      scriptBlock = compiler.compileScript(descriptor, {
        id,
        isProd: true,
        genDefaultAs: "__sfc_main",
      })
      scriptContent = scriptBlock.content
    } catch (e) {
      return { js: "", errors: [errorMessage(filename, `script 编译失败: ${(e as Error).message}`)] }
    }
  }

  // 3. Compile <template> → render function code.
  let renderCode = ""
  if (descriptor.template) {
    const templateOpts: SFCTemplateCompileOptions = {
      filename,
      source: descriptor.template.content,
      id,
      compilerOptions: {
        bindingMetadata: scriptBlock?.bindings,
        ...(hasScopedStyle ? { scopeId: scopeIdAttr } : {}),
      },
    }
    const templateResult = compiler.compileTemplate(templateOpts)
    for (const e of templateResult.errors) {
      errors.push(errorMessage(filename, e))
    }
    if (errors.length > 0) {
      return { js: "", errors }
    }
    renderCode = toLocalRenderFunction(templateResult.code)
  }

  // 4. Assemble the JS module. Ordinary styles are side-effect imports;
  //    CSS Modules are imported as objects whose mappings are exposed to Vue.
  //    Both paths keep url(...) rewriting and asset emission in esbuild.
  const parts: string[] = []
  const cssModules = new Map<string, string[]>()

  for (let i = 0; i < descriptor.styles.length; i++) {
    const importPath = JSON.stringify(styleImportPath(filename, i))
    const moduleName = styleModuleName(descriptor.styles[i])
    if (moduleName) {
      const importName = `__style_${i}`
      parts.push(`import ${importName} from ${importPath}`)
      const moduleImports = cssModules.get(moduleName) ?? []
      moduleImports.push(importName)
      cssModules.set(moduleName, moduleImports)
    } else {
      parts.push(`import ${importPath}`)
    }
  }

  if (scriptContent) {
    parts.push(scriptContent)
  } else {
    // Template-only or style-only SFC: define an empty component object so the
    // compiled render function has a `__sfc_main` to attach render to.
    parts.push("const __sfc_main = {}")
  }

  if (renderCode) {
    parts.push(renderCode)
    parts.push("__sfc_main.render = render")
  }

  if (hasScopedStyle) {
    parts.push(`__sfc_main.__scopeId = ${JSON.stringify(scopeIdAttr)}`)
  }

  if (cssModules.size > 0) {
    const modules = [...cssModules]
      .map(([name, imports]) => `${JSON.stringify(name)}: Object.assign({}, ${imports.join(", ")})`)
      .join(", ")
    parts.push(`__sfc_main.__cssModules = { ${modules} }`)
  }

  // Export the component after normalizing both <script> and <script setup> to
  // a local __sfc_main binding.
  parts.push("export default __sfc_main")

  return { js: parts.join("\n\n"), errors: [] }
}

async function compileSfcStyle(
  source: string,
  filename: string,
  styleIndex: number,
  sources: Map<string, string | Uint8Array>,
): Promise<{ css: string; loader: Loader; errors: PartialMessage[]; dependencies: string[] }> {
  const compiler = await loadCompiler()
  const errors: PartialMessage[] = []
  const parseResult: SFCParseResult = compiler.parse(source, { filename })
  for (const e of parseResult.errors) {
    errors.push({ text: errorMessage(filename, e) })
  }
  if (errors.length > 0) {
    return { css: "", loader: "css", errors, dependencies: [] }
  }

  const descriptor = parseResult.descriptor
  const styleError = validateStyleBlock(descriptor, styleIndex, filename)
  if (styleError) {
    return { css: "", loader: "css", errors: [{ text: styleError }], dependencies: [] }
  }

  const styleBlock = descriptor.styles[styleIndex]
  const language = styleLanguage(styleBlock)!
  let styleSource = styleBlock.content
  let dependencies: string[] = []
  if (language !== "css") {
    try {
      const preprocessed = await compileStylePreprocessor({
        language,
        source: styleSource,
        filename,
        sources,
        sourceLineOffset: styleBlock.loc.start.line - 1,
        sourceColumnOffset: styleBlock.loc.start.column,
      })
      styleSource = preprocessed.css
      dependencies = preprocessed.dependencies
    } catch (error) {
      return {
        css: "",
        loader: "css",
        errors: [toStylePreprocessorMessage(error, { language, filename })],
        dependencies: [],
      }
    }
  }

  const styleResult: SFCStyleCompileResults = await compiler.compileStyleAsync({
    filename,
    source: styleSource,
    id: scopeIdFor(source),
    scoped: styleBlock.scoped,
    isProd: true,
  })
  for (const e of styleResult.errors) {
    errors.push({ text: errorMessage(filename, e as Error) })
  }
  return errors.length > 0
    ? { css: "", loader: "css", errors, dependencies }
    : {
        css: styleResult.code,
        loader: styleModuleName(styleBlock) ? "local-css" : "css",
        errors: [],
        dependencies,
      }
}

export function createSfcPlugin(input: SfcPluginInput): Plugin {
  const sources = input.sources
  return {
    name: "vue-sfc",
    setup(build) {
      // Intercept .vue files in the workspace namespace. Must be registered
      // BEFORE the workspace-source-plugin's catch-all onLoad so the more
      // specific filter wins (esbuild runs onLoad in registration order).
      build.onLoad(
        { filter: /\.vue(?:\?.*)?$/, namespace: VUE_NAMESPACE },
        async (args) => {
          const request = splitSourceRequest(`${args.path}${args.suffix}`)
          const sourcePath = normalizeWorkspaceSourcePath(request.path)
          const source = sources.get(sourcePath)
          if (source === undefined) {
            return { errors: [{ text: `SFC 源码未找到: ${args.path}` }] }
          }
          if (typeof source !== "string") {
            return { errors: [{ text: `SFC 源码必须是文本文件: ${args.path}` }] }
          }

          const params = new URLSearchParams(request.query)
          const styleIndexParam = params.get(STYLE_QUERY_KEY)
          if (styleIndexParam !== null) {
            const styleIndex = Number(styleIndexParam)
            if (!Number.isInteger(styleIndex) || styleIndex < 0) {
              return { errors: [{ text: `SFC style 索引无效: ${args.path}` }] }
            }
            const compiled = await compileSfcStyle(source, sourcePath, styleIndex, sources)
            if (compiled.errors.length > 0) {
              return { errors: compiled.errors }
            }
            return {
              contents: compiled.css,
              loader: compiled.loader,
              resolveDir: sourcePath.includes("/")
                ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
                : ".",
              watchFiles: compiled.dependencies,
            }
          }

          if (request.query) {
            // Let workspace-source-plugin handle raw/url/inline or report an
            // unsupported query error for non-SFC requests.
            return undefined
          }

          const compiled = await compileSfc(source, sourcePath)
          if (compiled.errors.length > 0) {
            return { errors: compiled.errors.map((text) => ({ text })) }
          }
          return { contents: compiled.js, loader: "ts" }
        },
      )
    },
  }
}
