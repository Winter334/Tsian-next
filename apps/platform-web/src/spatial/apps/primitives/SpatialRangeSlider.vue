<template>
  <div class="spatial-range-slider">
    <span class="spatial-range-slider__header">
      <span class="spatial-range-slider__label">
        <label :for="inputId">{{ label }}</label>
        <SpatialParamTip v-if="tip" :label="label" :tip="tip" />
      </span>
      <output :for="inputId" :class="{ 'spatial-range-slider__value--unset': nullable && modelValue === null }">{{ readout }}</output>
    </span>
    <span class="spatial-range-slider__control">
      <input
        :id="inputId"
        type="range"
        :min="0"
        :max="internalMax"
        step="1"
        :value="internalValue"
        :style="{ '--spatial-range-fill': `${fillPercent}%` }"
        :aria-label="label"
        :aria-valuetext="readout"
        @input="onInput"
      >
      <span v-if="nullable" class="spatial-range-slider__unset-mark" aria-hidden="true" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue"
import SpatialParamTip from "./SpatialParamTip.vue"

const props = withDefaults(defineProps<{
  modelValue: number | null
  min: number
  max: number
  step?: number
  nullable?: boolean
  label: string
  unit?: string
  tip?: string
}>(), {
  step: 0.1,
  nullable: false,
  unit: "",
  tip: "",
})

const emit = defineEmits<{ "update:modelValue": [value: number | null] }>()
const inputId = useId()
const steps = computed(() => Math.round((props.max - props.min) / props.step))
const internalMax = computed(() => steps.value + (props.nullable ? 1 : 0))
const internalValue = computed(() => {
  if (props.nullable && props.modelValue === null) return 0
  const offset = Math.round(((props.modelValue ?? props.min) - props.min) / props.step)
  return props.nullable ? offset + 1 : offset
})
const fillPercent = computed(() => internalMax.value > 0 ? Math.min(100, Math.max(0, internalValue.value / internalMax.value * 100)) : 0)
const readout = computed(() => props.nullable && props.modelValue === null ? "不发送" : `${props.modelValue ?? props.min}${props.unit}`)

function onInput(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (props.nullable && raw === 0) {
    emit("update:modelValue", null)
    return
  }
  const offset = props.nullable ? raw - 1 : raw
  const value = Math.min(props.max, Math.max(props.min, props.min + offset * props.step))
  emit("update:modelValue", Number(value.toFixed(4)))
}
</script>

<style scoped>
.spatial-range-slider { display: grid; gap: 7px; min-width: 0; }
.spatial-range-slider__header { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-range-slider__label { display: inline-flex; align-items: center; gap: 3px; }
.spatial-range-slider output { color: var(--spatial-window-tab); }.spatial-range-slider__value--unset { color: var(--spatial-app-muted); }
.spatial-range-slider__control { position: relative; display: grid; align-items: center; min-height: 22px; }
.spatial-range-slider input { --spatial-range-fill: 0%; width: 100%; height: 8px; margin: 0; appearance: none; border: 1px solid var(--spatial-app-border-strong); border-radius: 999px; background: linear-gradient(to right, var(--spatial-window-accent) 0 var(--spatial-range-fill), var(--spatial-app-surface-strong) var(--spatial-range-fill) 100%); box-shadow: inset 0 1px 2px rgb(28 31 35 / 20%); cursor: pointer; }
.spatial-range-slider input::-webkit-slider-runnable-track { height: 8px; border: 0; background: transparent; }
.spatial-range-slider input::-webkit-slider-thumb { width: 16px; height: 16px; margin-top: -5px; appearance: none; border: 2px solid var(--spatial-window-body); border-radius: 50%; background: var(--spatial-window-tab); box-shadow: 0 0 0 1px var(--spatial-app-border-strong), 0 2px 5px rgb(28 31 35 / 28%); }
.spatial-range-slider input::-moz-range-track { height: 8px; border: 0; background: transparent; }
.spatial-range-slider input::-moz-range-thumb { width: 13px; height: 13px; border: 2px solid var(--spatial-window-body); border-radius: 50%; background: var(--spatial-window-tab); box-shadow: 0 0 0 1px var(--spatial-app-border-strong); }
.spatial-range-slider input:focus-visible { outline: 0; border-color: var(--spatial-window-accent); box-shadow: inset 0 1px 2px rgb(28 31 35 / 20%); }
.spatial-range-slider input:focus-visible::-webkit-slider-thumb { background: var(--spatial-window-accent); }
.spatial-range-slider input:focus-visible::-moz-range-thumb { background: var(--spatial-window-accent); }
.spatial-range-slider__unset-mark { position: absolute; left: 3px; width: 3px; height: 3px; border-radius: 50%; background: var(--spatial-window-body); pointer-events: none; }
</style>
