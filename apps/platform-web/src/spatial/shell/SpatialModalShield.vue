<template>
  <div
    class="spatial-modal-shield-source"
    :data-spatial-source="SPATIAL_MODAL_SHIELD_SOURCE_ID"
    data-spatial-layer="overlay"
    data-spatial-render="none"
    :data-spatial-z="SPATIAL_MODAL_SHIELD_Z_INDEX"
    data-spatial-parallax-factor="0"
    data-spatial-curve-half-angle="0"
    aria-hidden="true"
    @pointerdown.stop
    @click.stop="emit('backdrop')"
    @contextmenu.prevent.stop
    @wheel.prevent.stop
  />
</template>

<script setup lang="ts">
import {
  SPATIAL_MODAL_SHIELD_SOURCE_ID,
  SPATIAL_MODAL_SHIELD_Z_INDEX,
} from "./spatial-global-surfaces"

const emit = defineEmits<{
  backdrop: []
}>()
</script>
