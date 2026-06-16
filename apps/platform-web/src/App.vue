<template>
  <div
    class="grid min-h-dvh w-full overflow-hidden bg-void"
    :class="{ 'animate-crt-switch': splashState === 'animating' }"
    @animationend="onCrtAnimationEnd"
  >
    <div class="col-start-1 row-start-1 z-10 min-h-0">
      <div v-if="isPlayRoute" class="h-dvh overflow-x-hidden overflow-y-auto bg-void">
        <router-view />
      </div>

      <div
        v-else
        class="desktop-shell"
        @click="clearDesktopSelection"
        @contextmenu.prevent="openDesktopContextMenu"
      >
        <header class="desktop-menubar">
          <button
            type="button"
            class="desktop-start-button"
            @click.stop="router.push('/')"
          >
            <MonitorDot class="h-4 w-4" aria-hidden="true" />
            TSian
          </button>
          <div class="desktop-menu-tabs" aria-label="System menus">
            <span>File</span>
            <span>View</span>
            <span>System</span>
          </div>
          <div class="desktop-system-readout">
            <span>STO:{{ storageStatus }}</span>
            <span>AI:{{ aiStatusShort }}</span>
          </div>
        </header>

        <main class="desktop-stage">
          <nav class="desktop-icon-grid" aria-label="Desktop applications">
            <button
              v-for="icon in desktopIcons"
              :key="icon.id"
              type="button"
              class="desktop-icon retro-focus"
              :class="{ 'desktop-icon--selected': selectedDesktopIcon === icon.id || isIconActive(icon.id) }"
              :aria-label="`Open ${icon.label}`"
              @click.stop="selectDesktopIcon(icon.id)"
              @dblclick.stop="openDesktopIcon(icon)"
              @contextmenu.prevent.stop="openIconContextMenu(icon, $event)"
              @keydown.enter.prevent="openDesktopIcon(icon)"
              @keydown.space.prevent="openDesktopIcon(icon)"
            >
              <span class="desktop-icon-glyph">
                <component :is="icon.icon" class="h-7 w-7" aria-hidden="true" />
              </span>
              <span class="desktop-icon-label">{{ icon.label }}</span>
            </button>
          </nav>

          <div v-if="isWindowRoute" class="desktop-window-wrap">
            <section
              class="desktop-window"
              :class="activeWindow?.wide ? 'desktop-window--wide' : 'desktop-window--normal'"
              :aria-label="activeWindow?.title ?? 'Tsian application window'"
            >
              <header class="desktop-window-titlebar">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="desktop-window-icon">
                    <component :is="activeWindow?.icon ?? MonitorDot" class="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div class="min-w-0">
                    <h1 class="truncate font-mono text-sm font-bold">
                      {{ activeWindow?.title ?? "Tsian" }}
                    </h1>
                    <p class="truncate font-mono text-[10px] uppercase tracking-wider">
                      {{ activeWindow?.caption ?? "Application window" }}
                    </p>
                  </div>
                </div>
                <div class="desktop-window-controls">
                  <button type="button" aria-label="Minimize window" @click="router.push('/')">
                    <Minus class="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" aria-label="Close window" @click="router.push('/')">
                    <X class="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </header>
              <div class="desktop-window-content">
                <router-view />
              </div>
            </section>
          </div>

          <div
            v-if="contextMenu"
            class="desktop-context-menu"
            :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
            @click.stop
          >
            <button
              v-if="contextMenu.icon"
              type="button"
              @click="openDesktopIcon(contextMenu.icon)"
            >
              Open
            </button>
            <button type="button" @click="router.push('/')">
              Show Desktop
            </button>
          </div>
        </main>

        <footer class="desktop-taskbar">
          <button
            v-for="icon in desktopIcons"
            :key="`task-${icon.id}`"
            type="button"
            class="desktop-task-button"
            :class="{ 'desktop-task-button--active': isIconActive(icon.id) }"
            @click="openDesktopIcon(icon)"
          >
            <component :is="icon.icon" class="h-3.5 w-3.5" aria-hidden="true" />
            {{ icon.shortLabel }}
          </button>
          <div class="desktop-clock">{{ desktopClock }}</div>
        </footer>

        <div class="pointer-events-none fixed inset-0 z-40 crt-scanlines opacity-20" aria-hidden="true" />
        <div class="pointer-events-none fixed inset-0 z-30 bg-noise" aria-hidden="true" />
      </div>
    </div>

    <SplashScreen
      v-if="splashState !== 'done'"
      class="col-start-1 row-start-1 z-50"
      @exit="startCrtTransition"
    />
  </div>
</template>

<script setup lang="ts">
import type { Component } from "vue"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  Activity,
  FolderOpen,
  FolderKanban,
  Minus,
  MonitorDot,
  Settings,
  Store,
  X,
} from "lucide-vue-next"
import SplashScreen from "./components/SplashScreen.vue"
import {
  getBrowserAiConfig,
  getBrowserPlatformConfigStorageState,
} from "./config/ai"
import { initializePlatformHost } from "./platform-host"
import { ensureLocalStorageReady } from "./storage"

type SplashState = "typing" | "animating" | "done"

interface DesktopIcon {
  id: string
  label: string
  shortLabel: string
  path: string
  routeNames: string[]
  icon: Component
  title: string
  caption: string
  wide?: boolean
}

interface ContextMenuState {
  x: number
  y: number
  icon: DesktopIcon | null
}

const splashState = ref<SplashState>("typing")
const route = useRoute()
const router = useRouter()
const storageStatus = ref("checking...")
const aiStatus = ref("checking...")
const selectedDesktopIcon = ref("")
const contextMenu = ref<ContextMenuState | null>(null)
const desktopClock = ref("")
let clockTimer: number | null = null

const desktopIcons: DesktopIcon[] = [
  {
    id: "market",
    label: "App Market",
    shortLabel: "Market",
    path: "/market",
    routeNames: ["app-market"],
    icon: Store,
    title: "App Market",
    caption: "Browse and install Game Cards",
    wide: true,
  },
  {
    id: "my-apps",
    label: "My Apps",
    shortLabel: "My Apps",
    path: "/library",
    routeNames: ["library", "game-card-detail"],
    icon: FolderOpen,
    title: "My Apps",
    caption: "Installed Game Cards",
    wide: true,
  },
  {
    id: "settings",
    label: "Control Panel",
    shortLabel: "Settings",
    path: "/settings",
    routeNames: ["settings"],
    icon: Settings,
    title: "Control Panel",
    caption: "Platform settings",
  },
  {
    id: "debug",
    label: "System Monitor",
    shortLabel: "Monitor",
    path: "/debug",
    routeNames: ["debug"],
    icon: Activity,
    title: "System Monitor",
    caption: "Runtime diagnostics",
    wide: true,
  },
]

const isPlayRoute = computed(() => route.name === "play")
const isWindowRoute = computed(() => route.name !== "desktop" && !isPlayRoute.value)
const fallbackWindow: DesktopIcon = {
    id: "workspace",
    label: "Tsian",
    shortLabel: "Tsian",
    path: "/",
    routeNames: [],
    icon: FolderKanban,
    title: "Tsian",
    caption: "Application window",
}
const activeWindow = computed<DesktopIcon>(() => {
  if (route.name === "game-card-detail") {
    const library = desktopIcons.find((icon) => icon.id === "my-apps") ?? desktopIcons[0]
    return {
      ...library,
      title: "Game Launcher",
      caption: "Play, saves, and workspace",
    }
  }

  return desktopIcons.find((icon) => icon.routeNames.includes(String(route.name))) ?? fallbackWindow
})

const aiStatusShort = computed(() => {
  const chat = getBrowserAiConfig() ? "OK" : "--"
  return `CHAT:${chat}`
})

function startCrtTransition() {
  if (splashState.value !== "typing") {
    return
  }

  splashState.value = "animating"
  setTimeout(() => {
    if (splashState.value === "animating") {
      splashState.value = "done"
    }
  }, 440)
}

function onCrtAnimationEnd() {
  splashState.value = "done"
}

function selectDesktopIcon(id: string) {
  selectedDesktopIcon.value = id
  contextMenu.value = null
}

function clearDesktopSelection() {
  selectedDesktopIcon.value = ""
  contextMenu.value = null
}

function openDesktopIcon(icon: DesktopIcon) {
  selectedDesktopIcon.value = icon.id
  contextMenu.value = null
  router.push(icon.path)
}

function openIconContextMenu(icon: DesktopIcon, event: MouseEvent) {
  selectedDesktopIcon.value = icon.id
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    icon,
  }
}

function openDesktopContextMenu(event: MouseEvent) {
  selectedDesktopIcon.value = ""
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    icon: null,
  }
}

function isIconActive(id: string): boolean {
  return activeWindow.value?.id === id && isWindowRoute.value
}

function updateClock() {
  desktopClock.value = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(Date.now())
}

function onKeydown(event: KeyboardEvent) {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
    event.preventDefault()
    router.push("/debug")
  }

  if (event.key === "Escape") {
    contextMenu.value = null
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown)
  updateClock()
  clockTimer = window.setInterval(updateClock, 30_000)
  storageStatus.value = await ensureLocalStorageReady()
  await initializePlatformHost()
  aiStatus.value = `chat=${getBrowserAiConfig() ? "configured" : "missing"} | local=${getBrowserPlatformConfigStorageState()}`
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
  }
})
</script>
