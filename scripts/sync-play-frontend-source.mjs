#!/usr/bin/env node
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const defaultSourceDir = path.join(repoRoot, "apps/play-frontend-dev")
const defaultTargetDir = path.resolve(repoRoot, "../Tsian-Singularity")

const syncedEntries = [
  "index.html",
  "tsconfig.json",
  "public",
  "src",
]

function usage() {
  return `Usage: node scripts/sync-play-frontend-source.mjs [options]

Options:
  --target <path>       Standalone repository path. Defaults to ../Tsian-Singularity
  --source <path>       Source frontend app directory. Defaults to apps/play-frontend-dev
  --dry-run             Print planned changes without writing files
  --force               Allow syncing when target git worktree is dirty, and skip target name guard
  --no-package-json     Do not merge dependencies/scripts from source package.json
  --help                Show this help
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
      case "--target":
        options.target = requireValue(argv, ++index, arg)
        break
      case "--source":
        options.source = requireValue(argv, ++index, arg)
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "--force":
        options.force = true
        break
      case "--no-package-json":
        options.noPackageJson = true
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

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function assertDirectory(dirPath, label) {
  const stat = await fs.stat(dirPath).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error(`${label} is not a directory: ${dirPath}`)
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function mergeObjectWithSourcePriority(sourceValue, targetValue) {
  const source = sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)
    ? sourceValue
    : {}
  const target = targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)
    ? targetValue
    : {}
  const sourceKeys = new Set(Object.keys(source))
  const targetExtras = Object.fromEntries(
    Object.entries(target).filter(([key]) => !sourceKeys.has(key)),
  )
  return { ...source, ...targetExtras }
}

function mergeScripts(sourceScripts, targetScripts) {
  const source = sourceScripts && typeof sourceScripts === "object" && !Array.isArray(sourceScripts)
    ? sourceScripts
    : {}
  const target = targetScripts && typeof targetScripts === "object" && !Array.isArray(targetScripts)
    ? targetScripts
    : {}
  return { ...source, ...target }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function gitStatus(targetDir) {
  const { stdout } = await execFileAsync("git", ["-C", targetDir, "status", "--porcelain"])
  return stdout.trim()
}

async function assertTargetRepo(targetDir, options) {
  await assertDirectory(targetDir, "Target repository")
  if (!await exists(path.join(targetDir, ".git"))) {
    throw new Error(`Target repository is missing .git: ${targetDir}`)
  }

  const targetPackagePath = path.join(targetDir, "package.json")
  if (!await exists(targetPackagePath)) {
    throw new Error(`Target repository is missing package.json: ${targetPackagePath}`)
  }

  const targetPackage = await readJson(targetPackagePath)
  if (targetPackage.name !== "tsian-singularity" && !options.force) {
    throw new Error(
      `Target package name is ${JSON.stringify(targetPackage.name)}, expected "tsian-singularity". Use --force to override.`,
    )
  }

  const status = await gitStatus(targetDir)
  if (status && !options.force && !options.dryRun) {
    throw new Error(
      `Target repository has uncommitted changes. Commit/stash them first, or use --force.\n\n${status}`,
    )
  }
}

async function assertSourceFrontend(sourceDir) {
  await assertDirectory(sourceDir, "Source frontend")
  const entryPath = path.join(sourceDir, "src/main.ts")
  if (!await exists(entryPath)) {
    throw new Error(`Source frontend entry is missing: ${entryPath}`)
  }
}

async function copyEntry(sourceDir, targetDir, entry, options) {
  const sourcePath = path.join(sourceDir, entry)
  const targetPath = path.join(targetDir, entry)
  if (!await exists(sourcePath)) {
    throw new Error(`Source entry is missing: ${sourcePath}`)
  }

  if (options.dryRun) {
    console.log(`[dry-run] sync ${path.relative(repoRoot, sourcePath)} -> ${targetPath}`)
    return
  }

  await fs.rm(targetPath, { recursive: true, force: true })
  await fs.cp(sourcePath, targetPath, { recursive: true })
}

async function syncPackageJson(sourceDir, targetDir, options) {
  if (options.noPackageJson) {
    return false
  }

  const sourcePackagePath = path.join(sourceDir, "package.json")
  const targetPackagePath = path.join(targetDir, "package.json")
  const sourcePackage = await readJson(sourcePackagePath)
  const targetPackage = await readJson(targetPackagePath)
  const nextPackage = {
    ...targetPackage,
    type: sourcePackage.type ?? targetPackage.type,
    scripts: mergeScripts(sourcePackage.scripts, targetPackage.scripts),
    dependencies: mergeObjectWithSourcePriority(sourcePackage.dependencies, targetPackage.dependencies),
    devDependencies: mergeObjectWithSourcePriority(sourcePackage.devDependencies, targetPackage.devDependencies),
  }

  if (sameJson(targetPackage, nextPackage)) {
    return false
  }

  if (options.dryRun) {
    console.log(`[dry-run] merge ${path.relative(repoRoot, sourcePackagePath)} -> ${targetPackagePath}`)
    return true
  }

  await writeJson(targetPackagePath, nextPackage)
  return true
}

async function syncFrontend(options) {
  const sourceDir = options.source ? resolveFromRoot(options.source) : defaultSourceDir
  const targetDir = options.target ? resolveFromRoot(options.target) : defaultTargetDir

  await assertSourceFrontend(sourceDir)
  await assertTargetRepo(targetDir, options)

  for (const entry of syncedEntries) {
    await copyEntry(sourceDir, targetDir, entry, options)
  }
  const packageChanged = await syncPackageJson(sourceDir, targetDir, options)

  if (options.dryRun) {
    console.log("Dry run complete. No files were changed.")
    return
  }

  console.log(`Synced frontend source to ${targetDir}`)
  if (packageChanged) {
    console.log("package.json changed; run npm install in the standalone repository before building.")
  }
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    process.exit(0)
  }
  await syncFrontend(options)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
