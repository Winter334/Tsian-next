<template>
  <div class="spatial-assistant-image">
    <button v-if="src" type="button" :aria-label="`查看原图：${name}`" @click="showFull = true">
      <img :src="src" :alt="name">
    </button>
    <span v-else role="status">加载中…</span>
    <div v-if="showFull && src" class="spatial-assistant-image__backdrop" role="dialog" aria-modal="true" :aria-label="name" @click.self="showFull = false">
      <button type="button" aria-label="关闭原图" @click="showFull = false">
        <img :src="src" :alt="name">
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import { getAssistantAttachmentBlob } from "@/storage"

const props = defineProps<{ path: string; name: string }>()
const src = ref<string>()
const showFull = ref(false)
let objectUrl: string | undefined
let loadGeneration = 0
let disposed = false

function releaseObjectUrl(): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = undefined
  src.value = undefined
}

async function load(): Promise<void> {
  const generation = ++loadGeneration
  releaseObjectUrl()
  const blob = await getAssistantAttachmentBlob(props.path)
  if (!blob || disposed || generation !== loadGeneration) return
  objectUrl = URL.createObjectURL(blob)
  src.value = objectUrl
}

onMounted(() => { void load() })
watch(() => props.path, () => { void load() })
onBeforeUnmount(() => {
  disposed = true
  loadGeneration += 1
  releaseObjectUrl()
})
</script>

<style scoped>
.spatial-assistant-image { display: inline-grid; }
.spatial-assistant-image > button { padding: 0; border: 1px solid var(--spatial-app-border-strong); background: var(--spatial-app-surface); }
.spatial-assistant-image > button img { display: block; width: auto; max-width: 180px; height: auto; max-height: 120px; object-fit: cover; }
.spatial-assistant-image > span { display: grid; width: 76px; height: 76px; place-items: center; border: 1px solid var(--spatial-app-border); color: var(--spatial-app-muted); font-size: 9px; }
.spatial-assistant-image__backdrop { position: absolute; z-index: 70; inset: 0; display: grid; padding: 20px; place-items: center; background: rgb(15 16 14 / 78%); }
.spatial-assistant-image__backdrop button { max-width: 100%; max-height: 100%; padding: 0; border: 0; background: transparent; }
.spatial-assistant-image__backdrop img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
