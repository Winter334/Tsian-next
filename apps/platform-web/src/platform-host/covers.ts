import type { GameCardCover } from "@tsian/contracts"
import {
  deleteLocalGameCardContentFile,
  getLocalGameCard,
  putLocalGameCard,
  writeLocalGameCardContentFile,
} from "../storage"

const COVER_CONTENT_PREFIX = ".cover/"

function coverExtensionForMediaType(mediaType: string): string {
  if (mediaType === "image/png") return "png"
  if (mediaType === "image/jpeg") return "jpg"
  if (mediaType === "image/webp") return "webp"
  if (mediaType === "image/gif") return "gif"
  if (mediaType === "image/svg+xml") return "svg"
  return "bin"
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export type PlatformGameCardCoverInput =
  | { kind: "upload"; file: Blob; alt?: string }
  | { kind: "url"; url: string; alt?: string }
  | { kind: "clear" }

export async function setPlatformGameCardCover(
  cardId: string,
  input: PlatformGameCardCoverInput,
) {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  if (card.source === "builtin") {
    throw new Error("内置游戏卡不能直接修改封面。请先另存为本地副本。")
  }

  const previousCoverPath = card.manifest.cover?.workspacePath?.trim()

  if (input.kind === "url") {
    const url = input.url.trim()
    if (!url) {
      throw new Error("封面 URL 不能为空。")
    }
    const nextCover: GameCardCover = { url }
    if (input.alt?.trim()) {
      nextCover.alt = input.alt.trim()
    }
    // Drop the old workspacePath cover row (if any), then update manifest only.
    if (previousCoverPath) {
      await deleteLocalGameCardContentFile(cardId, previousCoverPath)
    }
    return putLocalGameCard({
      manifest: { ...card.manifest, cover: nextCover },
      source: card.source,
    })
  }

  if (input.kind === "clear") {
    if (previousCoverPath) {
      await deleteLocalGameCardContentFile(cardId, previousCoverPath)
    }
    return putLocalGameCard({
      manifest: { ...card.manifest, cover: undefined },
      source: card.source,
    })
  }

  // kind === "upload"
  const mediaType = input.file.type || "image/png"
  if (!mediaType.startsWith("image/")) {
    throw new Error("封面文件必须是图片。")
  }
  const extension = coverExtensionForMediaType(mediaType)
  const coverPath = `${COVER_CONTENT_PREFIX}cover.${extension}`
  const bytes = new Uint8Array(await input.file.arrayBuffer())
  const base64 = bytesToBase64(bytes)
  const dataUri = `data:${mediaType};base64,${base64}`

  const nextCover: GameCardCover = { workspacePath: coverPath }
  if (input.alt?.trim()) {
    nextCover.alt = input.alt.trim()
  }
  // Delete the old cover row (if any), write the new cover row, then update manifest.
  if (previousCoverPath && previousCoverPath !== coverPath) {
    await deleteLocalGameCardContentFile(cardId, previousCoverPath)
  }
  await writeLocalGameCardContentFile(cardId, { path: coverPath, content: dataUri, mediaType })
  return putLocalGameCard({
    manifest: { ...card.manifest, cover: nextCover },
    source: card.source,
  })
}
