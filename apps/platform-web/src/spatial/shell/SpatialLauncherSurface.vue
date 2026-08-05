<template>
  <nav
    ref="sourceRef"
    class="spatial-launcher-surface"
    data-spatial-source="shell:launcher"
    data-spatial-z="10"
    data-spatial-depth="28"
    data-spatial-yaw="-0.055"
    data-spatial-scale="0.985"
    data-spatial-curve-half-angle="0.035"
    aria-label="Spatial 应用启动器"
    @contextmenu.prevent="openPointerMenu(null, $event)"
  >
    <div class="spatial-dock-scroll spatial-launcher-surface__apps" aria-label="应用">
      <button
        v-for="launcher in launchers"
        :key="launcher.id"
        type="button"
        class="spatial-dock-button spatial-launcher-button"
        :class="{ 'spatial-launcher-button--active': launcher.id === activeAppId }"
        :aria-label="`打开${launcher.label}`"
        :aria-current="launcher.id === activeAppId ? 'page' : undefined"
        :title="launcher.label"
        @click="activateLauncher(launcher.id)"
        @contextmenu.prevent.stop="openPointerMenu(launcher, $event)"
        @keydown="openKeyboardMenu(launcher, $event)"
      >
        <component :is="launcher.icon" aria-hidden="true" />
      </button>
    </div>
  </nav>

  <SpatialShellContextMenu
    v-if="menu"
    :source-id="SPATIAL_LAUNCHER_MENU_SOURCE_ID"
    menu-label="应用启动器菜单"
    :items="menuItems"
    :layout="menu.layout"
    @select="selectMenuItem"
    @close="closeMenu"
    @source-dirty="(sourceId) => emit('sourceDirty', sourceId)"
  />
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { PlatformAppId, PlatformLauncherDescriptor } from "@/platform-apps"
import SpatialShellContextMenu from "./SpatialShellContextMenu.vue"
import {
  SPATIAL_LAUNCHER_MENU_SOURCE_ID,
  type SpatialShellMenuItem,
  type SpatialShellMenuViewport,
} from "./spatial-shell-context-menu"
import { useSpatialShellContextMenu } from "./use-spatial-shell-context-menu"

const props = defineProps<{
  launchers: readonly PlatformLauncherDescriptor[]
  activeAppId: PlatformAppId | ""
  viewport: SpatialShellMenuViewport
}>()

const emit = defineEmits<{
  open: [id: PlatformAppId]
  minimizeAll: []
  sourceTopologyChanged: []
  sourceDirty: [sourceId: string]
}>()

const { sourceRef, menu, openPointerMenu, openKeyboardMenu, closeMenu } =
  useSpatialShellContextMenu<PlatformLauncherDescriptor | null>({
    ownerSourceId: "shell:launcher",
    menuSourceId: SPATIAL_LAUNCHER_MENU_SOURCE_ID,
    viewport: () => props.viewport,
    itemCount: (target) => target ? 2 : 1,
    sourceTopologyChanged: () => emit("sourceTopologyChanged"),
    sourceDirty: (sourceId) => emit("sourceDirty", sourceId),
  })

const menuItems = computed<readonly SpatialShellMenuItem[]>(() => [
  ...(menu.value?.target
    ? [{ id: "open", label: `打开${menu.value.target.label}` }]
    : []),
  { id: "desktop", label: "显示桌面" },
])

function activateLauncher(id: PlatformAppId): void {
  closeMenu(false)
  emit("open", id)
}

function selectMenuItem(id: string): void {
  const current = menu.value
  if (!current) return
  if (id === "open" && current.target) emit("open", current.target.id)
  if (id === "desktop") emit("minimizeAll")
  closeMenu(false)
}
</script>
