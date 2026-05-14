<template>
  <main class="app-shell">
    <!-- 平台壳：游戏路由 /play 下隐藏外壳，由游玩前端独占视口 -->
    <template v-if="!isPlayRoute">
      <section class="panel">
        <header class="panel-header">
          <div class="panel-copy">
            <p class="eyebrow">Tsian</p>
            <h1>Platform Lobby</h1>
            <p class="summary">
              先在平台大厅选择模组，再进入对应模组页管理存档与查看平台设置；只有真正进入游戏时，才挂载游玩前端。
            </p>
          </div>
          <div class="status-grid">
            <article class="status-card">
              <span>Storage</span>
              <strong>{{ storageStatus }}</strong>
            </article>
            <article class="status-card">
              <span>AI</span>
              <strong>{{ aiStatus }}</strong>
            </article>
            <article class="status-card">
              <span>Route</span>
              <strong>{{ routeName }}</strong>
            </article>
          </div>
        </header>

        <nav class="platform-nav">
          <button
            class="nav-button"
            :class="{ 'nav-button--active': isRoute('lobby') }"
            type="button"
            @click="goLobby"
          >
            大厅
          </button>
          <button
            class="nav-button"
            :class="{ 'nav-button--active': isRoute('mod') }"
            type="button"
            @click="goMod"
          >
            模组页
          </button>
          <button
            class="nav-button"
            :class="{ 'nav-button--active': isRoute('settings') }"
            type="button"
            @click="goSettings"
          >
            设置
          </button>
        </nav>

        <router-view />
      </section>
    </template>

    <router-view v-else />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  getBrowserAiConfig,
  getBrowserEmbeddingConfig,
  getBrowserPlatformConfigStorageState,
  getBrowserRetrievalConfig,
} from "./config/ai"
import { initializePlatformHost } from "./platform-host"
import { ensureLocalStorageReady } from "./storage"

const route = useRoute()
const router = useRouter()
const storageStatus = ref("checking...")
const aiStatus = ref("checking...")

const isPlayRoute = computed(() => route.name === "play")
const routeName = computed(() => String(route.name ?? "—"))

function isRoute(name: string): boolean {
  return route.name === name
}

function platformStatusText(): string {
  return [
    `chat=${getBrowserAiConfig() ? "configured" : "missing"}`,
    `retrieval=${getBrowserRetrievalConfig() ? "configured" : "missing"}`,
    `embed=${getBrowserEmbeddingConfig() ? "configured" : "missing"}`,
    `local=${getBrowserPlatformConfigStorageState()}`,
  ].join(" | ")
}

function goLobby() {
  router.push("/")
}

function goMod() {
  router.push("/mod")
}

function goSettings() {
  router.push("/settings")
}

// 全局 Ctrl+Shift+D 跳转到调试页（D6）
function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault()
    router.push("/debug")
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown)
  storageStatus.value = await ensureLocalStorageReady()
  await initializePlatformHost()
  aiStatus.value = platformStatusText()
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
})
</script>

<style scoped>
.app-shell {
  width: 100%;
  min-height: 100vh;
  padding: var(--ts-space-6);
}

.panel {
  width: min(1440px, 100%);
  min-width: 0;
  margin: 0 auto;
  padding: var(--ts-space-8);
  border: 1px solid var(--ts-color-border-strong);
  border-radius: var(--ts-radius-2xl);
  background: var(--ts-bg-parchment);
  box-shadow: var(--ts-shadow-4);
}

.panel-header {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.9fr);
  gap: var(--ts-space-4);
  align-items: start;
}

.panel-copy {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 var(--ts-space-3);
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-xs);
  letter-spacing: var(--ts-tracking-wide);
  text-transform: uppercase;
}

h1 {
  margin: 0 0 var(--ts-space-3);
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-3xl);
  line-height: var(--ts-leading-tight);
  color: var(--ts-color-text-primary);
  font-weight: var(--ts-weight-bold);
}

.summary {
  margin: 0;
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-base);
  line-height: var(--ts-leading-normal);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--ts-space-3);
}

.status-card {
  padding: var(--ts-space-4);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-xl);
  background: var(--ts-color-surface-raised);
  box-shadow: var(--ts-shadow-1);
}

.status-card span {
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-sm);
  line-height: 1.7;
}

.status-card strong {
  display: block;
  margin-top: var(--ts-space-2);
  color: var(--ts-color-text-primary);
  font-size: var(--ts-text-sm);
  line-height: 1.6;
  font-weight: var(--ts-weight-medium);
}

.platform-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ts-space-3);
  margin-top: var(--ts-space-6);
}

.nav-button {
  padding: var(--ts-space-3) var(--ts-space-4);
  border-radius: var(--ts-radius-lg);
  border: 1px solid var(--ts-color-border-strong);
  background: var(--ts-color-surface-overlay);
  color: var(--ts-color-text-primary);
  font: inherit;
  cursor: pointer;
  transition:
    transform var(--ts-duration-default) var(--ts-ease-out),
    border-color var(--ts-duration-default) var(--ts-ease-out),
    background var(--ts-duration-default) var(--ts-ease-out);
}

.nav-button--active {
  border-color: var(--ts-color-accent-default);
  background: var(--ts-color-accent-default);
  color: var(--ts-color-accent-fg);
}

.nav-button:hover {
  transform: translateY(-1px);
}

@media (max-width: 1080px) {
  .panel-header {
    grid-template-columns: 1fr;
  }

  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .app-shell {
    padding: var(--ts-space-3);
  }

  .panel {
    padding: var(--ts-space-4);
  }

  .status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
