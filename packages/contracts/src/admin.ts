import type { User } from "./user"

export interface AdminMeResponse {
  user: User
  isAdmin: true
}
