<template>
  <section
    v-if="sourceMounted"
    class="spatial-toast-source"
    :data-spatial-source="SPATIAL_TOAST_SOURCE_ID"
    data-spatial-layer="overlay"
    :data-spatial-z="SPATIAL_TOAST_Z_INDEX"
    data-spatial-parallax-factor="0"
    data-spatial-depth="0"
    data-spatial-yaw="0"
    data-spatial-pitch="0"
    data-spatial-scale="1"
    data-spatial-curve-half-angle="0.16"
    data-spatial-source-animation
    aria-live="polite"
    aria-atomic="false"
  >
    <TransitionGroup
      name="spatial-toast-item"
      tag="div"
      class="spatial-toast-source__stack"
      appear
      :css="!reducedMotion"
      @before-enter="prepareItemTransition"
      @before-leave="prepareItemTransition"
      @after-enter="finishEnter"
      @after-leave="finishLeave"
    >
      <article
        v-for="entry in toasts"
        :key="entry.id"
        class="spatial-toast-source__item"
        :class="`spatial-toast-source__item--${entry.type}`"
        :data-spatial-toast-id="entry.id"
        role="status"
      >
        <span class="spatial-toast-source__icon" aria-hidden="true">
          <component :is="iconFor(entry.type)" />
        </span>
        <p>{{ entry.message }}</p>
        <SpatialActionButton
          icon-only
          class="spatial-toast-source__dismiss"
          aria-label="关闭提示"
          title="关闭提示"
          @click="toast.dismiss(entry.id)"
        >
          <template #icon><X /></template>
        </SpatialActionButton>
      </article>
    </TransitionGroup>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { CheckCircle2, Info, TriangleAlert, X, type LucideIcon } from "lucide-vue-next"
import { toast, useToasts, type ToastType } from "@/composables/useToast"
import SpatialActionButton from "../apps/primitives/SpatialActionButton.vue"
import {
  SPATIAL_TOAST_SOURCE_ID,
  SPATIAL_TOAST_Z_INDEX,
} from "./spatial-global-surfaces"
import "../apps/spatial-apps.css"

const props = withDefaults(defineProps<{
  reducedMotion?: boolean | null
}>(), {
  reducedMotion: null,
})

const emit = defineEmits<{
  sourcesChanged: [sourceIds: readonly string[]]
  sourceDirty: [sourceId: string]
}>()

const toasts = useToasts()
const sourceMounted = ref(toasts.value.length > 0)
const mediaReducedMotion = ref(false)
const reducedMotion = computed(() => props.reducedMotion ?? mediaReducedMotion.value)
let motionMedia: MediaQueryList | null = null

watch(
  () => toasts.value.map((entry) => entry.id),
  (ids) => {
    if (ids.length > 0) sourceMounted.value = true
    void nextTick(() => {
      markDirty()
      if (toasts.value.length === 0 && reducedMotion.value) sourceMounted.value = false
    })
  },
  { immediate: true, flush: "sync" },
)

watch(
  sourceMounted,
  (mounted) => emit("sourcesChanged", mounted ? [SPATIAL_TOAST_SOURCE_ID] : []),
  { immediate: true, flush: "post" },
)

watch(reducedMotion, (reduced) => {
  if (reduced && toasts.value.length === 0) sourceMounted.value = false
})

function iconFor(type: ToastType): LucideIcon {
  if (type === "success") return CheckCircle2
  if (type === "error") return TriangleAlert
  return Info
}

function finishLeave(): void {
  if (toasts.value.length === 0) sourceMounted.value = false
  else markDirty()
}

function prepareItemTransition(element: Element): void {
  if (!(element instanceof HTMLElement)) return
  element.style.setProperty(
    "--spatial-toast-item-height",
    `${Math.max(1, Math.ceil(element.scrollHeight))}px`,
  )
}

function finishEnter(element: Element): void {
  if (element instanceof HTMLElement) {
    element.style.removeProperty("--spatial-toast-item-height")
  }
  markDirty()
}

function markDirty(): void {
  if (sourceMounted.value) emit("sourceDirty", SPATIAL_TOAST_SOURCE_ID)
}

function syncMotionPreference(event?: MediaQueryListEvent): void {
  mediaReducedMotion.value = event?.matches ?? motionMedia?.matches ?? false
}

onMounted(() => {
  motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)")
  syncMotionPreference()
  motionMedia.addEventListener("change", syncMotionPreference)
})

onBeforeUnmount(() => motionMedia?.removeEventListener("change", syncMotionPreference))
</script>
