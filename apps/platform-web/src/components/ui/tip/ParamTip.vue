<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"
import { Info } from "lucide-vue-next"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Inline ⓘ tip. Interaction model is a click/hover hybrid (mirrors the pattern
 * used by help tags in other apps): click the icon to open, move the pointer
 * away to dismiss — no second click needed, so neighbouring controls can't be
 * hit by an errant close click. The icon has no surrounding box; only the glyph
 * is visible, dimmed until hover/focus.
 */
defineProps<{
  /** Description shown in the popover. */
  tip: string
  /** Label used for the aria-label (`${label} 说明`). */
  label?: string
}>()

const open = ref(false)
let closeTimer: number | undefined

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
        class="retro-focus inline-flex items-center text-text-dim/70 transition-colors hover:text-neon focus-visible:text-neon"
        :aria-label="label ? `${label} 说明` : '参数说明'"
        @pointerenter="cancelClose"
        @pointerleave="scheduleClose"
      >
        <Info class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      class="z-[70] w-72 max-w-xs border border-neon-deep/55 bg-[#2d2a23] p-3 font-mono text-[11px] leading-5 text-text-main shadow-[0_8px_24px_rgba(0,0,0,0.45),inset_1px_1px_0_rgba(0,0,0,0.45)]"
      @pointerenter="cancelClose"
      @pointerleave="scheduleClose"
    >
      <p>{{ tip }}</p>
    </PopoverContent>
  </Popover>
</template>
