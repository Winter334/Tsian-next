<script setup lang="ts">
import { computed } from "vue"
import { cn } from "@/lib/utils"

/**
 * Retro-styled range slider. When `nullable` is set, the leftmost position
 * (internal value 0) maps to `null` ("不发送" / do not send this parameter);
 * positions 1..steps map linearly to min..max. When not nullable, the slider
 * maps directly to min..max.
 */
const props = withDefaults(
  defineProps<{
    /** Current value; `null` means "do not send" (only valid when nullable). */
    modelValue: number | null
    min: number
    max: number
    step?: number
    /** Allow a leftmost "do not send" (null) position. */
    nullable?: boolean
    /** Label shown to the left of the value readout. */
    label?: string
    /** Optional unit suffix in the readout (e.g. ""). */
    unit?: string
    class?: string
  }>(),
  { step: 0.1, nullable: false, unit: "" },
)

const emit = defineEmits<{
  (e: "update:modelValue", value: number | null): void
}>()

// Internal slider index: 0 = null (when nullable), then 1..N = min..max.
const steps = computed(() => Math.round((props.max - props.min) / props.step))
const internalMax = computed(() => (props.nullable ? steps.value + 1 : steps.value))

const internalValue = computed(() => {
  if (props.nullable && props.modelValue === null) {
    return 0
  }
  const v = props.modelValue ?? props.min
  const offset = Math.round((v - props.min) / props.step)
  return props.nullable ? offset + 1 : offset
})

const readout = computed(() => {
  if (props.nullable && props.modelValue === null) {
    return "不发送"
  }
  const v = props.modelValue ?? props.min
  return `${v}${props.unit}`
})

function onInput(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (props.nullable && raw === 0) {
    emit("update:modelValue", null)
    return
  }
  const offset = props.nullable ? raw - 1 : raw
  // Snap back to min/max to avoid float drift.
  const value = Math.min(props.max, Math.max(props.min, props.min + offset * props.step))
  emit("update:modelValue", Number(value.toFixed(4)))
}
</script>

<template>
  <div :class="cn('grid gap-1', props.class)">
    <div v-if="label" class="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-text-dim/80">
      <span>{{ label }}</span>
      <span :class="nullable && modelValue === null ? 'text-text-dim/60' : 'text-neon'">{{ readout }}</span>
    </div>
    <input
      type="range"
      class="retro-range retro-focus h-2 w-full cursor-pointer appearance-none"
      :min="0"
      :max="internalMax"
      :step="1"
      :value="internalValue"
      :aria-label="label"
      @input="onInput"
    >
  </div>
</template>
