import { promises as fs } from "node:fs"
import path from "node:path"

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

export function mediaTypeForPath(filePath) {
  return mediaTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream"
}

export function assertSafeRelativePath(value, label = "File path") {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required.`)
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} is unsafe: ${value}`)
  }
  const segments = value.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} is unsafe: ${value}`)
  }
  return value
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export async function listTreeFiles(root) {
  const absoluteRoot = path.resolve(root)
  const files = []

  async function visit(directory, segments) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => compareStrings(left.name, right.name))
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const nextSegments = [...segments, entry.name]
      if (entry.isDirectory()) {
        await visit(absolutePath, nextSegments)
      } else if (entry.isFile()) {
        const relativePath = assertSafeRelativePath(nextSegments.join("/"))
        files.push({ absolutePath, relativePath })
      } else {
        throw new Error(`Source trees cannot contain symlinks or special entries: ${absolutePath}`)
      }
    }
  }

  await visit(absoluteRoot, [])
  files.sort((left, right) => compareStrings(left.relativePath, right.relativePath))

  const paths = new Set()
  const caseFoldedPaths = new Map()
  for (const file of files) {
    if (paths.has(file.relativePath)) throw new Error(`Duplicate source path: ${file.relativePath}`)
    paths.add(file.relativePath)
    const folded = file.relativePath.toLocaleLowerCase("en-US")
    const existing = caseFoldedPaths.get(folded)
    if (existing && existing !== file.relativePath) {
      throw new Error(`Case-conflicting source paths: ${existing} and ${file.relativePath}`)
    }
    caseFoldedPaths.set(folded, file.relativePath)
  }
  return files
}
