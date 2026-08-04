import { computed, onBeforeUnmount, ref, watch, type MaybeRefOrGetter, toValue } from "vue"
import {
  inferMediaTypeFromPath,
  isAudioMediaType,
  isImageMediaType,
  isVideoMediaType,
} from "@/lib/media-type"
import { readPlatformWorkspaceFile } from "@/platform-host"

/** Presentation-neutral workspace media loading and object-URL ownership. */
export function useWorkspaceMediaController(input: {
  cardId: MaybeRefOrGetter<string | undefined>
  path: MaybeRefOrGetter<string | undefined>
}) {
  const loading = ref(false)
  const loadError = ref("")
  const blobUrl = ref("")
  const loadedPath = ref("")
  let requestId = 0

  const mediaType = computed(() => inferMediaTypeFromPath(loadedPath.value))
  const isImage = computed(() => isImageMediaType(mediaType.value))
  const isAudio = computed(() => isAudioMediaType(mediaType.value))
  const isVideo = computed(() => isVideoMediaType(mediaType.value))

  function revokeUrl(): void {
    if (!blobUrl.value) return
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = ""
  }

  async function load(): Promise<void> {
    const currentRequest = ++requestId
    const path = toValue(input.path) ?? ""
    const cardId = toValue(input.cardId)
    revokeUrl()
    loadedPath.value = path
    loadError.value = ""
    if (!path) {
      loadError.value = "文件路径不能为空。"
      loading.value = false
      return
    }
    loading.value = true
    try {
      const file = await readPlatformWorkspaceFile({ ...(cardId ? { cardId } : {}), path })
      if (currentRequest !== requestId) return
      if (!file.binary) {
        loadError.value = "该文件不是可预览的媒体文件(无二进制数据)。"
        return
      }
      blobUrl.value = URL.createObjectURL(file.binary)
    } catch (error) {
      if (currentRequest === requestId) loadError.value = error instanceof Error ? error.message : "无法打开媒体文件。"
    } finally {
      if (currentRequest === requestId) loading.value = false
    }
  }

  watch(() => [toValue(input.cardId), toValue(input.path)] as const, () => { void load() }, { immediate: true })
  onBeforeUnmount(() => {
    requestId += 1
    revokeUrl()
  })

  return { loading, loadError, blobUrl, loadedPath, mediaType, isImage, isAudio, isVideo, load, revokeUrl }
}
