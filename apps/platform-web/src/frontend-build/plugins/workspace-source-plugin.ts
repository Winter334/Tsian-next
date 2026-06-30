import type { Loader, Plugin } from "esbuild-wasm"

/**
 * Workspace source plugin — feeds source files from IndexedDB memory into
 * esbuild-wasm, which has no file system in the browser.
 *
 * esbuild-wasm's `file` namespace would fall back to (non-existent) FS
 * resolution, so we resolve relative imports into a custom `workspace`
 * namespace and load contents from the preloaded `sources` map.
 *
 * `sources` keys are paths relative to `frontend/src/` (e.g. `App.vue`,
 * `components/Foo.ts`). Relative imports are resolved against the importer's
 * virtual path. Extension-less imports try a set of common extensions.
 */
export interface WorkspaceSourcePluginInput {
  sources: Map<string, string>
}

const WORKSPACE_NAMESPACE = "workspace"

/** Extensions tried when an import path has no explicit extension. */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".vue", ".css", ".json"]

/** Resolve a relative import path against the importer's virtual path. */
function resolveRelative(importPath: string, importer: string | undefined): string {
  if (!importer) {
    return importPath.replace(/^\.\//, "")
  }
  const importerDir = importer.includes("/")
    ? importer.slice(0, importer.lastIndexOf("/"))
    : ""
  const parts = importerDir ? importerDir.split("/") : []
  for (const seg of importPath.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join("/")
}

/** Pick an esbuild loader by file extension. `.vue` is left to the sfc plugin. */
function loaderFor(path: string): Loader {
  if (path.endsWith(".tsx")) return "tsx"
  if (path.endsWith(".ts")) return "ts"
  if (path.endsWith(".jsx")) return "jsx"
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "js"
  if (path.endsWith(".css")) return "css"
  if (path.endsWith(".json")) return "json"
  return "text"
}

export function workspaceSourcePlugin({ sources }: WorkspaceSourcePluginInput): Plugin {
  return {
    name: "workspace-source",
    setup(build) {
      // Relative imports (./ ../) → resolve into the workspace namespace.
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        const resolved = resolveRelative(args.path, args.importer)
        return { path: resolved, namespace: WORKSPACE_NAMESPACE }
      })

      // Load source content from the preloaded map. Try the path as-is, then
      // with common extensions for extension-less imports (import "./Foo").
      build.onLoad(
        { filter: /.*/, namespace: WORKSPACE_NAMESPACE },
        async (args) => {
          const direct = sources.get(args.path)
          if (direct !== undefined) {
            return { contents: direct, loader: loaderFor(args.path) }
          }
          for (const ext of RESOLVE_EXTENSIONS) {
            const withExt = sources.get(args.path + ext)
            if (withExt !== undefined) {
              return { contents: withExt, loader: loaderFor(args.path + ext) }
            }
          }
          return {
            errors: [{ text: `源码文件未找到: ${args.path}` }],
          }
        },
      )
    },
  }
}
