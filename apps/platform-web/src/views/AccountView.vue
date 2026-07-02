<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <!-- 状态条：未登录 NO OPERATOR / 已登录 OPERATOR ONLINE -->
    <div
      class="account-status"
      :class="loggedIn ? 'account-status--online' : 'account-status--offline'"
    >
      <span class="account-status-dot" aria-hidden="true" />
      <span>{{ loggedIn ? "OPERATOR ONLINE" : "NO OPERATOR SIGNED IN" }}</span>
    </div>

    <div class="account-body overflow-auto">
      <!-- 身份区 -->
      <div class="account-id-block">
        <div class="account-avatar retro-inset">
          <img
            v-if="currentUser?.avatarUrl"
            :src="currentUser.avatarUrl"
            :alt="currentUser.displayName"
            class="h-full w-full object-cover"
          />
          <UserRound v-else class="h-7 w-7 text-neon" aria-hidden="true" />
        </div>
        <div class="account-id-info">
          <div v-if="loggedIn" class="account-name">{{ currentUser?.displayName }}</div>
          <div v-else class="account-name account-name--guest">访客</div>
          <div v-if="loggedIn" class="account-opid">OP-ID: {{ currentUser?.handle }}</div>
          <p class="account-desc">
            <template v-if="loggedIn">游戏卡与存档将同步到云端，多设备续玩。</template>
            <template v-else>登录后同步游戏卡、存档到云端，多设备续玩。当前以访客身份使用本地数据，不会跨设备保留。</template>
          </p>
        </div>
      </div>

      <!-- 凭证槽位纵列 -->
      <div class="account-section-label">
        {{ loggedIn ? "已绑定凭证" : "可用登录方式" }}
      </div>

      <!-- Discord -->
      <div
        class="account-slot"
        :class="discordBound ? 'account-slot--bound' : 'account-slot--active'"
      >
        <div class="account-slot-name">
          <MessagesSquare class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>DISCORD<span v-if="discordBound"> · 已绑定</span></span>
        </div>
        <div v-if="discordBound" class="account-slot-tag account-slot-tag--bound">✓ 绑定</div>
        <button
          v-else
          type="button"
          class="retro-button retro-focus account-slot-action"
          :disabled="initializing"
          @click="login"
        >
          使用 Discord 登录 ▶
        </button>
      </div>

      <!-- 账号密码（预留） -->
      <div class="account-slot account-slot--disabled">
        <div class="account-slot-name">
          <KeyRound class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>账号密码</span>
        </div>
        <div class="account-slot-tag">即将开放</div>
      </div>

      <!-- 邮箱邀请（预留） -->
      <div class="account-slot account-slot--disabled">
        <div class="account-slot-name">
          <Mail class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>邮箱邀请</span>
        </div>
        <div class="account-slot-tag">即将开放</div>
      </div>

      <!-- Magic Link（预留） -->
      <div class="account-slot account-slot--disabled">
        <div class="account-slot-name">
          <Link2 class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Magic Link</span>
        </div>
        <div class="account-slot-tag">即将开放</div>
      </div>

      <!-- 退出登录（仅已登录） -->
      <button
        v-if="loggedIn"
        type="button"
        class="retro-focus account-logout"
        :disabled="logoutPending"
        @click="handleLogout"
      >
        <LogOut class="h-3.5 w-3.5" aria-hidden="true" />
        <span>{{ logoutPending ? "正在退出…" : "退出登录" }}</span>
      </button>

      <!-- 错误提示 -->
      <p v-if="authError" class="account-error">{{ authError }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { KeyRound, Link2, LogOut, Mail, MessagesSquare, UserRound } from "lucide-vue-next"
import { useAuth } from "@/composables/useAuth"
import { toast } from "@/composables/useToast"

const { currentUser, loggedIn, initializing, authError, login, logout } = useAuth()
const logoutPending = ref(false)

const discordBound = computed(() => currentUser.value?.authProviders.includes("discord") ?? false)

async function handleLogout(): Promise<void> {
  logoutPending.value = true
  try {
    await logout()
    toast.success("已退出登录")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "退出登录失败。")
  } finally {
    logoutPending.value = false
  }
}
</script>

<style scoped>
.account-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid rgba(246, 236, 215, 0.22);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 1.5px;
}

.account-status--offline {
  background: rgba(243, 197, 109, 0.06);
  color: var(--color-neon);
}

.account-status--online {
  background: rgba(92, 119, 91, 0.1);
  color: #a8c89a;
}

.account-status-dot {
  width: 6px;
  height: 6px;
  background: currentColor;
}

.account-status--offline .account-status-dot {
  animation: account-phosphor-breathe 1.6s ease-in-out infinite;
}

@keyframes account-phosphor-breathe {
  0%, 100% { opacity: 0.35; box-shadow: 0 0 2px currentColor; }
  50% { opacity: 1; box-shadow: 0 0 8px currentColor, 0 0 14px currentColor; }
}

@media (prefers-reduced-motion: reduce) {
  .account-status--offline .account-status-dot {
    animation: none;
    opacity: 0.8;
  }
}

.account-body {
  padding: 1rem;
}

.account-id-block {
  display: flex;
  gap: 0.9rem;
  margin-bottom: 1.2rem;
}

.account-avatar {
  display: grid;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  place-items: center;
}

.account-id-info {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 0.25rem;
}

.account-name {
  font-size: 1rem;
  font-weight: bold;
  color: var(--color-text-main);
}

.account-name--guest {
  color: var(--color-text-dim);
}

.account-opid {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--color-neon-muted);
  letter-spacing: 1px;
}

.account-desc {
  font-size: 0.72rem;
  line-height: 1.6;
  color: var(--color-text-dim);
}

.account-section-label {
  margin: 0 0 0.55rem;
  border-bottom: 1px solid rgba(246, 236, 215, 0.15);
  padding-bottom: 0.3rem;
  color: var(--color-text-dim);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.account-slot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  border: 1px solid rgba(246, 236, 215, 0.22);
  background: var(--color-panel);
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.5rem;
}

.account-slot--active {
  border-color: var(--color-neon-deep);
  background: rgba(243, 197, 109, 0.06);
}

.account-slot--bound {
  border-color: rgba(168, 200, 154, 0.4);
  background: rgba(92, 119, 91, 0.08);
}

.account-slot--disabled {
  border-style: dashed;
  opacity: 0.5;
}

.account-slot-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-main);
}

.account-slot--disabled .account-slot-name {
  color: var(--color-text-dim);
}

.account-slot-name span {
  font-family: var(--font-mono);
}

.account-slot-action {
  flex: 0 0 auto;
  padding: 0.3rem 0.7rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
}

.account-slot-tag {
  border: 1px solid rgba(246, 236, 215, 0.15);
  padding: 0.15rem 0.45rem;
  color: var(--color-text-dim);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  flex: 0 0 auto;
}

.account-slot-tag--bound {
  border-color: rgba(168, 200, 154, 0.3);
  color: #a8c89a;
}

.account-logout {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--color-danger);
  background: rgba(200, 79, 92, 0.12);
  padding: 0.55rem;
  margin-top: 1rem;
  color: var(--color-danger);
  font-family: var(--font-mono);
  font-size: 0.72rem;
}

.account-logout:hover:not(:disabled) {
  background: rgba(200, 79, 92, 0.2);
}

.account-logout:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.account-error {
  margin-top: 0.6rem;
  color: var(--color-danger);
  font-size: 0.7rem;
}
</style>
