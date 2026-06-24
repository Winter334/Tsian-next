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
        v-for="window in desktop.visibleWindows.value"
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
      <div class="desktop-clock">{{ desktopClock }}</div>
    </footer>

    <div class="pointer-events-none fixed inset-0 z-40 crt-scanlines opacity-20" aria-hidden="true" />
    <div class="pointer-events-none fixed inset-0 z-30 bg-noise" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { MonitorDot } from "lucide-vue-next"
import DesktopWindow from "./DesktopWindow.vue"
import {
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

interface ContextMenuState {
  x: number
  y: number
  icon: DesktopLauncher | null
}

const route = useRoute()
const router = useRouter()
const desktop = useDesktopWindows()
const selectedDesktopIcon = ref("")
const contextMenu = ref<ContextMenuState | null>(null)
const desktopClock = ref("")
const stageRef = ref<HTMLElement | null>(null)
const stageBounds = ref<DesktopBounds>({ width: 1280, height: 720 })
const isNarrow = ref(false)
let clockTimer: number | null = null
let resizeObserver: ResizeObserver | null = null

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

function setFullscreen(id: string, fullscreen: boolean) {
  desktop.setFullscreen(id, fullscreen)
  const active = desktop.activeWindow.value
  if (active?.id === id) {
    navigateTo(active.routePath)
  }
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

  resizeObserver = new ResizeObserver(updateStageBounds)
  if (stageRef.value) {
    resizeObserver.observe(stageRef.value)
  }
  updateStageBounds()
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  resizeObserver?.disconnect()
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
  }
})
</script>
