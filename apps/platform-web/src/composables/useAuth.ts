import type { User } from "@tsian/contracts"
import { computed, readonly, ref } from "vue"
import { authApi } from "@/platform-host/api-client"

const currentUser = ref<User | null>(null)
const initializing = ref(false)
const authError = ref("")

export function useAuth() {
  const loggedIn = computed(() => currentUser.value !== null)

  async function initAuth(): Promise<void> {
    initializing.value = true
    authError.value = ""
    try {
      currentUser.value = await authApi.me()
    } catch (error) {
      authError.value = error instanceof Error ? error.message : "读取登录状态失败。"
      currentUser.value = null
    } finally {
      initializing.value = false
    }
  }

  function login(): void {
    authApi.login()
  }

  function mockLogin(): void {
    authApi.mockLogin()
  }

  async function logout(): Promise<void> {
    authError.value = ""
    try {
      await authApi.logout()
      currentUser.value = null
    } catch (error) {
      authError.value = error instanceof Error ? error.message : "退出登录失败。"
      throw error
    }
  }

  return {
    currentUser: readonly(currentUser),
    loggedIn,
    initializing: readonly(initializing),
    authError: readonly(authError),
    initAuth,
    login,
    mockLogin,
    logout,
  }
}
