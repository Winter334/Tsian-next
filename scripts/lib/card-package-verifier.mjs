import { strFromU8, unzipSync, zipSync } from "fflate"
import { assertSafeRelativePath } from "./source-package.mjs"

const textDecoder = new TextDecoder("utf-8", { fatal: true })

function fail(message) {
  throw new Error(message)
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
  )
}

function parseCentralDirectoryNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557)
  let eocdOffset = -1
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) fail("ZIP end-of-central-directory record is missing.")
  if (view.getUint16(eocdOffset + 4, true) !== 0 || view.getUint16(eocdOffset + 6, true) !== 0) {
    fail("Multi-disk ZIP archives are not supported.")
  }

  const entryCount = view.getUint16(eocdOffset + 10, true)
  let offset = view.getUint32(eocdOffset + 16, true)
  const names = []
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      fail("ZIP central directory is malformed.")
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > bytes.byteLength) fail("ZIP entry name is truncated.")
    try {
      names.push(textDecoder.decode(bytes.subarray(nameStart, nameEnd)))
    } catch {
      fail("ZIP entry names must be UTF-8.")
    }
    offset = nameEnd + extraLength + commentLength
  }
  return names
}

function validateArchiveNames(bytes) {
  const names = parseCentralDirectoryNames(bytes)
  const exact = new Set()
  const folded = new Map()
  for (const name of names) {
    assertSafeRelativePath(name, "ZIP entry path")
    if (exact.has(name)) fail(`Duplicate ZIP entry: ${name}`)
    exact.add(name)
    const key = name.toLocaleLowerCase("en-US")
    const existing = folded.get(key)
    if (existing && existing !== name) fail(`Case-conflicting ZIP entries: ${existing} and ${name}`)
    folded.set(key, name)
    if (
      name !== "game-card.json"
      && !name.startsWith("workspace/")
      && !name.startsWith("frontend/")
      && !name.startsWith("cover/")
    ) {
      fail(`Unsupported ZIP entry root: ${name}`)
    }
    if (/^workspace\/(?:save|\.tsian)(?:\/|$)/i.test(name)) {
      fail(`Runtime-owned workspace path was packaged: ${name}`)
    }
  }
  return names
}

function parseManifest(entries) {
  const bytes = entries["game-card.json"]
  if (!bytes) fail("Package is missing game-card.json.")
  let value
  try {
    value = JSON.parse(strFromU8(bytes))
  } catch {
    fail("game-card.json is not valid UTF-8 JSON.")
  }
  if (!isObject(value) || value.schema !== "tsian.game-card.package.v1") {
    fail("game-card.json has an unsupported package schema.")
  }
  return value
}

function inventoryFor(manifest, fieldName, prefix, entries) {
  const inventory = manifest[fieldName]
  if (!Array.isArray(inventory)) fail(`${fieldName} must be an array.`)
  const paths = new Set()
  const folded = new Map()
  for (const item of inventory) {
    if (!isObject(item) || typeof item.path !== "string") fail(`${fieldName} contains an invalid entry.`)
    assertSafeRelativePath(item.path, `${fieldName} path`)
    if (!item.path.startsWith(prefix)) fail(`${fieldName} entry has the wrong root: ${item.path}`)
    if (paths.has(item.path)) fail(`${fieldName} contains a duplicate path: ${item.path}`)
    paths.add(item.path)
    const key = item.path.toLocaleLowerCase("en-US")
    const existing = folded.get(key)
    if (existing && existing !== item.path) fail(`${fieldName} contains case-conflicting paths: ${existing} and ${item.path}`)
    folded.set(key, item.path)
    const entry = entries[item.path]
    if (!entry) fail(`${fieldName} indexes a missing ZIP entry: ${item.path}`)
    if (!Number.isInteger(item.size) || item.size !== entry.byteLength) {
      fail(`${fieldName} size does not match ZIP bytes for ${item.path}.`)
    }
    if (typeof item.mediaType !== "string" || !item.mediaType.trim()) {
      fail(`${fieldName} mediaType is missing for ${item.path}.`)
    }
  }

  const actualPaths = Object.keys(entries).filter((entryPath) => entryPath.startsWith(prefix))
  for (const entryPath of actualPaths) {
    if (!paths.has(entryPath)) fail(`${fieldName} is missing ZIP entry: ${entryPath}`)
  }
  if (paths.size !== actualPaths.length) fail(`${fieldName} does not match the ZIP entry set.`)
  return inventory
}

function requireMatchingBytes(entries, packagePath, expected, label) {
  const actual = entries[packagePath]
  if (!actual) fail(`${label} is missing from the package: ${packagePath}`)
  if (!bytesEqual(actual, expected)) fail(`${label} bytes changed during packaging: ${packagePath}`)
}

function assertRoundTrip(entries) {
  const rebuilt = unzipSync(zipSync(entries, { level: 6 }))
  const paths = Object.keys(entries).sort()
  if (JSON.stringify(Object.keys(rebuilt).sort()) !== JSON.stringify(paths)) {
    fail("ZIP entry set changed during round-trip verification.")
  }
  for (const path of paths) {
    if (!bytesEqual(entries[path], rebuilt[path])) fail(`ZIP round-trip changed entry bytes: ${path}`)
  }
}

export function verifyCardPackage(bytesInput, snapshot, authorManifest) {
  const bytes = bytesInput instanceof Uint8Array ? bytesInput : new Uint8Array(bytesInput)
  const centralNames = validateArchiveNames(bytes)
  let entries
  try {
    entries = unzipSync(bytes)
  } catch {
    fail("Browser exporter returned an invalid ZIP archive.")
  }
  if (centralNames.length !== Object.keys(entries).length) {
    fail("ZIP central directory and extracted entry set differ.")
  }

  const manifest = parseManifest(entries)
  if (JSON.stringify(canonicalJson(manifest.manifest)) !== JSON.stringify(canonicalJson(authorManifest))) {
    fail("Exported game-card manifest differs from card-manifest.json.")
  }
  const workspaceInventory = inventoryFor(manifest, "workspaceFiles", "workspace/", entries)
  const frontendInventory = inventoryFor(manifest, "frontendFiles", "frontend/", entries)
  const coverInventory = inventoryFor(manifest, "coverFiles", "cover/", entries)

  for (const file of snapshot.workspaceFiles) {
    requireMatchingBytes(entries, `workspace/${file.path}`, file.bytes, "Workspace source")
  }
  for (const file of snapshot.frontendFiles) {
    const packagePath = `frontend/src/${file.path}`
    requireMatchingBytes(entries, packagePath, file.bytes, "Frontend source")
    const indexed = frontendInventory.find((item) => item.path === packagePath)
    if (indexed?.mediaType !== file.mediaType) {
      fail(`Frontend source mediaType changed during packaging: ${packagePath}`)
    }
  }
  requireMatchingBytes(entries, snapshot.coverFile.packagePath, snapshot.coverFile.bytes, "Cover source")
  const indexedCover = coverInventory.find((item) => item.path === snapshot.coverFile.packagePath)
  if (indexedCover?.mediaType !== snapshot.coverFile.mediaType) {
    fail(`Cover mediaType changed during packaging: ${snapshot.coverFile.packagePath}`)
  }

  const workspacePaths = new Set(snapshot.workspaceFiles.map((file) => `workspace/${file.path}`))
  if (workspaceInventory.some((item) => !workspacePaths.has(item.path))) {
    fail("Package contains workspace files outside the authoritative workspace source tree.")
  }
  const sourcePaths = new Set(snapshot.frontendFiles.map((file) => `frontend/src/${file.path}`))
  for (const item of frontendInventory) {
    if (item.path.startsWith("frontend/src/") && !sourcePaths.has(item.path)) {
      fail(`Package contains non-authoritative frontend source: ${item.path}`)
    }
    if (!item.path.startsWith("frontend/src/") && !item.path.startsWith("frontend/dist/")) {
      fail(`Package contains an unsupported frontend path: ${item.path}`)
    }
  }

  const entryPath = authorManifest.frontend?.entry
  if (typeof entryPath !== "string" || !entries[entryPath]) fail("Built frontend entry is missing from the package.")
  if (entryPath !== "frontend/dist/index.html") fail(`Unexpected packaged frontend entry: ${entryPath}`)
  assertRoundTrip(entries)

  return {
    manifest,
    totalFileCount: Object.keys(entries).length - 1,
    workspaceFileCount: workspaceInventory.length,
    frontendSourceFileCount: sourcePaths.size,
    frontendDistFileCount: frontendInventory.length - sourcePaths.size,
    coverFileCount: coverInventory.length,
  }
}
