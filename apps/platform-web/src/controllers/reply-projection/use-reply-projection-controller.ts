import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
} from "vue"
import type { RouteLocationNormalizedLoaded } from "vue-router"
import { confirmChoice } from "@/composables/useConfirm"
import { clearBeforeClose, setBeforeClose } from "@/composables/window-close-guards"
import {
  ACTIVE_CARD_CHANGED_EVENT,
  isActiveCardChangedEvent,
} from "@/lib/platform-events"
import {
  emitWorkspaceContentChanged,
  isWorkspaceContentChangedEvent,
  WORKSPACE_CONTENT_CHANGED_EVENT,
} from "@/lib/workspace-events"
import { platformWindowForRoute } from "@/platform-apps"
import {
  getPlatformActiveGameCard,
  readPlatformWorkspaceFile,
  REPLY_PROJECTION_CONFIG_PATH,
  waitForPlatformHostReady,
  writePlatformWorkspaceFile,
} from "@/platform-host"
import {
  cloneReplyProjectionRuleDraft,
  createReplyProjectionDraft,
  createReplyProjectionProjectRowDraft,
  createReplyProjectionRuleDraft,
  parseReplyProjectionDraft,
  serializeReplyProjectionDraft,
  type ReplyProjectionReplacementMode,
  type ReplyProjectionRuleDraft,
} from "./reply-projection-draft"

type ActiveCard = NonNullable<Awaited<ReturnType<typeof getPlatformActiveGameCard>>>
export type ReplyProjectionStatusKind = "danger" | "success" | "warning" | "muted"

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error
    && typeof error.message === "string") return error.message
  return fallback
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : ""
}

function isFileNotFound(error: unknown): boolean {
  return errorCode(error) === "WORKSPACE_FILE_NOT_FOUND"
}

function isExpectedContentConflict(error: unknown): boolean {
  return errorCode(error) === "WORKSPACE_EXPECTED_CONTENT_MISMATCH"
}

/** Shared Reply Projection authoring state for RetroOS and Spatial. */
export function useReplyProjectionController(input: {
  route: RouteLocationNormalizedLoaded
  minimized?: MaybeRefOrGetter<boolean | undefined>
  openWorkspaceEditor: (input: { cardId: string; path: string; mode: "create" | "edit" }) => void
  openLibrary: () => void
}) {
  const card = shallowRef<ActiveCard | null>(null)
  const draft = ref<ReturnType<typeof createReplyProjectionDraft> | null>(null)
  const selectedRuleKey = ref("")
  const loading = ref(false)
  const saving = ref(false)
  const readOnly = ref(false)
  const fileExists = ref(false)
  const unsupportedReason = ref("")
  const loadError = ref("")
  const saveError = ref("")
  const feedback = ref("")
  const externalChange = ref(false)
  const activeCardChanged = ref(false)
  let baselineContent = ""
  let baselineDraftFingerprint = ""
  let loadGeneration = 0
  let disposed = false
  let emittingOwnChange = false
  let registeredWindowId = "reply-projection"

  const hasDraftChanges = computed(() => {
    if (!draft.value || readOnly.value) return false
    return !fileExists.value || JSON.stringify(draft.value) !== baselineDraftFingerprint
  })
  const selectedRuleIndex = computed(() => draft.value?.rules.findIndex(
    (rule) => rule.clientKey === selectedRuleKey.value,
  ) ?? -1)
  const selectedRule = computed(() => {
    const index = selectedRuleIndex.value
    return index >= 0 ? draft.value?.rules[index] ?? null : null
  })
  const missingConfig = computed(() => Boolean(card.value) && !loading.value
    && !fileExists.value && !draft.value && !loadError.value)
  const canEdit = computed(() => Boolean(draft.value) && !readOnly.value
    && !unsupportedReason.value && !loading.value)
  const cardTitle = computed(() => card.value?.manifest.name ?? "未加载游戏卡")
  const statusMessage = computed(() => {
    if (loadError.value) return loadError.value
    if (saveError.value) return saveError.value
    if (unsupportedReason.value) return unsupportedReason.value
    if (externalChange.value) return "配置文件已在其他窗口发生变化；重新读取前会保留当前草稿。"
    if (activeCardChanged.value) return "当前加载的游戏卡已变化；可先保存本页草稿，再切换到当前游戏卡。"
    if (loading.value) return "正在读取正文处理配置…"
    if (saving.value) return "正在保存…"
    if (readOnly.value) return "当前配置为只读。"
    if (hasDraftChanges.value) return "有未保存的更改。"
    if (feedback.value) return feedback.value
    if (!card.value) return "当前没有加载游戏卡。"
    if (missingConfig.value) return "当前游戏卡尚未配置正文处理。"
    return "配置已保存。"
  })
  const statusKind = computed<ReplyProjectionStatusKind>(() => {
    if (loadError.value || saveError.value || unsupportedReason.value) return "danger"
    if (externalChange.value || activeCardChanged.value || hasDraftChanges.value) return "warning"
    if (feedback.value) return "success"
    return "muted"
  })
  const statusLabel = computed(() => {
    if (!card.value) return "未加载"
    if (unsupportedReason.value) return "需手动编辑"
    if (readOnly.value) return "只读"
    if (hasDraftChanges.value) return "未保存"
    if (!fileExists.value) return "未创建"
    return "已保存"
  })

  function resetLoadState(nextCard: ActiveCard | null): void {
    card.value = nextCard
    draft.value = null
    selectedRuleKey.value = ""
    readOnly.value = nextCard?.source === "builtin"
    fileExists.value = false
    unsupportedReason.value = ""
    loadError.value = ""
    saveError.value = ""
    feedback.value = ""
    externalChange.value = false
    activeCardChanged.value = false
    baselineContent = ""
    baselineDraftFingerprint = ""
  }

  function selectFirstRule(): void {
    selectedRuleKey.value = draft.value?.rules[0]?.clientKey ?? ""
  }

  async function loadCard(nextCard: ActiveCard | null): Promise<void> {
    if (disposed) return
    const generation = ++loadGeneration
    loading.value = true
    resetLoadState(nextCard)
    if (!nextCard) {
      loading.value = false
      return
    }
    try {
      const file = await readPlatformWorkspaceFile({
        cardId: nextCard.id,
        path: REPLY_PROJECTION_CONFIG_PATH,
      })
      if (disposed || generation !== loadGeneration) return
      fileExists.value = true
      baselineContent = file.content
      readOnly.value = file.readOnly === true || nextCard.source === "builtin"
      if (file.binary) {
        unsupportedReason.value = "配置文件不是可编辑的文本文件。"
        return
      }
      const parsed = parseReplyProjectionDraft(file.content)
      if (!parsed.ok) {
        unsupportedReason.value = parsed.reason
        return
      }
      draft.value = parsed.draft
      baselineDraftFingerprint = JSON.stringify(parsed.draft)
      selectFirstRule()
    } catch (error) {
      if (disposed || generation !== loadGeneration) return
      if (!isFileNotFound(error)) {
        loadError.value = errorMessage(error, "无法读取正文处理配置。")
      }
    } finally {
      if (!disposed && generation === loadGeneration) loading.value = false
    }
  }

  async function loadActiveCard(): Promise<void> {
    if (disposed) return
    const generation = ++loadGeneration
    loading.value = true
    try {
      await waitForPlatformHostReady()
      if (disposed || generation !== loadGeneration) return
      const nextCard = await getPlatformActiveGameCard()
      if (disposed || generation !== loadGeneration) return
      await loadCard(nextCard)
    } catch (error) {
      if (!disposed && generation === loadGeneration) {
        resetLoadState(null)
        loadError.value = errorMessage(error, "无法读取当前游戏卡。")
        loading.value = false
      }
    }
  }

  function createConfig(): void {
    if (!card.value || readOnly.value || draft.value) return
    draft.value = createReplyProjectionDraft()
    feedback.value = "已创建未保存的空配置。"
    selectFirstRule()
  }

  function selectRule(clientKey: string): void {
    selectedRuleKey.value = clientKey
  }

  function addRule(): void {
    if (!draft.value || !canEdit.value) return
    const rule = createReplyProjectionRuleDraft(draft.value.rules.length)
    draft.value.rules.push(rule)
    selectedRuleKey.value = rule.clientKey
  }

  function duplicateRule(clientKey = selectedRuleKey.value): void {
    if (!draft.value || !canEdit.value) return
    const index = draft.value.rules.findIndex((rule) => rule.clientKey === clientKey)
    if (index < 0) return
    const copy = cloneReplyProjectionRuleDraft(draft.value.rules[index])
    if (copy.idPresent && copy.id) copy.id = `${copy.id}-copy`
    draft.value.rules.splice(index + 1, 0, copy)
    selectedRuleKey.value = copy.clientKey
  }

  function deleteRule(clientKey = selectedRuleKey.value): void {
    if (!draft.value || !canEdit.value) return
    const index = draft.value.rules.findIndex((rule) => rule.clientKey === clientKey)
    if (index < 0) return
    draft.value.rules.splice(index, 1)
    selectedRuleKey.value = draft.value.rules[Math.min(index, draft.value.rules.length - 1)]?.clientKey ?? ""
  }

  function moveRule(clientKey: string, direction: -1 | 1): void {
    if (!draft.value || !canEdit.value) return
    const index = draft.value.rules.findIndex((rule) => rule.clientKey === clientKey)
    const target = index + direction
    if (index < 0 || target < 0 || target >= draft.value.rules.length) return
    const [rule] = draft.value.rules.splice(index, 1)
    draft.value.rules.splice(target, 0, rule)
  }

  function setReplacementMode(mode: ReplyProjectionReplacementMode): void {
    if (!selectedRule.value || !canEdit.value) return
    selectedRule.value.replacementMode = mode
    if (mode === "split" && !selectedRule.value.contentPresent && !selectedRule.value.displayPresent) {
      selectedRule.value.contentPresent = true
      selectedRule.value.displayPresent = true
    }
  }

  function addProjectRow(): void {
    if (!selectedRule.value || !canEdit.value) return
    selectedRule.value.projectPresent = true
    selectedRule.value.projectRows.push(createReplyProjectionProjectRowDraft())
  }

  function removeProjectRow(clientKey: string): void {
    if (!selectedRule.value || !canEdit.value) return
    const index = selectedRule.value.projectRows.findIndex((row) => row.clientKey === clientKey)
    if (index >= 0) selectedRule.value.projectRows.splice(index, 1)
  }

  function ruleTitle(rule: ReplyProjectionRuleDraft, index: number): string {
    return rule.idPresent && rule.id ? rule.id : `规则 ${index + 1}`
  }

  function ruleTags(rule: ReplyProjectionRuleDraft): string[] {
    const tags: string[] = []
    if (rule.replacementMode === "text") tags.push("同时替换")
    if (rule.replacementMode === "split") {
      if (rule.contentPresent && rule.displayPresent) tags.push("分别替换")
      else if (rule.contentPresent) tags.push("上下文替换")
      else if (rule.displayPresent) tags.push("显示替换")
    }
    if (rule.projectPresent) {
      const keys = rule.projectRows.map((row) => row.key).filter(Boolean)
      tags.push(keys.length ? `投影 ${keys.join(", ")}` : "数据投影")
    }
    return tags.length ? tags : ["仅匹配"]
  }

  async function save(): Promise<boolean> {
    if (disposed || saving.value || readOnly.value || !draft.value || unsupportedReason.value) return false
    const serialized = serializeReplyProjectionDraft(draft.value)
    if (!serialized.ok) {
      saveError.value = serialized.reason
      return false
    }
    if (fileExists.value && serialized.content === baselineContent) {
      baselineDraftFingerprint = JSON.stringify(draft.value)
      feedback.value = "没有需要保存的更改。"
      return true
    }
    const loadedCard = card.value
    if (!loadedCard) return false
    saving.value = true
    saveError.value = ""
    feedback.value = ""
    try {
      const result = await writePlatformWorkspaceFile({
        cardId: loadedCard.id,
        path: REPLY_PROJECTION_CONFIG_PATH,
        content: serialized.content,
        ...(fileExists.value ? { expectedContent: baselineContent } : {}),
      })
      if (disposed) return false
      baselineContent = result.file.content
      baselineDraftFingerprint = JSON.stringify(draft.value)
      fileExists.value = true
      readOnly.value = (result.file as typeof result.file & { readOnly?: boolean }).readOnly === true
        || loadedCard.source === "builtin"
      externalChange.value = false
      saveError.value = ""
      feedback.value = "配置已保存。"
      emittingOwnChange = true
      emitWorkspaceContentChanged({ cardId: loadedCard.id, path: REPLY_PROJECTION_CONFIG_PATH })
      emittingOwnChange = false
      return true
    } catch (error) {
      if (isExpectedContentConflict(error)) {
        externalChange.value = true
        saveError.value = "配置文件已被其他窗口修改。当前草稿未覆盖外部内容，请重新读取后再保存。"
      } else {
        saveError.value = errorMessage(error, "无法保存正文处理配置。")
      }
      return false
    } finally {
      if (!disposed) saving.value = false
      emittingOwnChange = false
    }
  }

  async function reload(): Promise<void> {
    if (disposed || loading.value || saving.value) return
    if (hasDraftChanges.value) {
      const choice = await confirmChoice({
        title: "未保存的更改",
        message: "重新读取会替换当前未保存的更改。",
        cancelText: "取消",
        options: [
          { value: "save", label: "保存后重新读取" },
          { value: "discard", label: "放弃并重新读取", severity: "danger" },
        ],
      })
      if (choice === "save" && !await save()) return
      if (choice !== "save" && choice !== "discard") return
    }
    await loadActiveCard()
  }

  async function beforeClose(): Promise<boolean> {
    if (!hasDraftChanges.value) return true
    const choice = await confirmChoice({
      title: "未保存的更改",
      message: "正文处理配置有未保存的更改，是否保存？",
      cancelText: "取消",
      options: [
        { value: "save", label: "保存" },
        { value: "discard", label: "不保存", severity: "danger" },
      ],
    })
    if (choice === "discard") return true
    if (choice !== "save") return false
    return await save() && !hasDraftChanges.value
  }

  function handleSaveShortcut(event: KeyboardEvent): void {
    if (toValue(input.minimized) || (!event.ctrlKey && !event.metaKey)
      || event.key.toLowerCase() !== "s"
      || platformWindowForRoute(input.route)?.id !== registeredWindowId) return
    event.preventDefault()
    if (!readOnly.value) void save()
  }

  function handleActiveCardChanged(event: Event): void {
    if (disposed || !isActiveCardChangedEvent(event)) return
    if (hasDraftChanges.value) {
      activeCardChanged.value = true
      return
    }
    void loadActiveCard()
  }

  function handleWorkspaceChanged(event: Event): void {
    if (disposed || emittingOwnChange || !isWorkspaceContentChangedEvent(event)
      || event.detail.cardId !== card.value?.id
      || event.detail.path !== REPLY_PROJECTION_CONFIG_PATH) return
    if (hasDraftChanges.value) {
      externalChange.value = true
      return
    }
    void loadCard(card.value)
  }

  function openWorkspaceEditor(): void {
    if (!card.value) return
    input.openWorkspaceEditor({
      cardId: card.value.id,
      path: REPLY_PROJECTION_CONFIG_PATH,
      mode: fileExists.value ? "edit" : "create",
    })
  }

  onMounted(() => {
    registeredWindowId = platformWindowForRoute(input.route)?.id ?? "reply-projection"
    setBeforeClose(registeredWindowId, beforeClose)
    window.addEventListener("keydown", handleSaveShortcut)
    window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, handleActiveCardChanged)
    window.addEventListener(WORKSPACE_CONTENT_CHANGED_EVENT, handleWorkspaceChanged)
    void loadActiveCard()
  })

  onBeforeUnmount(() => {
    disposed = true
    loadGeneration += 1
    clearBeforeClose(registeredWindowId)
    window.removeEventListener("keydown", handleSaveShortcut)
    window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, handleActiveCardChanged)
    window.removeEventListener(WORKSPACE_CONTENT_CHANGED_EVENT, handleWorkspaceChanged)
  })

  return {
    card,
    draft,
    selectedRule,
    selectedRuleIndex,
    selectedRuleKey,
    loading,
    saving,
    readOnly,
    fileExists,
    missingConfig,
    unsupportedReason,
    loadError,
    saveError,
    feedback,
    externalChange,
    activeCardChanged,
    hasDraftChanges,
    canEdit,
    cardTitle,
    statusMessage,
    statusKind,
    statusLabel,
    createConfig,
    selectRule,
    addRule,
    duplicateRule,
    deleteRule,
    moveRule,
    setReplacementMode,
    addProjectRow,
    removeProjectRow,
    ruleTitle,
    ruleTags,
    save,
    reload,
    openWorkspaceEditor,
    goToLibrary: input.openLibrary,
  }
}
