import type { WorkspaceFile } from "@tsian/contracts"
import {
  binaryPlaceholderText,
  isImageMediaType,
  isTextMediaType,
  resolveBlobMediaType,
} from "./media-type"

export interface BlobWorkspaceFileInput {
  path: string
  blob: Blob
  createdAt: number
  updatedAt: number
}

export async function decodeUtf8Blob(blob: Blob, path: string): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await blob.arrayBuffer(),
    )
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : ""
    throw new Error(`文本文件不是有效的 UTF-8，无法安全读取：${path}${detail}`)
  }
}

/**
 * Project a stored Blob into the workspace text/binary dual track.
 *
 * Text MIME types use fatal UTF-8 decoding so invalid bytes cannot be loaded as
 * replacement characters and later saved over the original Blob. Opaque
 * binary data keeps the Blob and a descriptive placeholder; ordinary images
 * also carry imageMimeType for Agent multimodal reads.
 */
export async function blobToWorkspaceFile(
  input: BlobWorkspaceFileInput,
): Promise<WorkspaceFile> {
  const { path, blob, createdAt, updatedAt } = input
  const mediaType = resolveBlobMediaType(path, blob)

  if (isTextMediaType(mediaType)) {
    return {
      path,
      content: await decodeUtf8Blob(blob, path),
      createdAt,
      updatedAt,
    }
  }

  return {
    path,
    content: binaryPlaceholderText(blob, path, mediaType),
    binary: blob,
    ...(isImageMediaType(mediaType) ? { imageMimeType: mediaType } : {}),
    createdAt,
    updatedAt,
  }
}
