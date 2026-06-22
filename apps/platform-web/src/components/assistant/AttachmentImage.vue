<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue"
import { getAssistantAttachmentBlob } from "@/storage"

const props = defineProps<{
  path: string
  name: string
}>()

const src = ref<string | undefined>(undefined)
const showFull = ref(false)
let objectUrl: string | undefined

async function loadImage() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
  }
  src.value = undefined
  const blob = await getAssistantAttachmentBlob(props.path)
  if (blob) {
    objectUrl = URL.createObjectURL(blob)
    src.value = objectUrl
  }
}

onMounted(loadImage)
watch(() => props.path, loadImage)
onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <div class="inline-block">
    <img
      v-if="src"
      :src="src"
      :alt="name"
      class="max-h-32 max-w-[200px] cursor-zoom-in border border-neon-deep/30 object-cover transition-opacity hover:opacity-85"
      title="点击查看原图"
      @click="showFull = true"
    />
    <div
      v-else
      class="flex h-20 w-20 items-center justify-center border border-neon-deep/30 bg-panel/30 text-xs text-text-dim"
    >
      加载中…
    </div>

    <!-- 原图 modal -->
    <Teleport to="body">
      <div
        v-if="showFull && src"
        class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
        @click.self="showFull = false"
      >
        <img
          :src="src"
          :alt="name"
          class="max-h-[90vh] max-w-[90vw] object-contain"
          @click="showFull = false"
        />
      </div>
    </Teleport>
  </div>
</template>
