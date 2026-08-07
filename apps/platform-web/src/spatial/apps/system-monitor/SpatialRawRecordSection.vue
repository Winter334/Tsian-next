<template>
  <details class="spatial-monitor-raw">
    <summary><span>原始记录</span><SpatialActionButton @click.prevent.stop="copy">复制</SpatialActionButton></summary>
    <pre>{{ json }}</pre>
  </details>
</template>

<script setup lang="ts">
import { toast } from "@/composables/useToast"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"

const props = defineProps<{ json: string }>()
async function copy(): Promise<void> {
  try { await navigator.clipboard.writeText(props.json); toast.success("已复制原始 JSON。") }
  catch { toast.error("复制失败，请手动选择文本。") }
}
</script>
