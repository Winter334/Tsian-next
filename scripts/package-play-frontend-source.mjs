#!/usr/bin/env node
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync, strToU8 } from "fflate"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const defaultSourceDir = path.join(repoRoot, "apps/play-frontend-dev/src")
const defaultOutDir = path.join(repoRoot, "tmp/frontend-packages")
const defaultBaseName = "play-frontend-dev-source"

const mediaTypes = new Map([
  [".ts", "text/typescript; charset=utf-8"],
  [".tsx", "text/typescript; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".jsx", "text/javascript; charset=utf-8"],
  [".vue", "text/plain; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".scss", "text/x-scss; charset=utf-8"],
  [".sass", "text/x-sass; charset=utf-8"],
  [".less", "text/less; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".eot", "application/vnd.ms-fontobject"],
  [".wasm", "application/wasm"],
])

function usage() {
  return `Usage: node scripts/package-play-frontend-source.mjs [options]

Options:
  --out <path>        Output zip path. Defaults to tmp/frontend-packages/<name>-YYYYMMDD.tsian-frontend.zip
  --out-dir <path>    Output directory when --out is not set. Defaults to tmp/frontend-packages
  --name <name>       Output base name when --out is not set. Defaults to play-frontend-dev-source
  --source <path>     Source directory to package. Defaults to apps/play-frontend-dev/src
  --help              Show this help
`
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true
        break
      case "--out":
        options.out = requireValue(argv, ++index, arg)
        break
      case "--out-dir":
        options.outDir = requireValue(argv, ++index, arg)
        break
      case "--name":
        options.name = requireValue(argv, ++index, arg)
        break
      case "--source":
        options.source = requireValue(argv, ++index, arg)
        break
      default:
        throw new Error(`Unknown option: ${arg}\n\n${usage()}`)
    }
  }
  return options
}

function requireValue(argv, index, option) {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`)
  }
  return value
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value)
}

function dateStamp(date = new Date()) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}${month}${day}`
}

function mediaTypeFor(filePath) {
  return mediaTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream"
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

async function outputPathFor(options) {
  if (options.out) {
    return resolveFromRoot(options.out)
  }
  const outDir = options.outDir ? resolveFromRoot(options.outDir) : defaultOutDir
  const name = options.name ?? defaultBaseName
  return path.join(outDir, `${name}-${dateStamp()}.tsian-frontend.zip`)
}

async function packageSourceFrontend(options) {
  const sourceDir = options.source ? resolveFromRoot(options.source) : defaultSourceDir
  const entryPath = path.join(sourceDir, "main.ts")
  if (!await exists(entryPath)) {
    throw new Error(`Source frontend entry is missing: ${entryPath}`)
  }

  const files = (await walk(sourceDir)).sort((left, right) => left.localeCompare(right))
  const zipInput = {}
  const manifestFiles = []

  for (const filePath of files) {
    const relFromSrc = path.relative(sourceDir, filePath).split(path.sep).join("/")
    const packagePath = `src/${relFromSrc}`
    const data = new Uint8Array(await fs.readFile(filePath))
    zipInput[packagePath] = data
    manifestFiles.push({
      path: packagePath,
      mediaType: mediaTypeFor(filePath),
      size: data.byteLength,
    })
  }

  const manifest = {
    schema: "tsian.frontend-package.v1",
    entry: "dist/index.html",
    framework: "vue",
    bridgeVersion: "tsian.play-bridge.v1",
    files: manifestFiles,
    exportedAt: new Date().toISOString(),
    exporter: {
      name: "play-frontend-dev",
      version: "0.0.0",
    },
  }

  zipInput["frontend.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`)

  const outPath = await outputPathFor(options)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, zipSync(zipInput, { level: 6 }))
  const stat = await fs.stat(outPath)

  return { outPath, fileCount: manifestFiles.length, size: stat.size }
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    process.exit(0)
  }
  const result = await packageSourceFrontend(options)
  console.log(`Wrote ${result.outPath}`)
  console.log(`Packaged ${result.fileCount} source files (${result.size} bytes).`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
