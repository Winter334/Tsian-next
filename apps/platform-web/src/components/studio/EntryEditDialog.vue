<template>
  <FloatingWindow
    v-if="open && draft"
    title="编辑消息序列条目"
    width-class="max-w-5xl"
    @close="cancel"
  >
    <div class="flex max-h-[82vh] min-h-0 flex-col">
      <div class="grid min-h-0 flex-1 gap-3 overflow-auto p-1.5">
        <section class="grid gap-3 border border-neon-deep/30 bg-panel/35 p-3 lg:grid-cols-3">
          <label class="grid gap-1.5">
            <span class="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              内容来源
              <ParamTip label="内容来源" tip="引用文件会从 workspace 文件读取内容，适合长提示词和可复用规则；内联文本会直接写在 agent.json 的 contextPaths 条目里，适合短提示、预填充或宏条目。" />
            </span>
            <Select v-model="draft.kind">
              <SelectTrigger class="h-9 w-full">
                <SelectValue placeholder="选择内容来源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="path">引用文件</SelectItem>
                <SelectItem value="template">内联文本</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label class="grid gap-1.5">
            <span class="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              消息角色
              <ParamTip label="消息角色" tip="此条注入进入模型消息序列时使用的 role。system 适合高优先级规则，user 适合普通上下文，assistant 适合预填充或让模型续写 assistant 消息。" />
            </span>
            <Select v-model="draft.role">
              <SelectTrigger class="h-9 w-full">
                <SelectValue placeholder="选择消息角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="role in CONTEXT_PATH_ROLES" :key="role" :value="role">
                  {{ role }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label class="grid gap-1.5">
            <span class="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              插入位置
              <ParamTip :label="`插入位置：${positionLabel(draft.position)}`" :tip="positionDescription(draft.position)" />
            </span>
            <Select v-model="draft.position">
              <SelectTrigger class="h-9 w-full">
                <SelectValue placeholder="选择插入位置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="position in CONTEXT_PATH_POSITIONS" :key="position" :value="position">
                  {{ positionLabel(position) }} · {{ position }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
        </section>

        <section v-if="draft.kind === 'path'" class="grid min-h-[420px] grid-rows-[auto_auto_minmax(0,1fr)] border border-neon-deep/30 bg-panel/35">
          <div class="grid gap-2 border-b border-neon-deep/25 p-3">
            <label class="grid gap-1.5">
              <span class="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-dim">
                workspace 文件路径
                <ParamTip label="引用文件路径" tip="保存序列后，运行时会读取这个 workspace 文件并把文件内容注入消息序列。这里编辑正文会在弹窗保存时写入文件。" />
              </span>
              <input
                v-model="draft.path"
                type="text"
                placeholder="agents/storyteller/cot-template.md"
                class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                @change="loadFileContent"
                @keydown.enter.prevent="loadFileContent"
              />
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-45"
                :disabled="loadingFile || !draft.path.trim()"
                @click="loadFileContent"
              >
                <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': loadingFile }" aria-hidden="true" />
                读取文件
              </button>
              <span v-if="fileError" class="font-mono text-[10px] text-warning">{{ fileError }}</span>
              <span v-else-if="loadedPath" class="font-mono text-[10px] text-text-dim">已读取 {{ loadedPath }}</span>
            </div>
          </div>

          <div class="border-b border-neon-deep/25 px-3 py-2">
            <p class="text-xs leading-5 text-text-dim">文件正文会在弹窗保存时写入 workspace；条目配置进入外层草稿，需点击“保存序列”才写入 agent.json。</p>
          </div>

          <WorkspaceCodeEditor
            v-model="fileDraft"
            :path="draft.path"
            media-type="text/markdown"
          />
        </section>

        <section v-else class="grid gap-2 border border-neon-deep/30 bg-panel/35 p-3">
          <label class="grid gap-1.5">
            <span class="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              内联文本
              <ParamTip label="内联文本" tip="文本直接保存在 agent.json 的 contextPaths 条目里。适合短句、预填充，或 {{file:...}} / {{random:...}} 这类宏。" />
            </span>
            <textarea
              v-model="draft.template"
              rows="14"
              spellcheck="false"
              placeholder="支持 {{file:...}}、{{random:...}} 等宏"
              class="retro-focus retro-select-surface min-h-72 w-full resize-y border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs leading-5 text-text-main placeholder:text-text-dim/60"
            />
          </label>
        </section>

        <ModuleSwitchList
          v-if="hasModuleMacros"
          :modules="modulesForCurrentMacros"
          :enabled-modules="enabledModulesDraft"
          @update:enabled-modules="enabledModulesDraft = $event"
        />
      </div>

      <p v-if="error" class="mt-2 font-mono text-[11px] text-danger">{{ error }}</p>

      <div class="mt-4 flex justify-end gap-2 border-t border-neon-deep/30 pt-3">
        <button type="button" class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs" @click="cancel">
          取消
        </button>
        <button type="button" class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs" @click="confirm">
          保存
        </button>
      </div>
    </div>
  </FloatingWindow>
</template>

<script setup lang="ts">
import type { ContextPathPosition, WorkspaceFile } from "@tsian/contracts"
import { computed, ref, watch } from "vue"
import { RefreshCw } from "lucide-vue-next"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import WorkspaceCodeEditor from "@/components/workspace/WorkspaceCodeEditor.vue"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ParamTip } from "@/components/ui/tip"
import {
  readPlatformWorkspaceFile,
  writePlatformWorkspaceFile,
  type PlatformStudioModuleInfo,
} from "@/platform-host"
import ModuleSwitchList from "./ModuleSwitchList.vue"
import type { EditableContextPathEntry } from "./message-sequence"
import {
  cloneEditableEntry,
  CONTEXT_PATH_POSITIONS,
  CONTEXT_PATH_ROLES,
  extractEnabledModuleMacroPaths,
  modulePathMatchesEnabledMacroPath,
  positionDescription,
  positionLabel,
} from "./message-sequence"

const props = defineProps<{
  open: boolean
  entry: EditableContextPathEntry | null
  cardId: string
  modules: PlatformStudioModuleInfo[]
  enabledModules: string[]
}>()

const emit = defineEmits<{
  (event: "update:open", value: boolean): void
  (event: "save", entry: EditableContextPathEntry, enabledModules?: string[]): void
}>()

const draft = ref<EditableContextPathEntry | null>(null)
const enabledModulesDraft = ref<string[]>([])
const fileDraft = ref("")
const fileOriginal = ref("")
const loadedPath = ref("")
const loadingFile = ref(false)
const fileError = ref("")
const error = ref("")

const currentModuleMacroText = computed(() => {
  if (!draft.value) {
    return ""
  }
  return draft.value.kind === "template" ? draft.value.template : fileDraft.value
})
const currentModuleMacroPaths = computed(() => extractEnabledModuleMacroPaths(currentModuleMacroText.value))
const hasModuleMacros = computed(() => currentModuleMacroPaths.value.length > 0)
const modulesForCurrentMacros = computed(() => {
  const macroPaths = currentModuleMacroPaths.value
  if (macroPaths.length === 0) {
    return []
  }
  return props.modules.filter((module) =>
    macroPaths.some((macroPath) => modulePathMatchesEnabledMacroPath(module.path, macroPath)))
})

watch(
  () => [props.open, props.entry] as const,
  ([open]) => {
    if (!open || !props.entry) {
      draft.value = null
      fileDraft.value = ""
      fileOriginal.value = ""
      loadedPath.value = ""
      loadingFile.value = false
      fileError.value = ""
      error.value = ""
      enabledModulesDraft.value = []
      return
    }

    draft.value = cloneEditableEntry(props.entry)
    enabledModulesDraft.value = [...props.enabledModules]
    error.value = ""
    fileError.value = ""
    if (draft.value.kind === "path" && draft.value.path.trim()) {
      void loadFileContent()
    }
  },
  { immediate: true },
)

watch(
  () => draft.value?.kind,
  () => {
    error.value = ""
  },
)

watch(
  () => draft.value?.path,
  (path) => {
    if (!draft.value || draft.value.kind !== "path" || !loadedPath.value) {
      return
    }
    if (normalizePath(path ?? "") === loadedPath.value) {
      return
    }
    fileDraft.value = ""
    fileOriginal.value = ""
    loadedPath.value = ""
    fileError.value = ""
  },
)

function cancel(): void {
  emit("update:open", false)
}

function requireDraft(): EditableContextPathEntry | null {
  if (!draft.value) {
    return null
  }
  return draft.value
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\+/g, "/").replace(/^\/+/, "")
}

function rejectBinaryFile(file: WorkspaceFile): void {
  if (file.binary) {
    throw new Error("二进制文件不能在消息序列编辑器中作为文本正文编辑。")
  }
}

async function loadFileContent(): Promise<void> {
  const current = requireDraft()
  if (!current || current.kind !== "path") {
    return
  }
  const path = normalizePath(current.path)
  if (!path) {
    fileDraft.value = ""
    fileOriginal.value = ""
    loadedPath.value = ""
    fileError.value = ""
    return
  }

  current.path = path
  loadingFile.value = true
  fileError.value = ""
  try {
    const file = await readPlatformWorkspaceFile({ cardId: props.cardId, path })
    rejectBinaryFile(file)
    fileDraft.value = file.content
    fileOriginal.value = file.content
    loadedPath.value = file.path
  } catch (e) {
    fileDraft.value = ""
    fileOriginal.value = ""
    loadedPath.value = ""
    fileError.value = e instanceof Error ? e.message : "读取文件失败。"
  } finally {
    loadingFile.value = false
  }
}

async function saveFileIfNeeded(current: EditableContextPathEntry): Promise<void> {
  if (current.kind !== "path") {
    return
  }
  const path = normalizePath(current.path)
  if (!path) {
    return
  }
  if (loadedPath.value !== path || fileDraft.value === fileOriginal.value) {
    return
  }

  await writePlatformWorkspaceFile({
    cardId: props.cardId,
    path,
    content: fileDraft.value,
    expectedContent: fileOriginal.value,
  })
}

async function confirm(): Promise<void> {
  const current = requireDraft()
  if (!current) {
    return
  }
  error.value = ""
  current.position = current.position as ContextPathPosition
  if (current.kind === "path") {
    current.path = normalizePath(current.path)
    current.template = ""
    if (!current.path) {
      error.value = "请填写 workspace 文件路径。"
      return
    }
  } else {
    current.path = ""
    if (!current.template.trim()) {
      error.value = "请填写内联模板。"
      return
    }
  }

  try {
    await saveFileIfNeeded(current)
    emit("save", { ...current, modified: true }, hasModuleMacros.value ? [...enabledModulesDraft.value] : undefined)
    emit("update:open", false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存条目失败。"
  }
}
</script>
