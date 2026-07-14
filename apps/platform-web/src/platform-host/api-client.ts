import type {
  Announcement,
  AnnouncementListResponse,
  CloudBackupCommitRequest,
  CloudBackupListResponse,
  CloudBackupManifestResponse,
  CloudBackupPrepareRequest,
  CloudBackupPrepareResponse,
  MarketPackage,
  MarketPackageCountsResponse,
  MarketPackageListResponse,
  MarketResourceType,
  PresenceSummaryResponse,
  User,
} from "@tsian/contracts"

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "")

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function errorMessageFromResponse(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "")
  const trimmed = text.trim()
  if (!trimmed) {
    return fallback
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const error = (parsed as { error?: unknown }).error
      if (typeof error === "string" && error.trim()) {
        return error.trim()
      }
      const message = (parsed as { message?: unknown }).message
      if (typeof message === "string" && message.trim()) {
        return message.trim()
      }
    }
  } catch {
    // Non-JSON error bodies are already displayable text.
  }

  return trimmed
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  })

  if (!response.ok) {
    throw new ApiError(
      await errorMessageFromResponse(response, `API request failed (${response.status})`),
      response.status,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  if (text.trim() === "") {
    return undefined as T
  }
  return JSON.parse(text) as T
}

export const authApi = {
  login(): void {
    window.location.href = `${API_BASE}/api/v1/auth/login`
  },

  mockLogin(): void {
    window.location.href = `${API_BASE}/api/v1/auth/mock-login`
  },

  async logout(): Promise<void> {
    await apiFetch<void>("/api/v1/auth/logout", { method: "POST" })
  },

  async me(): Promise<User | null> {
    try {
      return await apiFetch<User>("/api/v1/auth/me")
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null
      }
      throw error
    }
  },
}

export interface MarketListParams {
  resourceType?: MarketResourceType
  q?: string
  tag?: string
  sort?: "newest" | "downloads"
  limit?: number
  cursor?: string
}

export interface MarketPublishParams {
  title?: string
  summary?: string
  author?: string
  tags?: string
}

export interface MarketUploadParams extends MarketPublishParams {
  resourceType: MarketResourceType
}

export interface MarketUpdateParams extends MarketPublishParams {
  resourceType: MarketResourceType
}

export const marketApi = {
  async list(params?: MarketListParams): Promise<MarketPackageListResponse> {
    const qs = marketListQuery(params)
    return apiFetch<MarketPackageListResponse>(
      `/api/v1/market/packages${qs ? `?${qs}` : ""}`,
    )
  },

  async listMine(params?: MarketListParams): Promise<MarketPackageListResponse> {
    const qs = marketListQuery(params)
    return apiFetch<MarketPackageListResponse>(
      `/api/v1/market/my/packages${qs ? `?${qs}` : ""}`,
    )
  },

  async counts(): Promise<MarketPackageCountsResponse> {
    return apiFetch<MarketPackageCountsResponse>("/api/v1/market/packages/counts")
  },

  async countsMine(): Promise<MarketPackageCountsResponse> {
    return apiFetch<MarketPackageCountsResponse>("/api/v1/market/my/packages/counts")
  },

  async get(id: string): Promise<MarketPackage> {
    return apiFetch<MarketPackage>(`/api/v1/market/packages/${encodeURIComponent(id)}`)
  },

  async upload(file: Blob, params: MarketUploadParams): Promise<MarketPackage> {
    const form = marketPackageForm(file, params)
    const response = await fetch(`${API_BASE}/api/v1/market/packages`, {
      method: "POST",
      credentials: "include",
      body: form,
    })
    if (!response.ok) {
      throw new ApiError(
        await errorMessageFromResponse(response, `上传失败 (${response.status})`),
        response.status,
      )
    }
    return (await response.json()) as MarketPackage
  },

  async update(id: string, file: Blob | null, params: MarketUpdateParams): Promise<MarketPackage> {
    const form = marketPackageForm(file, params)
    const response = await fetch(`${API_BASE}/api/v1/market/packages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      body: form,
    })
    if (!response.ok) {
      throw new ApiError(
        await errorMessageFromResponse(response, `更新失败 (${response.status})`),
        response.status,
      )
    }
    return (await response.json()) as MarketPackage
  },

  async delete(id: string): Promise<void> {
    await apiFetch<void>(`/api/v1/market/packages/${encodeURIComponent(id)}`, { method: "DELETE" })
  },

  async download(id: string): Promise<Blob> {
    const response = await fetch(
      `${API_BASE}/api/v1/market/packages/${encodeURIComponent(id)}/download`,
      { credentials: "include" },
    )
    if (!response.ok) {
      throw new ApiError(
        await errorMessageFromResponse(response, `下载失败 (${response.status})`),
        response.status,
      )
    }
    return response.blob()
  },
}

export const cloudBackupApi = {
  async list(cardId?: string): Promise<CloudBackupListResponse> {
    const query = new URLSearchParams()
    if (cardId?.trim()) {
      query.set("cardId", cardId.trim())
    }
    const qs = query.toString()
    return apiFetch<CloudBackupListResponse>(`/api/v1/cloud-backups${qs ? `?${qs}` : ""}`)
  },

  async prepare(request: CloudBackupPrepareRequest): Promise<CloudBackupPrepareResponse> {
    return apiFetch<CloudBackupPrepareResponse>("/api/v1/cloud-backups/prepare", {
      method: "POST",
      body: JSON.stringify(request),
    })
  },

  async uploadBlob(hash: string, blob: Blob, mediaType: string): Promise<void> {
    const headers = new Headers()
    headers.set("Content-Type", mediaType || blob.type || "application/octet-stream")
    const response = await fetch(`${API_BASE}/api/v1/cloud-backups/blobs/${encodeURIComponent(hash)}`, {
      method: "PUT",
      credentials: "include",
      headers,
      body: blob,
    })
    if (!response.ok) {
      throw new ApiError(
        await errorMessageFromResponse(response, `上传云备份文件失败 (${response.status})`),
        response.status,
      )
    }
  },

  async commit(id: string, request: CloudBackupCommitRequest): Promise<CloudBackupManifestResponse> {
    return apiFetch<CloudBackupManifestResponse>(`/api/v1/cloud-backups/${encodeURIComponent(id)}/commit`, {
      method: "POST",
      body: JSON.stringify(request),
    })
  },

  async manifest(id: string): Promise<CloudBackupManifestResponse> {
    return apiFetch<CloudBackupManifestResponse>(`/api/v1/cloud-backups/${encodeURIComponent(id)}/manifest`)
  },

  async downloadBlob(id: string, hash: string): Promise<Blob> {
    const response = await fetch(
      `${API_BASE}/api/v1/cloud-backups/${encodeURIComponent(id)}/blobs/${encodeURIComponent(hash)}`,
      { credentials: "include" },
    )
    if (!response.ok) {
      throw new ApiError(
        await errorMessageFromResponse(response, `下载云备份文件失败 (${response.status})`),
        response.status,
      )
    }
    return response.blob()
  },

  async delete(id: string): Promise<void> {
    await apiFetch<void>(`/api/v1/cloud-backups/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
}

export const announcementsApi = {
  async list(): Promise<Announcement[]> {
    const response = await apiFetch<AnnouncementListResponse>("/api/v1/announcements")
    return response.announcements
  },
}

export const presenceApi = {
  async heartbeat(): Promise<PresenceSummaryResponse> {
    return apiFetch<PresenceSummaryResponse>("/api/v1/presence/heartbeat", { method: "POST" })
  },

  async summary(): Promise<PresenceSummaryResponse> {
    return apiFetch<PresenceSummaryResponse>("/api/v1/presence/summary")
  },
}

function marketListQuery(params?: MarketListParams): string {
  const query = new URLSearchParams()
  if (params?.resourceType) {
    query.set("resourceType", params.resourceType)
  }
  if (params?.q) {
    query.set("q", params.q)
  }
  if (params?.tag) {
    query.set("tag", params.tag)
  }
  if (params?.sort) {
    query.set("sort", params.sort)
  }
  if (params?.limit) {
    query.set("limit", String(params.limit))
  }
  if (params?.cursor) {
    query.set("cursor", params.cursor)
  }
  return query.toString()
}

function marketPackageForm(file: Blob | null, params: MarketUpdateParams): FormData {
  const form = new FormData()
  if (file) {
    form.append("file", file, marketUploadFileName(params.resourceType))
  }
  form.append("resourceType", params.resourceType)
  if (params.title !== undefined) {
    form.append("title", params.title)
  }
  if (params.summary !== undefined) {
    form.append("summary", params.summary)
  }
  if (params.author !== undefined) {
    form.append("author", params.author)
  }
  if (params.tags !== undefined) {
    form.append("tags", params.tags)
  }
  return form
}

function marketUploadFileName(resourceType: MarketResourceType): string {
  switch (resourceType) {
    case "agent":
      return "package.tsian-agent.zip"
    case "skill":
      return "package.tsian-skill.zip"
    case "tool":
      return "package.tsian-tool.zip"
    case "game_card":
    default:
      return "package.tsian-card.zip"
  }
}
