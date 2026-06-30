import type { Plugin } from "esbuild-wasm"

/**
 * CDN external plugin — marks bare imports (non-relative, non-absolute,
 * non-URL) as external so they stay as `import { x } from "vue"` in the
 * bundle, resolved at runtime via an import map injected into index.html.
 *
 * While marking external, it also collects the bare-import set so write-back
 * can generate an import map entry for each (esm.sh URL). The collection is
 * returned via the `collected` field for the caller to read post-build.
 *
 * esm.sh handles nested dependency resolution internally: the module it
 * returns already rewrites inner imports to esm.sh URLs, so the browser's
 * native import map only needs top-level bare imports.
 */
export interface CdnExternalPluginInput {
  /** Pre-populated core framework entries (e.g. "vue" → "vue@3"). */
  coreImports?: Map<string, string>
}

export interface CdnExternalPluginResult {
  /** Bare import names collected during build (excluding core entries). */
  collected: Set<string>
}

export function cdnExternalPlugin(
  input: CdnExternalPluginInput = {},
): Plugin & { result: CdnExternalPluginResult } {
  const coreImports = input.coreImports ?? new Map<string, string>()
  const collected = new Set<string>()

  return {
    name: "cdn-external",
    result: { collected },
    setup(build) {
      // Bare import = does not start with ".", "/", "http", or "data:".
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        // Skip URL/protocol imports (http, https, data) — leave as-is.
        if (/^(https?:|data:)/.test(args.path)) {
          return undefined
        }
        // Bare package name (possibly with submodule path like "react/jsx-runtime").
        const bareName = args.path
        if (!coreImports.has(bareName)) {
          collected.add(bareName)
        }
        return { path: args.path, external: true }
      })
    },
  }
}
