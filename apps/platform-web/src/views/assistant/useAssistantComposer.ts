import { onBeforeUnmount, ref, type Ref } from "vue"
import { saveAssistantAttachment } from "@/storage"
import type { PendingAttachment } from "./types"

export const ACCEPTED_FILE_TYPES = "image/*,.txt,.json,.md,.markdown,.csv,.xml,.yaml,.yml,.jsonl,.js,.ts,.css,.html,.htm,.svg"

interface UseAssistantComposerOptions {
  activeSessionId: Ref<string | null>
  inputLocked: Ref<boolean>
  setErrorMessage: (message: string) => void
}

export function useAssistantComposer(options: UseAssistantComposerOptions) {
  const inputText = ref("")
  const pendingAttachments = ref<PendingAttachment[]>([])
  const dragOver = ref(false)

  async function addFileAsAttachment(file: File) {
    if (!options.activeSessionId.value || options.inputLocked.value) return
    try {
      const ref = await saveAssistantAttachment(options.activeSessionId.value, file)
      const previewUrl = ref.kind === "image" ? URL.createObjectURL(file) : undefined
      pendingAttachments.value.push({ ref, previewUrl })
    } catch (error) {
      options.setErrorMessage(`附件添加失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function addFilesAsAttachments(files: Iterable<File>) {
    if (options.inputLocked.value) return
    for (const file of files) {
      void addFileAsAttachment(file)
    }
  }

  function clearPendingAttachmentPreviews() {
    for (const pending of pendingAttachments.value) {
      if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl)
    }
    pendingAttachments.value = []
  }

  function removePendingAttachment(index: number) {
    const [removed] = pendingAttachments.value.splice(index, 1)
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
  }

  onBeforeUnmount(clearPendingAttachmentPreviews)

  return {
    inputText,
    pendingAttachments,
    dragOver,
    addFilesAsAttachments,
    clearPendingAttachmentPreviews,
    removePendingAttachment,
  }
}
