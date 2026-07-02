export type AuthProvider = "discord" | "password" | "email_magic_link"

export interface User {
  id: string
  handle: string
  displayName: string
  avatarUrl: string | null
  authProviders: AuthProvider[]
}
