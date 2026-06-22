<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-xs uppercase tracking-wider text-neon">
          媒体查看
        </p>
        <h1 class="mt-1 truncate text-sm font-bold text-text-main">
          {{ path || "未知文件" }}
        </h1>
      </div>
      <p class="font-mono text-[11px] text-text-dim">
        {{ mediaTypeLabel }}
      </p>
    </div>

    <main class="grid min-h-0 place-items-center overflow-auto bg-[#101411] p-4">
      <div v-if="loading" class="grid place-items-center">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
          正在加载文件
        </p>
      </div>
      <div v-else-if="loadError" class="max-w-lg border border-danger/40 bg-danger/10 p-4">
        <p class="font-mono text-xs uppercase tracking-wider text-danger">文件不可用</p>
        <p class="mt-2 text-sm leading-6 text-text-dim">{{ loadError }}</p>
      </div>
      <template v-else-if="blobUrl">
        <img
          v-if="isImage"
          :src="blobUrl"
          class="max-h-full max-w-full object-contain"
          :alt="path"
        />
        <audio
          v-else-if="isAudio"
          controls
          :src="blobUrl"
          class="w-full max-w-xl"
        />
        <video
          v-else-if="isVideo"
          controls
          :src="blobUrl"
          class="max-h-full max-w-full"
        />
        <p v-else class="text-center font-mono text-xs text-text-dim">
          不支持预览的文件类型:{{ mediaTypeLabel }}
        </p>
      </template>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute } from "vue-router"
import {
  inferMediaTypeFromPath,
  isImageMediaType,
  isAudioMediaType,
  isVideoMediaType,
} from "@/lib/media-type"
import { readPlatformWorkspaceFile } from "../platform-host"

const props = withDefaults(defineProps<{
  cardId?: string
  path?: string
}>(), {
  path: "",
})

const route = useRoute()
const loading = ref(false)
const loadError = ref("")
const blobUrl = ref("")
const path = ref(props.path)
const mediaType = computed(() => inferMediaTypeFromPath(path.value))
const mediaTypeLabel = computed(() => mediaType.value)
const isImage = computed(() => isImageMediaType(mediaType.value))
const isAudio = computed(() => isAudioMediaType(mediaType.value))
const isVideo = computed(() => isVideoMediaType(mediaType.value))

function routeQueryString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function revokeUrl() {
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = ""
  }
}

async function loadMedia() {
  revokeUrl()
  const initialPath = props.path
  path.value = initialPath
  if (!initialPath) {
    loadError.value = "文件路径不能为空。"
    return
  }

  loading.value = true
  loadError.value = ""
  try {
    const file = await readPlatformWorkspaceFile({
      cardId: props.cardId,
      path: initialPath,
    })
    if (!file.binary) {
      loadError.value = "该文件不是可预览的媒体文件(无二进制数据)。"
      return
    }
    blobUrl.value = URL.createObjectURL(file.binary)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "无法打开媒体文件。"
  } finally {
    loading.value = false
  }
}

watch(() => [props.cardId, props.path] as const, () => {
  void loadMedia()
})

watch(() => route.fullPath, () => {
  // 同一组件实例复用时(route query 变化)重新加载
  const nextPath = routeQueryString(route.query.path)
  if (nextPath && nextPath !== path.value) {
    void loadMedia()
  }
})

onMounted(() => {
  void loadMedia()
})

onBeforeUnmount(() => {
  revokeUrl()
})
</script>
