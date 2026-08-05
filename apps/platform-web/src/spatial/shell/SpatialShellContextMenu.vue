<template>
  <div
    ref="menuRef"
    class="spatial-shell-context-menu"
    :data-spatial-source="sourceId"
    :data-spatial-z="SPATIAL_SHELL_MENU_Z_INDEX"
    data-spatial-depth="24"
    data-spatial-scale="0.995"
    data-spatial-curve-half-angle="0.025"
    role="menu"
    :aria-label="menuLabel"
    :style="menuStyle"
    @click.stop
    @focusin="emit('sourceDirty', sourceId)"
    @keydown="handleKeydown"
  >
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      role="menuitem"
      :class="{ 'spatial-shell-context-menu__danger': item.danger }"
      @click="emit('select', item.id)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue"
import {
  SPATIAL_SHELL_MENU_Z_INDEX,
  type SpatialShellMenuItem,
  type SpatialShellMenuLayout,
} from "./spatial-shell-context-menu"

const props = defineProps<{
  sourceId: string
  menuLabel: string
  items: readonly SpatialShellMenuItem[]
  layout: SpatialShellMenuLayout
}>()

const emit = defineEmits<{
  select: [id: string]
  close: [restoreFocus: boolean]
  sourceDirty: [sourceId: string]
}>()

const menuRef = ref<HTMLElement | null>(null)
const menuStyle = computed(() => ({
  width: `${props.layout.width}px`,
  height: `${props.layout.height}px`,
  transform: `translate3d(${props.layout.x}px, ${props.layout.y}px, 0)`,
}))

function menuItems(): HTMLButtonElement[] {
  return [...(menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    emit("close", true)
    return
  }
  if (event.key === "Tab") {
    emit("close", false)
    return
  }

  const items = menuItems()
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  let next = -1
  if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length
  else if (event.key === "ArrowUp") next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = items.length - 1
  if (next < 0) return
  event.preventDefault()
  items[next].focus()
  emit("sourceDirty", props.sourceId)
}

onMounted(() => {
  void nextTick(() => {
    menuItems()[0]?.focus()
    emit("sourceDirty", props.sourceId)
  })
})
</script>
