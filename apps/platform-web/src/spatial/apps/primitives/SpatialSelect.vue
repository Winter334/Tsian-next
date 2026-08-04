<template>
  <div
    ref="root"
    class="spatial-select"
    :class="{ 'spatial-select--open': open, 'spatial-select--disabled': disabled }"
    @focusout="handleFocusOut"
  >
    <button
      ref="trigger"
      :id="triggerId"
      class="spatial-select__trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="triggerLabel"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      :disabled="disabled"
      @click="toggle"
      @keydown="handleKeydown"
    >
      <span class="spatial-select__value">{{ selectedOption?.label || placeholder }}</span>
      <span class="spatial-select__chevron" aria-hidden="true"><ChevronDown /></span>
    </button>
    <div
      :id="listboxId"
      class="spatial-select__listbox"
      role="listbox"
      :aria-hidden="!open"
      :aria-label="ariaLabel"
      :aria-labelledby="ariaLabel ? undefined : triggerId"
    >
      <div
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.value"
        class="spatial-select__option"
        :class="{ 'spatial-select__option--active': activeIndex === index }"
        role="option"
        :aria-selected="option.value === modelValue"
        :aria-disabled="option.disabled || undefined"
        @pointerenter="activate(index)"
        @mousedown.prevent
        @click="select(index)"
      >
        <span>{{ option.label }}</span>
        <Check v-if="option.value === modelValue" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue"
import { Check, ChevronDown } from "lucide-vue-next"
import {
  shouldCloseSpatialSelectFromPointerDown,
  spatialSelectKeyResult,
  spatialSelectSelectedIndex,
  type SpatialSelectOption,
} from "./spatial-select"

const props = withDefaults(defineProps<{
  modelValue: string
  options: readonly SpatialSelectOption[]
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
}>(), {
  ariaLabel: "",
  placeholder: "请选择",
  disabled: false,
})

const emit = defineEmits<{
  "update:modelValue": [value: string]
  change: [value: string]
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)
const uid = useId()
const triggerId = `spatial-select-${uid}-trigger`
const listboxId = `spatial-select-${uid}-listbox`
const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue))
const triggerLabel = computed(() => props.ariaLabel
  ? `${props.ariaLabel}：${selectedOption.value?.label || props.placeholder}`
  : selectedOption.value?.label || props.placeholder)

function optionId(index: number): string {
  return `spatial-select-${uid}-option-${index}`
}

function toggle(): void {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  activeIndex.value = spatialSelectSelectedIndex(props.options, props.modelValue)
  open.value = activeIndex.value >= 0
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.disabled) return
  const wasOpen = open.value
  const result = spatialSelectKeyResult(props.options, props.modelValue, {
    open: open.value,
    activeIndex: activeIndex.value,
  }, event.key)
  open.value = result.open
  activeIndex.value = result.activeIndex
  if (result.handled) event.preventDefault()
  if (result.selectedValue !== undefined && result.selectedValue !== props.modelValue) {
    emit("update:modelValue", result.selectedValue)
    emit("change", result.selectedValue)
  }
  if (wasOpen && event.key === "Escape" && !result.open) {
    void nextTick(() => trigger.value?.focus())
  }
}

function activate(index: number): void {
  if (!props.options[index]?.disabled) activeIndex.value = index
}

function select(index: number): void {
  const option = props.options[index]
  if (!option || option.disabled) return
  activeIndex.value = index
  open.value = false
  if (option.value !== props.modelValue) {
    emit("update:modelValue", option.value)
    emit("change", option.value)
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  // Trusted pointer input targets the full-screen Spatial input plane before
  // the router inverse-projects and dispatches the Source-local event. Closing
  // here would hide the listbox before its option can participate in hit-test.
  if (shouldCloseSpatialSelectFromPointerDown(root.value, event)) open.value = false
}

function handleFocusOut(): void {
  void nextTick(() => {
    if (!root.value?.contains(document.activeElement)) open.value = false
  })
}

watch(() => [props.modelValue, props.options, props.disabled] as const, () => {
  const selectedIndex = spatialSelectSelectedIndex(props.options, props.modelValue)
  if (props.disabled || selectedIndex < 0) {
    open.value = false
    activeIndex.value = selectedIndex
    return
  }
  if (!open.value || !props.options[activeIndex.value] || props.options[activeIndex.value]?.disabled) {
    activeIndex.value = selectedIndex
  }
})

onMounted(() => document.addEventListener("pointerdown", handleDocumentPointerDown, true))
onBeforeUnmount(() => document.removeEventListener("pointerdown", handleDocumentPointerDown, true))
</script>
