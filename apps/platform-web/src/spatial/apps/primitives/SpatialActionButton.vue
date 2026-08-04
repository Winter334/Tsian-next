<template>
  <button
    :class="[
      'spatial-app__button',
      'spatial-action-button',
      `spatial-action-button--${variant}`,
      { 'spatial-action-button--icon-only': iconOnly },
    ]"
    :type="type"
    :disabled="disabled"
  >
    <span v-if="$slots.icon" class="spatial-action-button__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span v-if="!iconOnly" class="spatial-action-button__label"><slot /></span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: "default" | "primary" | "danger"
  iconOnly?: boolean
  type?: "button" | "submit" | "reset"
  disabled?: boolean
}>(), {
  variant: "default",
  iconOnly: false,
  type: "button",
  disabled: false,
})
</script>
