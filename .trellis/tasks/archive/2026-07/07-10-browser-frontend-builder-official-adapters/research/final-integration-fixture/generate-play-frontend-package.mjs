import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync, strToU8 } from "fflate"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "../../../../..")
const sourceRoot = resolve(repoRoot, "apps/play-frontend-dev/src")
const outputPath = resolve(repoRoot, "tmp/play-frontend-dev-source.tsian-frontend.zip")

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) return listFiles(full)
    if (!entry.isFile()) return []
    return [relative(sourceRoot, full).replace(/\\/g, "/")]
  })
}

const listed = listFiles(sourceRoot).sort()

function mediaTypeFor(path) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "text/typescript"
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript"
  if (path.endsWith(".vue")) return "text/x-vue"
  if (path.endsWith(".css")) return "text/css"
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"
  if (path.endsWith(".svg")) return "image/svg+xml"
  return "application/octet-stream"
}

const files = []
for (const rel of listed) {
  const srcPath = resolve(sourceRoot, rel)
  if (!srcPath.startsWith(sourceRoot)) throw new Error(`Unsafe path: ${rel}`)
  if (!statSync(srcPath).isFile()) continue
  const packagePath = `src/${rel.replace(/\\/g, "/")}`
  const data = readFileSync(srcPath)
  files.push({ path: packagePath, mediaType: mediaTypeFor(packagePath), data })
}

const manifest = {
  schema: "tsian.frontend-package.v1",
  entry: "dist/index.html",
  framework: "vue",
  bridgeVersion: "tsian.play-bridge.v1",
  files: files.map((file) => ({ path: file.path, mediaType: file.mediaType, size: file.data.byteLength })),
  exportedAt: new Date("2026-07-11T00:00:00.000Z").toISOString(),
  exporter: { name: "play-frontend-dev-source-regression", version: "0.1.0" },
}

const zipInput = { "frontend.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`) }
for (const file of files) zipInput[file.path] = file.data
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, zipSync(zipInput, { level: 6 }))
console.log(outputPath)
console.log(`${files.length} files`)
