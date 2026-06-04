<template>
  <!-- ── Master Wrapper: CSS Grid 堆叠，用于 CRT 开屏动画 ── -->
  <div
    class="grid w-full min-h-dvh overflow-hidden bg-void"
    :class="{ 'animate-crt-switch': splashState === 'animating' }"
    @animationend="onCrtAnimationEnd"
  >
    <!-- ── 主应用层 (z-10, 始终挂载, splash 期间被遮盖) ── -->
    <div class="col-start-1 row-start-1 z-10 min-h-0">
      <!-- /play 路由：游玩前端独占视口，无平台壳 -->
      <div v-if="isPlayRoute" class="h-dvh overflow-x-hidden overflow-y-auto bg-void">
        <router-view />
      </div>

      <!-- 平台壳：赛博工业风侧边栏布局 -->
      <div v-else class="flex h-screen w-screen overflow-hidden bg-void">
        <!-- ── 左侧边栏 ── -->
        <aside class="flex w-56 shrink-0 flex-col border-r border-neon-deep/40 bg-panel">
          <!-- 标题区 -->
          <div class="flex items-center gap-2 border-b border-neon-deep/30 px-4 py-5">
            <div class="h-2 w-2 rounded-full bg-neon shadow-neon-glow animate-pulse" />
            <h1 class="font-mono text-sm font-bold tracking-[0.25em] text-neon glow-text">
              T S I A N
            </h1>
          </div>

          <!-- 导航链接 -->
          <nav class="flex flex-1 flex-col gap-1 px-2 py-3">
            <button
              v-for="item in navItems"
              :key="item.name"
              type="button"
              class="group flex items-center gap-3 px-3 py-2.5 font-mono text-xs uppercase tracking-wider transition-all duration-150"
              :class="isRoute(item.name)
                ? 'bg-neon/10 text-neon border-l-2 border-neon glow-box'
                : 'text-text-dim hover:text-text-main hover:bg-elevated/50 border-l-2 border-transparent'"
              @click="router.push(item.path)"
            >
              <span class="text-[10px] font-bold opacity-40">{{ item.index }}</span>
              {{ item.label }}
            </button>
          </nav>

          <!-- 底部状态区 -->
          <div class="border-t border-neon-deep/30 px-4 py-3">
            <div class="flex items-center gap-2 font-mono text-[10px] text-text-dim">
              <div
                class="h-1.5 w-1.5 rounded-full"
                :class="storageStatus === 'ready' ? 'bg-neon' : 'bg-warning'"
              />
              STO:{{ storageStatus }}
            </div>
            <div class="mt-1 font-mono text-[10px] text-text-dim truncate">
              AI:{{ aiStatusShort }}
            </div>
          </div>
        </aside>

        <!-- ── 主内容区 ── -->
        <main class="relative flex-1 overflow-x-hidden overflow-y-auto bg-void p-4 md:p-6 lg:p-8">
          <div class="relative mx-auto min-h-full max-w-[1520px] border border-neon-muted/30 bg-panel/30 p-4 shadow-[inset_0_0_32px_rgba(0,0,0,0.35)] md:p-6 lg:p-8">
            <router-view />
          </div>
        </main>

        <!-- ── CRT 扫描线叠加层 ── -->
        <div
          class="pointer-events-none fixed inset-0 z-50 crt-scanlines opacity-30"
          aria-hidden="true"
        />

        <!-- ── 噪点纹理叠加层 ── -->
        <div
          class="pointer-events-none fixed inset-0 z-40 bg-noise"
          aria-hidden="true"
        />
      </div>
    </div>

    <!-- ── 开屏动画层 (z-50) ── -->
    <SplashScreen
      v-if="splashState !== 'done'"
      class="col-start-1 row-start-1 z-50"
      @exit="startCrtTransition"
    />
  </div>
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
import SplashScreen from "./components/SplashScreen.vue"

// ── 开屏动画状态机 ──
// typing   = splash 可见，打字机运行中
// animating = CRT 关机→开机动画播放中
// done     = 动画结束，splash 永久移除
type SplashState = "typing" | "animating" | "done"
const splashState = ref<SplashState>("typing")

/** 点击 splash 后触发 CRT 过渡动画 */
const startCrtTransition = () => {
  if (splashState.value !== "typing") return
  splashState.value = "animating"

  // 在 CRT 动画 55% 处 (800ms × 0.55 ≈ 440ms)，画面压缩到最暗的水平线
  // 此刻移除 splash DOM，动画展开时露出的就是真正的平台 UI
  setTimeout(() => {
    if (splashState.value === "animating") {
      splashState.value = "done"
    }
  }, 440)
}

/** CSS 动画结束回调（清理 will-change 等） */
const onCrtAnimationEnd = () => {
  splashState.value = "done"
}

const route = useRoute()
const router = useRouter()
const storageStatus = ref("checking...")
const aiStatus = ref("checking...")

const isPlayRoute = computed(() => route.name === "play")

const navItems = [
  { name: "lobby", path: "/", label: "大厅", index: "01" },
  { name: "mod", path: "/mod", label: "模组", index: "02" },
  { name: "resources", path: "/resources", label: "资源库", index: "03" },
  { name: "settings", path: "/settings", label: "设置", index: "04" },
  { name: "debug", path: "/debug", label: "调试", index: "05" },
]

function isRoute(name: string): boolean {
  if (name === "mod") {
    return route.name === "mod" || route.name === "mod-detail"
  }
  return route.name === name
}

const aiStatusShort = computed(() => {
  const chat = getBrowserAiConfig() ? "OK" : "--"
  const ret = getBrowserRetrievalConfig() ? "OK" : "--"
  const embed = getBrowserEmbeddingConfig() ? "OK" : "--"
  return `C:${chat} R:${ret} E:${embed}`
})

// Ctrl+Shift+D → 调试页
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
  aiStatus.value = `chat=${getBrowserAiConfig() ? "configured" : "missing"} | retrieval=${getBrowserRetrievalConfig() ? "configured" : "missing"} | embed=${getBrowserEmbeddingConfig() ? "configured" : "missing"} | local=${getBrowserPlatformConfigStorageState()}`
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
})
</script>
