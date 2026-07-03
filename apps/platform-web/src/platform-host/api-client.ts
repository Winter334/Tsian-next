import type { MarketPackage, MarketResourceType, User } from "@tsian/contracts"

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

export const marketApi = {
  async list(params?: {
    resourceType?: MarketResourceType
    q?: string
    tag?: string
    sort?: "newest" | "downloads"
  }): Promise<MarketPackage[]> {
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
    const qs = query.toString()
    const res = await apiFetch<{ packages: MarketPackage[] }>(
      `/api/v1/market/packages${qs ? `?${qs}` : ""}`,
    )
    return res.packages
  },

  async get(id: string): Promise<MarketPackage> {
    return apiFetch<MarketPackage>(`/api/v1/market/packages/${encodeURIComponent(id)}`)
  },

  async upload(file: Blob, params: {
    resourceType: MarketResourceType
    title?: string
    summary?: string
    author?: string
    version?: string
    tags?: string
  }): Promise<MarketPackage> {
    const form = new FormData()
    form.append("file", file, marketUploadFileName(params.resourceType))
    form.append("resourceType", params.resourceType)
    if (params.title) {
      form.append("title", params.title)
    }
    if (params.summary) {
      form.append("summary", params.summary)
    }
    if (params.author) {
      form.append("author", params.author)
    }
    if (params.version) {
      form.append("version", params.version)
    }
    if (params.tags) {
      form.append("tags", params.tags)
    }
    const response = await fetch(`${API_BASE}/api/v1/market/packages`, {
      method: "POST",
      credentials: "include",
      body: form,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new ApiError(text.trim() || `上传失败 (${response.status})`, response.status)
    }
    return (await response.json()) as MarketPackage
  },

  async download(id: string): Promise<Blob> {
    const response = await fetch(
      `${API_BASE}/api/v1/market/packages/${encodeURIComponent(id)}/download`,
      { credentials: "include" },
    )
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new ApiError(text.trim() || `下载失败 (${response.status})`, response.status)
    }
    return response.blob()
  },
}

function marketUploadFileName(resourceType: MarketResourceType): string {
  switch (resourceType) {
    case "agent":
      return "package.tsian-agent.zip"
    case "skill":
      return "package.tsian-skill.zip"
    case "game_card":
    default:
      return "package.tsian-card.zip"
  }
}
