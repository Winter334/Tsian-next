import type { LocalGameCardRecord } from "@/storage/db"

export function getGameCardTitle(card: LocalGameCardRecord | null | undefined): string {
  return card?.manifest.name?.trim() || "Untitled Game Card"
}

export function getGameCardSummary(card: LocalGameCardRecord | null | undefined): string {
  return card?.manifest.summary?.trim() || "No summary available."
}

export function getGameCardDescription(card: LocalGameCardRecord | null | undefined): string {
  return card?.manifest.description?.trim()
    || card?.manifest.summary?.trim()
    || "This Game Card has not provided a description yet."
}

export function getGameCardAuthor(card: LocalGameCardRecord | null | undefined): string {
  return card?.manifest.author?.name?.trim() || "Unknown author"
}

export function getFrontendStatusLabel(card: LocalGameCardRecord | null | undefined): string {
  const frontend = card?.manifest.frontend
  if (!frontend) {
    return "No frontend"
  }

  return frontend.kind === "remote" ? "Remote frontend" : "Packaged frontend"
}

export function getFrontendStatusDescription(card: LocalGameCardRecord | null | undefined): string {
  const frontend = card?.manifest.frontend
  if (!frontend) {
    return "Save slots can be created, but /play is unavailable until a frontend is configured."
  }

  return frontend.kind === "remote"
    ? "This card launches through a remote play frontend."
    : "This card launches through a packaged play frontend."
}

export function hasPlayableFrontend(card: LocalGameCardRecord | null | undefined): boolean {
  const kind = card?.manifest.frontend?.kind
  return kind === "remote" || kind === "packaged"
}

export function getGameCardCoverUrl(card: LocalGameCardRecord | null | undefined): string | null {
  const cover = card?.manifest.cover
  if (!cover) {
    return null
  }

  if (cover.url?.trim()) {
    return cover.url.trim()
  }

  if (!cover.workspacePath?.trim()) {
    return null
  }

  const coverPath = cover.workspacePath.trim()
  const file = card.contentFiles.find((item) => item.path === coverPath)
  if (!file) {
    return null
  }

  const content = file.content.trim()
  if (content.startsWith("data:image/")) {
    return content
  }

  if (file.mediaType === "image/svg+xml" || content.startsWith("<svg")) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
  }

  if (file.mediaType?.startsWith("image/")) {
    return `data:${file.mediaType};base64,${content}`
  }

  return null
}

export function formatDateTime(input: number | undefined): string {
  if (!input) {
    return "Unknown"
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input)
}
