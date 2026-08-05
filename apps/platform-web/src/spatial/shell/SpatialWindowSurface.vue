<template>
  <article
    class="spatial-window-surface"
    :class="{
      'spatial-window-surface--hidden': window.minimized || window.textureState !== 'active',
      'spatial-window-surface--maximized': window.maximized,
    }"
    :data-spatial-source="`window:${window.id}`"
    :data-spatial-z="window.zIndex"
    :data-spatial-window-active="active ? 'true' : undefined"
    :data-spatial-window-maximized="window.maximized ? 'true' : undefined"
    :data-spatial-window-id="window.id"
    data-spatial-gesture-owner
    :aria-label="window.descriptor.title"
    @pointerdown="beginSurfacePointerDown"
    @pointermove="continueInteraction"
    @pointerup="endInteraction"
    @pointercancel="endInteraction"
  >
    <header
      class="spatial-window-title-tab"
      data-spatial-gesture-start
      @pointerdown.stop="beginDrag"
    >
      <component :is="window.descriptor.icon" aria-hidden="true" />
      <div class="spatial-window-title-tab__identity">
        <small>{{ window.descriptor.appId }}</small>
        <strong>{{ window.descriptor.title }}</strong>
      </div>
    </header>
    <div
      class="spatial-window-control-tab"
      role="group"
      aria-label="窗口控制"
      @pointerdown.stop="beginDrag"
    >
      <button
        type="button"
        aria-label="最小化"
        data-spatial-minimize-control
        @pointerdown.stop
        @click.stop="emit('minimize', window.id)"
      >
        <Minus aria-hidden="true" />
      </button>
      <button
        v-if="window.descriptor.spatial.fullscreenable"
        type="button"
        :aria-label="window.maximized ? '还原窗口' : '最大化窗口'"
        data-spatial-maximize-control
        @pointerdown.stop
        @click.stop="emit('maximize', window.id, !window.maximized)"
      >
        <Minimize2 v-if="window.maximized" aria-hidden="true" />
        <Maximize2 v-else aria-hidden="true" />
      </button>
      <button type="button" aria-label="关闭" @pointerdown.stop @click.stop="emit('close', window.id)">
        <X aria-hidden="true" />
      </button>
    </div>
    <div
      class="spatial-window-top-drag-strip"
      data-spatial-gesture-start
      aria-hidden="true"
      @pointerdown.stop="beginDrag"
    />

    <div class="spatial-window-content">
      <component
        :is="window.descriptor.spatial.component"
        v-if="window.descriptor.spatial.readiness === 'ready' && window.descriptor.spatial.component"
        v-bind="presentationProps(window)"
      />
      <SpatialPendingAppSurface
        v-else
        :title="window.descriptor.title"
        :caption="window.descriptor.caption"
        :icon="window.descriptor.icon"
      />
    </div>

    <template v-if="!window.maximized">
      <span
        v-for="direction in resizeDirections"
        :key="direction"
        class="spatial-resize-handle"
        :class="`spatial-resize-handle--${direction}`"
        role="separator"
        tabindex="0"
        data-spatial-gesture-start
        :aria-label="`向 ${direction} 调整窗口大小`"
        @pointerdown.stop="beginResize(direction, $event)"
        @keydown="resizeWithKeyboard(direction, $event)"
      />
    </template>
  </article>
</template>

<script setup lang="ts">
import { Maximize2, Minimize2, Minus, X } from "lucide-vue-next"
import type { SpatialResizeDirection } from "./window-layout"
import type { SpatialWindowState } from "./window-session"
import SpatialPendingAppSurface from "./SpatialPendingAppSurface.vue"

const props = defineProps<{
  window: SpatialWindowState
  active: boolean
}>()

const emit = defineEmits<{
  (event: "focus", id: string): void
  (event: "minimize", id: string): void
  (event: "maximize", id: string, maximized: boolean): void
  (event: "close", id: string): void
  (event: "move", id: string, delta: { x: number; y: number }): void
  (event: "resize", id: string, direction: SpatialResizeDirection, delta: { x: number; y: number }): void
  (event: "settle", id: string): void
}>()

const resizeDirections: readonly SpatialResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"]
let interaction: {
  kind: "move" | "resize"
  pointerId: number
  direction?: SpatialResizeDirection
  localX: number
  localY: number
  screenX: number
  screenY: number
} | null = null

function presentationProps(window: SpatialWindowState): Record<string, unknown> {
  if (window.descriptor.appId !== "play") return window.descriptor.props
  return { ...window.descriptor.props, minimized: window.minimized }
}

function beginSurfacePointerDown(event: PointerEvent): void {
  if (!isRoutedGestureEvent(event) || event.button !== 0) return
  emit("focus", props.window.id)
}

function beginDrag(event: PointerEvent): void {
  if (props.window.maximized || !isRoutedGestureEvent(event) || event.button !== 0) return
  if ((event.target as Element).closest("button")) return
  emit("focus", props.window.id)
  const screen = routedScreenPoint(event)
  interaction = {
    kind: "move",
    pointerId: event.pointerId,
    localX: event.clientX,
    localY: event.clientY,
    screenX: screen.x,
    screenY: screen.y,
  }
}

function continueInteraction(event: PointerEvent): void {
  if (!isRoutedGestureEvent(event) || interaction?.pointerId !== event.pointerId) return
  if (props.window.maximized) {
    interaction = null
    return
  }
  if (interaction.kind === "move") {
    emitScreenDelta(event, (delta) => emit("move", props.window.id, delta))
    return
  }
  if (interaction.direction) {
    const direction = interaction.direction
    emitLocalDelta(event, (delta) => emit("resize", props.window.id, direction, delta))
  }
}

function beginResize(direction: SpatialResizeDirection, event: PointerEvent): void {
  if (props.window.maximized || !isRoutedGestureEvent(event) || event.button !== 0) return
  emit("focus", props.window.id)
  const screen = routedScreenPoint(event)
  interaction = {
    kind: "resize",
    pointerId: event.pointerId,
    direction,
    localX: event.clientX,
    localY: event.clientY,
    screenX: screen.x,
    screenY: screen.y,
  }
}

function emitLocalDelta(event: PointerEvent, dispatch: (delta: { x: number; y: number }) => void): void {
  if (!interaction) return
  const delta = {
    x: event.clientX - interaction.localX,
    y: event.clientY - interaction.localY,
  }
  interaction.localX = event.clientX
  interaction.localY = event.clientY
  dispatch(delta)
}

function emitScreenDelta(event: PointerEvent, dispatch: (delta: { x: number; y: number }) => void): void {
  if (!interaction) return
  const screen = routedScreenPoint(event)
  const delta = {
    x: screen.x - interaction.screenX,
    y: screen.y - interaction.screenY,
  }
  interaction.screenX = screen.x
  interaction.screenY = screen.y
  dispatch(delta)
}

function routedScreenPoint(event: PointerEvent): { x: number; y: number } {
  const routed = event as PointerEvent & {
    readonly spatialScreenClientX?: number
    readonly spatialScreenClientY?: number
  }
  return {
    x: routed.spatialScreenClientX ?? event.clientX,
    y: routed.spatialScreenClientY ?? event.clientY,
  }
}

function endInteraction(event: PointerEvent): void {
  if (!isRoutedGestureEvent(event) || interaction?.pointerId !== event.pointerId) return
  interaction = null
  emit("settle", props.window.id)
}

function isRoutedGestureEvent(event: PointerEvent): boolean {
  // Trusted input belongs to the full-screen input plane. Source gestures use
  // only router-generated events so visual and projected deltas cannot mix.
  return !event.isTrusted
}

function resizeWithKeyboard(direction: SpatialResizeDirection, event: KeyboardEvent): void {
  if (props.window.maximized) return
  const amount = event.shiftKey ? 32 : 12
  const delta = {
    x: event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0,
    y: event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0,
  }
  if (!delta.x && !delta.y) return
  event.preventDefault()
  emit("resize", props.window.id, direction, delta)
}
</script>
