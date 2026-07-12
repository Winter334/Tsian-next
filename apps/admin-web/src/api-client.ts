import type {
  AdminMarketPackage,
  AdminMarketPackageListResponse,
  AdminMarketPackageUpdateRequest,
  AdminMarketVisibility,
  AdminMeResponse,
  Announcement,
  AnnouncementInput,
  AnnouncementListResponse,
  MarketResourceType,
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
    const text = await response.text().catch(() => "")
    throw new ApiError(text.trim() || `API request failed (${response.status})`, response.status)
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

  async adminMe(): Promise<AdminMeResponse> {
    return apiFetch<AdminMeResponse>("/api/v1/admin/me")
  },

  async logout(): Promise<void> {
    await apiFetch<void>("/api/v1/auth/logout", { method: "POST" })
  },
}

export interface AdminMarketListParams {
  resourceType?: MarketResourceType | ""
  visibility?: AdminMarketVisibility
  q?: string
  uploader?: string
  limit?: number
  cursor?: string
}

export const adminMarketApi = {
  async list(params: AdminMarketListParams = {}): Promise<AdminMarketPackageListResponse> {
    const query = new URLSearchParams()
    if (params.resourceType) query.set("resourceType", params.resourceType)
    if (params.visibility) query.set("visibility", params.visibility)
    if (params.q) query.set("q", params.q)
    if (params.uploader) query.set("uploader", params.uploader)
    if (params.limit) query.set("limit", String(params.limit))
    if (params.cursor) query.set("cursor", params.cursor)
    const qs = query.toString()
    return apiFetch<AdminMarketPackageListResponse>(`/api/v1/admin/market/packages${qs ? `?${qs}` : ""}`)
  },

  async update(id: string, payload: AdminMarketPackageUpdateRequest): Promise<AdminMarketPackage> {
    return apiFetch<AdminMarketPackage>(`/api/v1/admin/market/packages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
  },

  async hide(id: string): Promise<AdminMarketPackage> {
    return apiFetch<AdminMarketPackage>(`/api/v1/admin/market/packages/${encodeURIComponent(id)}/hide`, { method: "POST" })
  },

  async unhide(id: string): Promise<AdminMarketPackage> {
    return apiFetch<AdminMarketPackage>(`/api/v1/admin/market/packages/${encodeURIComponent(id)}/unhide`, { method: "POST" })
  },

  async delete(id: string): Promise<void> {
    await apiFetch<void>(`/api/v1/admin/market/packages/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
}

export const adminAnnouncementsApi = {
  async list(): Promise<Announcement[]> {
    const response = await apiFetch<AnnouncementListResponse>("/api/v1/admin/announcements")
    return response.announcements
  },

  async create(input: AnnouncementInput): Promise<Announcement> {
    return apiFetch<Announcement>("/api/v1/admin/announcements", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  async update(id: string, input: AnnouncementInput): Promise<Announcement> {
    return apiFetch<Announcement>(`/api/v1/admin/announcements/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  },

  async delete(id: string): Promise<void> {
    await apiFetch<void>(`/api/v1/admin/announcements/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
}
