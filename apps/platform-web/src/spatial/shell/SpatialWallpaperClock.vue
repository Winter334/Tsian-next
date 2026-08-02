<template>
  <time
    class="spatial-wallpaper-clock"
    data-spatial-source="shell:clock"
    data-spatial-z="1"
    data-spatial-parallax-factor="0"
    data-spatial-input="none"
    :datetime="dateTime"
    :aria-label="`${dateLabel} ${hours}时${minutes}分${seconds}秒`"
  >
    <span class="spatial-wallpaper-clock__time" aria-hidden="true">
      <span class="spatial-wallpaper-clock__major">{{ hours }}</span>
      <span class="spatial-wallpaper-clock__separator">:</span>
      <span class="spatial-wallpaper-clock__major">{{ minutes }}</span>
      <span class="spatial-wallpaper-clock__seconds">{{ seconds }}</span>
    </span>
    <span class="spatial-wallpaper-clock__date" aria-hidden="true">{{ dateLabel }}</span>
  </time>
</template>

<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  timestamp: number
}>()

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
})

const date = computed(() => new Date(props.timestamp))
const hours = computed(() => String(date.value.getHours()).padStart(2, "0"))
const minutes = computed(() => String(date.value.getMinutes()).padStart(2, "0"))
const seconds = computed(() => String(date.value.getSeconds()).padStart(2, "0"))
const dateLabel = computed(() => dateFormatter.format(date.value))
const dateTime = computed(() => date.value.toISOString())
</script>
