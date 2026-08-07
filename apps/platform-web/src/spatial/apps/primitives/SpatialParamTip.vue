<template>
  <span
    ref="tipRoot"
    class="spatial-param-tip"
    :class="{ 'spatial-param-tip--open': open }"
    @pointerenter="openTip"
    @pointerleave="scheduleClose"
  >
    <button
      type="button"
      class="spatial-param-tip__trigger"
      :aria-label="`${label}说明`"
      :aria-expanded="open"
      :aria-describedby="open ? tooltipId : undefined"
      @click="openTip"
      @focus="openTip"
      @blur="scheduleClose"
      @keydown.esc.prevent="closeTip"
    >
      <Info aria-hidden="true" />
    </button>
    <span
      v-if="open"
      :id="tooltipId"
      class="spatial-param-tip__content"
      role="tooltip"
      :style="{
        width: `${tipLayout.width}px`,
        transform: `translateX(calc(-50% + ${tipLayout.offsetX}px))`,
        whiteSpace: 'normal',
      }"
      @pointerenter="cancelClose"
      @pointerleave="scheduleClose"
    >{{ tip }}</span>
  </span>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from "vue"
import { Info } from "lucide-vue-next"
import { spatialParamTipHorizontalLayout } from "./spatial-param-tip"

defineProps<{ label: string; tip: string }>()

const open = ref(false)
const tipRoot = ref<HTMLElement | null>(null)
const tipLayout = ref({ width: 260, offsetX: 0 })
const tooltipId = useId()
let closeTimer: ReturnType<typeof setTimeout> | null = null
let boundaryElement: HTMLElement | null = null
let resizeObserver: ResizeObserver | null = null

function cancelClose(): void {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}

function openTip(): void {
  cancelClose()
  updateTipLayout()
  open.value = true
  void nextTick(() => {
    if (open.value) startLayoutTracking()
  })
}

function closeTip(): void {
  cancelClose()
  open.value = false
  stopLayoutTracking()
}

function scheduleClose(): void {
  cancelClose()
  closeTimer = setTimeout(closeTip, 140)
}

function resolveBoundary(): HTMLElement | null {
  return tipRoot.value?.closest<HTMLElement>(
    "[data-spatial-popover-boundary], .spatial-app__scroll, [data-spatial-source]",
  ) ?? null
}

function updateTipLayout(): void {
  const root = tipRoot.value
  const boundary = resolveBoundary()
  if (!root || !boundary) {
    tipLayout.value = { width: 260, offsetX: 0 }
    return
  }

  const rootRect = root.getBoundingClientRect()
  const boundaryRect = boundary.getBoundingClientRect()
  const boundaryLeft = boundaryRect.left + boundary.clientLeft
  const boundaryWidth = boundary.clientWidth || boundaryRect.width
  tipLayout.value = spatialParamTipHorizontalLayout(
    { left: rootRect.left, width: rootRect.width },
    { left: boundaryLeft, right: boundaryLeft + boundaryWidth },
  )
}

function stopLayoutTracking(): void {
  boundaryElement?.removeEventListener("scroll", updateTipLayout)
  boundaryElement = null
  window.removeEventListener("resize", updateTipLayout)
  resizeObserver?.disconnect()
  resizeObserver = null
}

function startLayoutTracking(): void {
  stopLayoutTracking()
  boundaryElement = resolveBoundary()
  boundaryElement?.addEventListener("scroll", updateTipLayout, { passive: true })
  window.addEventListener("resize", updateTipLayout, { passive: true })
  if (typeof ResizeObserver !== "undefined" && boundaryElement && tipRoot.value) {
    resizeObserver = new ResizeObserver(updateTipLayout)
    resizeObserver.observe(boundaryElement)
    resizeObserver.observe(tipRoot.value)
  }
  updateTipLayout()
}

onBeforeUnmount(() => {
  cancelClose()
  stopLayoutTracking()
})
</script>

<style scoped>
.spatial-param-tip { position: relative; display: inline-flex; flex: 0 0 auto; }
.spatial-param-tip--open { z-index: 30; }
.spatial-param-tip__trigger { display: grid; width: 18px; height: 18px; place-items: center; border: 1px solid transparent; padding: 0; color: var(--spatial-app-muted); background: transparent; }
.spatial-param-tip__trigger:hover,.spatial-param-tip__trigger:focus-visible,.spatial-param-tip__trigger[aria-expanded="true"] { border-color: var(--spatial-app-border-strong); color: var(--spatial-window-tab); background: var(--spatial-app-accent-soft); }
.spatial-param-tip__trigger svg { width: 12px; height: 12px; }
.spatial-param-tip__content { position: absolute; z-index: 20; top: calc(100% + 5px); left: 50%; box-sizing: border-box; border: 1px solid var(--spatial-app-border-strong); padding: 8px 9px; overflow-wrap: anywhere; color: var(--spatial-window-ink); background: color-mix(in srgb, var(--spatial-window-body) 96%, white); box-shadow: 0 8px 20px rgb(28 31 35 / 20%); font: 10px/1.55 "Inter", sans-serif; text-transform: none; letter-spacing: normal; }
</style>
