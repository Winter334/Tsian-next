<template>
  <section
    class="desktop-window"
    :class="{
      'desktop-window--active': active,
      'desktop-window--inactive': !active,
      'desktop-window--fullscreen': window.fullscreen,
    }"
    :style="windowStyle"
    :aria-label="window.title"
    @pointerdown="$emit('focus', window.id)"
    @contextmenu.stop
  >
    <header class="desktop-window-titlebar">
      <div
        class="desktop-window-drag-region"
        @pointerdown="startDrag"
      >
        <span class="desktop-window-icon">
          <component :is="window.icon" class="h-4 w-4" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <h1 class="truncate font-mono text-sm font-bold">
            {{ window.title }}
          </h1>
          <p class="truncate font-mono text-[10px] uppercase">
            {{ window.caption }}
          </p>
        </div>
      </div>

      <div class="desktop-window-controls">
        <button
          type="button"
          class="retro-focus"
          aria-label="最小化窗口"
          @pointerdown.stop
          @click.stop="$emit('minimize', window.id)"
        >
          <Minus class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          v-if="window.fullscreenable"
          type="button"
          class="retro-focus"
          :aria-label="window.fullscreen ? '还原窗口' : '全屏窗口'"
          @pointerdown.stop
          @click.stop="$emit('fullscreen', window.id, !window.fullscreen)"
        >
          <Minimize2 v-if="window.fullscreen" class="h-3.5 w-3.5" aria-hidden="true" />
          <Maximize2 v-else class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="retro-focus"
          aria-label="关闭窗口"
          @pointerdown.stop
          @click.stop="$emit('close', window.id)"
        >
          <X class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="desktop-window-content">
      <component :is="window.component" v-bind="window.props" />
    </div>

    <template v-if="!isInteractionLocked">
      <span
        v-for="handle in resizeHandles"
        :key="handle"
        class="desktop-resize-handle"
        :class="`desktop-resize-handle--${handle}`"
        aria-hidden="true"
        @pointerdown.stop="startResize($event, handle)"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue"
import { Maximize2, Minimize2, Minus, X } from "lucide-vue-next"
import type {
  DesktopWindowGeometry,
  DesktopWindowState,
} from "@/composables/useDesktopWindows"

type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw"

const props = defineProps<{
  window: DesktopWindowState
  active: boolean
  narrow: boolean
}>()

const emit = defineEmits<{
  focus: [id: string]
  minimize: [id: string]
  close: [id: string]
  fullscreen: [id: string, fullscreen: boolean]
  move: [id: string, geometry: Pick<DesktopWindowGeometry, "x" | "y">]
  resize: [id: string, geometry: DesktopWindowGeometry]
}>()

const resizeHandles: ResizeHandle[] = ["n", "e", "s", "w", "ne", "nw", "se", "sw"]
const isInteractionLocked = computed(() => props.narrow || props.window.fullscreen)

const windowStyle = computed(() => {
  if (props.narrow || props.window.fullscreen) {
    return {
      zIndex: props.window.zIndex,
    }
  }

  return {
    left: `${props.window.x}px`,
    top: `${props.window.y}px`,
    width: `${props.window.width}px`,
    height: `${props.window.height}px`,
    zIndex: props.window.zIndex,
  }
})

let cleanupPointerListeners: (() => void) | null = null

function startDrag(event: PointerEvent) {
  if (event.button !== 0 || isInteractionLocked.value) {
    return
  }

  emit("focus", props.window.id)
  event.preventDefault()
  const origin = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    x: props.window.x,
    y: props.window.y,
  }

  bindPointerMove(
    (moveEvent) => {
      emit("move", props.window.id, {
        x: origin.x + moveEvent.clientX - origin.pointerX,
        y: origin.y + moveEvent.clientY - origin.pointerY,
      })
    },
  )
}

function startResize(event: PointerEvent, handle: ResizeHandle) {
  if (event.button !== 0 || isInteractionLocked.value) {
    return
  }

  emit("focus", props.window.id)
  event.preventDefault()
  const origin = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    x: props.window.x,
    y: props.window.y,
    width: props.window.width,
    height: props.window.height,
  }

  bindPointerMove((moveEvent) => {
    const deltaX = moveEvent.clientX - origin.pointerX
    const deltaY = moveEvent.clientY - origin.pointerY
    const next = { ...origin }

    if (handle.includes("e")) {
      next.width = origin.width + deltaX
    }
    if (handle.includes("s")) {
      next.height = origin.height + deltaY
    }
    if (handle.includes("w")) {
      next.x = origin.x + deltaX
      next.width = origin.width - deltaX
    }
    if (handle.includes("n")) {
      next.y = origin.y + deltaY
      next.height = origin.height - deltaY
    }

    emit("resize", props.window.id, {
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
    })
  })
}

function bindPointerMove(onMove: (event: PointerEvent) => void) {
  cleanupPointerListeners?.()

  const onPointerMove = (event: PointerEvent) => {
    onMove(event)
  }
  const onPointerUp = () => {
    cleanupPointerListeners?.()
    cleanupPointerListeners = null
  }

  window.addEventListener("pointermove", onPointerMove)
  window.addEventListener("pointerup", onPointerUp, { once: true })
  window.addEventListener("pointercancel", onPointerUp, { once: true })
  cleanupPointerListeners = () => {
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
    window.removeEventListener("pointercancel", onPointerUp)
  }
}

onBeforeUnmount(() => {
  cleanupPointerListeners?.()
})
</script>
