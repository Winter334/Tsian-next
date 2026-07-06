<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useSlots } from "vue"
import { Info, TriangleAlert, type LucideIcon } from "lucide-vue-next"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Inline tip button. Interaction model is a click/hover hybrid (mirrors the
 * pattern used by help tags in other apps): click the icon to open, move the
 * pointer away to dismiss — no second click needed, so neighbouring controls
 * can't be hit by an errant close click. The icon has no surrounding box; only
 * the glyph is visible, dimmed until hover/focus.
 */
const props = withDefaults(defineProps<{
  /** Description shown in the popover. Optional when slot content is provided. */
  tip?: string
  /** Label used for the aria-label (`${label} 说明`). */
  label?: string
  /** Optional text rendered next to the icon inside the trigger button. */
  triggerText?: string
  /** Visual tone for non-info tips such as registry warnings. */
  tone?: "info" | "warning" | "danger"
}>(), {
  tone: "info",
})

const slots = useSlots()
const open = ref(false)
let closeTimer: number | undefined

const iconComponent = computed<LucideIcon>(() =>
  props.tone === "info" ? Info : TriangleAlert,
)
const triggerClass = computed(() => {
  if (props.tone === "warning") {
    return "text-warning/80 hover:text-warning focus-visible:text-warning"
  }
  if (props.tone === "danger") {
    return "text-danger/80 hover:text-danger focus-visible:text-danger"
  }
  return "text-text-dim/70 hover:text-neon focus-visible:text-neon"
})
const contentClass = computed(() => {
  if (props.tone === "warning") {
    return "border-warning/60 text-text-main"
  }
  if (props.tone === "danger") {
    return "border-danger/60 text-text-main"
  }
  return "border-neon-deep/55 text-text-main"
})
const ariaLabel = computed(() => {
  if (props.label) {
    return props.tone === "info" ? `${props.label} 说明` : `${props.label} 诊断`
  }
  return props.tone === "info" ? "参数说明" : "诊断信息"
})
const hasSlotContent = computed(() => Boolean(slots.default))

function cancelClose(): void {
  if (closeTimer !== undefined) {
    clearTimeout(closeTimer)
    closeTimer = undefined
  }
}

function scheduleClose(): void {
  cancelClose()
  // Brief grace period so moving from the icon onto the popover body does not
  // dismiss it mid-transit (the body is portalled a few px away).
  closeTimer = window.setTimeout(() => {
    open.value = false
  }, 120)
}

onBeforeUnmount(cancelClose)
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="retro-focus inline-flex items-center gap-1 transition-colors"
        :class="triggerClass"
        :aria-label="ariaLabel"
        @pointerenter="cancelClose"
        @pointerleave="scheduleClose"
      >
        <component :is="iconComponent" class="h-3.5 w-3.5" aria-hidden="true" />
        <span v-if="props.triggerText" class="font-mono text-[11px] leading-none">{{ props.triggerText }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      class="z-[70] w-72 max-w-xs bg-[#2d2a23] p-3 text-[11px] leading-5 shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_1px_1px_0_rgba(0,0,0,0.45)]"
      :class="contentClass"
      @pointerenter="cancelClose"
      @pointerleave="scheduleClose"
    >
      <slot v-if="hasSlotContent" />
      <p v-else>{{ props.tip }}</p>
    </PopoverContent>
  </Popover>
</template>
