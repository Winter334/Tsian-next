<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-xs uppercase tracking-wider text-neon">
          {{ modeLabel }}
        </p>
        <h1 class="mt-1 truncate text-sm font-bold text-text-main">
          {{ draftPath || "untitled.txt" }}<span v-if="hasDraftChanges" class="text-neon">*</span>
        </h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="loading || saving"
          @click="saveDraft"
        >
          <Save class="h-3.5 w-3.5" aria-hidden="true" />
          {{ saving ? "保存中" : "保存" }}
        </button>
      </div>
    </div>

    <main class="min-h-0 overflow-hidden bg-[#101411]">
      <div v-if="loading" class="grid h-full place-items-center">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
          正在打开文件
        </p>
      </div>
      <div v-else-if="loadError" class="grid h-full place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">文件不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ loadError }}</p>
        </div>
      </div>
      <WorkspaceCodeEditor
        v-else
        v-model="content"
        :path="draftPath"
      />
    </main>

    <footer class="retro-statusbar grid min-h-9 gap-2 border-t px-3 py-2 lg:grid-cols-[1fr_auto] lg:items-center">
      <p
        class="min-w-0 truncate text-sm"
        :class="statusTone"
      >
        {{ statusMessage }}
      </p>
      <p class="font-mono text-[11px] text-text-dim">
        {{ mediaTypeLabel }} · {{ content.length }} 字符
      </p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Save } from "lucide-vue-next"
import type { WorkspaceValidationResult } from "@tsian/contracts"
import WorkspaceCodeEditor from "@/components/workspace/WorkspaceCodeEditor.vue"
import { inferMediaTypeFromPath } from "@/lib/media-type"
import { emitWorkspaceContentChanged } from "@/lib/workspace-events"
import { confirmChoice } from "@/composables/useConfirm"
import { clearBeforeClose, setBeforeClose } from "@/composables/useDesktopWindows"
import { editorWindowIdFor } from "@/desktop-apps"
import {
  listPlatformWorkspaceDirectory,
  patchPlatformWorkspaceFile,
  readPlatformWorkspaceFile,
  validatePlatformWorkspaceFile,
  writePlatformWorkspaceFile,
} from "../platform-host"

type EditorMode = "create" | "edit"
type EditorValidator = "json" | "frontmatter"

const props = withDefaults(defineProps<{
  cardId?: string
  path?: string
  mode?: EditorMode
}>(), {
  path: "",
  mode: "edit",
})

const route = useRoute()
const router = useRouter()

const loadedCardId = ref("")
const draftPath = ref("")
const originalPath = ref("")
const content = ref("")
const expectedContent = ref("")
const loading = ref(false)
const saving = ref(false)
const loadError = ref("")
const saveError = ref("")
const feedback = ref("")
const validation = ref<WorkspaceValidationResult | null>(null)
const mode = ref<EditorMode>("edit")

const normalizedDraftPath = computed(() => normalizeDisplayPath(draftPath.value))
const contentChanged = computed(() => content.value !== expectedContent.value)
const hasDraftChanges = computed(() =>
  mode.value === "create"
  || contentChanged.value
)

const modeLabel = computed(() => mode.value === "create" ? "新建文件" : "编辑文件")
const mediaTypeLabel = computed(() => inferMediaTypeFromPath(normalizedDraftPath.value))

const editorValidator = computed<EditorValidator | null>(() => {
  const path = normalizedDraftPath.value.toLowerCase()
  if (path.endsWith(".json")) {
    return "json"
  }
  if (isFrontmatterDefinitionPath(path)) {
    return "frontmatter"
  }
  return null
})

const statusMessage = computed(() => {
  if (loadError.value) {
    return loadError.value
  }
  if (saveError.value) {
    return saveError.value
  }
  if (feedback.value) {
    return feedback.value
  }
  if (validation.value) {
    if (validation.value.valid) {
      return `${validation.value.validator} 校验通过。`
    }
    return validation.value.errors.map((error) => error.message).join("；")
  }
  if (hasDraftChanges.value) {
    return "有未保存的更改。"
  }
  return mode.value === "create" ? "输入内容后保存为新文件。" : "没有未保存的更改。"
})

const statusTone = computed(() => {
  if (loadError.value || saveError.value || (validation.value && !validation.value.valid)) {
    return "text-danger"
  }
  if (feedback.value || validation.value?.valid) {
    return "text-neon"
  }
  return "text-text-dim"
})

function normalizeDisplayPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
}

function routeQueryString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function isFrontmatterDefinitionPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean)
  const fileName = segments[segments.length - 1]
  return fileName === "agent.md" || fileName === "skill.md"
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
  ) {
    return error.message
  }
  return fallback
}

function validateDraft(): boolean {
  feedback.value = ""
  saveError.value = ""
  const validator = editorValidator.value
  if (!validator) {
    validation.value = {
      scope: "effective",
      valid: true,
      validator: "plain",
      errors: [],
    }
    return true
  }

  if (validator === "json") {
    try {
      JSON.parse(content.value)
      validation.value = {
        scope: "effective",
        path: normalizedDraftPath.value,
        valid: true,
        validator,
        errors: [],
      }
      return true
    } catch (error) {
      validation.value = {
        scope: "effective",
        path: normalizedDraftPath.value,
        valid: false,
        validator,
        errors: [{
          code: "WORKSPACE_JSON_INVALID",
          message: errorMessage(error, "JSON 格式无效。"),
          path: normalizedDraftPath.value,
        }],
      }
      return false
    }
  }

  const valid = /^---\r?\n[\s\S]*?\r?\n---/.test(content.value)
  validation.value = {
    scope: "effective",
    path: normalizedDraftPath.value,
    valid,
    validator,
    errors: valid
      ? []
      : [{
          code: "WORKSPACE_FRONTMATTER_MISSING",
          message: "文件开头缺少 YAML frontmatter。",
          path: normalizedDraftPath.value,
        }],
  }
  return valid
}

async function ensureTargetPathAvailable(targetPath: string) {
  const segments = targetPath.split("/").filter(Boolean)
  const targetName = segments.pop()
  if (!targetName) {
    throw new Error("文件路径不能为空。")
  }

  const parentPath = segments.join("/")
  const listing = await listPlatformWorkspaceDirectory({
    cardId: props.cardId,
    path: parentPath,
  })
  if (listing.entries.some((entry) => entry.name === targetName || entry.path === targetPath)) {
    throw new Error(`目标路径已存在：${targetPath}`)
  }
}

async function validateSavedFile() {
  const validator = editorValidator.value
  if (!validator) {
    return
  }

  validation.value = await validatePlatformWorkspaceFile({
    cardId: props.cardId,
    path: normalizedDraftPath.value,
    validator,
  })
}

async function saveDraft() {
  const targetPath = normalizedDraftPath.value
  if (!targetPath) {
    loadError.value = ""
    feedback.value = ""
    validation.value = {
      scope: "effective",
      valid: false,
      validator: "path",
      errors: [{
        code: "WORKSPACE_PATH_REQUIRED",
        message: "文件路径不能为空。",
      }],
    }
    return
  }
  if (editorValidator.value && !validateDraft()) {
    return
  }

  saving.value = true
  saveError.value = ""
  feedback.value = ""

  try {
    if (mode.value === "create") {
      await ensureTargetPathAvailable(targetPath)
      const result = await writePlatformWorkspaceFile({
        cardId: props.cardId,
        path: targetPath,
        content: content.value,
      })
      applySavedFile(result.file.path, result.file.content)
      mode.value = "edit"
      feedback.value = `已保存：${result.file.path}`
      emitWorkspaceContentChanged({ cardId: props.cardId ?? "", path: result.file.path })
      await syncEditorRoute(result.file.path)
      await validateSavedFile()
      return
    }

    if (contentChanged.value) {
      const result = await patchPlatformWorkspaceFile({
        cardId: props.cardId,
        path: originalPath.value,
        content: content.value,
        expectedContent: expectedContent.value,
      })
      applySavedFile(result.file.path, result.file.content)
      feedback.value = `已保存：${result.file.path}`
      emitWorkspaceContentChanged({ cardId: props.cardId ?? "", path: result.file.path })
      await syncEditorRoute(result.file.path)
      await validateSavedFile()
      return
    }

    feedback.value = "没有需要保存的更改。"
  } catch (error) {
    saveError.value = errorMessage(error, "无法保存文件。")
  } finally {
    saving.value = false
  }
}

function applySavedFile(path: string, nextContent: string) {
  draftPath.value = path
  originalPath.value = path
  content.value = nextContent
  expectedContent.value = nextContent
}

async function syncEditorRoute(path: string) {
  const editorId = routeQueryString(route.query.editorId)
  if (!editorId) {
    return
  }

  await router.replace({
    name: "workspace-editor",
    query: {
      cardId: props.cardId,
      path,
      mode: "edit",
      editorId,
    },
  })
}

async function loadFile() {
  loadedCardId.value = props.cardId ?? ""
  mode.value = props.mode
  const initialPath = normalizeDisplayPath(props.path)
  loading.value = false
  draftPath.value = initialPath
  originalPath.value = initialPath
  content.value = ""
  expectedContent.value = ""
  loadError.value = ""
  saveError.value = ""
  feedback.value = ""
  validation.value = null

  if (props.mode === "create") {
    return
  }

  loading.value = true
  try {
    const file = await readPlatformWorkspaceFile({
      cardId: props.cardId,
      path: initialPath,
    })
    applySavedFile(file.path, file.content)
  } catch (error) {
    loadError.value = errorMessage(error, "无法打开文件。")
  } finally {
    loading.value = false
  }
}

watch(draftPath, () => {
  validation.value = null
  feedback.value = ""
  saveError.value = ""
})

watch(content, () => {
  validation.value = null
  feedback.value = ""
  saveError.value = ""
})

watch(() => [props.cardId, props.path, props.mode] as const, () => {
  if (
    loadedCardId.value === props.cardId
    && props.mode === mode.value
    && normalizeDisplayPath(props.path) === normalizeDisplayPath(originalPath.value)
    && !loadError.value
  ) {
    return
  }

  void loadFile()
})

// Ctrl+S / Cmd+S: save. Active only on the editor route so other views keep the
// browser default. No editable-target guard: Ctrl+S must fire inside CodeMirror.
function onGlobalKeydown(event: KeyboardEvent) {
  const ctrl = event.ctrlKey || event.metaKey
  if (!ctrl || (event.key !== "s" && event.key !== "S")) {
    return
  }
  if (route.name !== "workspace-editor") {
    return
  }
  event.preventDefault()
  void saveDraft()
}

// before-close guard: if there are unsaved changes, ask save/discard/cancel.
// Returns true to allow close, false to veto (user chose cancel).
async function onBeforeClose(): Promise<boolean> {
  if (!hasDraftChanges.value) {
    return true
  }
  const choice = await confirmChoice({
    title: "未保存的更改",
    message: `「${draftPath.value || "untitled.txt"}」有未保存的更改，是否保存？`,
    cancelText: "取消",
    options: [
      { value: "save", label: "保存" },
      { value: "discard", label: "不保存", severity: "danger" },
    ],
  })
  if (choice === "save") {
    await saveDraft()
    // If the save failed (e.g. validation error), keep the window open so the
    // user can fix it; hasDraftChanges will still be true.
    return !hasDraftChanges.value
  }
  if (choice === "discard") {
    return true
  }
  return false
}

function editorWindowId(): string {
  const cardId = props.cardId ?? ""
  const scopeKey = cardId || "tsian-local"
  return editorWindowIdFor({
    scopeKey,
    editorId: routeQueryString(route.query.editorId),
    mode: props.mode,
    path: props.path,
  })
}

// Capture the window id once at mount so unregister uses the same id even if
// props.path changes between mount and unmount (e.g. after a save route-sync).
let registeredWindowId = ""

onMounted(() => {
  void loadFile()
  window.addEventListener("keydown", onGlobalKeydown)
  registeredWindowId = editorWindowId()
  setBeforeClose(registeredWindowId, onBeforeClose)
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown)
  clearBeforeClose(registeredWindowId)
  registeredWindowId = ""
})
</script>
