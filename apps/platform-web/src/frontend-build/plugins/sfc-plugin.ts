import type { Plugin } from "esbuild-wasm"
import type {
  SFCDescriptor,
  SFCParseResult,
  SFCScriptBlock,
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
 * → compileStyleAsync per <style> block. Scoped CSS is injected at runtime
 * via JS (`document.head.appendChild(<style>)`), NOT extracted to a separate
 * CSS file — matches vite dev mode, avoids index.html maintaining a CSS
 * manifest. Source-level `import './x.css'` still goes through esbuild's css
 * loader and produces a separate CSS file (see write-back.ts).
 *
 * The sources map is passed via the factory (closed over), so concurrent
 * builds of different cards don't cross-contaminate.
 *
 * Design ref: task 06-30 §5.1 (B3 scoped CSS JS injection).
 */

const VUE_NAMESPACE = "workspace"

export interface SfcPluginInput {
  sources: Map<string, string>
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
    errors.push(typeof e === "string" ? e : e.message)
  }
  if (errors.length > 0) {
    return { js: "", errors }
  }
  const descriptor: SFCDescriptor = parseResult.descriptor
  const id = scopeIdFor(source)
  const scopeIdAttr = `data-v-${id}`

  // 2. Compile <script> / <script setup> → JS module body.
  let scriptContent = ""
  let scriptBlock: SFCScriptBlock | null = null
  if (descriptor.script || descriptor.scriptSetup) {
    try {
      scriptBlock = compiler.compileScript(descriptor, { id, isProd: true })
      scriptContent = scriptBlock.content
    } catch (e) {
      return { js: "", errors: [`script 编译失败: ${(e as Error).message}`] }
    }
  }

  // 3. Compile <template> → render function code (an IIFE assigning to `render`).
  let renderCode = ""
  if (descriptor.template) {
    const templateOpts: SFCTemplateCompileOptions = {
      filename,
      source: descriptor.template.content,
      id,
      compilerOptions: { scopeId: scopeIdAttr },
    }
    const templateResult = compiler.compileTemplate(templateOpts)
    for (const e of templateResult.errors) {
      errors.push(typeof e === "string" ? e : e.message)
    }
    if (errors.length > 0) {
      return { js: "", errors }
    }
    renderCode = templateResult.code
  }

  // 4. Compile each <style> block (scoped → data-v-xxxx attribute rewrite).
  const styleCodes: string[] = []
  for (const styleBlock of descriptor.styles) {
    const styleResult: SFCStyleCompileResults = await compiler.compileStyleAsync({
      filename,
      source: styleBlock.content,
      id,
      scoped: styleBlock.scoped,
    })
    for (const e of styleResult.errors) {
      errors.push(typeof e === "string" ? e : (e as Error).message)
    }
    if (styleResult.errors.length === 0) {
      styleCodes.push(styleResult.code)
    }
  }
  if (errors.length > 0) {
    return { js: "", errors }
  }

  // 5. Assemble the JS module.
  //    compileScript rewrites the component to a local `__sfc_main` binding
  //    (or `export default` for plain <script>). compileTemplate produces an
  //    IIFE that assigns `render` onto a `__sfc_main` variable it expects to
  //    find in scope. We splice them together: script first (defines
  //    __sfc_main), then template (attaches render), then export + CSS.
  const parts: string[] = []

  if (scriptContent) {
    parts.push(scriptContent)
  } else {
    // Template-only or style-only SFC: define an empty component object so
    // compileTemplate's IIFE has a `__sfc_main` to attach render to.
    parts.push("const __sfc_main = {}")
  }

  if (renderCode) {
    parts.push(renderCode)
  }

  // Export the component. compileScript emits `export default` already when
  // there is a <script> block; when it's <script setup> it defines __sfc_main
  // and we add the export. To stay uniform, rewrite any trailing
  // `export default` from compileScript to an assignment and emit one export.
  // Simpler: if scriptBlock produced an `export default`, leave it; else add.
  // compileScript for <script setup> does NOT emit export default — it leaves
  // __sfc_main — so we always append the export and strip a stray one.
  const hasExplicitExport = /export\s+default\b/.test(scriptContent)
  if (!hasExplicitExport) {
    parts.push("export default __sfc_main")
  }

  // Scoped CSS runtime injection.
  if (styleCodes.length > 0) {
    const cssJson = JSON.stringify(styleCodes.join("\n"))
    parts.push(`;(function(){const __c=${cssJson};if(typeof document!=='undefined'){const s=document.createElement('style');s.textContent=__c;document.head.appendChild(s)}})();`)
  }

  return { js: parts.join("\n\n"), errors: [] }
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
        { filter: /\.vue$/, namespace: VUE_NAMESPACE },
        async (args) => {
          const source = sources.get(args.path)
          if (source === undefined) {
            return { errors: [{ text: `SFC 源码未找到: ${args.path}` }] }
          }
          const compiled = await compileSfc(source, args.path)
          if (compiled.errors.length > 0) {
            return { errors: compiled.errors.map((text) => ({ text })) }
          }
          return { contents: compiled.js, loader: "js" }
        },
      )
    },
  }
}
