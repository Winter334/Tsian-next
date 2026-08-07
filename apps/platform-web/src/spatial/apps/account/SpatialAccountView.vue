<template>
  <section class="spatial-app spatial-account" data-spatial-source-animation aria-label="账号中心">
    <header class="spatial-app__header">
      <div class="spatial-app__identity"><span class="spatial-app__eyebrow">OPERATOR IDENTITY</span><h1>账号中心</h1></div>
      <span class="spatial-app__status" :data-state="statusLabel">{{ statusLabel }}</span>
    </header>
    <main class="spatial-app__scroll spatial-account__body">
      <p v-if="initializing" class="spatial-app__empty" role="status">正在验证操作员身份…</p>
      <template v-else>
        <section class="spatial-app__section spatial-account__identity-card">
          <SpatialImage v-if="currentUser?.avatarUrl" class="spatial-account__avatar" :source="avatarSource" :alt="currentUser.displayName" :icon="UserRound" fallback-label="头像不可用" />
          <div v-else class="spatial-account__avatar spatial-account__avatar--fallback" aria-hidden="true">{{ initials }}</div>
          <div><span class="spatial-app__eyebrow">{{ loggedIn ? 'SIGNED IN' : 'GUEST SESSION' }}</span><h2>{{ currentUser?.displayName || '访客' }}</h2><p>{{ loggedIn ? `OP-ID · ${currentUser?.handle || '—'}` : '本地数据仅保留在当前设备。' }}</p></div>
        </section>

        <p v-if="authError" class="spatial-app__banner spatial-app__banner--error" role="alert">{{ authError }}</p>

        <section class="spatial-app__section">
          <div class="spatial-account__heading"><div><span class="spatial-app__eyebrow">CREDENTIALS</span><h2>{{ loggedIn ? '已绑定凭证' : '可用登录方式' }}</h2></div></div>
          <div class="spatial-account__methods">
            <article class="spatial-account__method" :data-active="!loggedIn">
              <MessagesSquare aria-hidden="true" /><div><strong>Discord</strong><small>{{ discordBound ? '已绑定到当前账号' : '用于登录和云端身份验证' }}</small></div>
              <span v-if="discordBound" class="spatial-account__badge">已绑定</span>
              <SpatialActionButton v-else variant="primary" :disabled="initializing" @click="login">使用 Discord 登录</SpatialActionButton>
            </article>
            <article v-for="method in futureMethods" :key="method" class="spatial-account__method spatial-account__method--disabled"><KeyRound aria-hidden="true" /><div><strong>{{ method }}</strong><small>即将开放</small></div><span class="spatial-account__badge">预留</span></article>
          </div>
        </section>
        <section v-if="loggedIn" class="spatial-app__section spatial-account__logout"><p>退出后仍可继续以访客身份使用本地数据。</p><SpatialActionButton variant="danger" :disabled="logoutPending" @click="handleLogout"><template #icon><LogOut /></template>{{ logoutPending ? '正在退出…' : '退出登录' }}</SpatialActionButton></section>
      </template>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { KeyRound, LogOut, MessagesSquare, UserRound } from "lucide-vue-next"
import { useAuth } from "@/composables/useAuth"
import { toast } from "@/composables/useToast"
import SpatialImage from "../media/SpatialImage.vue"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"

const { currentUser, loggedIn, initializing, authError, login, logout } = useAuth()
const logoutPending = ref(false)
const futureMethods = ["账号密码", "邮箱邀请", "Magic Link"]
const discordBound = computed(() => currentUser.value?.authProviders.includes("discord") ?? false)
const avatarSource = computed(() => currentUser.value?.avatarUrl ? { kind: "url" as const, url: currentUser.value.avatarUrl } : { kind: "none" as const })
const initials = computed(() => (currentUser.value?.displayName || "访客").trim().slice(0, 2).toUpperCase())
const statusLabel = computed(() => logoutPending.value ? "SIGNING OUT" : initializing.value ? "INITIALIZING" : authError.value ? "AUTH ERROR" : loggedIn.value ? "ONLINE" : "GUEST")

async function handleLogout(): Promise<void> {
  logoutPending.value = true
  try { await logout(); toast.success("已退出登录") }
  catch (error) { toast.error(error instanceof Error ? error.message : "退出登录失败。") }
  finally { logoutPending.value = false }
}
</script>

<style scoped>
.spatial-account { grid-template-rows: auto minmax(0, 1fr); }
.spatial-account__body { display: grid; align-content: start; gap: 12px; padding: 14px; }
.spatial-account__identity-card { display: flex; align-items: center; gap: 12px; }
.spatial-account__identity-card h2, .spatial-account__heading h2 { margin: 3px 0; font-size: 16px; }
.spatial-account__identity-card p, .spatial-account__logout p { margin: 0; color: var(--spatial-app-muted); font-size: 11px; }
.spatial-account__avatar { width: 58px; height: 58px; flex: 0 0 58px; overflow: hidden; border: 1px solid var(--spatial-app-border-strong); }
.spatial-account__avatar--fallback { display: grid; place-items: center; background: var(--spatial-app-accent-soft); color: var(--spatial-window-tab); font: 700 18px "JetBrains Mono", monospace; }
.spatial-account__methods { display: grid; gap: 7px; margin-top: 10px; }
.spatial-account__method { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 9px; border: 1px solid var(--spatial-app-border); padding: 9px; }
.spatial-account__method > svg { width: 16px; color: var(--spatial-window-tab); }
.spatial-account__method strong, .spatial-account__method small { display: block; }.spatial-account__method strong { font-size: 12px; }.spatial-account__method small { color: var(--spatial-app-muted); font-size: 10px; margin-top: 2px; }
.spatial-account__method--disabled { opacity: .55; }.spatial-account__badge { border: 1px solid var(--spatial-app-border); padding: 3px 5px; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }.spatial-account__logout { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
</style>
