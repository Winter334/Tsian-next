<template>
  <div class="spatial-image" :data-image-status="state.status">
    <img
      v-if="state.status === 'ready'"
      :src="state.url"
      :alt="alt"
      decoding="async"
      @error="markLoadFailure"
    />
    <div v-else class="spatial-image__fallback">
      <component :is="icon" v-if="icon" aria-hidden="true" />
      <span>{{ state.status === "loading" ? "读取图像" : fallbackLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from "vue"
import { toRef } from "vue"
import { useSpatialImage, type SpatialImageInput } from "./spatial-image"

const props = withDefaults(defineProps<{
  source: SpatialImageInput
  alt?: string
  fallbackLabel?: string
  icon?: Component
}>(), {
  alt: "",
  fallbackLabel: "暂无图像",
  icon: undefined,
})

const { state, markLoadFailure } = useSpatialImage(toRef(props, "source"))
</script>
