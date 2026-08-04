import { computed, onBeforeUnmount, onMounted, ref, watch, type MaybeRefOrGetter, toValue } from "vue"
import type { WorkspaceFile, WorkspaceValidationResult } from "@tsian/contracts"
import type { Router, RouteLocationNormalizedLoaded } from "vue-router"
import { inferMediaTypeFromPath } from "@/lib/media-type"
import { hasWorkspaceEditorDraftChanges } from "@/lib/workspace-readonly"
import { emitWorkspaceContentChanged } from "@/lib/workspace-events"
import { confirmChoice } from "@/composables/useConfirm"
import { clearBeforeClose, setBeforeClose } from "@/composables/window-close-guards"
import { editorWindowIdFor, platformWindowForRoute } from "@/platform-apps"
import {
  listPlatformWorkspaceDirectory,
  readPlatformWorkspaceFile,
  validatePlatformWorkspaceFile,
  writePlatformWorkspaceFile,
} from "@/platform-host"
import { normalizeWorkspaceDisplayPath } from "./workspace-controller-helpers"

export type WorkspaceEditorMode = "create" | "edit"
export type WorkspaceEditorStatusKind = "danger" | "success" | "muted"
type EditorValidator = "json" | "frontmatter"

function message(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string") {
    return error.message
  }
  return fallback
}

function isSkillDefinition(path: string): boolean {
  const segments = path.split("/").filter(Boolean)
  return segments[segments.length - 1]?.toLowerCase() === "skill.md"
}

function requireTextFile<T extends WorkspaceFile>(file: T): T {
  if (file.binary) throw new Error(`文件「${file.path}」是二进制文件，不能在文本编辑器中打开或保存。`)
  return file
}

/** Shared editor state, persistence and guard ownership for both shells. */
export function useWorkspaceEditorController(input: {
  cardId: MaybeRefOrGetter<string | undefined>
  path: MaybeRefOrGetter<string | undefined>
  mode: MaybeRefOrGetter<WorkspaceEditorMode | undefined>
  editorId: MaybeRefOrGetter<string | undefined>
  minimized?: MaybeRefOrGetter<boolean | undefined>
  route: RouteLocationNormalizedLoaded
  router: Router
}) {
  const draftPath = ref("")
  const originalPath = ref("")
  const content = ref("")
  const expectedContent = ref("")
  const loading = ref(false)
  const saving = ref(false)
  const readOnly = ref(false)
  const loadError = ref("")
  const saveError = ref("")
  const feedback = ref("")
  const validation = ref<WorkspaceValidationResult | null>(null)
  const activeMode = ref<WorkspaceEditorMode>("edit")
  let loadGeneration = 0
  let loadedCardId = ""
  let registeredWindowId = ""

  const contentChanged = computed(() => content.value !== expectedContent.value)
  const hasDraftChanges = computed(() => hasWorkspaceEditorDraftChanges({ readOnly: readOnly.value, mode: activeMode.value, content: content.value, expectedContent: expectedContent.value }))
  const modeLabel = computed(() => readOnly.value ? "只读文件" : activeMode.value === "create" ? "新建文件" : "编辑文件")
  const mediaTypeLabel = computed(() => inferMediaTypeFromPath(draftPath.value))
  const editorValidator = computed<EditorValidator | null>(() => draftPath.value.toLowerCase().endsWith(".json") ? "json" : isSkillDefinition(draftPath.value) ? "frontmatter" : null)
  const statusMessage = computed(() => loadError.value || saveError.value || feedback.value
    || (validation.value ? validation.value.valid ? `${validation.value.validator} 校验通过。` : validation.value.errors.map((error) => error.message).join("；") : "")
    || (readOnly.value ? "只读文件。" : hasDraftChanges.value ? "有未保存的更改。" : activeMode.value === "create" ? "输入内容后保存为新文件。" : "没有未保存的更改。"))
  const statusKind = computed<WorkspaceEditorStatusKind>(() => (
    loadError.value || saveError.value || (validation.value && !validation.value.valid)
      ? "danger"
      : feedback.value || validation.value?.valid
        ? "success"
        : "muted"
  ))

  function validateDraft(): boolean {
    const validator = editorValidator.value
    if (!validator) return true
    if (validator === "json") {
      try { JSON.parse(content.value) } catch (error) {
        validation.value = { scope: "effective", path: draftPath.value, valid: false, validator, errors: [{ code: "WORKSPACE_JSON_INVALID", message: message(error, "JSON 格式无效。"), path: draftPath.value }] }
        return false
      }
    } else if (!/^---\r?\n[\s\S]*?\r?\n---/.test(content.value)) {
      validation.value = { scope: "effective", path: draftPath.value, valid: false, validator, errors: [{ code: "WORKSPACE_FRONTMATTER_MISSING", message: "文件开头缺少 YAML frontmatter。", path: draftPath.value }] }
      return false
    }
    validation.value = { scope: "effective", path: draftPath.value, valid: true, validator, errors: [] }
    return true
  }

  async function ensureTargetAvailable(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean); const name = segments.pop()
    if (!name) throw new Error("文件路径不能为空。")
    const listing = await listPlatformWorkspaceDirectory({ ...(toValue(input.cardId) ? { cardId: toValue(input.cardId) } : {}), path: segments.join("/") })
    if (listing.entries.some((entry) => entry.name === name || entry.path === path)) throw new Error(`目标路径已存在：${path}`)
  }

  async function syncRoute(path: string): Promise<void> {
    const editorId = toValue(input.editorId) ?? ""
    if (!editorId) return
    await input.router.replace({ name: "workspace-editor", query: { ...(toValue(input.cardId) ? { cardId: toValue(input.cardId) } : {}), path, mode: "edit", editorId } })
  }

  async function saveDraft(): Promise<void> {
    if (readOnly.value || saving.value) return
    const targetPath = normalizeWorkspaceDisplayPath(draftPath.value)
    if (!targetPath) { validation.value = { scope: "effective", valid: false, validator: "path", errors: [{ code: "WORKSPACE_PATH_REQUIRED", message: "文件路径不能为空。" }] }; return }
    if (!validateDraft()) return
    if (activeMode.value === "edit" && !contentChanged.value) {
      feedback.value = "没有需要保存的更改。"
      return
    }
    saving.value = true; saveError.value = ""; feedback.value = ""
    try {
      if (activeMode.value === "create") await ensureTargetAvailable(targetPath)
      const result = await writePlatformWorkspaceFile({
        ...(toValue(input.cardId) ? { cardId: toValue(input.cardId) } : {}),
        path: activeMode.value === "create" ? targetPath : originalPath.value,
        content: content.value,
        ...(activeMode.value === "edit" ? { expectedContent: expectedContent.value } : {}),
      })
      const file = requireTextFile(result.file)
      draftPath.value = file.path; originalPath.value = file.path; content.value = file.content; expectedContent.value = file.content; readOnly.value = (file as WorkspaceFile & { readOnly?: boolean }).readOnly === true; activeMode.value = "edit"
      feedback.value = `已保存：${file.path}`
      emitWorkspaceContentChanged({ cardId: toValue(input.cardId) ?? "", path: file.path })
      await syncRoute(file.path)
      if (editorValidator.value) validation.value = await validatePlatformWorkspaceFile({ ...(toValue(input.cardId) ? { cardId: toValue(input.cardId) } : {}), path: file.path, validator: editorValidator.value })
    } catch (error) { saveError.value = message(error, "无法保存文件。") } finally { saving.value = false }
  }

  async function load(): Promise<void> {
    const generation = ++loadGeneration; const path = normalizeWorkspaceDisplayPath(toValue(input.path) ?? ""); const mode = toValue(input.mode) ?? "edit"
    loadedCardId = toValue(input.cardId) ?? ""
    activeMode.value = mode; draftPath.value = path; originalPath.value = path; content.value = ""; expectedContent.value = ""; readOnly.value = false; loading.value = false; loadError.value = ""; saveError.value = ""; feedback.value = ""; validation.value = null
    if (mode === "create") return
    loading.value = true
    try {
      const file = requireTextFile(await readPlatformWorkspaceFile({ ...(toValue(input.cardId) ? { cardId: toValue(input.cardId) } : {}), path }))
      if (generation !== loadGeneration) return
      draftPath.value = file.path; originalPath.value = file.path; content.value = file.content; expectedContent.value = file.content; readOnly.value = file.readOnly === true
    } catch (error) { if (generation === loadGeneration) loadError.value = message(error, "无法打开文件。") } finally { if (generation === loadGeneration) loading.value = false }
  }

  function routeInputsMatchLoadedState(): boolean {
    return (toValue(input.cardId) ?? "") === loadedCardId
      && (toValue(input.mode) ?? "edit") === activeMode.value
      && normalizeWorkspaceDisplayPath(toValue(input.path) ?? "") === originalPath.value
      && !loadError.value
  }

  function isActiveEditor(): boolean {
    return platformWindowForRoute(input.route)?.id === registeredWindowId
  }
  function handleSaveShortcut(event: KeyboardEvent): void {
    if (toValue(input.minimized) || !isActiveEditor() || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "s") return
    event.preventDefault(); if (!readOnly.value) void saveDraft()
  }
  async function beforeClose(): Promise<boolean> {
    if (!hasDraftChanges.value) return true
    const choice = await confirmChoice({ title: "未保存的更改", message: `「${draftPath.value || "untitled.txt"}」有未保存的更改，是否保存？`, cancelText: "取消", options: [{ value: "save", label: "保存" }, { value: "discard", label: "不保存", severity: "danger" }] })
    if (choice === "discard") return true
    if (choice !== "save") return false
    await saveDraft(); return !hasDraftChanges.value
  }

  watch([draftPath, content], () => { validation.value = null; feedback.value = ""; saveError.value = "" })
  watch(() => [toValue(input.cardId), toValue(input.path), toValue(input.mode)] as const, () => {
    if (!routeInputsMatchLoadedState()) void load()
  })
  onMounted(() => {
    const cardId = toValue(input.cardId) ?? ""; const editorId = toValue(input.editorId) ?? ""
    registeredWindowId = editorWindowIdFor({ scopeKey: cardId || "tsian-local", editorId, mode: toValue(input.mode) ?? "edit", path: toValue(input.path) ?? "" })
    setBeforeClose(registeredWindowId, beforeClose); window.addEventListener("keydown", handleSaveShortcut); void load()
  })
  onBeforeUnmount(() => { loadGeneration += 1; window.removeEventListener("keydown", handleSaveShortcut); clearBeforeClose(registeredWindowId) })

  return { draftPath, content, loading, saving, readOnly, loadError, saveError, feedback, validation, hasDraftChanges, modeLabel, mediaTypeLabel, statusMessage, statusKind, saveDraft, load, handleSaveShortcut, beforeClose }
}
