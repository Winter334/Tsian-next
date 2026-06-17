import type { LocalGameCardRecord } from "@/storage/db"

export function getGameCardTitle(card: LocalGameCardRecord | null | undefined): string {
  return card?.manifest.name?.trim() || "未命名游戏卡"
}

export function getGameCardSummary(card: LocalGameCardRecord | null | undefined): string {
  return card?.manifest.summary?.trim() || "暂无简介。"
}

export function getGameCardDescription(card: LocalGameCardRecord | null | undefined): string {
  return getGameCardSummary(card)
}

export function getGameCardAuthor(card: LocalGameCardRecord | null | undefined): string {
  return card?.manifest.author?.name?.trim() || "未知作者"
}

export function getFrontendStatusLabel(card: LocalGameCardRecord | null | undefined): string {
  const frontend = card?.manifest.frontend
  if (!frontend) {
    return "未配置前端"
  }

  return frontend.kind === "remote" ? "远程前端" : "打包前端"
}

export function getFrontendStatusDescription(card: LocalGameCardRecord | null | undefined): string {
  const frontend = card?.manifest.frontend
  if (!frontend) {
    return "可以创建存档槽，但需要先配置前端才能进入 /play。"
  }

  return frontend.kind === "remote"
    ? "这张游戏卡会通过远程游玩前端启动。"
    : "这张游戏卡会通过打包游玩前端启动。"
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
    return "未知"
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input)
}
