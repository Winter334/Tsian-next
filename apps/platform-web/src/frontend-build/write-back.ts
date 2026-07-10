import type { Metafile, OutputFile } from "esbuild-wasm"
import {
  deleteLocalGameCardFrontendFile,
  listLocalGameCardFrontendFiles,
  writeLocalGameCardFrontendFile,
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
  const { cardId, outputFiles, metafile, entryPoint, importMap } = input
  const entryJsRel = findEntryOutputPath(metafile, entryPoint)

  // 1. Write all non-html output files to frontend/dist/.
  // esbuild outputs paths like `assets/stdin.js` (relative to outdir) but may
  // carry a leading slash (`/assets/stdin.js`); strip it so DIST_PREFIX concat
  // doesn't produce a double slash (`frontend/dist//assets/...`). The storage
  // layer normalizes paths on write, but our `newPaths` set must hold the
  // SAME normalized form the storage layer stores, or the stale-file cleanup
  // below won't recognize freshly-written files and will delete them.
  const newPaths = new Set<string>()
  for (const file of outputFiles) {
    const rel = normalizeOutputPath(file.path)
    const distPath = DIST_PREFIX + rel
    await writeLocalGameCardFrontendFile(cardId, { path: distPath, data: file.contents })
    newPaths.add(distPath)
  }

  // 2. Collect CSS outputs for <link> tags (strip leading slash, same as step 1).
  const cssRelPaths = outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => normalizeOutputPath(f.path))

  // 3. Generate index.html with import map + entry script + css links.
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
  await writeLocalGameCardFrontendFile(cardId, { path: entryHtmlPath, data: html })
  newPaths.add(entryHtmlPath)

  // 4. Clean old dist files not in the new output set.
  const existing = await listLocalGameCardFrontendFiles(cardId)
  for (const file of existing) {
    if (file.path.startsWith(DIST_PREFIX) && !newPaths.has(file.path)) {
      await deleteLocalGameCardFrontendFile(cardId, file.path)
    }
  }

  return { distPaths: [...newPaths], entryHtmlPath }
}
