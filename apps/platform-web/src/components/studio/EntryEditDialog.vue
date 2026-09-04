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
                class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider"
                @click="openPathFilePicker"
              >
                选择文件
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-45"
                :disabled="loadingFile || !draft.path.trim()"
                @click="loadFileContent"
              >
                <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': loadingFile }" aria-hidden="true" />
                读取文件
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-45"
                :disabled="!draft.path.trim()"
                @click="openWorkspaceEditor(draft.path)"
              >
                编辑
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-45"
                :disabled="!draft.path.trim()"
                @click="openWorkspaceDirectory(draft.path)"
              >
                目录
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
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="font-mono text-[11px] uppercase tracking-wider text-text-dim">宏插入</p>
              <p class="mt-1 text-xs text-text-dim">可选择 Agent 目录内文件或 modules 子目录；高级宏仍可手写。</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center px-2 font-mono text-[10px] uppercase tracking-wider"
                @click="openTemplateFilePicker"
              >
                插入文件宏
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center px-2 font-mono text-[10px] uppercase tracking-wider"
                @click="openTemplateModuleDirectoryPicker"
              >
                插入模块目录宏
              </button>
            </div>
          </div>
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

        <WorkspacePathPicker
          :open="pickerOpen"
          :card-id="cardId"
          :mode="pickerMode"
          :title="pickerTitle"
          :initial-path="pickerInitialPath"
          @update:open="pickerOpen = $event"
          @select="handlePickerSelect"
        />

        <ModuleSwitchList
          v-if="hasModuleMacros"
          :groups="moduleSwitchGroups"
          :enabled-modules="enabledModulesDraft"
          @update:enabled-modules="enabledModulesDraft = $event"
          @edit-module="openWorkspaceEditor"
          @open-module-directory="openWorkspaceDirectory"
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
import { computed, nextTick, ref, watch } from "vue"
import { useRouter } from "vue-router"
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
import { confirm as confirmDialog } from "@/composables/useConfirm"
import {
  readPlatformWorkspaceFile,
  writePlatformWorkspaceFile,
  type PlatformStudioModuleInfo,
} from "@/platform-host"
import ModuleSwitchList from "./ModuleSwitchList.vue"
import WorkspacePathPicker from "./WorkspacePathPicker.vue"
import type { EditableContextPathEntry } from "./message-sequence"
import {
  buildModuleSwitchGroups,
  cloneEditableEntry,
  CONTEXT_PATH_POSITIONS,
  CONTEXT_PATH_ROLES,
  extractEnabledModuleMacroPaths,
  positionDescription,
  positionLabel,
} from "./message-sequence"

type PickerPurpose = "path-file" | "template-file" | "template-module-directory"

const props = defineProps<{
  open: boolean
  entry: EditableContextPathEntry | null
  cardId: string
  agentPath: string
  modules: PlatformStudioModuleInfo[]
  enabledModules: string[]
}>()

const emit = defineEmits<{
  (event: "update:open", value: boolean): void
  (event: "save", entry: EditableContextPathEntry, enabledModules?: string[]): void
}>()

const router = useRouter()
const draft = ref<EditableContextPathEntry | null>(null)
const enabledModulesDraft = ref<string[]>([])
const fileDraft = ref("")
const fileOriginal = ref("")
const loadedPath = ref("")
const loadingFile = ref(false)
const fileError = ref("")
const error = ref("")
const pickerOpen = ref(false)
const pickerMode = ref<"file" | "directory">("file")
const pickerPurpose = ref<PickerPurpose>("path-file")
const pickerInitialPath = ref("")

const agentDirectory = computed(() => directoryOf(props.agentPath))
const hasDraftChanges = computed(() => {
  const current = draft.value
  const source = props.entry
  if (!current || !source) {
    return false
  }
  if (current.kind !== source.kind) {
    return true
  }
  if (current.kind === "path") {
    return current.path.trim() !== source.path.trim()
      || current.role !== source.role
      || current.position !== source.position
      || fileDraft.value !== fileOriginal.value
      || enabledModulesChanged()
  }
  return current.template !== source.template
    || current.role !== source.role
    || current.position !== source.position
    || enabledModulesChanged()
})
const currentModuleMacroText = computed(() => {
  if (!draft.value) {
    return ""
  }
  return draft.value.kind === "template" ? draft.value.template : fileDraft.value
})
const currentModuleMacroPaths = computed(() => extractEnabledModuleMacroPaths(currentModuleMacroText.value))
const hasModuleMacros = computed(() => currentModuleMacroPaths.value.length > 0)
const moduleSwitchGroups = computed(() => buildModuleSwitchGroups(props.modules, currentModuleMacroPaths.value))
const pickerTitle = computed(() => {
  if (pickerPurpose.value === "path-file") {
    return "选择引用文件"
  }
  if (pickerPurpose.value === "template-file") {
    return "选择要插入的文件宏"
  }
  return "选择模块目录"
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
      pickerOpen.value = false
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
  return value.trim().replace(/\\+/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/+$/, "")
}

function directoryOf(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

/**
 * 资源管理器把存档运行时文件显示为 save/save-NN/...（save-NN 是虚拟存档槽目录），
 * 但 runtime 注入侧的 save/ 就是"当前存档"本身，没有槽位这一层。选择器选出来的
 * 路径要去掉槽位段再写进配置，否则存下的 contextPath 注入时找不到文件。
 */
function toRuntimeWorkspacePath(path: string): string {
  return path.replace(/^save\/save-\d{2,}(\/|$)/, "save$1")
}

/**
 * 反向：无槽位的 save/ 路径在资源管理器里不存在对应目录，直接当初始目录会开出空列表。
 * 回落到 save 根，让使用者自己选槽位。
 */
function toStudioBrowseDirectory(path: string): string {
  if (path !== "save" && path.startsWith("save/") && !/^save\/save-\d{2,}(\/|$)/.test(path)) {
    return "save"
  }
  return path
}

function createEditorSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function enabledModulesChanged(): boolean {
  const baseline = new Set(props.enabledModules)
  const current = new Set(enabledModulesDraft.value)
  if (baseline.size !== current.size) {
    return true
  }
  for (const stem of baseline) {
    if (!current.has(stem)) {
      return true
    }
  }
  return false
}

async function confirmDiscardBeforeLeaving(): Promise<boolean> {
  if (!hasDraftChanges.value) {
    return true
  }
  return await confirmDialog({
    title: "离开消息条目编辑",
    message: "当前还有未保存的修改，如果此时离开会被丢弃。",
    confirmText: "确认",
    cancelText: "取消",
    severity: "danger",
  })
}

async function leaveDialogAndNavigate(navigate: () => void): Promise<void> {
  const shouldLeave = await confirmDiscardBeforeLeaving()
  if (!shouldLeave) {
    return
  }
  emit("update:open", false)
  await nextTick()
  navigate()
}

async function openWorkspaceDirectory(path: string): Promise<void> {
  const normalizedPath = normalizePath(path)
  if (!normalizedPath) {
    return
  }
  await leaveDialogAndNavigate(() => {
    void router.push({
      name: "workspace",
      query: {
        cardId: props.cardId,
        path: directoryOf(normalizedPath),
      },
    })
  })
}

async function openWorkspaceEditor(path: string): Promise<void> {
  const normalizedPath = normalizePath(path)
  if (!normalizedPath) {
    return
  }
  await leaveDialogAndNavigate(() => {
    void router.push({
      name: "workspace-editor",
      query: {
        cardId: props.cardId,
        path: normalizedPath,
        mode: "edit",
        editorId: createEditorSessionId(),
      },
    })
  })
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

function openPicker(purpose: PickerPurpose, mode: "file" | "directory", initialPath: string): void {
  pickerPurpose.value = purpose
  pickerMode.value = mode
  pickerInitialPath.value = normalizePath(initialPath)
  pickerOpen.value = true
  error.value = ""
  fileError.value = ""
}

function openPathFilePicker(): void {
  const currentPath = draft.value?.kind === "path" ? draft.value.path : ""
  openPicker("path-file", "file", toStudioBrowseDirectory(directoryOf(currentPath)))
}

function openTemplateFilePicker(): void {
  openPicker("template-file", "file", agentDirectory.value)
}

function openTemplateModuleDirectoryPicker(): void {
  const preferredModuleDirectory = props.modules[0]
    ? directoryOf(props.modules[0].path)
    : `${agentDirectory.value}/modules`
  openPicker("template-module-directory", "directory", preferredModuleDirectory)
}

function macroPathForAgentFile(path: string): string | null {
  const normalizedPath = normalizePath(path)
  const base = normalizePath(agentDirectory.value)
  if (!base) {
    return normalizedPath
  }
  if (normalizedPath === base) {
    return ""
  }
  if (normalizedPath.startsWith(`${base}/`)) {
    return normalizedPath.slice(base.length + 1)
  }
  return null
}

function appendTemplateMacro(macro: string): void {
  const current = requireDraft()
  if (!current || current.kind !== "template") {
    return
  }
  current.template = current.template.trimEnd()
    ? `${current.template.trimEnd()}\n${macro}`
    : macro
}

function insertFileMacro(path: string): void {
  const macroPath = macroPathForAgentFile(path)
  if (!macroPath) {
    error.value = "内联文件宏只能引用当前 Agent 目录内的文件。"
    return
  }
  appendTemplateMacro(`{{file:${macroPath}}}`)
}

function isModulesMacroDirectory(path: string): boolean {
  return path === "modules" || path.startsWith("modules/")
}

function insertModuleDirectoryMacro(path: string): void {
  const macroPath = macroPathForAgentFile(path)
  if (!macroPath || !isModulesMacroDirectory(macroPath)) {
    error.value = "模块目录宏请选择当前 Agent 的 modules 目录或子目录。"
    return
  }
  appendTemplateMacro(`{{file:${macroPath}/*.md?enabled}}`)
}

async function handlePickerSelect(path: string): Promise<void> {
  const current = requireDraft()
  if (!current) {
    return
  }

  if (pickerPurpose.value === "path-file") {
    if (current.kind !== "path") {
      return
    }
    current.path = toRuntimeWorkspacePath(normalizePath(path))
    await loadFileContent()
    return
  }

  if (current.kind !== "template") {
    return
  }
  if (pickerPurpose.value === "template-file") {
    insertFileMacro(path)
  } else {
    insertModuleDirectoryMacro(path)
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
