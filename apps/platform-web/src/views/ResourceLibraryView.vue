<template>
  <section class="flex min-h-full flex-col">
    <header class="mb-8 border-b-2 border-neon/50 pb-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div class="grid gap-2">
          <p class="font-mono text-xs uppercase tracking-[0.35em] text-neon-muted">
            SYS.DIR // RESOURCES
          </p>
          <h2 class="text-3xl font-black uppercase tracking-widest text-text-main md:text-4xl">
            全局资源库
          </h2>
          <p class="max-w-2xl font-mono text-sm leading-relaxed text-text-dim">
            管理提示词预设、世界书与工作流预设；这些资源会作为工作流运行时的统一来源。
          </p>
        </div>
        <Badge
          variant="outline"
          class="w-fit rounded-none border-neon/50 bg-neon/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-neon"
        >
          {{ activeTab.itemCount }} ITEMS
        </Badge>
      </div>
    </header>

    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-neon-muted/30">
      <div class="flex flex-wrap gap-2" role="tablist" aria-label="资源类型">
        <button
          v-for="tab in resourceTabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTabId === tab.id"
          class="border-x border-t px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors"
          :class="activeTabId === tab.id
            ? 'border-neon bg-neon/10 text-neon glow-box'
            : 'border-neon-muted/30 bg-panel text-text-dim hover:border-neon-muted hover:text-text-main'"
          @click="selectTab(tab.id)"
        >
          {{ tab.label }}
          <span class="ml-2 text-[10px] opacity-60">{{ tab.itemCount }}</span>
        </button>
      </div>
      <button
        type="button"
        class="mb-2 border border-neon bg-neon/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-neon transition-colors hover:bg-neon/20"
        @click="createDraft"
      >
        新建{{ activeTab.label }}
      </button>
    </div>

    <div class="grid flex-1 gap-4 border-x border-b border-neon-muted/30 bg-panel/40 p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside class="min-h-[520px] border border-neon-muted/30 bg-void/35">
        <div class="border-b border-neon-muted/30 p-3">
          <p class="font-mono text-xs uppercase tracking-[0.25em] text-neon-muted">
            LIST // {{ activeTab.code }}
          </p>
          <p class="mt-1 font-mono text-[11px] text-text-dim">
            {{ activeTab.description }}
          </p>
        </div>

        <div v-if="activeResources.length === 0" class="grid min-h-80 place-items-center p-6 text-center">
          <div class="grid gap-2">
            <p class="font-mono text-xs uppercase tracking-[0.25em] text-neon-muted">EMPTY</p>
            <p class="font-mono text-sm text-text-dim">暂无资源，点击右上角创建。</p>
          </div>
        </div>

        <div v-else class="max-h-[calc(100vh-320px)] overflow-y-auto p-3">
          <button
            v-for="resource in activeResources"
            :key="resource.id"
            type="button"
            class="mb-3 block w-full border p-3 text-left transition-colors"
            :class="selectedResourceId === resource.id
              ? 'border-neon bg-neon/10 glow-box'
              : 'border-neon-muted/30 bg-panel hover:border-neon-muted/70'"
            @click="selectResource(resource.id)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate font-mono text-sm font-bold text-text-main">{{ resource.name }}</p>
                <p class="mt-1 truncate font-mono text-[10px] text-text-dim">{{ resource.id }}</p>
              </div>
              <span class="shrink-0 font-mono text-[10px] uppercase text-neon-muted">
                {{ formatDate(resource.updatedAt) }}
              </span>
            </div>
            <div v-if="resource.tags.length > 0" class="mt-3 flex flex-wrap gap-1">
              <span
                v-for="tag in resource.tags"
                :key="tag"
                class="border border-neon-deep/30 bg-void px-2 py-0.5 font-mono text-[10px] text-neon-muted"
              >
                #{{ tag }}
              </span>
            </div>
            <p v-if="resource.description" class="mt-3 line-clamp-2 font-mono text-xs leading-relaxed text-text-dim">
              {{ resource.description }}
            </p>
          </button>
        </div>
      </aside>

      <main class="min-h-[520px] border border-neon-muted/30 bg-void/35 p-4">
        <div v-if="!draft" class="grid h-full min-h-80 place-items-center text-center">
          <div class="grid gap-2">
            <p class="font-mono text-xs uppercase tracking-[0.3em] text-neon-muted">NO SELECTION</p>
            <p class="font-mono text-sm text-text-dim">选择左侧资源，或创建一个新资源。</p>
          </div>
        </div>

        <form v-else class="grid gap-4" @submit.prevent="saveDraft">
          <div class="flex flex-col gap-3 border-b border-neon-muted/30 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p class="font-mono text-xs uppercase tracking-[0.3em] text-neon-muted">
                EDIT // {{ activeTab.code }}
              </p>
              <p class="mt-1 break-all font-mono text-[11px] text-text-dim">
                {{ draft.id || "NEW RESOURCE" }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="submit"
                class="border border-neon bg-neon/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-neon transition-colors hover:bg-neon/20 disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!canSave"
              >
                保存资源
              </button>
              <button
                type="button"
                class="border border-danger/50 bg-danger/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-danger transition-colors hover:bg-danger/20"
                @click="prepareDelete"
              >
                删除资源
              </button>
            </div>
          </div>

          <p v-if="statusMessage" class="border border-neon-deep/30 bg-panel px-3 py-2 font-mono text-xs text-neon-muted">
            {{ statusMessage }}
          </p>
          <p v-if="deleteBlockMessage" role="alert" class="border border-danger/50 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
            {{ deleteBlockMessage }}
          </p>

          <div class="grid gap-4 lg:grid-cols-2">
            <label class="grid gap-2 font-mono text-xs uppercase tracking-wider text-text-dim">
              名称 name
              <input
                v-model="draft.name"
                type="text"
                class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
                required
              />
            </label>
            <label class="grid gap-2 font-mono text-xs uppercase tracking-wider text-text-dim">
              标签 tagsText（逗号分隔）
              <input
                v-model="draft.tagsText"
                type="text"
                class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
                placeholder="core, builtin, draft"
              />
            </label>
          </div>

          <label class="grid gap-2 font-mono text-xs uppercase tracking-wider text-text-dim">
            描述 description
            <textarea
              v-model="draft.description"
              rows="3"
              class="resize-y border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
            />
          </label>

          <!-- Prompt Preset: preview + open editor -->
          <template v-if="activeTabId === 'prompt-presets'">
            <div class="grid gap-3 font-mono text-xs uppercase tracking-wider text-text-dim">
              提示词条目 prompts
              <div class="grid gap-3 border border-neon-muted/30 bg-panel p-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p class="font-mono text-sm font-bold uppercase tracking-wider text-text-main">
                      {{ (draftPreset?.prompts?.length ?? 0) }} ENTRIES
                    </p>
                    <p class="mt-1 font-mono text-[11px] normal-case tracking-normal text-text-dim">
                      在全屏编辑器中管理条目；保存仍使用页面右上角"保存资源"。
                    </p>
                  </div>
                  <button
                    type="button"
                    class="border border-neon bg-neon/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-neon transition-colors hover:bg-neon/20"
                    @click="presetEditorOpen = true"
                  >
                    打开全屏编辑器
                  </button>
                </div>
                <div class="max-h-[clamp(400px,50vh,600px)] overflow-y-auto border border-neon-deep/30 bg-void/40 p-3">
                  <PromptPresetPreview
                    v-if="draftPreset"
                    :preset="draftPreset"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- World Book: preview + open editor -->
          <template v-if="activeTabId === 'world-books'">
            <div class="grid gap-3 font-mono text-xs uppercase tracking-wider text-text-dim">
              世界书条目 entries
              <div class="grid gap-3 border border-neon-muted/30 bg-panel p-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p class="font-mono text-sm font-bold uppercase tracking-wider text-text-main">
                      {{ (draftWorldBook?.entries?.length ?? 0) }} ENTRIES
                    </p>
                    <p class="mt-1 font-mono text-[11px] normal-case tracking-normal text-text-dim">
                      在全屏编辑器中管理条目；保存仍使用页面右上角"保存资源"。
                    </p>
                  </div>
                  <button
                    type="button"
                    class="border border-neon bg-neon/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-neon transition-colors hover:bg-neon/20"
                    @click="worldBookEditorOpen = true"
                  >
                    打开全屏编辑器
                  </button>
                </div>
                <div class="max-h-[clamp(400px,50vh,600px)] overflow-y-auto border border-neon-deep/30 bg-void/40 p-3">
                  <WorldBookPreview
                    v-if="draftWorldBook"
                    :world-book="draftWorldBook"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- Workflow Preset: preview + open editor -->
          <template v-if="activeTabId === 'workflow-presets'">
            <div class="grid gap-3 font-mono text-xs uppercase tracking-wider text-text-dim">
              工作流定义 definition
              <div class="grid gap-3 border border-neon-muted/30 bg-panel p-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p class="font-mono text-sm font-bold uppercase tracking-wider text-text-main">
                      {{ draft.definition.nodes.length }} NODES // {{ draft.definition.edges.length }} EDGES
                    </p>
                    <p class="mt-1 font-mono text-[11px] normal-case tracking-normal text-text-dim">
                      在全屏编辑器中修改工作流；保存仍使用页面右上角"保存资源"。
                    </p>
                  </div>
                  <button
                    type="button"
                    class="border border-neon bg-neon/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-neon transition-colors hover:bg-neon/20"
                    @click="openWorkflowEditor"
                  >
                    打开全屏编辑器
                  </button>
                </div>
                <div class="h-[clamp(640px,72vh,860px)] min-h-[640px] overflow-hidden border border-neon-deep/30 bg-void/40">
                  <WorkflowEditorCanvas
                    :key="`preview-${workflowCanvasKey}`"
                    readonly
                    :initial-definition="draft.definition"
                    save-status="saved"
                    source-label="资源库工作流预览"
                  />
                </div>
              </div>
            </div>
          </template>

          <div
            v-if="deleteConfirming"
            role="alertdialog"
            aria-label="删除确认"
            class="border border-danger/60 bg-danger/10 p-4"
          >
            <p class="font-mono text-sm font-bold uppercase tracking-wider text-danger">
              确认删除：{{ draft.name || draft.id }}
            </p>
            <p class="mt-2 font-mono text-xs leading-relaxed text-text-dim">
              删除后不可恢复。请再次点击确认删除，或取消操作。
            </p>
            <ul v-if="deleteReferences.length > 0" class="mt-3 list-inside list-disc font-mono text-xs text-danger">
              <li v-for="ref in deleteReferences" :key="ref.id">{{ ref.name }} // {{ ref.id }}</li>
            </ul>
            <div class="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                class="border border-danger bg-danger/20 px-4 py-2 font-mono text-xs uppercase tracking-wider text-danger transition-colors hover:bg-danger/30"
                @click="confirmDelete"
              >
                确认删除
              </button>
              <button
                type="button"
                class="border border-neon-muted/40 bg-panel px-4 py-2 font-mono text-xs uppercase tracking-wider text-text-main transition-colors hover:border-neon-muted"
                @click="cancelDelete"
              >
                取消删除
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>

    <div
      v-if="workflowEditorOpen && draft && activeTabId === 'workflow-presets'"
      class="fixed inset-0 z-50 flex flex-col bg-void/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="工作流预设全屏编辑器"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-neon-muted/30 bg-panel px-5 py-3">
        <div>
          <p class="font-mono text-xs uppercase tracking-[0.3em] text-neon-muted">WORKFLOW // FULLSCREEN EDITOR</p>
          <p class="mt-1 font-mono text-sm text-text-main">{{ draft.name || "未命名工作流预设" }}</p>
        </div>
        <button
          type="button"
          class="border border-neon-muted/40 bg-panel px-4 py-2 font-mono text-xs uppercase tracking-wider text-text-main transition-colors hover:border-neon hover:text-neon"
          @click="closeWorkflowEditor"
        >
          关闭编辑器
        </button>
      </div>
      <div class="min-h-0 flex-1">
        <WorkflowEditorCanvas
          :key="`editor-${workflowCanvasKey}`"
          :initial-definition="draft.definition"
          :save-status="workflowSaveStatus"
          source-label="资源库工作流预设"
          @change="updateWorkflowDefinition"
          @reset-workflow="resetWorkflowDraft"
        />
      </div>
    </div>
    <!-- Prompt Preset Fullscreen Editor -->
    <div
      v-if="presetEditorOpen && draft && activeTabId === 'prompt-presets' && draftPreset"
      class="fixed inset-0 z-50 flex flex-col bg-void/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="提示词预设全屏编辑器"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-neon-muted/30 bg-panel px-5 py-3">
        <div>
          <p class="font-mono text-xs uppercase tracking-[0.3em] text-neon-muted">PROMPT PRESET // FULLSCREEN EDITOR</p>
          <p class="mt-1 font-mono text-sm text-text-main">{{ draft.name || "未命名提示词预设" }}</p>
        </div>
        <button
          type="button"
          class="border border-neon-muted/40 bg-panel px-4 py-2 font-mono text-xs uppercase tracking-wider text-text-main transition-colors hover:border-neon hover:text-neon"
          @click="presetEditorOpen = false"
        >
          关闭编辑器
        </button>
      </div>
      <div class="min-h-0 flex-1">
        <PromptPresetEditor
          :preset="draftPreset"
          @change="updatePresetFromEditor"
        />
      </div>
    </div>

    <!-- World Book Fullscreen Editor -->
    <div
      v-if="worldBookEditorOpen && draft && activeTabId === 'world-books' && draftWorldBook"
      class="fixed inset-0 z-50 flex flex-col bg-void/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="世界书全屏编辑器"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-neon-muted/30 bg-panel px-5 py-3">
        <div>
          <p class="font-mono text-xs uppercase tracking-[0.3em] text-neon-muted">WORLD BOOK // FULLSCREEN EDITOR</p>
          <p class="mt-1 font-mono text-sm text-text-main">{{ draft.name || "未命名世界书" }}</p>
        </div>
        <button
          type="button"
          class="border border-neon-muted/40 bg-panel px-4 py-2 font-mono text-xs uppercase tracking-wider text-text-main transition-colors hover:border-neon hover:text-neon"
          @click="worldBookEditorOpen = false"
        >
          关闭编辑器
        </button>
      </div>
      <div class="min-h-0 flex-1">
        <WorldBookEditor
          :world-book="draftWorldBook"
          @change="updateWorldBookFromEditor"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import type { WorkflowDefinition, PromptPreset, WorldBook } from "@tsian/contracts"
import { Badge } from "@/components/ui/badge"
import WorkflowEditorCanvas from "@/components/workflow/WorkflowEditorCanvas.vue"
import PromptPresetPreview from "@/components/resource-library/PromptPresetPreview.vue"
import WorldBookPreview from "@/components/resource-library/WorldBookPreview.vue"
import PromptPresetEditor from "@/components/resource-library/PromptPresetEditor.vue"
import WorldBookEditor from "@/components/resource-library/WorldBookEditor.vue"
import {
  deletePromptPresetResource,
  deleteWorkflowPresetResource,
  deleteWorldBookResource,
  findWorkflowPresetReferencesToPromptPreset,
  findWorkflowPresetReferencesToWorldBook,
  listPromptPresetResources,
  listWorkflowPresetResources,
  listWorldBookResources,
  seedBuiltinResourceLibraryResources,
  upsertPromptPresetResource,
  upsertWorkflowPresetResource,
  upsertWorldBookResource,
} from "@/storage/resources"

type ResourceTabId = "prompt-presets" | "world-books" | "workflow-presets"
type SaveStatus = "saved" | "dirty" | "saving" | "error"

interface ResourceTab {
  id: ResourceTabId
  label: string
  code: string
  description: string
  itemCount: number
}

interface ResourceSummary {
  id: string
  name: string
  description?: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

interface JsonResource extends ResourceSummary {
  preset?: PromptPreset
  worldBook?: WorldBook
}

interface WorkflowResource extends ResourceSummary {
  workflow: WorkflowDefinition
}

type Draft = {
  id?: string
  name: string
  description: string
  tagsText: string
  preset: PromptPreset
  worldBook: WorldBook
  definition: WorkflowDefinition
}

const emptyDefinition = (): WorkflowDefinition => ({ nodes: [], edges: [] })

const emptyPreset = (name = ""): PromptPreset => ({
  name,
  prompts: [],
  utilityPrompts: {},
  regexScripts: [],
  other: {},
})

const emptyWorldBook = (name = ""): WorldBook => ({
  name,
  entries: [],
})

const activeTabId = ref<ResourceTabId>("prompt-presets")
const promptPresets = ref<JsonResource[]>([])
const worldBooks = ref<JsonResource[]>([])
const workflowPresets = ref<WorkflowResource[]>([])
const selectedResourceId = ref<string | null>(null)
const draft = ref<Draft | null>(null)
const statusMessage = ref("")
const deleteConfirming = ref(false)
const deleteReferences = ref<ResourceSummary[]>([])
const deleteBlockMessage = ref("")
const workflowSaveStatus = ref<SaveStatus>("saved")
const workflowCanvasKey = ref(0)
const workflowEditorOpen = ref(false)
const presetEditorOpen = ref(false)
const worldBookEditorOpen = ref(false)

const resourceTabs = computed<ResourceTab[]>(() => [
  {
    id: "prompt-presets",
    label: "提示词预设",
    code: "PROMPT_PRESETS",
    description: "用于管理可复用的系统提示词、正文提示词与维护提示词预设。",
    itemCount: promptPresets.value.length,
  },
  {
    id: "world-books",
    label: "世界书",
    code: "WORLD_BOOKS",
    description: "用于管理跨模组复用的世界观条目、术语与设定片段。",
    itemCount: worldBooks.value.length,
  },
  {
    id: "workflow-presets",
    label: "工作流预设",
    code: "WORKFLOW_PRESETS",
    description: "用于管理可复用的 AI 主链 DAG 模板与节点编排预设。",
    itemCount: workflowPresets.value.length,
  },
])

const activeTab = computed(() => resourceTabs.value.find((tab) => tab.id === activeTabId.value)!)

const activeResources = computed<ResourceSummary[]>(() => {
  if (activeTabId.value === "prompt-presets") return promptPresets.value
  if (activeTabId.value === "world-books") return worldBooks.value
  return workflowPresets.value
})

const draftPreset = computed<PromptPreset | null>(() => draft.value?.preset ?? null)
const draftWorldBook = computed<WorldBook | null>(() => draft.value?.worldBook ?? null)

const canSave = computed(() => {
  if (!draft.value?.name.trim()) return false
  return workflowSaveStatus.value !== "saving"
})

onMounted(() => {
  void reloadResources()
})

watch(activeTabId, () => {
  selectedResourceId.value = null
  draft.value = null
  workflowEditorOpen.value = false
  presetEditorOpen.value = false
  worldBookEditorOpen.value = false
  resetDeleteState()
  statusMessage.value = ""
})

async function reloadResources() {
  await seedBuiltinResourceLibraryResources()
  const [promptRows, worldBookRows, workflowRows] = await Promise.all([
    listPromptPresetResources(),
    listWorldBookResources(),
    listWorkflowPresetResources(),
  ])
  promptPresets.value = promptRows
  worldBooks.value = worldBookRows
  workflowPresets.value = workflowRows
}

function selectTab(tabId: ResourceTabId) {
  activeTabId.value = tabId
}

function selectResource(id: string) {
  const resource = activeResources.value.find((item) => item.id === id)
  if (!resource) return
  selectedResourceId.value = id
  resetDeleteState()
  statusMessage.value = ""

  if (activeTabId.value === "workflow-presets") {
    const workflow = resource as WorkflowResource
    draft.value = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? "",
      tagsText: workflow.tags.join(", "),
      preset: emptyPreset(),
      worldBook: emptyWorldBook(),
      definition: workflow.workflow ?? emptyDefinition(),
    }
    workflowSaveStatus.value = "saved"
    workflowCanvasKey.value += 1
    return
  }

  const jsonResource = resource as JsonResource
  const presetPayload = activeTabId.value === "prompt-presets"
    ? (jsonResource.preset ?? emptyPreset(jsonResource.name))
    : emptyPreset()
  const worldBookPayload = activeTabId.value === "world-books"
    ? (jsonResource.worldBook ?? emptyWorldBook(jsonResource.name))
    : emptyWorldBook()

  draft.value = {
    id: jsonResource.id,
    name: jsonResource.name,
    description: jsonResource.description ?? "",
    tagsText: jsonResource.tags.join(", "),
    preset: presetPayload,
    worldBook: worldBookPayload,
    definition: emptyDefinition(),
  }
  workflowSaveStatus.value = "saved"
}

function createDraft() {
  selectedResourceId.value = null
  resetDeleteState()
  statusMessage.value = ""
  const name = `未命名${activeTab.value.label}`
  draft.value = {
    name,
    description: "",
    tagsText: "",
    preset: emptyPreset(name),
    worldBook: emptyWorldBook(name),
    definition: emptyDefinition(),
  }
  // Mark as dirty so create flow knows there's unsaved work
  workflowSaveStatus.value = "dirty"
  workflowCanvasKey.value += 1
}

function parseTags(tagsText: string) {
  return Array.from(new Set(tagsText.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean)))
}

async function saveDraft() {
  if (!draft.value || !canSave.value) return
  workflowSaveStatus.value = "saving"
  statusMessage.value = "正在保存资源……"

  try {
    const baseInput = {
      id: draft.value.id,
      name: draft.value.name.trim(),
      description: draft.value.description.trim(),
      tags: parseTags(draft.value.tagsText),
    }

    if (activeTabId.value === "prompt-presets") {
      const saved = await upsertPromptPresetResource({
        ...baseInput,
        preset: draft.value.preset,
      })
      selectedResourceId.value = saved.id
    } else if (activeTabId.value === "world-books") {
      const saved = await upsertWorldBookResource({
        ...baseInput,
        worldBook: draft.value.worldBook,
      })
      selectedResourceId.value = saved.id
    } else {
      const saved = await upsertWorkflowPresetResource({
        ...baseInput,
        workflow: draft.value.definition,
      })
      selectedResourceId.value = saved.id
    }

    await reloadResources()
    if (selectedResourceId.value) selectResource(selectedResourceId.value)
    statusMessage.value = "资源已保存。"
    workflowSaveStatus.value = "saved"
  } catch (error) {
    workflowSaveStatus.value = "error"
    statusMessage.value = `保存失败：${error instanceof Error ? error.message : String(error)}`
  }
}

function updatePresetFromEditor(updated: PromptPreset) {
  if (!draft.value || activeTabId.value !== "prompt-presets") return
  draft.value.preset = updated
  workflowSaveStatus.value = "dirty"
}

function updateWorldBookFromEditor(updated: WorldBook) {
  if (!draft.value || activeTabId.value !== "world-books") return
  draft.value.worldBook = updated
  workflowSaveStatus.value = "dirty"
}

function openWorkflowEditor() {
  workflowEditorOpen.value = true
}

function closeWorkflowEditor() {
  workflowEditorOpen.value = false
}

function updateWorkflowDefinition(definition: WorkflowDefinition) {
  if (!draft.value || activeTabId.value !== "workflow-presets") return
  draft.value.definition = definition
  workflowSaveStatus.value = "dirty"
}

function resetWorkflowDraft() {
  if (!draft.value?.id) {
    if (draft.value) {
      draft.value.definition = emptyDefinition()
    }
    workflowCanvasKey.value += 1
    workflowSaveStatus.value = "dirty"
    return
  }
  selectResource(draft.value.id)
}

async function prepareDelete() {
  if (!draft.value?.id) {
    draft.value = null
    statusMessage.value = "新建草稿已丢弃。"
    return
  }

  resetDeleteState()
  if (activeTabId.value === "prompt-presets") {
    deleteReferences.value = await findWorkflowPresetReferencesToPromptPreset(draft.value.id) as ResourceSummary[]
  } else if (activeTabId.value === "world-books") {
    deleteReferences.value = await findWorkflowPresetReferencesToWorldBook(draft.value.id) as ResourceSummary[]
  }

  if (deleteReferences.value.length > 0) {
    deleteBlockMessage.value = `该资源正被 ${deleteReferences.value.length} 个工作流预设引用，不能删除。`
    return
  }

  deleteConfirming.value = true
}

async function confirmDelete() {
  if (!draft.value?.id || !deleteConfirming.value) return
  const id = draft.value.id

  if (activeTabId.value === "prompt-presets") await deletePromptPresetResource(id)
  else if (activeTabId.value === "world-books") await deleteWorldBookResource(id)
  else await deleteWorkflowPresetResource(id)

  await reloadResources()
  selectedResourceId.value = null
  draft.value = null
  workflowEditorOpen.value = false
  presetEditorOpen.value = false
  worldBookEditorOpen.value = false
  resetDeleteState()
  statusMessage.value = "资源已删除。"
}

function cancelDelete() {
  resetDeleteState()
}

function resetDeleteState() {
  deleteConfirming.value = false
  deleteReferences.value = []
  deleteBlockMessage.value = ""
}

function formatDate(value: number): string {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
</script>
