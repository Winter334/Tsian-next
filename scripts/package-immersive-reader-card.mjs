#!/usr/bin/env node
import { promises as fs } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  readRequestBytes,
  runInIsolatedBrowser,
  startStaticHarnessServer,
} from "./lib/headless-browser.mjs"
import { verifyCardPackage } from "./lib/card-package-verifier.mjs"
import {
  assertSafeRelativePath,
  listTreeFiles,
  mediaTypeForPath,
} from "./lib/source-package.mjs"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDirectory, "..")
const cardRoot = path.join(repoRoot, "cards", "沉浸阅读器.tsian-card")
const manifestPath = path.join(cardRoot, "card-manifest.json")
const workspaceRoot = path.join(cardRoot, "workspace")
const coverRoot = path.join(cardRoot, "cover")
const frontendRoot = path.join(repoRoot, "apps", "play-frontend-dev", "src")
const harnessDistRoot = path.join(repoRoot, "apps", "platform-web", "dist-card-package-harness")
const defaultOutputDirectory = path.join(repoRoot, "tmp", "card-packages")
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

function usage() {
  return `Usage: node scripts/package-immersive-reader-card.mjs [options]

Builds the immersive reader card with the platform's real browser build/export chain.

Options:
  --out <path>  Explicit output path. Existing files are replaced with backup/swap rollback.
  --help        Show this help.
`
}

function fail(message) {
  throw new Error(message)
}

function requireValue(argv, index, option) {
  const value = argv[index]
  if (!value || value.startsWith("--")) fail(`${option} requires a value.`)
  return value
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--help":
      case "-h":
        options.help = true
        break
      case "--out":
        options.out = requireValue(argv, ++index, "--out")
        break
      default:
        fail(`Unknown option: ${argv[index]}\n\n${usage()}`)
    }
  }
  return options
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertObject(value, fieldName) {
  if (!isObject(value)) fail(`${fieldName} must be an object.`)
  return value
}

function assertKeys(value, allowedKeys, fieldName) {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key))
  if (unknown.length > 0) fail(`${fieldName} contains unsupported fields: ${unknown.join(", ")}`)
}

function nonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) fail(`${fieldName} must be a non-empty string.`)
  return value
}

function deepFreeze(value) {
  if (!isObject(value) && !Array.isArray(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

async function loadAuthorManifestSnapshot() {
  let bytes
  try {
    bytes = new Uint8Array(await fs.readFile(manifestPath))
  } catch (error) {
    fail(`Could not read ${path.relative(repoRoot, manifestPath)}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let value
  try {
    value = JSON.parse(textDecoder.decode(bytes))
  } catch (error) {
    fail(`Could not parse ${path.relative(repoRoot, manifestPath)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const manifest = assertObject(value, "card-manifest.json")
  assertKeys(manifest, ["schema", "id", "name", "version", "summary", "author", "cover", "frontend", "runtime"], "card-manifest.json")
  if (manifest.schema !== "tsian.game-card.v1") fail("card-manifest.json schema must be tsian.game-card.v1.")
  for (const field of ["id", "name", "version", "summary"]) nonEmptyString(manifest[field], `manifest.${field}`)

  if (manifest.author !== undefined) {
    const author = assertObject(manifest.author, "manifest.author")
    assertKeys(author, ["name", "url"], "manifest.author")
    nonEmptyString(author.name, "manifest.author.name")
    if (author.url !== undefined) nonEmptyString(author.url, "manifest.author.url")
  }

  const cover = assertObject(manifest.cover, "manifest.cover")
  assertKeys(cover, ["workspacePath", "alt"], "manifest.cover")
  const coverContentPath = assertSafeRelativePath(
    nonEmptyString(cover.workspacePath, "manifest.cover.workspacePath"),
    "manifest.cover.workspacePath",
  )
  if (!coverContentPath.startsWith(".cover/")) fail("manifest.cover.workspacePath must live under .cover/.")
  if (coverContentPath.slice(".cover/".length).includes("/")) {
    fail("The immersive-reader exporter currently requires one flat .cover/<file> path.")
  }
  if (cover.alt !== undefined) nonEmptyString(cover.alt, "manifest.cover.alt")

  const frontend = assertObject(manifest.frontend, "manifest.frontend")
  assertKeys(frontend, ["kind", "entry", "framework", "bridgeVersion"], "manifest.frontend")
  if (frontend.kind !== "packaged") fail("manifest.frontend.kind must be packaged.")
  if (frontend.entry !== "frontend/dist/index.html") fail("manifest.frontend.entry must be frontend/dist/index.html.")
  if (frontend.framework !== "vue") fail("manifest.frontend.framework must be vue for the immersive reader.")
  if (frontend.bridgeVersion !== "tsian.play-bridge.v1") fail("manifest.frontend.bridgeVersion is unsupported.")

  const runtime = assertObject(manifest.runtime, "manifest.runtime")
  assertKeys(runtime, ["entrypoints"], "manifest.runtime")
  const entrypoints = assertObject(runtime.entrypoints, "manifest.runtime.entrypoints")
  assertKeys(entrypoints, ["playerTurn", "postTurnMaintenance"], "manifest.runtime.entrypoints")
  nonEmptyString(entrypoints.playerTurn, "manifest.runtime.entrypoints.playerTurn")
  if (entrypoints.postTurnMaintenance !== undefined) {
    nonEmptyString(entrypoints.postTurnMaintenance, "manifest.runtime.entrypoints.postTurnMaintenance")
  }
  return { manifest: deepFreeze(manifest), bytes }
}

function byteArraysEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function snapshotInputs() {
  const { manifest, bytes: manifestBytes } = await loadAuthorManifestSnapshot()
  const workspaceSources = await listTreeFiles(workspaceRoot)
  const frontendSources = await listTreeFiles(frontendRoot)
  const coverSources = await listTreeFiles(coverRoot)
  if (!frontendSources.some((file) => file.relativePath === "main.ts")) {
    fail(`Frontend source entry is missing: ${path.join(frontendRoot, "main.ts")}`)
  }
  if (coverSources.length !== 1) fail("The immersive reader card must have exactly one authoritative cover file.")

  const expectedCoverRelativePath = manifest.cover.workspacePath.slice(".cover/".length)
  if (coverSources[0].relativePath !== expectedCoverRelativePath) {
    fail(`Author manifest cover ${expectedCoverRelativePath} does not match cards/沉浸阅读器.tsian-card/cover/.`)
  }

  const sourceChecks = []
  const workspaceFiles = []
  for (const file of workspaceSources) {
    const firstSegment = file.relativePath.split("/", 1)[0].toLocaleLowerCase("en-US")
    if (["save", ".tsian", "frontend"].includes(firstSegment) || file.relativePath.toLocaleLowerCase("en-US") === "game-card.json") {
      fail(`Workspace source uses a reserved path: ${file.relativePath}`)
    }
    const bytes = new Uint8Array(await fs.readFile(file.absolutePath))
    let content
    try {
      content = textDecoder.decode(bytes)
    } catch {
      fail(`Workspace source must be UTF-8 text: ${file.relativePath}`)
    }
    if (!byteArraysEqual(new TextEncoder().encode(content), bytes)) {
      fail(`Workspace source cannot be losslessly represented as UTF-8 text: ${file.relativePath}`)
    }
    workspaceFiles.push({ path: file.relativePath, content, bytes })
    sourceChecks.push({ absolutePath: file.absolutePath, bytes })
  }

  const frontendFiles = []
  for (const file of frontendSources) {
    const bytes = new Uint8Array(await fs.readFile(file.absolutePath))
    frontendFiles.push({
      path: file.relativePath,
      mediaType: mediaTypeForPath(file.relativePath),
      bytes,
    })
    sourceChecks.push({ absolutePath: file.absolutePath, bytes })
  }

  const coverSource = coverSources[0]
  const coverBytes = new Uint8Array(await fs.readFile(coverSource.absolutePath))
  const coverMediaType = mediaTypeForPath(coverSource.relativePath)
  if (!coverMediaType.startsWith("image/")) fail(`Cover source is not a supported image: ${coverSource.relativePath}`)
  sourceChecks.push({ absolutePath: coverSource.absolutePath, bytes: coverBytes })
  sourceChecks.push({ absolutePath: manifestPath, bytes: manifestBytes })

  return {
    manifest,
    workspaceFiles,
    frontendFiles,
    coverFile: {
      path: coverSource.relativePath,
      contentPath: manifest.cover.workspacePath,
      packagePath: `cover/${path.posix.basename(coverSource.relativePath)}`,
      mediaType: coverMediaType,
      bytes: coverBytes,
    },
    sourceChecks,
    treeChecks: [
      { root: workspaceRoot, paths: workspaceSources.map((file) => file.relativePath) },
      { root: frontendRoot, paths: frontendSources.map((file) => file.relativePath) },
      { root: coverRoot, paths: coverSources.map((file) => file.relativePath) },
    ],
  }
}

function encodedInput(manifest, snapshot) {
  return {
    manifest,
    workspaceFiles: snapshot.workspaceFiles.map((file) => ({ path: file.path, content: file.content })),
    frontendFiles: snapshot.frontendFiles.map((file) => ({
      path: `frontend/src/${file.path}`,
      mediaType: file.mediaType,
      base64: Buffer.from(file.bytes).toString("base64"),
    })),
    coverFile: {
      path: snapshot.coverFile.packagePath,
      contentPath: snapshot.coverFile.contentPath,
      mediaType: snapshot.coverFile.mediaType,
      base64: Buffer.from(snapshot.coverFile.bytes).toString("base64"),
    },
  }
}

async function runBrowserExporter(manifest, snapshot) {
  const inputBytes = Buffer.from(JSON.stringify(encodedInput(manifest, snapshot)))
  let settleResult
  let settled = false
  const result = new Promise((resolveResult) => { settleResult = resolveResult })
  const harnessServer = await startStaticHarnessServer({
    distRoot: harnessDistRoot,
    handleRequest: async ({ request, response, url }) => {
      if (url.pathname === "/__card-package-input" && request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": inputBytes.byteLength,
          "Cache-Control": "no-store",
        })
        response.end(inputBytes)
        return true
      }
      if (url.pathname === "/__card-package-result" && request.method === "POST") {
        const body = await readRequestBytes(request)
        let summary = {}
        const encodedSummary = request.headers["x-tsian-card-package-summary"]
        if (typeof encodedSummary === "string" && encodedSummary) {
          summary = JSON.parse(decodeURIComponent(encodedSummary))
        }
        if (!settled) {
          settled = true
          settleResult({ kind: "package", bytes: new Uint8Array(body), summary })
        }
        response.writeHead(204).end()
        return true
      }
      if (url.pathname === "/__card-package-error" && request.method === "POST") {
        const body = await readRequestBytes(request)
        if (!settled) {
          settled = true
          settleResult({ kind: "error", payload: JSON.parse(body.toString("utf8")) })
        }
        response.writeHead(204).end()
        return true
      }
      return false
    },
  })

  try {
    const probe = await fetch(harnessServer.url)
    if (!probe.ok) fail(`Card package harness returned HTTP ${probe.status}.`)
    const completed = await runInIsolatedBrowser({
      url: harnessServer.url,
      result,
      profilePrefix: "tsian-card-package-",
      timeoutMs: 120_000,
      timeoutMessage: "Headless browser timed out while building the card package.",
    })
    if (completed.result.kind === "error") {
      const error = completed.result.payload?.error
      fail(`Browser card build/export failed: ${error?.message ?? JSON.stringify(completed.result.payload)}`)
    }
    return { browser: completed.browser, ...completed.result }
  } finally {
    await harnessServer.close()
  }
}

function assertByteSizeRegression(summary) {
  const sizes = summary?.byteSizeRegression
  for (const name of ["ascii.txt", "chinese.txt", "emoji.txt", "binary.bin"]) {
    if (!Number.isInteger(sizes?.[name]) || sizes[name] <= 0) {
      fail(`Browser exporter byte-size regression did not report ${name}.`)
    }
  }
  if (summary?.importRoundTrip !== true) {
    fail("Browser exporter did not complete the platform import round-trip.")
  }
}

async function assertSourcesUnchanged(snapshot) {
  for (const tree of snapshot.treeChecks) {
    const currentPaths = (await listTreeFiles(tree.root)).map((file) => file.relativePath)
    if (JSON.stringify(currentPaths) !== JSON.stringify(tree.paths)) {
      fail(`Authoritative source tree changed during packaging: ${path.relative(repoRoot, tree.root)}`)
    }
  }
  for (const source of snapshot.sourceChecks) {
    const current = new Uint8Array(await fs.readFile(source.absolutePath))
    if (!byteArraysEqual(current, source.bytes)) {
      fail(`Authoritative source changed during packaging: ${path.relative(repoRoot, source.absolutePath)}`)
    }
  }
}

function dateStamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("")
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function lstatIfExists(filePath) {
  try {
    return await fs.lstat(filePath)
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null
    throw error
  }
}

function explicitTargetPath(options) {
  if (!options.out) return null
  return path.isAbsolute(options.out) ? options.out : path.resolve(repoRoot, options.out)
}

async function assertExplicitTargetIsFileOrMissing(targetPath) {
  if (!targetPath) return
  const targetStat = await lstatIfExists(targetPath)
  if (targetStat && !targetStat.isFile()) {
    fail(`--out target must be a regular file or a missing path: ${targetPath}`)
  }
}

async function publishDefault(stagedPath) {
  for (let sequence = 1; ; sequence += 1) {
    const suffix = sequence === 1 ? "" : `-${sequence}`
    const targetPath = path.join(
      defaultOutputDirectory,
      `沉浸阅读器-${dateStamp()}${suffix}.tsian-card.zip`,
    )
    try {
      await fs.link(stagedPath, targetPath)
      return targetPath
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") continue
      throw error
    }
  }
}

async function publishExplicit(stagedPath, targetPath) {
  for (;;) {
    const targetStat = await lstatIfExists(targetPath)
    if (!targetStat) {
      try {
        await fs.link(stagedPath, targetPath)
        return targetPath
      } catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") continue
        throw error
      }
    }
    if (!targetStat.isFile()) {
      fail(`--out target must be a regular file or a missing path: ${targetPath}`)
    }

    const backupPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.backup-${process.pid}-${randomUUID()}`,
    )
    await fs.rename(targetPath, backupPath)
    try {
      const backupStat = await fs.lstat(backupPath)
      if (!backupStat.isFile()) {
        fail(`--out target changed into a non-file during publication: ${targetPath}`)
      }
      await fs.link(stagedPath, targetPath)
    } catch (publishError) {
      try {
        await fs.rename(backupPath, targetPath)
      } catch (restoreError) {
        fail(`Publishing failed and backup restore also failed. Recover ${backupPath}. Publish error: ${publishError}; restore error: ${restoreError}`)
      }
      throw publishError
    }
    try {
      await fs.unlink(backupPath)
    } catch (cleanupError) {
      process.stderr.write(`Warning: package published, but the previous output backup could not be removed: ${backupPath} (${cleanupError})\n`)
    }
    return targetPath
  }
}

async function stageAndPublish(bytes, options, manifest, snapshot) {
  const explicitTarget = explicitTargetPath(options)
  const outputDirectory = explicitTarget ? path.dirname(explicitTarget) : defaultOutputDirectory
  await fs.mkdir(outputDirectory, { recursive: true })
  const stagedPath = path.join(
    outputDirectory,
    `.沉浸阅读器-card-package.tmp-${process.pid}-${randomUUID()}`,
  )
  await fs.writeFile(stagedPath, bytes, { flag: "wx" })
  try {
    const stagedBytes = new Uint8Array(await fs.readFile(stagedPath))
    verifyCardPackage(stagedBytes, snapshot, manifest)
    await assertSourcesUnchanged(snapshot)
    return explicitTarget
      ? await publishExplicit(stagedPath, explicitTarget)
      : await publishDefault(stagedPath)
  } finally {
    try {
      await fs.rm(stagedPath, { force: true })
    } catch (cleanupError) {
      process.stderr.write(`Warning: temporary package file could not be removed: ${stagedPath} (${cleanupError})\n`)
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  if (!await pathExists(path.join(harnessDistRoot, "index.html"))) {
    fail("Card package browser harness is not built. Run npm run package:card from the repository root.")
  }
  await assertExplicitTargetIsFileOrMissing(explicitTargetPath(options))

  const snapshot = await snapshotInputs()
  const manifest = snapshot.manifest
  const browserResult = await runBrowserExporter(manifest, snapshot)
  assertByteSizeRegression(browserResult.summary)
  const verification = verifyCardPackage(browserResult.bytes, snapshot, manifest)
  if (browserResult.summary.entryHtmlPath !== "frontend/dist/index.html") {
    fail(`Browser build reported an unexpected entry: ${browserResult.summary.entryHtmlPath}`)
  }
  const outputPath = await stageAndPublish(browserResult.bytes, options, manifest, snapshot)
  const outputStat = await fs.stat(outputPath)

  process.stdout.write(`Wrote ${outputPath}\n`)
  process.stdout.write(
    `Packaged ${verification.totalFileCount} files (${verification.workspaceFileCount} workspace, `
    + `${verification.frontendSourceFileCount} frontend source, ${verification.frontendDistFileCount} frontend dist, `
    + `${verification.coverFileCount} cover; ${outputStat.size} bytes).\n`,
  )
  process.stdout.write(`Validated platform import round trip, schema, path safety, exact inventories, UTF-8/binary byte sizes, source bytes, dist entry, and ZIP round trip with ${browserResult.browser}.\n`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
