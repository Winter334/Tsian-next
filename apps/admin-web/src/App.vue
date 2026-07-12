<template>
  <div class="admin-shell">
    <section v-if="state === 'loading'" class="admin-gate">
      <p class="eyebrow">TSIAN ADMIN</p>
      <h1>正在验证管理员身份…</h1>
    </section>

    <section v-else-if="state === 'login'" class="admin-gate">
      <p class="eyebrow">TSIAN ADMIN</p>
      <h1>需要登录</h1>
      <p>请先使用平台账号登录，再进入管理后台。</p>
      <button type="button" class="button" @click="authApi.login">登录</button>
    </section>

    <section v-else-if="state === 'forbidden'" class="admin-gate admin-gate--forbidden">
      <p class="eyebrow">TSIAN ADMIN</p>
      <h1>无管理员权限</h1>
      <p>当前账号不在管理员白名单中。</p>
      <a class="button" href="/">返回平台</a>
    </section>

    <template v-else>
      <header class="admin-topbar">
        <div>
          <p class="eyebrow">TSIAN ADMIN</p>
          <h1>管理后台</h1>
        </div>
        <div class="admin-account">
          <span>{{ adminName }}</span>
          <a href="/" class="text-link">返回平台</a>
          <button type="button" class="text-link" @click="logout">退出</button>
        </div>
      </header>

      <div class="admin-layout">
        <nav class="admin-nav" aria-label="管理模块">
          <button
            v-for="item in navItems"
            :key="item.id"
            type="button"
            :class="['admin-nav__item', { 'admin-nav__item--active': activeTab === item.id }]"
            @click="activeTab = item.id"
          >
            <span>{{ item.label }}</span>
            <small>{{ item.caption }}</small>
          </button>
        </nav>

        <main class="admin-main">
          <OverviewView v-if="activeTab === 'overview'" />
          <WorkshopAdminView v-else-if="activeTab === 'workshop'" />
          <AnnouncementsAdminView v-else />
        </main>
      </div>
      <ConfirmHost />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { ApiError, authApi } from "./api-client"
import type { AdminMeResponse } from "@tsian/contracts"
import ConfirmHost from "./components/ConfirmHost.vue"
import OverviewView from "./views/OverviewView.vue"
import WorkshopAdminView from "./views/WorkshopAdminView.vue"
import AnnouncementsAdminView from "./views/AnnouncementsAdminView.vue"

type GateState = "loading" | "login" | "forbidden" | "ready"
type TabId = "overview" | "workshop" | "announcements"

const state = ref<GateState>("loading")
const activeTab = ref<TabId>("overview")
const session = ref<AdminMeResponse | null>(null)

const navItems: Array<{ id: TabId; label: string; caption: string }> = [
  { id: "overview", label: "总览", caption: "Overview" },
  { id: "workshop", label: "创意工坊", caption: "Workshop" },
  { id: "announcements", label: "公告", caption: "Announcements" },
]

const adminName = computed(() => session.value?.user.displayName ?? "Admin")

onMounted(async () => {
  await loadSession()
})

async function loadSession(): Promise<void> {
  state.value = "loading"
  try {
    session.value = await authApi.adminMe()
    state.value = "ready"
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.value = "login"
      return
    }
    if (error instanceof ApiError && error.status === 403) {
      state.value = "forbidden"
      return
    }
    state.value = "forbidden"
  }
}

async function logout(): Promise<void> {
  await authApi.logout()
  window.location.href = "/"
}
</script>
