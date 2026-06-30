import * as esbuild from "esbuild-wasm"
import type { FrontendFramework } from "@tsian/contracts"
import { getLocalGameCard, listLocalGameCardFrontendFiles } from "../storage"
import { cdnExternalPlugin } from "./plugins/cdn-external-plugin"
import { createSfcPlugin } from "./plugins/sfc-plugin"
import { workspaceSourcePlugin } from "./plugins/workspace-source-plugin"
import { writeBackDist } from "./write-back"

/**
 * Platform-side frontend build engine. Compiles `frontend/src/**` (source,
 * assistant-editable) into `frontend/dist/**` (build output, Service Worker
 * loaded) using esbuild-wasm inside the browser sandbox.
 *
 * Design ref: `.trellis/tasks/06-30-platform-frontend-build-service/design.md`
 *
 * Why esbuild-wasm: browser-native build, no FS access, lazy-loaded. The wasm
 * binary is served same-origin from `/esbuild.wasm` (copied to public/ at
 * build time via the prebuild hook) and cached in Cache API after first load
 * — standalone, does NOT touch the main Dexie DB `tsian-agent-runtime-v13`
 * (per storage spec, touching main DB tables requires a DB name bump).
 */

const ESBUILD_WASM_URL = "/esbuild.wasm"
const SOURCE_PREFIX = "frontend/src/"
const CACHE_NAME = "tsian-builder-cache"
const WASM_CACHE_KEY = "esbuild-wasm"

const ENTRY_CANDIDATES = ["main.ts", "main.tsx", "main.jsx", "main.js", "index.ts", "index.tsx"]

let esbuildInitialized = false
let initPromise: Promise<void> | null = null

/** Fetch the esbuild wasm binary, caching in Cache API after first download. */
async function fetchWasmWithCache(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(url)
  if (cached) {
    return cached.arrayBuffer()
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`esbuild wasm 下载失败: HTTP ${res.status}`)
  }
  const buffer = await res.arrayBuffer()
  await cache.put(
    url,
    new Response(buffer, { headers: { "Content-Type": "application/wasm" } }),
  )
  return buffer
}

/** Lazily initialize esbuild-wasm (idempotent — safe to call repeatedly). */
export async function ensureEsbuildInitialized(): Promise<void> {
  if (esbuildInitialized) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const wasmBuffer = await fetchWasmWithCache(ESBUILD_WASM_URL)
    // Blob URL keeps the binary in memory for esbuild's worker to fetch.
    const wasmBlob = new Blob([wasmBuffer], { type: "application/wasm" })
    const wasmURL = URL.createObjectURL(wasmBlob)
    await esbuild.initialize({ wasmURL, worker: true })
    esbuildInitialized = true
  })()

  return initPromise
}

// ─── Framework config ───────────────────────────────────────────────────

interface FrameworkConfig {
  /** Core framework bare imports → esm.sh URL (platform-fixed versions). */
  coreImportMap: Map<string, string>
  /** esbuild jsx config (react/preact use "automatic"; vue uses its own render fn). */
  jsx?: "automatic"
  /** jsxImportSource for automatic runtime (e.g. "react", "preact"). */
  jsxImportSource?: string
}

function frameworkConfig(framework: FrontendFramework): FrameworkConfig {
  switch (framework) {
    case "vue": {
      const m = new Map<string, string>()
      m.set("vue", "https://esm.sh/vue@3")
      return { coreImportMap: m }
    }
    case "react": {
      const m = new Map<string, string>()
      m.set("react", "https://esm.sh/react@18")
      m.set("react-dom", "https://esm.sh/react-dom@18")
      m.set("react-dom/client", "https://esm.sh/react-dom@18/client")
      m.set("react/jsx-runtime", "https://esm.sh/react@18/jsx-runtime")
      return { coreImportMap: m, jsx: "automatic", jsxImportSource: "react" }
    }
    case "preact": {
      const m = new Map<string, string>()
      m.set("preact", "https://esm.sh/preact@10")
      m.set("preact/jsx-runtime", "https://esm.sh/preact@10/jsx-runtime")
      return { coreImportMap: m, jsx: "automatic", jsxImportSource: "preact" }
    }
    case "vanilla":
    case "svelte":
    default:
      return { coreImportMap: new Map() }
  }
}

// ─── Source loading ─────────────────────────────────────────────────────

interface LoadedSources {
  sources: Map<string, string>
  entryPath: string
  entryContent: string
}

/** Preload all `frontend/src/**` files from IndexedDB into memory. */
async function loadSources(cardId: string): Promise<LoadedSources> {
  const allFiles = await listLocalGameCardFrontendFiles(cardId)
  const sources = new Map<string, string>()
  for (const file of allFiles) {
    if (!file.path.startsWith(SOURCE_PREFIX)) continue
    const relPath = file.path.slice(SOURCE_PREFIX.length)
    sources.set(relPath, await file.data.text())
  }
  if (sources.size === 0) {
    throw new Error("游戏卡 frontend/src/ 下无源码文件，无法构建")
  }
  // Detect entry by convention (main.ts / main.tsx / index.ts / ...).
  let entryPath: string | undefined
  for (const candidate of ENTRY_CANDIDATES) {
    if (sources.has(candidate)) {
      entryPath = candidate
      break
    }
  }
  if (!entryPath) {
    throw new Error(
      `未找到入口文件（尝试过 ${ENTRY_CANDIDATES.join(", ")}），frontend/src/ 下需包含其一`,
    )
  }
  return { sources, entryPath, entryContent: sources.get(entryPath)! }
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface BuildFrontendResult {
  distPaths: string[]
  entryHtmlPath: string
  /** All bare imports the build saw (core + collected), for diagnostics. */
  bareImports: string[]
}

/**
 * Build a game card's `frontend/src/` into `frontend/dist/`. Reads the
 * manifest for framework; preloads sources; runs esbuild-wasm; writes
 * outputs back. On build error, throws (caller keeps old dist + records
 * status). Does NOT update the manifest entry — that's the caller's job.
 */
export async function buildFrontend(cardId: string): Promise<BuildFrontendResult> {
  await ensureEsbuildInitialized()

  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡不存在: ${cardId}`)
  }
  const frontend = card.manifest.frontend
  if (!frontend || frontend.kind !== "packaged") {
    throw new Error("游戏卡无 packaged frontend binding，无法构建")
  }
  const framework: FrontendFramework = frontend.framework ?? "vanilla"
  const config = frameworkConfig(framework)
  const { sources, entryPath, entryContent } = await loadSources(cardId)

  const cdnPlugin = cdnExternalPlugin({ coreImports: config.coreImportMap })

  // Plugin order matters: sfcPlugin (specific .vue filter) must register its
  // onLoad BEFORE workspaceSourcePlugin's catch-all, so .vue is compiled by
  // the SFC compiler rather than returned as raw text.
  const plugins: esbuild.Plugin[] = [cdnPlugin]
  if (framework === "vue") {
    plugins.push(createSfcPlugin({ sources }))
  }
  plugins.push(workspaceSourcePlugin({ sources }))

  const result = await esbuild.build({
    stdin: {
      contents: entryContent,
      sourcefile: entryPath,
      resolveDir: "frontend/src",
      loader: entryPath.endsWith(".tsx")
        ? "tsx"
        : entryPath.endsWith(".jsx")
          ? "jsx"
          : entryPath.endsWith(".ts")
            ? "ts"
            : "js",
    },
    bundle: true,
    format: "esm",
    splitting: true,
    write: false,
    outdir: "assets",
    metafile: true,
    sourcemap: true,
    plugins,
    loader: { ".css": "css", ".json": "json" },
    // react/preact: automatic JSX runtime injects `import {jsx} from "<source>/jsx-runtime"`,
    // which is a bare import already in the core map → cdnExternalPlugin keeps it external.
    ...(config.jsx ? { jsx: config.jsx } : {}),
    ...(config.jsxImportSource ? { jsxImportSource: config.jsxImportSource } : {}),
  })

  // Build the import map: core entries + collected bare imports → esm.sh URL.
  // Collected extras without a known version get the bare name (esm.sh
  // resolves latest). Source package.json version pinning is a future refinement.
  const importMap = new Map<string, string>(config.coreImportMap)
  for (const bare of cdnPlugin.result.collected) {
    if (!importMap.has(bare)) {
      importMap.set(bare, `https://esm.sh/${bare}`)
    }
  }

  const writeBack = await writeBackDist({
    cardId,
    outputFiles: result.outputFiles ?? [],
    metafile: result.metafile!,
    importMap,
  })

  return {
    distPaths: writeBack.distPaths,
    entryHtmlPath: writeBack.entryHtmlPath,
    bareImports: [...importMap.keys()],
  }
}
