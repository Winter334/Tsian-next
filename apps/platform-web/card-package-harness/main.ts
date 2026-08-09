import type { GameCardContentFile, GameCardManifest } from "@tsian/contracts"
import { strFromU8, unzipSync } from "fflate"
import { buildFrontend } from "../src/frontend-build/engine"
import { exportGameCardPackage, importGameCardPackage } from "../src/storage/game-card-packages"
import { putLocalGameCard, writeLocalGameCardContentFile } from "../src/storage/game-cards"

interface EncodedFile {
  path: string
  mediaType: string
  base64: string
}

interface CardPackageHarnessInput {
  manifest: GameCardManifest
  workspaceFiles: Array<{ path: string; content: string }>
  frontendFiles: EncodedFile[]
  coverFile: EncodedFile & { contentPath: string }
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function blobFromFile(file: EncodedFile): Blob {
  const bytes = bytesFromBase64(file.base64)
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: file.mediaType })
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) }
  const extended = error as Error & { code?: unknown; messageDetail?: unknown }
  return {
    name: error.name,
    message: error.message,
    ...(typeof extended.code === "string" ? { code: extended.code } : {}),
    ...(extended.messageDetail ? { messageDetail: extended.messageDetail } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
  }
}

async function verifyExporterByteSizing(baseCardId: string): Promise<Record<string, number>> {
  const fixtureId = `${baseCardId}.__package-byte-regression`
  const binary = new Uint8Array([0, 255, 1, 128, 64])
  const fixtureFiles = [
    { path: "ascii.txt", content: "plain ascii" },
    { path: "chinese.txt", content: "中文内容" },
    { path: "emoji.txt", content: "emoji: 😀🚀" },
    {
      path: "binary.bin",
      content: "",
      data: new Blob([binary.slice().buffer as ArrayBuffer], { type: "application/octet-stream" }),
    },
  ]
  await putLocalGameCard({
    manifest: {
      schema: "tsian.game-card.v1",
      id: fixtureId,
      name: "Card package byte-size regression",
      version: "0.0.0",
      summary: "Validates exported inventory sizes against ZIP entry bytes.",
    },
    contentFiles: fixtureFiles,
    source: "local",
  })

  const blob = await exportGameCardPackage(fixtureId)
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const packageManifest = JSON.parse(strFromU8(entries["game-card.json"])) as {
    workspaceFiles?: Array<{ path: string; size?: number }>
  }
  const sizes: Record<string, number> = {}
  for (const file of fixtureFiles) {
    const packagePath = `workspace/${file.path}`
    const entry = entries[packagePath]
    const indexed = packageManifest.workspaceFiles?.find((candidate) => candidate.path === packagePath)
    if (!entry || indexed?.size !== entry.byteLength) {
      throw new Error(`Exporter byte-size regression failed for ${packagePath}.`)
    }
    sizes[file.path] = entry.byteLength
  }
  return sizes
}

async function postError(error: unknown): Promise<void> {
  await fetch("/__card-package-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: errorPayload(error) }),
  })
}

async function run(): Promise<void> {
  const status = document.querySelector<HTMLPreElement>("#status")
  try {
    const inputResponse = await fetch("/__card-package-input", { cache: "no-store" })
    if (!inputResponse.ok) throw new Error(`Card package input returned HTTP ${inputResponse.status}.`)
    const input = await inputResponse.json() as CardPackageHarnessInput
    const byteSizeRegression = await verifyExporterByteSizing(input.manifest.id)

    const contentFiles: GameCardContentFile[] = input.workspaceFiles.map((file) => ({
      path: file.path,
      content: file.content,
    }))
    await putLocalGameCard({
      manifest: input.manifest,
      contentFiles,
      frontendFiles: input.frontendFiles.map((file) => ({
        path: file.path,
        data: blobFromFile(file),
        mediaType: file.mediaType,
      })),
      source: "local",
    })
    await writeLocalGameCardContentFile(input.manifest.id, {
      path: input.coverFile.contentPath,
      data: blobFromFile(input.coverFile),
    })

    const build = await buildFrontend(input.manifest.id)
    const packageBlob = await exportGameCardPackage(input.manifest.id)
    const packageBytes = new Uint8Array(await packageBlob.arrayBuffer())
    const imported = await importGameCardPackage(packageBytes)
    if (imported.id !== input.manifest.id) {
      throw new Error("Exported card package did not round-trip through the platform importer.")
    }
    const summary = encodeURIComponent(JSON.stringify({
      entryHtmlPath: build.entryHtmlPath,
      distFileCount: build.distPaths.length,
      bareImports: build.bareImports,
      byteSizeRegression,
      importRoundTrip: true,
    }))
    const resultResponse = await fetch("/__card-package-result", {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Tsian-Card-Package-Summary": summary,
      },
      body: packageBytes,
    })
    if (!resultResponse.ok) throw new Error(`Card package result returned HTTP ${resultResponse.status}.`)
    if (status) status.textContent = "Card package built successfully."
  } catch (error) {
    if (status) status.textContent = JSON.stringify(errorPayload(error), null, 2)
    await postError(error)
  }
}

void run()
