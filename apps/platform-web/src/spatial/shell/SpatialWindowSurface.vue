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
        v-bind="presentationProps(window)"
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
import {
  beginRoutedSpatialDrag,
  isRoutedSpatialGestureEvent,
  moveRoutedSpatialDrag,
  routedSpatialDragMatches,
  type SpatialRoutedDragState,
} from "./spatial-routed-drag"
import type { SpatialResizeDirection } from "./window-layout"
import type { SpatialWindowState } from "./window-session"

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
let interaction:
  | { kind: "move"; drag: SpatialRoutedDragState }
  | {
      kind: "resize"
      pointerId: number
      direction: SpatialResizeDirection
      localX: number
      localY: number
    }
  | null = null

function presentationProps(window: SpatialWindowState): Record<string, unknown> {
  if (window.descriptor.appId !== "play") return window.descriptor.props
  return { ...window.descriptor.props, minimized: window.minimized }
}

function beginSurfacePointerDown(event: PointerEvent): void {
  if (!isRoutedSpatialGestureEvent(event) || event.button !== 0) return
  emit("focus", props.window.id)
}

function beginDrag(event: PointerEvent): void {
  if (props.window.maximized) return
  if ((event.target as Element).closest("button")) return
  const drag = beginRoutedSpatialDrag(event)
  if (!drag) return
  emit("focus", props.window.id)
  interaction = {
    kind: "move",
    drag,
  }
}

function continueInteraction(event: PointerEvent): void {
  if (!isRoutedSpatialGestureEvent(event) || !interaction) return
  if (props.window.maximized) {
    interaction = null
    return
  }
  if (interaction.kind === "move") {
    const delta = moveRoutedSpatialDrag(interaction.drag, event)
    if (delta) emit("move", props.window.id, delta)
    return
  }
  if (interaction.pointerId !== event.pointerId) return
  const direction = interaction.direction
  emitLocalDelta(event, (delta) => emit("resize", props.window.id, direction, delta))
}

function beginResize(direction: SpatialResizeDirection, event: PointerEvent): void {
  if (props.window.maximized || !isRoutedSpatialGestureEvent(event) || event.button !== 0) return
  emit("focus", props.window.id)
  interaction = {
    kind: "resize",
    pointerId: event.pointerId,
    direction,
    localX: event.clientX,
    localY: event.clientY,
  }
}

function emitLocalDelta(event: PointerEvent, dispatch: (delta: { x: number; y: number }) => void): void {
  if (!interaction || interaction.kind !== "resize") return
  const delta = {
    x: event.clientX - interaction.localX,
    y: event.clientY - interaction.localY,
  }
  interaction.localX = event.clientX
  interaction.localY = event.clientY
  dispatch(delta)
}

function endInteraction(event: PointerEvent): void {
  if (!interaction) return
  const matches = interaction.kind === "move"
    ? routedSpatialDragMatches(interaction.drag, event)
    : isRoutedSpatialGestureEvent(event) && interaction.pointerId === event.pointerId
  if (!matches) return
  interaction = null
  emit("settle", props.window.id)
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
