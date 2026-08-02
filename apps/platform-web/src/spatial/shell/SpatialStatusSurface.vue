<template>
  <aside
    class="spatial-status-surface"
    data-spatial-source="shell:status"
    data-spatial-z="11"
    data-spatial-depth="28"
    data-spatial-yaw="0.055"
    data-spatial-scale="0.985"
    data-spatial-curve-half-angle="0.035"
    aria-label="Spatial 窗口任务与桌面工具"
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
        @click="emit('focus', window.id)"
      >
        <component :is="window.descriptor.icon" aria-hidden="true" />
      </button>
    </div>
    <div class="spatial-status-surface__utility" aria-label="桌面工具">
      <div class="spatial-status-surface__actions">
        <button
          type="button"
          class="spatial-dock-button"
          aria-label="全部最小化"
          title="全部最小化"
          @click="emit('minimizeAll')"
        >
          <Minimize2 aria-hidden="true" />
        </button>
        <button
          type="button"
          class="spatial-dock-button spatial-status-surface__exit"
          aria-label="返回 RetroOS"
          title="返回 RetroOS"
          @click="emit('returnRetro')"
        >
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Minimize2, RotateCcw } from "lucide-vue-next"
import type { SpatialWindowState } from "./window-session"

defineProps<{
  windows: readonly SpatialWindowState[]
  activeWindowId: string
}>()

const emit = defineEmits<{
  (event: "focus", id: string): void
  (event: "minimizeAll"): void
  (event: "returnRetro"): void
}>()
</script>
