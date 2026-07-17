#!/usr/bin/env node
import { createHash } from "node:crypto"
import { dirname, resolve, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { build } from "esbuild"

const scriptPath = fileURLToPath(import.meta.url)
const scriptDir = dirname(scriptPath)
const defaultRepoRoot = resolve(scriptDir, "../../../..")

function parseArgs(argv) {
  const args = {
    repoRoot: defaultRepoRoot,
    modulePath: undefined,
    out: undefined,
    compare: undefined,
    keepBundle: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--repo-root") {
      args.repoRoot = resolve(argv[++index])
    } else if (arg === "--module") {
      args.modulePath = resolve(argv[++index])
    } else if (arg === "--out") {
      args.out = resolve(argv[++index])
    } else if (arg === "--compare") {
      args.compare = resolve(argv[++index])
    } else if (arg === "--keep-bundle") {
      args.keepBundle = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  args.modulePath ??= resolve(args.repoRoot, "apps/platform-web/src/storage/workspace-templates.ts")
  return args
}

function hashContent(content) {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function snapshotTemplateFile(file) {
  const content = typeof file.content === "string" ? file.content : ""
  return {
    path: file.path,
    ...(typeof file.mediaType === "string" ? { mediaType: file.mediaType } : {}),
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: hashContent(content),
    content,
  }
}

async function loadModuleSnapshot(args) {
  const bundleDir = resolve(scriptDir, ".generated")
  mkdirSync(bundleDir, { recursive: true })
  const bundlePath = resolve(bundleDir, `workspace-templates-${Date.now()}.mjs`)

  await build({
    entryPoints: [args.modulePath],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  })

  try {
    const moduleExports = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`)
    return {
      generatedAt: new Date().toISOString(),
      modulePath: relative(args.repoRoot, args.modulePath).replaceAll("\\", "/"),
      exports: {
        DEFAULT_WORKSPACE_VERSION: moduleExports.DEFAULT_WORKSPACE_VERSION,
        WORKSPACE_MANIFEST_PATH: moduleExports.WORKSPACE_MANIFEST_PATH,
        DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS: Array.from(moduleExports.DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS ?? []),
        RUNTIME_DEFAULT_CARD_PATHS: Array.from(moduleExports.RUNTIME_DEFAULT_CARD_PATHS ?? []),
        DEFAULT_WORKSPACE_FILES: Array.from(moduleExports.DEFAULT_WORKSPACE_FILES ?? []).map(snapshotTemplateFile),
        DEFAULT_SAVE_RUNTIME_FILES: Array.from(moduleExports.DEFAULT_SAVE_RUNTIME_FILES ?? []).map(snapshotTemplateFile),
      },
    }
  } finally {
    if (!args.keepBundle) {
      rmSync(bundlePath, { force: true })
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

async function loadBaseline(path) {
  return readJson(path)
}

function describeContentDifference(left, right) {
  const leftContent = typeof left.content === "string" ? left.content : ""
  const rightContent = typeof right.content === "string" ? right.content : ""
  const max = Math.min(leftContent.length, rightContent.length)
  let index = 0
  while (index < max && leftContent[index] === rightContent[index]) {
    index += 1
  }

  if (index === max && leftContent.length === rightContent.length) {
    return "content differs but first differing character was not found"
  }

  const leftPrefix = leftContent.slice(0, index)
  const line = leftPrefix.split("\n").length
  const lastNewline = leftPrefix.lastIndexOf("\n")
  const column = index - lastNewline
  const before = Math.max(0, index - 80)
  const after = index + 80
  return [
    `first difference at character ${index}, line ${line}, column ${column}`,
    `baseline snippet: ${JSON.stringify(leftContent.slice(before, after))}`,
    `current snippet:  ${JSON.stringify(rightContent.slice(before, after))}`,
  ].join("\n")
}

function compareArrays(name, baseline, current, diffs) {
  if (baseline.length !== current.length) {
    diffs.push(`${name}: length changed ${baseline.length} -> ${current.length}`)
  }

  const max = Math.max(baseline.length, current.length)
  for (let index = 0; index < max; index += 1) {
    if (baseline[index] !== current[index]) {
      diffs.push(`${name}[${index}]: ${JSON.stringify(baseline[index])} -> ${JSON.stringify(current[index])}`)
    }
  }
}

function compareTemplateFiles(name, baseline, current, diffs) {
  if (baseline.length !== current.length) {
    diffs.push(`${name}: length changed ${baseline.length} -> ${current.length}`)
  }

  const max = Math.max(baseline.length, current.length)
  for (let index = 0; index < max; index += 1) {
    const left = baseline[index]
    const right = current[index]
    if (!left || !right) {
      diffs.push(`${name}[${index}]: ${left ? left.path : "<missing>"} -> ${right ? right.path : "<missing>"}`)
      continue
    }

    if (left.path !== right.path) {
      diffs.push(`${name}[${index}].path: ${left.path} -> ${right.path}`)
    }
    if ((left.mediaType ?? "") !== (right.mediaType ?? "")) {
      diffs.push(`${name}[${index}].mediaType (${left.path}): ${left.mediaType ?? "<none>"} -> ${right.mediaType ?? "<none>"}`)
    }
    if (left.bytes !== right.bytes || left.sha256 !== right.sha256 || ("content" in left && left.content !== right.content)) {
      diffs.push([
        `${name}[${index}].content (${left.path}):`,
        `baseline bytes=${left.bytes} sha256=${left.sha256}`,
        `current  bytes=${right.bytes} sha256=${right.sha256}`,
        describeContentDifference(left, right),
      ].join("\n"))
    }
  }

  const baselinePaths = new Set(baseline.map((file) => file.path))
  const currentPaths = new Set(current.map((file) => file.path))
  for (const path of baselinePaths) {
    if (!currentPaths.has(path)) {
      diffs.push(`${name}: missing path ${path}`)
    }
  }
  for (const path of currentPaths) {
    if (!baselinePaths.has(path)) {
      diffs.push(`${name}: added path ${path}`)
    }
  }
}

function compareSnapshots(baseline, current) {
  const diffs = []
  const left = baseline.exports
  const right = current.exports

  for (const name of ["DEFAULT_WORKSPACE_VERSION", "WORKSPACE_MANIFEST_PATH"]) {
    if (left[name] !== right[name]) {
      diffs.push(`${name}: ${JSON.stringify(left[name])} -> ${JSON.stringify(right[name])}`)
    }
  }

  compareArrays(
    "DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS",
    left.DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS,
    right.DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS,
    diffs,
  )
  compareArrays(
    "RUNTIME_DEFAULT_CARD_PATHS",
    left.RUNTIME_DEFAULT_CARD_PATHS,
    right.RUNTIME_DEFAULT_CARD_PATHS,
    diffs,
  )
  compareTemplateFiles(
    "DEFAULT_WORKSPACE_FILES",
    left.DEFAULT_WORKSPACE_FILES,
    right.DEFAULT_WORKSPACE_FILES,
    diffs,
  )
  compareTemplateFiles(
    "DEFAULT_SAVE_RUNTIME_FILES",
    left.DEFAULT_SAVE_RUNTIME_FILES,
    right.DEFAULT_SAVE_RUNTIME_FILES,
    diffs,
  )

  return diffs
}

const args = parseArgs(process.argv.slice(2))
const snapshot = await loadModuleSnapshot(args)

if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
}

if (args.compare) {
  if (!existsSync(args.compare)) {
    throw new Error(`Baseline snapshot not found: ${args.compare}`)
  }
  const baseline = await loadBaseline(args.compare)
  const diffs = compareSnapshots(baseline, snapshot)
  if (diffs.length > 0) {
    console.error(`Snapshot mismatch: ${diffs.length} difference(s)`)
    console.error(diffs.join("\n\n"))
    process.exit(1)
  }
  console.log("Snapshot equivalence: PASS")
  console.log(`DEFAULT_WORKSPACE_FILES: ${snapshot.exports.DEFAULT_WORKSPACE_FILES.length}`)
  console.log(`DEFAULT_SAVE_RUNTIME_FILES: ${snapshot.exports.DEFAULT_SAVE_RUNTIME_FILES.length}`)
} else {
  console.log("Snapshot written")
  console.log(`DEFAULT_WORKSPACE_FILES: ${snapshot.exports.DEFAULT_WORKSPACE_FILES.length}`)
  console.log(`DEFAULT_SAVE_RUNTIME_FILES: ${snapshot.exports.DEFAULT_SAVE_RUNTIME_FILES.length}`)
}
