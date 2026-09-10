import type { GameCardContentFile, GameCardManifest, WorkspaceFile } from "@tsian/contracts"
import { strFromU8, unzipSync } from "fflate"
import { buildFrontend } from "../src/frontend-build/engine"
import { exportGameCardPackage, importGameCardPackage } from "../src/storage/game-card-packages"
import { listLocalGameCardContentFiles, putLocalGameCard, readLocalGameCardContentFile, writeLocalGameCardContentFile } from "../src/storage/game-cards"
import { createLocalSaveFromGameCard } from "../src/storage/saves"
import { localDb } from "../src/storage/db"
import { verifySemanticMaintenance } from "./semantic-maintenance"

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
  if (!(error instanceof Error)) return { message: typeof error === "object" ? JSON.stringify(error) : String(error) }
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
    const templateRoot = input.manifest.runtime?.initialSave?.templateRoot
    if (imported.manifest.runtime?.initialSave?.templateRoot !== templateRoot || !templateRoot) {
      throw new Error("Initial save declaration did not survive the package round-trip.")
    }
    const initialFiles = input.workspaceFiles.filter(file => file.path.startsWith(`${templateRoot}/`))
    const save = await createLocalSaveFromGameCard(imported)
    const savedFiles = await localDb.workspaceFiles.where("saveId").equals(save.id).toArray()
    for (const file of initialFiles) {
      const path = `save/${file.path.slice(templateRoot.length + 1)}`
      if (savedFiles.find(candidate => candidate.path === path)?.content !== file.content
        || (await readLocalGameCardContentFile(imported.id, file.path))?.content !== file.content) {
        throw new Error(`Imported initial save differs from its card source: ${path}`)
      }
    }
    if (savedFiles.length !== initialFiles.length + 1 || !savedFiles.some(file => file.path === ".tsian/manifest.json")) {
      throw new Error("Initial save contains missing or unexpected platform/business files.")
    }
    const checkpoints = await localDb.checkpoints.where("saveId").equals(save.id).toArray()
    if (checkpoints.length !== 1 || checkpoints[0]!.manifest.length !== savedFiles.length) {
      throw new Error("Imported initial save checkpoint is incomplete.")
    }
    const semanticMaintenanceRegression = await verifySemanticMaintenance((await listLocalGameCardContentFiles(imported.id)).map(file => ({ path: file.path, content: file.content, createdAt: 0, updatedAt: 0 } as WorkspaceFile)))
    const summary = encodeURIComponent(JSON.stringify({
      entryHtmlPath: build.entryHtmlPath,
      distFileCount: build.distPaths.length,
      bareImports: build.bareImports,
      byteSizeRegression,
      importRoundTrip: true,
      semanticMaintenanceRegression,
      initialSaveRegression: {
        templateFileCount: initialFiles.length,
        savedFileCount: savedFiles.length,
        checkpointFileCount: checkpoints[0]!.manifest.length,
        sourceUnchanged: true,
      },
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
