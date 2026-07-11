import * as esbuild from "esbuild-wasm"
import type { FrontendFramework } from "@tsian/contracts"
import { getLocalGameCard, listLocalGameCardFrontendFiles } from "../storage"
import { isTextFilePath } from "@/lib/media-type"
import { blobToWorkspaceFile } from "@/lib/workspace-blob"
import { transformImportMetaGlob } from "./glob-transform"
import { cdnExternalPlugin } from "./plugins/cdn-external-plugin"
import { createSfcPlugin } from "./plugins/sfc-plugin"
import { workspaceSourcePlugin, type WorkspaceSourceContent } from "./plugins/workspace-source-plugin"
import {
  assertNoDirectWorkerConstructors,
  toDirectWorkerConstructorMessage,
} from "./worker-build/diagnostics"
import {
  buildQueuedWorkerEntries,
  createFrontendBuildContext,
} from "./worker-build"
import { createWorkerPlugin } from "./worker-build/plugin"
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
const PLAY_BRIDGE_IMPORT = "@tsian/play-bridge"
const PLAY_BRIDGE_CDN_URL = "https://esm.sh/@tsian/play-bridge@0.2.0-beta.0"

const ENTRY_CANDIDATES = [
  "main.ts",
  "main.tsx",
  "main.mts",
  "main.jsx",
  "main.js",
  "main.mjs",
  "index.ts",
  "index.tsx",
  "index.mts",
  "index.jsx",
  "index.js",
  "index.mjs",
]

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

/**
 * Lazily initialize esbuild-wasm. Idempotent across the module lifetime AND
 * across vite HMR reloads.
 *
 * esbuild-wasm's `initialize` is documented as "call exactly once" — it guards
 * internally (`Cannot call "initialize" more than once`) and reuses one
 * long-lived service for every subsequent `esbuild.build`.
 *
 * Two defenses against re-initialization:
 *
 * 1. **The init promise lives on `globalThis`, not a module-level variable.**
 *    vite HMR reloads this module on edit, which resets module-level state —
 *    but esbuild-wasm (a node_modules dep) is NOT reloaded, so its internal
 *    `initializePromise` survives. A module-level cache would diverge from
 *    esbuild-wasm's state after HMR (ours says "not init", theirs says "already
 *    init") and the next `initialize` call would throw. A `globalThis` cache
 *    survives the module reload, staying in sync with esbuild-wasm.
 *
 * 2. **`initialize` is wrapped to swallow "more than once".** If that error
 *    surfaces (e.g. the global cache was somehow cleared but esbuild-wasm's
 *    service is still alive), it means esbuild-wasm is ALREADY initialized —
 *    treat it as success rather than failing the build. A genuine init failure
 *    (wasm download error etc.) is a different error and still propagates.
 */
const ESBUILD_INIT_KEY = "__tsianEsbuildInitPromise__"

function getEsbuildInitPromise(): Promise<void> | null {
  return (globalThis as Record<string, unknown>)[ESBUILD_INIT_KEY] as
    | Promise<void>
    | null
    | undefined
  ?? null
}

function setEsbuildInitPromise(p: Promise<void> | null): void {
  if (p === null) {
    delete (globalThis as Record<string, unknown>)[ESBUILD_INIT_KEY]
  } else {
    (globalThis as Record<string, unknown>)[ESBUILD_INIT_KEY] = p
  }
}

export async function ensureEsbuildInitialized(): Promise<void> {
  const existing = getEsbuildInitPromise()
  if (existing) return existing

  const promise = (async () => {
    const wasmBuffer = await fetchWasmWithCache(ESBUILD_WASM_URL)
    // Blob URL keeps the binary in memory for esbuild's worker to fetch.
    const wasmBlob = new Blob([wasmBuffer], { type: "application/wasm" })
    const wasmURL = URL.createObjectURL(wasmBlob)
    try {
      await esbuild.initialize({ wasmURL, worker: true })
    } catch (e) {
      // "Cannot call initialize more than once" means esbuild-wasm already has
      // a live service (e.g. after an HMR reload where our global cache was
      // cleared but esbuild-wasm's module state survived). That's not a failure
      // — the service is usable, so swallow this specific error. Any other
      // error (wasm fetch, worker creation, ...) still propagates.
      const msg = e instanceof Error ? e.message : String(e)
      if (/more than once/i.test(msg)) {
        return
      }
      throw e
    }
  })()

  setEsbuildInitPromise(promise)
  // On failure, release the global cache so a later call can retry; esbuild-wasm
  // resets its internal initializePromise on rejection too, so re-initialize is
  // allowed. On success the promise stays cached for the page lifetime.
  promise.catch(() => {
    setEsbuildInitPromise(null)
  })
  return promise
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

function createBaseCoreImportMap(): Map<string, string> {
  return new Map([[PLAY_BRIDGE_IMPORT, PLAY_BRIDGE_CDN_URL]])
}

function frameworkConfig(framework: FrontendFramework): FrameworkConfig {
  switch (framework) {
    case "vue": {
      const m = createBaseCoreImportMap()
      m.set("vue", "https://esm.sh/vue@3")
      return { coreImportMap: m }
    }
    case "react": {
      const m = createBaseCoreImportMap()
      m.set("react", "https://esm.sh/react@18")
      m.set("react-dom", "https://esm.sh/react-dom@18")
      m.set("react-dom/client", "https://esm.sh/react-dom@18/client")
      m.set("react/jsx-runtime", "https://esm.sh/react@18/jsx-runtime")
      return { coreImportMap: m, jsx: "automatic", jsxImportSource: "react" }
    }
    case "preact": {
      const m = createBaseCoreImportMap()
      m.set("preact", "https://esm.sh/preact@10")
      m.set("preact/jsx-runtime", "https://esm.sh/preact@10/jsx-runtime")
      return { coreImportMap: m, jsx: "automatic", jsxImportSource: "preact" }
    }
    case "vanilla":
    default:
      return { coreImportMap: createBaseCoreImportMap() }
    case "svelte":
      // SFC compiler stub reserved (plugins/svelte-plugin.ts); NOT mounted
      // yet — svelte cards fall through to the pure-TS path until the second
      // SFC compiler is integrated. See prd.md D10 + svelte-plugin.ts TODO.
      return { coreImportMap: createBaseCoreImportMap() }
  }
}

// ─── Source loading ─────────────────────────────────────────────────────

interface LoadedSources {
  sources: Map<string, WorkspaceSourceContent>
  entryPath: string
  entryContent: string
}

function entryLoaderFor(path: string): "js" | "jsx" | "ts" | "tsx" {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith(".tsx")) return "tsx"
  if (lowerPath.endsWith(".jsx")) return "jsx"
  if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".mts") || lowerPath.endsWith(".cts")) return "ts"
  return "js"
}

/** Preload all `frontend/src/**` files from IndexedDB into memory. */
async function loadSources(cardId: string): Promise<LoadedSources> {
  const allFiles = await listLocalGameCardFrontendFiles(cardId)
  const sources = new Map<string, WorkspaceSourceContent>()
  for (const file of allFiles) {
    if (!file.path.startsWith(SOURCE_PREFIX)) continue
    const relPath = file.path.slice(SOURCE_PREFIX.length)
    if (isTextFilePath(relPath)) {
      const workspaceFile = await blobToWorkspaceFile({
        path: file.path,
        blob: file.data,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      })
      if (workspaceFile.binary) {
        throw new Error(`文本源码被投影为二进制文件: ${file.path}`)
      }
      sources.set(relPath, workspaceFile.content)
    } else {
      sources.set(relPath, new Uint8Array(await file.data.arrayBuffer()))
    }
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
  const entryContent = sources.get(entryPath)
  if (typeof entryContent !== "string") {
    throw new Error(`入口文件必须是文本源码: ${entryPath}`)
  }
  return { sources, entryPath, entryContent }
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
  const entryLoader = entryLoaderFor(entryPath)
  try {
    await assertNoDirectWorkerConstructors({
      code: entryContent,
      importer: entryPath,
      loader: entryLoader,
    })
  } catch (error) {
    const message = toDirectWorkerConstructorMessage(error, { importer: entryPath })
    throw Object.assign(new Error(message.text), { messageDetail: message })
  }
  const transformedEntry = await transformImportMetaGlob({
    code: entryContent,
    importer: entryPath,
    loader: entryLoader,
    sources,
  })

  const cdn = cdnExternalPlugin({ coreImports: config.coreImportMap })
  const buildContext = createFrontendBuildContext(sources)

  // Plugin order matters: workerPlugin handles ?worker before CDN/workspace catch-alls;
  // sfcPlugin (specific .vue filter) must register its onLoad before workspaceSourcePlugin's
  // catch-all so .vue is compiled by the SFC compiler rather than returned as raw text.
  const plugins: esbuild.Plugin[] = [createWorkerPlugin({ context: buildContext }), cdn.plugin]
  if (framework === "vue") {
    plugins.push(createSfcPlugin({ sources }))
  }
  plugins.push(workspaceSourcePlugin({ sources }))

  const result = await esbuild.build({
    stdin: {
      contents: transformedEntry.code,
      sourcefile: entryPath,
      resolveDir: "frontend/src",
      loader: entryLoader,
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
  for (const bare of cdn.result.collected) {
    if (!importMap.has(bare)) {
      importMap.set(bare, `https://esm.sh/${bare}`)
    }
  }

  const workerResults = await buildQueuedWorkerEntries(buildContext)
  const workerOutputFiles = workerResults.flatMap((worker) => worker.outputFiles)

  const writeBack = await writeBackDist({
    cardId,
    outputFiles: result.outputFiles ?? [],
    workerOutputFiles,
    metafile: result.metafile!,
    entryPoint: `${SOURCE_PREFIX}${entryPath}`,
    importMap,
  })

  return {
    distPaths: writeBack.distPaths,
    entryHtmlPath: writeBack.entryHtmlPath,
    bareImports: [...importMap.keys()],
  }
}
