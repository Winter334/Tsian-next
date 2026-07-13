<template>
  <div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-neon-deep/25 px-3 py-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon">消息编排</p>
          <ParamTip label="消息编排" tip="从上到下就是 Agent 阅读信息的顺序。带锁的是系统固定内容；自定义条目可以拖拽到不同位置。" />
        </div>
        <p class="mt-1 text-xs leading-5 text-text-dim">从上到下 = 发送顺序。拖拽与编辑先进入草稿，点击保存序列后应用。</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="saving" class="font-mono text-[11px] text-neon">保存中…</span>
        <span v-else-if="localError" class="font-mono text-[11px] text-danger">{{ localError }}</span>
        <span v-else-if="dirty" class="font-mono text-[11px] text-warning">有未保存更改</span>
        <span v-else class="font-mono text-[11px] text-text-dim">已保存 · {{ totalEntryCount }} 条自定义条目</span>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs disabled:opacity-45"
          :disabled="saving || !dirty"
          @click="saveDraft"
        >
          保存序列
        </button>
        <button
          type="button"
          class="retro-focus inline-flex h-8 items-center gap-2 border border-neon-deep/40 bg-panel px-3 font-mono text-xs text-text-dim transition-colors hover:border-neon/55 hover:text-neon disabled:opacity-45"
          :disabled="saving || !dirty"
          @click="revertDraft"
        >
          撤销更改
        </button>
      </div>
    </div>

    <div class="min-h-0 overflow-auto p-3">
      <div class="relative grid gap-2 pl-4 before:absolute before:bottom-2 before:left-1.5 before:top-2 before:w-px before:bg-neon-deep/35">
        <TimelineFixedRow
          title="角色设定与工具说明"
          role="system"
          :sources="systemPromptSources"
          tip="这里是当前 Agent 的主要设定和可用能力说明，通常由 AGENT.md、SOUL.md 和平台工具说明组成。"
        />

        <PositionBucket
          position="before-history"
          :entries="groups['before-history']"
          @update:entries="(value) => setGroup('before-history', value)"
          @add="addEntry"
          @edit="editEntry"
          @delete="deleteEntry"
          @drag-end="markDraftDirty"
        />

        <TimelineFixedRow
          title="过往剧情"
          role="user"
          :sources="historySources"
          tip="这里放已经发生过的剧情或对话摘要，帮助 Agent 接上前文。"
        />

        <TimelineFixedRow
          title="当前资料包"
          role="user"
          :sources="workspaceMetaSources"
          tip="这里会放当前 Agent 的笔记、已加载资料提示，以及可用能力的简表。"
        />

        <PositionBucket
          position="workspace-context"
          :entries="groups['workspace-context']"
          @update:entries="(value) => setGroup('workspace-context', value)"
          @add="addEntry"
          @edit="editEntry"
          @delete="deleteEntry"
          @drag-end="markDraftDirty"
        />

        <TimelineFixedRow
          title="工具记忆"
          role="user"
          :sources="['有些助手会使用']"
          tip="如果这个 Agent 会记住自己用过的工具，这里会放相关记录；普通剧情回合通常没有。"
        />

        <TimelineFixedRow
          title="当前回合信息"
          role="user"
          :sources="['回合编号']"
          tip="这里告诉 Agent 当前是第几轮，让它知道本次输入发生在什么时候。"
        />

        <TimelineFixedRow
          title="游戏界面临时补充（输入前）"
          :sources="['由游戏界面提供']"
          tip="游戏界面有时会在玩家输入前临时补充信息，例如当前界面状态。这里不是 Agent 配置。"
        />

        <TimelineFixedRow
          title="玩家输入"
          role="user"
          :sources="['本轮输入']"
          tip="玩家本轮输入会作为一条消息交给 Agent。"
        />

        <TimelineFixedRow
          title="游戏界面临时补充（输入后）"
          :sources="['由游戏界面提供']"
          tip="游戏界面有时会在玩家输入后追加临时要求，例如界面状态或玩法指令。这里不是 Agent 配置。"
        />

        <PositionBucket
          position="after-input"
          :entries="groups['after-input']"
          @update:entries="(value) => setGroup('after-input', value)"
          @add="addEntry"
          @edit="editEntry"
          @delete="deleteEntry"
          @drag-end="markDraftDirty"
        />

        <PositionBucket
          position="tail"
          :entries="groups.tail"
          @update:entries="(value) => setGroup('tail', value)"
          @add="addEntry"
          @edit="editEntry"
          @delete="deleteEntry"
          @drag-end="markDraftDirty"
        />
      </div>
    </div>

    <EntryEditDialog
      :open="dialogOpen"
      :entry="editingEntry"
      :card-id="cardId"
      :modules="modules"
      :enabled-modules="enabledModulesDraft"
      @update:open="dialogOpen = $event"
      @save="saveEntry"
    />
  </div>
</template>

<script setup lang="ts">
import type {
  AgentContextEntry,
  AgentRegistryEntry,
  ContextPathEntry,
  ContextPathPosition,
} from "@tsian/contracts"
import { computed, reactive, ref, watch } from "vue"
import { ParamTip } from "@/components/ui/tip"
import { confirm } from "@/composables/useConfirm"
import {
  updatePlatformStudioAgentContextPaths,
  type PlatformStudioModuleInfo,
} from "@/platform-host"
import EntryEditDialog from "./EntryEditDialog.vue"
import PositionBucket from "./PositionBucket.vue"
import TimelineFixedRow from "./TimelineFixedRow.vue"
import type { EditableContextPathEntry } from "./message-sequence"
import {
  CONTEXT_PATH_POSITIONS,
  createEditableEntry,
  editableEntrySummary,
  normalizeEditableEntry,
  serializeEditableEntry,
  validateSerializedEntries,
} from "./message-sequence"

const props = defineProps<{
  agent: AgentRegistryEntry
  context: AgentContextEntry | null
  cardId: string
  modules: PlatformStudioModuleInfo[]
}>()

const emit = defineEmits<{
  (event: "saved", message: string): void
  (event: "error", message: string): void
}>()

type EntryGroups = Record<ContextPathPosition, EditableContextPathEntry[]>

function createEmptyGroups(): EntryGroups {
  return {
    "before-history": [],
    "workspace-context": [],
    "after-input": [],
    tail: [],
  }
}

function cloneEditable(entry: EditableContextPathEntry): EditableContextPathEntry {
  return { ...entry }
}

function cloneSavedEntry(entry: EditableContextPathEntry): EditableContextPathEntry {
  const stringCompat = entry.kind === "path"
    && entry.originalWasString
    && !entry.modified
    && entry.role === "user"
    && entry.position === "workspace-context"
  return {
    ...entry,
    originalWasString: stringCompat,
    modified: false,
  }
}

function copyGroups(source: EntryGroups, mode: "draft" | "saved" = "draft"): EntryGroups {
  const clone = createEmptyGroups()
  for (const position of CONTEXT_PATH_POSITIONS) {
    clone[position] = source[position].map(mode === "saved" ? cloneSavedEntry : cloneEditable)
  }
  return clone
}

const groups = reactive<EntryGroups>(createEmptyGroups())
const baselineGroups = ref<EntryGroups>(createEmptyGroups())
const enabledModulesDraft = ref<string[]>([])
const enabledModulesConfiguredDraft = ref(false)
const baselineEnabledModules = ref<string[]>([])
const baselineEnabledModulesConfigured = ref(false)
const dirty = ref(false)
const saving = ref(false)
const localError = ref("")
const dialogOpen = ref(false)
const editingEntry = ref<EditableContextPathEntry | null>(null)

const totalEntryCount = computed(() => CONTEXT_PATH_POSITIONS.reduce((total, position) => total + groups[position].length, 0))
const systemPromptSources = computed(() => [
  "AGENT.md（主要设定）",
  ...(props.context?.soulFile ? ["SOUL.md（风格设定）"] : []),
  "工具说明",
])
const historySources = computed(() => props.context
  ? ["过往剧情 / 对话摘要"]
  : ["最近对话"])
const workspaceMetaSources = computed(() => [
  props.context?.notesFile ? "角色笔记" : "角色笔记（暂无）",
  "已加载资料提示",
  "可用能力简表",
])

watch(
  () => [props.agent, props.modules.map((module) => module.stem).join("\u0000")] as const,
  () => {
    if (!dirty.value && !saving.value) {
      hydrateFromAgent()
    }
  },
  { immediate: true },
)

function replaceGroups(next: EntryGroups): void {
  for (const position of CONTEXT_PATH_POSITIONS) {
    groups[position] = next[position].map(cloneEditable)
  }
}

function hydrateFromAgent(): void {
  const next = createEmptyGroups()
  for (const entry of props.agent.contextPaths) {
    const editable = normalizeEditableEntry(entry)
    next[editable.position].push(editable)
  }
  replaceGroups(next)
  baselineGroups.value = copyGroups(next)
  enabledModulesDraft.value = props.agent.enabledModulesConfigured
    ? [...props.agent.enabledModules]
    : props.modules.map((module) => module.stem)
  enabledModulesConfiguredDraft.value = props.agent.enabledModulesConfigured
  baselineEnabledModules.value = [...enabledModulesDraft.value]
  baselineEnabledModulesConfigured.value = enabledModulesConfiguredDraft.value
  dirty.value = false
  localError.value = ""
}

function setGroup(position: ContextPathPosition, value: EditableContextPathEntry[]): void {
  groups[position] = value
}

function markPositions(): void {
  for (const position of CONTEXT_PATH_POSITIONS) {
    for (const entry of groups[position]) {
      if (entry.position !== position) {
        entry.position = position
        entry.modified = true
      }
    }
  }
}

function markDraftDirty(): void {
  markPositions()
  dirty.value = true
  localError.value = ""
}

function flattenEntries(): EditableContextPathEntry[] {
  markPositions()
  return CONTEXT_PATH_POSITIONS.flatMap((position) => groups[position])
}

function serializeEntries(): ContextPathEntry[] {
  return flattenEntries().map(serializeEditableEntry)
}

async function saveDraft(): Promise<void> {
  if (saving.value || !dirty.value) {
    return
  }

  localError.value = ""
  const contextPaths = serializeEntries()
  const validationError = validateSerializedEntries(contextPaths)
  if (validationError) {
    localError.value = validationError
    emit("error", validationError)
    return
  }

  saving.value = true
  try {
    await updatePlatformStudioAgentContextPaths({
      agentId: props.agent.id,
      contextPaths,
      ...(enabledModulesConfiguredDraft.value
        ? { enabledModules: enabledModulesDraft.value }
        : {}),
    })
    const savedGroups = copyGroups(groups, "saved")
    replaceGroups(savedGroups)
    baselineGroups.value = copyGroups(savedGroups)
    baselineEnabledModules.value = [...enabledModulesDraft.value]
    baselineEnabledModulesConfigured.value = enabledModulesConfiguredDraft.value
    dirty.value = false
    emit("saved", "消息序列已保存。")
  } catch (e) {
    const messageText = e instanceof Error ? e.message : "保存消息序列失败。"
    localError.value = messageText
    emit("error", messageText)
  } finally {
    saving.value = false
  }
}

function revertDraft(): void {
  replaceGroups(baselineGroups.value)
  enabledModulesDraft.value = [...baselineEnabledModules.value]
  enabledModulesConfiguredDraft.value = baselineEnabledModulesConfigured.value
  dirty.value = false
  localError.value = ""
}

function addEntry(position: ContextPathPosition): void {
  editingEntry.value = createEditableEntry(position)
  dialogOpen.value = true
}

function editEntry(entry: EditableContextPathEntry): void {
  editingEntry.value = entry
  dialogOpen.value = true
}

function removeEntryById(id: string): boolean {
  for (const position of CONTEXT_PATH_POSITIONS) {
    const index = groups[position].findIndex((entry) => entry.id === id)
    if (index >= 0) {
      groups[position].splice(index, 1)
      return true
    }
  }
  return false
}

async function deleteEntry(entry: EditableContextPathEntry): Promise<void> {
  const confirmed = await confirm({
    title: "删除消息序列条目",
    message: `删除「${editableEntrySummary(entry)}」？`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }

  removeEntryById(entry.id)
  markDraftDirty()
}

function saveEntry(entry: EditableContextPathEntry, enabledModules?: string[]): void {
  removeEntryById(entry.id)
  groups[entry.position].push(entry)
  if (enabledModules) {
    enabledModulesDraft.value = enabledModules
    enabledModulesConfiguredDraft.value = true
  }
  markDraftDirty()
}
</script>
