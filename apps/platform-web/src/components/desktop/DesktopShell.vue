<template>
  <div
    class="desktop-shell"
    :class="{ 'desktop-shell--narrow': isNarrow }"
    @click="clearDesktopSelection"
    @contextmenu.prevent="openDesktopContextMenu"
  >
    <main
      ref="stageRef"
      class="desktop-stage"
    >
      <nav class="desktop-icon-grid" aria-label="桌面应用">
        <button
          v-for="icon in desktopLaunchers"
          :key="icon.id"
          type="button"
          class="desktop-icon retro-focus"
          :class="{
            'desktop-icon--selected': selectedDesktopIcon === icon.id,
          }"
          :aria-label="`打开${icon.label}`"
          @click.stop="selectDesktopIcon(icon.id)"
          @dblclick.stop="openDesktopIcon(icon.id)"
          @contextmenu.prevent.stop="openIconContextMenu(icon, $event)"
          @keydown.enter.prevent="openDesktopIcon(icon.id)"
          @keydown.space.prevent="openDesktopIcon(icon.id)"
        >
          <span class="desktop-icon-glyph">
            <component :is="icon.icon" class="h-7 w-7" aria-hidden="true" />
          </span>
          <span class="desktop-icon-label">{{ icon.label }}</span>
        </button>
      </nav>

      <DesktopWindow
        v-for="window in desktop.windows.value"
        :key="window.id"
        :window="window"
        :active="desktop.activeWindowId.value === window.id"
        :narrow="isNarrow"
        @focus="focusWindow"
        @minimize="minimizeWindow"
        @close="closeWindow"
        @fullscreen="setFullscreen"
        @move="moveWindow"
        @resize="resizeWindow"
      />

      <div
        v-if="contextMenu"
        class="desktop-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button
          v-if="contextMenu.icon"
          type="button"
          @click="openDesktopIcon(contextMenu.icon.id)"
        >
          打开
        </button>
        <button type="button" @click="showDesktop">
          显示桌面
        </button>
      </div>
    </main>

    <footer class="desktop-taskbar">
      <button
        type="button"
        class="desktop-start-button retro-focus"
        aria-label="显示桌面"
        @click.stop="showDesktop"
      >
        <MonitorDot class="h-4 w-4" aria-hidden="true" />
        TSian
      </button>
      <div class="desktop-task-list" aria-label="已打开的窗口">
        <button
          v-for="window in desktop.windows.value"
          :key="`task-${window.id}`"
          type="button"
          class="desktop-task-button retro-focus"
          :class="{
            'desktop-task-button--active': desktop.activeWindowId.value === window.id && !window.minimized,
            'desktop-task-button--minimized': window.minimized,
          }"
          @click="toggleTaskbarWindow(window.id)"
        >
          <component :is="window.icon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ window.shortLabel }}</span>
        </button>
      </div>
      <div class="desktop-system-tray flex items-center gap-1 border-l border-neon-deep/35 pl-2" @click.stop>
        <button
          type="button"
          class="desktop-task-button retro-focus px-2"
          :class="{ 'desktop-task-button--active': unreadCount > 0 }"
          title="公告中心"
          @click="openAnnouncementCenter"
        >
          <Bell class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span class="hidden sm:inline">公告</span>
          <span v-if="unreadCount > 0" class="text-neon">{{ unreadCount }}</span>
        </button>
        <div class="desktop-task-button px-2" title="当前在线人数">
          <RadioTower class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span class="hidden sm:inline">在线</span>
          <span>{{ onlineCount ?? "--" }}</span>
        </div>
      </div>
      <div class="desktop-auth flex items-center gap-1 border-l border-neon-deep/35 pl-2" @click.stop>
        <button
          type="button"
          class="desktop-task-button retro-focus px-2"
          title="账号中心"
          @click="openAccountCenter"
        >
          <img
            v-if="loggedIn && currentUser?.avatarUrl"
            :src="currentUser.avatarUrl"
            alt=""
            class="h-4 w-4 rounded-full border border-neon-deep/50"
          />
          <UserRound v-else class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span v-if="!loggedIn" class="hidden sm:inline">登录</span>
          <span v-else class="truncate max-w-[120px]">{{ currentUser?.displayName }}</span>
        </button>
      </div>
      <div class="desktop-clock">{{ desktopClock }}</div>
    </footer>

    <div class="pointer-events-none fixed inset-0 z-40 crt-scanlines opacity-20" aria-hidden="true" />
    <div class="pointer-events-none fixed inset-0 z-30 bg-noise" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Bell, MonitorDot, RadioTower, UserRound } from "lucide-vue-next"
import DesktopWindow from "./DesktopWindow.vue"
import {
  announcementWindowInput,
  desktopLaunchers,
  desktopWindowForLauncher,
  desktopWindowForRoute,
  type DesktopAppId,
  type DesktopLauncher,
} from "@/desktop-apps"
import {
  useDesktopWindows,
  type DesktopBounds,
  type DesktopWindowGeometry,
} from "@/composables/useDesktopWindows"
import { useAuth } from "@/composables/useAuth"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { usePresence } from "@/composables/usePresence"

interface ContextMenuState {
  x: number
  y: number
  icon: DesktopLauncher | null
}

type FullscreenRequestElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  mozRequestFullScreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  mozFullScreenElement?: Element | null
  msFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  mozCancelFullScreen?: () => Promise<void> | void
  msExitFullscreen?: () => Promise<void> | void
}

const route = useRoute()
const router = useRouter()
const desktop = useDesktopWindows()
const { currentUser, loggedIn } = useAuth()
const { unreadCount } = useAnnouncements()
const { onlineCount } = usePresence()
const selectedDesktopIcon = ref("")
const contextMenu = ref<ContextMenuState | null>(null)
const desktopClock = ref("")
const stageRef = ref<HTMLElement | null>(null)
const stageBounds = ref<DesktopBounds>({ width: 1280, height: 720 })
const isNarrow = ref(false)
let clockTimer: number | null = null
let resizeObserver: ResizeObserver | null = null
let browserFullscreenWindowId = ""

watch(
  () => route.fullPath,
  () => {
    const input = desktopWindowForRoute(route)
    if (!input) {
      return
    }
    desktop.openWindow(input, stageBounds.value)
  },
  { immediate: true },
)

function selectDesktopIcon(id: DesktopAppId) {
  selectedDesktopIcon.value = id
  contextMenu.value = null
}

function clearDesktopSelection() {
  selectedDesktopIcon.value = ""
  contextMenu.value = null
}

function openDesktopIcon(id: DesktopAppId) {
  const input = desktopWindowForLauncher(id)
  if (!input) {
    return
  }

  selectedDesktopIcon.value = id
  contextMenu.value = null
  desktop.openWindow(input, stageBounds.value)
  navigateTo(input.routePath)
}

function openIconContextMenu(icon: DesktopLauncher, event: MouseEvent) {
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

function focusWindow(id: string) {
  const focused = desktop.focusWindow(id)
  if (focused) {
    navigateTo(focused.routePath)
  }
}

function minimizeWindow(id: string) {
  const wasActive = desktop.activeWindowId.value === id
  desktop.minimizeWindow(id)
  if (wasActive) {
    syncRouteToActiveWindow()
  }
}

function toggleTaskbarWindow(id: string) {
  const target = desktop.windows.value.find((window) => window.id === id)
  if (!target) {
    return
  }
  if (target.minimized) {
    focusWindow(id)
  } else if (desktop.activeWindowId.value === id) {
    minimizeWindow(id)
  } else {
    focusWindow(id)
  }
}

function closeWindow(id: string) {
  const wasActive = desktop.activeWindowId.value === id
  void desktop.closeWindow(id).then(() => {
    if (wasActive) {
      syncRouteToActiveWindow()
    }
  })
}

async function setFullscreen(id: string, fullscreen: boolean) {
  const target = desktop.windows.value.find((window) => window.id === id)
  if (!target) {
    return
  }

  if (target.appId === "play") {
    if (fullscreen) {
      const enteredBrowserFullscreen = await requestPlayIframeFullscreen(id)
      if (enteredBrowserFullscreen) {
        browserFullscreenWindowId = id
        applyDesktopFullscreen(id, true)
        return
      }
    } else if (browserFullscreenWindowId === id && browserFullscreenElement()) {
      await exitBrowserFullscreen()
      browserFullscreenWindowId = ""
    }
  }

  applyDesktopFullscreen(id, fullscreen)
}

function applyDesktopFullscreen(id: string, fullscreen: boolean) {
  desktop.setFullscreen(id, fullscreen)
  const active = desktop.activeWindow.value
  if (active?.id === id) {
    navigateTo(active.routePath)
  }
}

async function requestPlayIframeFullscreen(id: string) {
  const iframe = findPlayIframe(id)
  if (!iframe) {
    return false
  }

  const currentFullscreenElement = browserFullscreenElement()
  if (currentFullscreenElement === iframe) {
    return true
  }

  return requestBrowserFullscreen(iframe)
}

function findPlayIframe(id: string) {
  return findDesktopWindowElement(id)?.querySelector("iframe") ?? null
}

function findDesktopWindowElement(id: string) {
  const stage = stageRef.value
  if (!stage) {
    return null
  }

  for (const candidate of stage.querySelectorAll<HTMLElement>(".desktop-window")) {
    if (candidate.dataset.desktopWindowId === id) {
      return candidate
    }
  }

  return null
}

async function requestBrowserFullscreen(element: FullscreenRequestElement) {
  const request = element.requestFullscreen
    ?? element.webkitRequestFullscreen
    ?? element.mozRequestFullScreen
    ?? element.msRequestFullscreen

  if (!request) {
    return false
  }

  try {
    await Promise.resolve(request.call(element))
    return true
  } catch {
    return false
  }
}

function browserFullscreenElement() {
  const fullscreenDocument = document as FullscreenDocument
  return document.fullscreenElement
    ?? fullscreenDocument.webkitFullscreenElement
    ?? fullscreenDocument.mozFullScreenElement
    ?? fullscreenDocument.msFullscreenElement
    ?? null
}

async function exitBrowserFullscreen() {
  const fullscreenDocument = document as FullscreenDocument
  const exit = document.exitFullscreen
    ?? fullscreenDocument.webkitExitFullscreen
    ?? fullscreenDocument.mozCancelFullScreen
    ?? fullscreenDocument.msExitFullscreen

  if (!exit) {
    return
  }

  try {
    await Promise.resolve(exit.call(document))
  } catch {
    // Browser fullscreen exit may be rejected if the user already left fullscreen.
  }
}

function onBrowserFullscreenChange() {
  if (!browserFullscreenWindowId || browserFullscreenElement()) {
    return
  }

  const id = browserFullscreenWindowId
  browserFullscreenWindowId = ""
  desktop.setFullscreen(id, false)
}

function moveWindow(id: string, geometry: Pick<DesktopWindowGeometry, "x" | "y">) {
  desktop.moveWindow(id, geometry, stageBounds.value)
}

function resizeWindow(id: string, geometry: DesktopWindowGeometry) {
  desktop.resizeWindow(id, geometry, stageBounds.value)
}

function showDesktop() {
  desktop.minimizeAll()
  contextMenu.value = null
  navigateTo("/")
}

function openAccountCenter() {
  const input = desktopWindowForLauncher("account")
  if (!input) {
    return
  }
  desktop.openWindow(input, stageBounds.value)
  navigateTo(input.routePath)
}

function openAnnouncementCenter() {
  const input = announcementWindowInput()
  desktop.openWindow(input, stageBounds.value)
  navigateTo(input.routePath)
}

function syncRouteToActiveWindow() {
  void nextTick(() => {
    const active = desktop.activeWindow.value
    navigateTo(active?.routePath ?? "/")
  })
}

function navigateTo(path: string) {
  if (router.currentRoute.value.fullPath === path) {
    return
  }
  void router.push(path)
}

function updateClock() {
  desktopClock.value = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(Date.now())
}

function updateStageBounds() {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect) {
    return
  }

  stageBounds.value = {
    width: rect.width,
    height: rect.height,
  }
  isNarrow.value = rect.width < 720
  desktop.clampAll(stageBounds.value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
    event.preventDefault()
    const input = desktopWindowForLauncher("debug")
    if (input) {
      desktop.openWindow(input, stageBounds.value)
      navigateTo(input.routePath)
    }
  }

  if (event.key === "Escape") {
    contextMenu.value = null
  }
}

onMounted(() => {
  updateClock()
  clockTimer = window.setInterval(updateClock, 30_000)
  window.addEventListener("keydown", onKeydown)
  document.addEventListener("fullscreenchange", onBrowserFullscreenChange)
  document.addEventListener("webkitfullscreenchange", onBrowserFullscreenChange)
  document.addEventListener("mozfullscreenchange", onBrowserFullscreenChange)
  document.addEventListener("MSFullscreenChange", onBrowserFullscreenChange)

  resizeObserver = new ResizeObserver(updateStageBounds)
  if (stageRef.value) {
    resizeObserver.observe(stageRef.value)
  }
  updateStageBounds()
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  document.removeEventListener("fullscreenchange", onBrowserFullscreenChange)
  document.removeEventListener("webkitfullscreenchange", onBrowserFullscreenChange)
  document.removeEventListener("mozfullscreenchange", onBrowserFullscreenChange)
  document.removeEventListener("MSFullscreenChange", onBrowserFullscreenChange)
  resizeObserver?.disconnect()
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
  }
})
</script>
