import type { Plugin } from "esbuild-wasm"

/**
 * Svelte plugin — INTERFACE STUB ONLY (task 06-30 Phase 6, R3/D10).
 *
 * Svelte requires a second SFC compiler (`svelte/compiler`) analogous to the
 * Vue `@vue/compiler-sfc` plugin: `.svelte` files must be parsed + compiled to
 * JS render functions before esbuild bundles them. This stub reserves the
 * factory signature so the engine's framework routing has a stable attachment
 * point once the Vue SFC plugin interface stabilizes and we add a second
 * compiler.
 *
 * Current state: NOT mounted. `engine.ts`'s `frameworkConfig("svelte")`
 * returns an empty plugin map, so `framework === "svelte"` cards fall through
 * to the pure-TS path (same as `vanilla`) — a `.svelte` file would be loaded
 * as raw text and fail at runtime. This is intentional: shipping a half-working
 * svelte compiler would be worse than an explicit, documented gap.
 *
 * When implementing:
 * 1. Lazily `import("svelte/compiler")` (mirror `sfc-plugin.ts`'s
 *    `loadCompiler` pattern — keeps it out of the main bundle chunk).
 * 2. `onLoad({ filter: /\.svelte$/, namespace: "workspace" })` → parse +
 *    compile → return `{ contents: js, loader: "js" }`. Register BEFORE the
 *    workspace-source-plugin's catch-all (same ordering rule as the vue plugin).
 * 3. Add `case "svelte"` to `engine.ts`'s plugin wiring to push
 *    `createSveltePlugin({ sources })`.
 * 4. Add svelte + svelte/internal to the core import map in `frameworkConfig`
 *    (esm.sh URLs, pinned major).
 * 5. Scoped CSS: decide between JS runtime injection (vue's approach) vs
 *    separate CSS file — match whichever the vue plugin settled on by then.
 *
 * Design ref: task 06-30 §5.1 (R3 multi-framework), prd.md D10.
 */

export interface SveltePluginInput {
  sources: Map<string, string>
}

/**
 * Create the svelte SFC compiler plugin. STUB — returns a plugin that
 * registers no handlers, so mounting it is a no-op (kept this way so the
 * engine can wire it in without runtime side effects until the compiler is
 * integrated).
 */
export function createSveltePlugin(_input: SveltePluginInput): Plugin {
  return {
    name: "svelte-sfc",
    setup(_build) {
      // TODO(task 06-30 follow-up): onLoad .svelte files in the "workspace"
      // namespace, compile via svelte/compiler, return JS module contents.
    },
  }
}
