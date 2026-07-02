import type { User } from "@tsian/contracts"

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
