<template>
  <section class="grid min-h-full grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden">
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-xs uppercase tracking-wider text-neon">
          {{ modeLabel }}
        </p>
        <h1 class="mt-1 truncate text-sm font-bold text-text-main">
          {{ draftPath || "untitled.txt" }}
        </h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="loading || saving || !editorValidator"
          @click="validateDraft"
        >
          <CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
          校验
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="loading || saving || !hasDraftChanges"
          @click="resetDraft"
        >
          <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
          还原
        </button>
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

    <div class="grid gap-2 border-b border-neon-deep/35 bg-void/65 p-3 sm:grid-cols-[260px]">
      <label class="grid min-w-0 gap-1">
        <span class="font-mono text-[11px] uppercase tracking-wider text-text-dim">文件类型</span>
        <select
          v-model="mediaType"
          class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-elevated px-2 font-mono text-xs text-text-main"
          @change="mediaTypeTouched = true"
        >
          <option
            v-for="option in mediaTypeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }} · {{ option.extensions }}
          </option>
        </select>
      </label>
    </div>

    <main class="min-h-0 bg-[#101411]">
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
        :media-type="mediaType"
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
import { computed, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  CheckCircle2,
  RotateCcw,
  Save,
} from "lucide-vue-next"
import type { WorkspaceValidationResult } from "@tsian/contracts"
import WorkspaceCodeEditor from "@/components/workspace/WorkspaceCodeEditor.vue"
import {
  WORKSPACE_MEDIA_TYPE_OPTIONS,
  inferWorkspaceMediaType,
  workspaceMediaTypeLabel,
  type WorkspaceMediaTypeOption,
} from "@/lib/workspace-file-types"
import { emitWorkspaceContentChanged } from "@/lib/workspace-events"
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
const mediaType = ref("text/plain")
const originalMediaType = ref("text/plain")
const mediaTypeTouched = ref(false)
const loading = ref(false)
const saving = ref(false)
const loadError = ref("")
const saveError = ref("")
const feedback = ref("")
const validation = ref<WorkspaceValidationResult | null>(null)
const mode = ref<EditorMode>("edit")

const normalizedDraftPath = computed(() => normalizeDisplayPath(draftPath.value))
const contentChanged = computed(() => content.value !== expectedContent.value)
const mediaTypeChanged = computed(() => mediaType.value !== originalMediaType.value)
const hasDraftChanges = computed(() =>
  mode.value === "create"
  || contentChanged.value
  || mediaTypeChanged.value
)

const modeLabel = computed(() => mode.value === "create" ? "新建文件" : "编辑文件")
const mediaTypeLabel = computed(() => workspaceMediaTypeLabel(mediaType.value))

const mediaTypeOptions = computed<WorkspaceMediaTypeOption[]>(() => {
  const normalized = mediaType.value.trim().toLowerCase()
  if (!normalized || WORKSPACE_MEDIA_TYPE_OPTIONS.some((option) => option.value === normalized)) {
    return WORKSPACE_MEDIA_TYPE_OPTIONS
  }

  return [
    ...WORKSPACE_MEDIA_TYPE_OPTIONS,
    {
      value: normalized,
      label: "当前类型",
      extensions: normalized,
    },
  ]
})

const editorValidator = computed<EditorValidator | null>(() => {
  const path = normalizedDraftPath.value.toLowerCase()
  const type = mediaType.value.toLowerCase()
  if (path.endsWith(".json") || type.includes("json")) {
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

function resetDraft() {
  feedback.value = ""
  saveError.value = ""
  validation.value = null
  if (mode.value === "create") {
    content.value = ""
    mediaType.value = inferWorkspaceMediaType(draftPath.value)
    mediaTypeTouched.value = false
    return
  }

  draftPath.value = originalPath.value
  content.value = expectedContent.value
  mediaType.value = originalMediaType.value
  mediaTypeTouched.value = false
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
        mediaType: mediaType.value,
      })
      applySavedFile(result.file.path, result.file.content, result.file.mediaType)
      mode.value = "edit"
      feedback.value = `已保存：${result.file.path}`
      emitWorkspaceContentChanged({ cardId: props.cardId ?? "", path: result.file.path })
      await syncEditorRoute(result.file.path)
      await validateSavedFile()
      return
    }

    if (contentChanged.value || mediaTypeChanged.value) {
      const result = await patchPlatformWorkspaceFile({
        cardId: props.cardId,
        path: originalPath.value,
        content: content.value,
        expectedContent: expectedContent.value,
        mediaType: mediaType.value,
      })
      applySavedFile(result.file.path, result.file.content, result.file.mediaType)
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

function applySavedFile(path: string, nextContent: string, nextMediaType: string) {
  draftPath.value = path
  originalPath.value = path
  content.value = nextContent
  expectedContent.value = nextContent
  mediaType.value = nextMediaType
  originalMediaType.value = nextMediaType
  mediaTypeTouched.value = false
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
  mediaType.value = inferWorkspaceMediaType(initialPath)
  originalMediaType.value = mediaType.value
  mediaTypeTouched.value = false
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
    applySavedFile(file.path, file.content, file.mediaType)
  } catch (error) {
    loadError.value = errorMessage(error, "无法打开文件。")
  } finally {
    loading.value = false
  }
}

watch(draftPath, (path) => {
  validation.value = null
  feedback.value = ""
  saveError.value = ""
  if (!mediaTypeTouched.value) {
    mediaType.value = inferWorkspaceMediaType(path)
  }
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

onMounted(() => {
  void loadFile()
})
</script>
