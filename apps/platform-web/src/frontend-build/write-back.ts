import type { Metafile, OutputFile } from "esbuild-wasm"
import {
  replaceLocalGameCardFrontendDist,
  type PutLocalGameCardFrontendFileInput,
} from "../storage"

/**
 * Write build outputs back to the game card's `frontend/dist/` and generate
 * `index.html`. Called only on a successful build — on failure the caller
 * keeps the old dist intact (R6).
 *
 * index.html references assets by relative path (`./assets/...`) because the
 * Service Worker serves under a virtual URL where absolute paths would fail.
 * JS outputs → `<script type="module">`, CSS outputs → `<link rel=stylesheet>`.
 * The import map (bare import → esm.sh URL) is injected in `<head>` so it
 * applies before the entry module executes.
 */

const DIST_PREFIX = "frontend/dist/"

export interface WriteBackInput {
  cardId: string
  outputFiles: OutputFile[]
  workerOutputFiles?: OutputFile[]
  metafile: Metafile
  /** Exact stdin sourcefile identity used by the root build entry. */
  entryPoint: string
  /** bare import name → esm.sh URL (core framework entries + collected extras). */
  importMap: Map<string, string>
}

export interface WriteBackResult {
  distPaths: string[]
  entryHtmlPath: string
}

function normalizeOutputPath(path: string): string {
  return path.replace(/^\/+/, "")
}

/** Find the one JS output whose metafile identity matches the root stdin sourcefile. */
function findEntryOutputPath(metafile: Metafile, entryPoint: string): string {
  const matches = Object.entries(metafile.outputs)
    .filter(([outputPath, output]) => output.entryPoint === entryPoint && /\.m?js$/i.test(outputPath))
    .map(([outputPath]) => normalizeOutputPath(outputPath))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) {
    throw new Error(`构建产物缺少根入口文件（metafile entryPoint=${JSON.stringify(entryPoint)}）`)
  }
  throw new Error(
    `构建产物存在多个根入口文件（metafile entryPoint=${JSON.stringify(entryPoint)}）: ${matches.join(", ")}`,
  )
}

export async function writeBackDist(input: WriteBackInput): Promise<WriteBackResult> {
  const { cardId, outputFiles, workerOutputFiles = [], metafile, entryPoint, importMap } = input
  const entryJsRel = findEntryOutputPath(metafile, entryPoint)

  const workerCss = workerOutputFiles
    .map((file) => normalizeOutputPath(file.path))
    .filter((path) => path.endsWith(".css"))
  if (workerCss.length > 0) {
    throw new Error(`Worker 构建不应产生 CSS 产物: ${workerCss.join(", ")}`)
  }

  // esbuild outputs paths like `assets/stdin.js` (relative to outdir) but may
  // carry a leading slash (`/assets/stdin.js`); strip it so DIST_PREFIX concat
  // doesn't produce a double slash (`frontend/dist//assets/...`). The storage
  // layer normalizes paths on write, but our `newPaths` set must hold the
  // SAME normalized form the storage layer stores, or stale cleanup will not
  // recognize freshly-written files.
  const allOutputFiles = [...outputFiles, ...workerOutputFiles]
  const newPaths = new Set<string>()
  const files: PutLocalGameCardFrontendFileInput[] = allOutputFiles.map((file) => {
    const rel = normalizeOutputPath(file.path)
    const distPath = DIST_PREFIX + rel
    newPaths.add(distPath)
    return { path: distPath, data: file.contents }
  })

  // CSS links are only for the main graph. Worker graph style imports are
  // rejected before this point, so worker outputs must not contribute links.
  const cssRelPaths = outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => normalizeOutputPath(f.path))

  const importMapJson = JSON.stringify({
    imports: Object.fromEntries(importMap),
  })
  const linkTags = cssRelPaths
    .map((p) => `  <link rel="stylesheet" href="./${p}">`)
    .join("\n")
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game Card Frontend</title>
  <script type="importmap">
  ${importMapJson}
  </script>
${linkTags}
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./${entryJsRel}"></script>
</body>
</html>`

  const entryHtmlPath = DIST_PREFIX + "index.html"
  files.push({ path: entryHtmlPath, data: html })
  newPaths.add(entryHtmlPath)

  const distPaths = await replaceLocalGameCardFrontendDist(cardId, {
    files,
    keepPaths: newPaths,
  })

  return { distPaths, entryHtmlPath }
}
