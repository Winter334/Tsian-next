<template>
  <aside
    ref="sourceRef"
    class="spatial-status-surface"
    data-spatial-source="shell:status"
    data-spatial-z="11"
    data-spatial-depth="28"
    data-spatial-yaw="0.055"
    data-spatial-scale="0.985"
    data-spatial-curve-half-angle="0.035"
    aria-label="Spatial 窗口任务与桌面工具"
    @contextmenu.prevent="openPointerMenu(null, $event)"
  >
    <div
      v-if="windows.length > 0"
      class="spatial-dock-scroll spatial-status-surface__tasks"
      aria-label="已打开窗口"
    >
      <button
        v-for="window in windows"
        :key="window.id"
        type="button"
        class="spatial-dock-button spatial-task-button"
        :class="{
          'spatial-task-button--active': window.id === activeWindowId && !window.minimized,
          'spatial-task-button--minimized': window.minimized,
        }"
        :aria-label="`${window.minimized ? '恢复' : '聚焦'}${window.descriptor.title}`"
        :aria-pressed="window.id === activeWindowId && !window.minimized"
        :title="window.descriptor.title"
        @click="activateWindow(window.id)"
        @contextmenu.prevent.stop="openPointerMenu(window, $event)"
        @keydown="openKeyboardMenu(window, $event)"
      >
        <component :is="window.descriptor.icon" aria-hidden="true" />
      </button>
    </div>
    <div class="spatial-status-surface__utility" aria-label="桌面工具">
      <div class="spatial-status-surface__actions">
        <button
          type="button"
          class="spatial-dock-button spatial-status-surface__announcements"
          aria-label="打开公告中心"
          title="公告中心"
          @click="activateAnnouncements"
          @keydown="openKeyboardMenu(null, $event)"
        >
          <Bell aria-hidden="true" />
          <span v-if="(unreadCount ?? 0) > 0" class="spatial-status-surface__badge" :aria-label="`${unreadCount ?? 0} 条未读公告`">{{ unreadBadge }}</span>
        </button>
        <button
          type="button"
          class="spatial-dock-button"
          aria-label="全部最小化"
          title="全部最小化"
          @click="activateMinimizeAll"
          @keydown="openKeyboardMenu(null, $event)"
        >
          <Minimize2 aria-hidden="true" />
        </button>
        <button
          type="button"
          class="spatial-dock-button spatial-status-surface__exit"
          aria-label="返回 RetroOS"
          title="返回 RetroOS"
          @click="activateReturnRetro"
          @keydown="openKeyboardMenu(null, $event)"
        >
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
    </div>
  </aside>

  <SpatialShellContextMenu
    v-if="menu"
    :source-id="SPATIAL_STATUS_MENU_SOURCE_ID"
    menu-label="窗口任务与桌面菜单"
    :items="menuItems"
    :layout="menu.layout"
    @select="selectMenuItem"
    @close="closeMenu"
    @source-dirty="(sourceId) => emit('sourceDirty', sourceId)"
  />
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Bell, Minimize2, RotateCcw } from "lucide-vue-next"
import type { SpatialWindowState } from "./window-session"
import SpatialShellContextMenu from "./SpatialShellContextMenu.vue"
import {
  SPATIAL_STATUS_MENU_SOURCE_ID,
  type SpatialShellMenuItem,
  type SpatialShellMenuViewport,
} from "./spatial-shell-context-menu"
import { useSpatialShellContextMenu } from "./use-spatial-shell-context-menu"

const props = defineProps<{
  windows: readonly SpatialWindowState[]
  activeWindowId: string
  viewport: SpatialShellMenuViewport
  unreadCount?: number
}>()

const emit = defineEmits<{
  focus: [id: string]
  minimizeAll: []
  returnRetro: []
  announcements: []
  sourceTopologyChanged: []
  sourceDirty: [sourceId: string]
}>()

const { sourceRef, menu, openPointerMenu, openKeyboardMenu, closeMenu } =
  useSpatialShellContextMenu<SpatialWindowState | null>({
    ownerSourceId: "shell:status",
    menuSourceId: SPATIAL_STATUS_MENU_SOURCE_ID,
    viewport: () => props.viewport,
    itemCount: (target) => target ? 3 : 2,
    sourceTopologyChanged: () => emit("sourceTopologyChanged"),
    sourceDirty: (sourceId) => emit("sourceDirty", sourceId),
  })

const menuItems = computed<readonly SpatialShellMenuItem[]>(() => [
  ...(menu.value?.target
    ? [{
        id: "focus",
        label: `${menu.value.target.minimized ? "恢复" : "聚焦"}${menu.value.target.descriptor.title}`,
      }]
    : []),
  { id: "desktop", label: "显示桌面" },
  { id: "retro", label: "返回 RetroOS", danger: true },
])
const unreadBadge = computed(() => props.unreadCount && props.unreadCount > 99 ? "99+" : String(props.unreadCount ?? 0))

function activateWindow(id: string): void {
  closeMenu(false)
  emit("focus", id)
}

function activateMinimizeAll(): void {
  closeMenu(false)
  emit("minimizeAll")
}

function activateReturnRetro(): void {
  closeMenu(false)
  emit("returnRetro")
}

function activateAnnouncements(): void {
  closeMenu(false)
  emit("announcements")
}

function selectMenuItem(id: string): void {
  const current = menu.value
  if (!current) return
  if (id === "focus" && current.target) emit("focus", current.target.id)
  else if (id === "desktop") emit("minimizeAll")
  else if (id === "retro") emit("returnRetro")
  closeMenu(false)
}
</script>
