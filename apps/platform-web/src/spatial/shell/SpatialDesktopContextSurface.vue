<template>
  <section
    ref="sourceRef"
    class="spatial-desktop-context-surface"
    :data-spatial-source="SPATIAL_DESKTOP_INPUT_SOURCE_ID"
    data-spatial-render="none"
    data-spatial-z="0"
    data-spatial-depth="0"
    data-spatial-parallax-factor="0"
    data-spatial-curve-half-angle="0"
    tabindex="0"
    aria-label="Spatial 桌面"
    @pointerdown="focusDesktop"
    @contextmenu.prevent="openPointerMenu(null, $event)"
    @keydown="openKeyboardMenu(null, $event)"
  />

  <SpatialShellContextMenu
    v-if="menu"
    :source-id="SPATIAL_DESKTOP_MENU_SOURCE_ID"
    menu-label="桌面菜单"
    :items="menuItems"
    :layout="menu.layout"
    @select="selectMenuItem"
    @close="closeMenu"
    @source-dirty="(sourceId) => emit('sourceDirty', sourceId)"
  />
</template>

<script setup lang="ts">
import type { SpatialShellMenuItem, SpatialShellMenuViewport } from "./spatial-shell-context-menu"
import {
  SPATIAL_DESKTOP_INPUT_SOURCE_ID,
  SPATIAL_DESKTOP_MENU_SOURCE_ID,
} from "./spatial-shell-context-menu"
import SpatialShellContextMenu from "./SpatialShellContextMenu.vue"
import { useSpatialShellContextMenu } from "./use-spatial-shell-context-menu"

const props = defineProps<{
  viewport: SpatialShellMenuViewport
}>()

const emit = defineEmits<{
  minimizeAll: []
  sourceTopologyChanged: []
  sourceDirty: [sourceId: string]
}>()

const menuItems: readonly SpatialShellMenuItem[] = Object.freeze([
  { id: "desktop", label: "显示桌面" },
])

const { sourceRef, menu, openPointerMenu, openKeyboardMenu, closeMenu } =
  useSpatialShellContextMenu<null>({
    ownerSourceId: SPATIAL_DESKTOP_INPUT_SOURCE_ID,
    menuSourceId: SPATIAL_DESKTOP_MENU_SOURCE_ID,
    viewport: () => props.viewport,
    itemCount: () => 1,
    sourceTopologyChanged: () => emit("sourceTopologyChanged"),
    sourceDirty: (sourceId) => emit("sourceDirty", sourceId),
  })

function focusDesktop(event: PointerEvent): void {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
}

function selectMenuItem(id: string): void {
  if (id === "desktop") emit("minimizeAll")
  closeMenu(false)
}
</script>
