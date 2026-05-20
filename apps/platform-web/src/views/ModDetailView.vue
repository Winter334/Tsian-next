<template>
  <!-- 模组详情：当前模组的存档管理、资源与工作流入口 -->
  <section class="flex h-full flex-col overflow-hidden">
    <Button
      variant="ghost"
      class="mb-5 w-fit px-0 font-mono text-xs tracking-wider text-neon hover:bg-transparent hover:text-text-main hover:glow-text"
      @click="goModLibrary"
    >
      ← 返回模组库
    </Button>

    <div v-if="currentMod" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header class="mb-5 border-b border-neon-muted/30 pb-5">
        <div class="grid gap-2">
          <p class="font-mono text-xs uppercase tracking-[0.35em] text-neon-muted">
            SYS.MOD // DETAIL
          </p>
          <h2 class="text-3xl font-black uppercase tracking-widest text-text-main md:text-4xl">
            {{ currentMod.name }}
          </h2>
          <p class="max-w-3xl font-mono text-sm leading-relaxed text-text-dim">
            在这里管理当前模组的信息、工作流、实体档案与预设事件；真正进入游戏后，不再保留平台壳 UI。
          </p>
        </div>
      </header>

      <div class="flex flex-wrap gap-2 border-b border-neon-muted/30">
        <button
          v-for="tab in detailTabs"
          :key="tab.id"
          type="button"
          class="border-x border-t px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors"
          :class="activeTabId === tab.id
            ? 'border-neon bg-neon/10 text-neon glow-box'
            : 'border-neon-muted/30 bg-panel text-text-dim hover:border-neon-muted hover:text-text-main'"
          @click="activeTabId = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="min-h-0 flex-1 border-x border-b border-neon-muted/30 bg-panel/30">
        <div v-if="activeTabId === 'info'" class="h-full overflow-y-auto p-5">
          <div class="grid gap-6">
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <!-- Hero card: mod info -->
              <Card class="rounded-none border-neon-deep/40 bg-elevated">
                <CardHeader class="pb-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="mb-1 font-mono text-xs uppercase tracking-wider text-neon-muted">
                        {{ currentMod.id }}
                      </p>
                      <CardTitle class="text-xl text-text-main">{{ currentMod.name }}</CardTitle>
                    </div>
                    <Badge
                      variant="outline"
                      class="shrink-0 rounded-none border-neon-deep/60 font-mono text-neon-deep"
                    >
                      v{{ currentMod.version }}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent class="grid gap-3 pt-0">
                  <p class="leading-normal text-text-dim">
                    {{ currentMod.description || "当前模组未提供描述。" }}
                  </p>
                  <div class="grid gap-1.5">
                    <span class="font-mono text-sm text-text-dim">该模组存档：{{ currentModSaves.length }}</span>
                    <span class="font-mono text-sm text-text-dim">实体类型：{{ currentMod.entityTypeCount }}</span>
                    <span class="font-mono text-sm text-text-dim">预设档案：{{ currentMod.archiveCount }}</span>
                    <span class="font-mono text-sm text-text-dim">预设事件：{{ currentMod.eventCount }}</span>
                  </div>
                </CardContent>
              </Card>

              <!-- Config status card -->
              <Card class="rounded-none border-neon-deep/40 bg-panel">
                <CardHeader class="pb-3">
                  <div>
                    <p class="mb-1 font-mono text-xs uppercase tracking-wider text-neon-muted">
                      平台配置
                    </p>
                    <CardTitle class="text-xl text-text-main">当前状态</CardTitle>
                  </div>
                </CardHeader>

                <CardContent class="grid gap-3 pt-0">
                  <div class="grid gap-1.5">
                    <span class="font-mono text-sm text-text-dim">聊天模型：{{ chatModelSummary }}</span>
                    <span class="font-mono text-sm text-text-dim">检索模型：{{ retrievalModelSummary }}</span>
                    <span class="font-mono text-sm text-text-dim">嵌入模型：{{ embeddingModelSummary }}</span>
                    <span class="font-mono text-sm text-text-dim">检索增强：{{ retrievalEnhancedSummary }}</span>
                  </div>
                </CardContent>

                <CardFooter>
                  <Button
                    variant="outline"
                    class="border-neon-deep bg-neon/5 font-mono tracking-wide text-neon transition-all hover:bg-neon/15 hover:shadow-neon-glow"
                    @click="goSettings"
                  >
                    打开平台设置
                  </Button>
                </CardFooter>
              </Card>
            </div>

            <!-- Section header: saves -->
            <div class="flex items-end justify-between gap-3">
              <div>
                <p class="font-mono text-xs uppercase tracking-wider text-neon glow-text">
                  存档
                </p>
                <h3 class="text-xl font-bold text-text-main">当前模组存档</h3>
              </div>
              <Button
                variant="outline"
                class="border-neon bg-neon/5 font-mono tracking-wide text-neon transition-all hover:bg-neon/15 hover:shadow-neon-glow"
                @click="handleCreateSave"
              >
                开始新游戏
              </Button>
            </div>

            <!-- Save cards grid -->
            <div v-if="currentModSaves.length > 0" class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card
                v-for="save in currentModSaves"
                :key="save.id"
                class="cursor-pointer rounded-none transition-colors"
                :class="save.id === selectedSaveId
                  ? 'bg-panel border-neon glow-box'
                  : 'bg-panel border-neon-deep/40 hover:border-neon-deep/70'"
                @click="selectedSaveId = save.id"
              >
                <CardHeader class="pb-2">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle class="text-lg text-text-main">{{ save.name }}</CardTitle>
                      <p class="mt-1 text-xs text-text-dim">
                        {{ formatDateTime(save.updatedAt) }}
                      </p>
                    </div>
                    <Badge
                      v-if="save.id === activeSaveId"
                      class="shrink-0 rounded-none border-neon/30 bg-neon/10 text-neon"
                    >
                      当前激活
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent class="pb-3 pt-0">
                  <p class="text-xs text-text-dim">创建时间：{{ formatDateTime(save.createdAt) }}</p>
                </CardContent>

                <CardFooter class="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    class="border-neon-deep bg-neon/5 font-mono tracking-wide text-neon transition-all hover:bg-neon/15 hover:shadow-neon-glow"
                    @click.stop="handleContinueSave(save.id)"
                  >
                    继续游戏
                  </Button>
                  <Button
                    variant="outline"
                    class="border-danger/40 font-mono tracking-wide text-danger transition-colors hover:bg-danger/10"
                    @click.stop="handleDeleteSave(save.id)"
                  >
                    删除存档
                  </Button>
                </CardFooter>
              </Card>
            </div>

            <!-- Empty state: no saves -->
            <Card v-else class="rounded-none border-neon-deep/40 bg-panel">
              <CardContent class="py-8 text-center">
                <h4 class="mb-2 text-lg font-bold text-text-main">当前模组还没有存档</h4>
                <p class="text-text-dim">点击“开始新游戏”后，平台会先创建一个绑定当前模组的新存档，再进入游戏页。</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div v-else-if="activeTabId === 'workflow'" class="h-full overflow-hidden">
          <WorkflowEditorCanvas
            :initial-definition="currentModWorkflow"
            :save-status="workflowSaveStatus"
            :source-label="workflowSourceLabel"
            @change="handleWorkflowChange"
            @save-workflow="handleSaveWorkflowDraft"
            @reset-workflow="handleResetWorkflowDraft"
          />
        </div>

        <div v-else-if="activeTabId === 'archives'" class="grid h-full place-items-center p-6">
          <EmptyTabSkeleton
            code="ARCHIVES"
            title="实体档案"
            description="当前批次仅保留模组级实体档案入口，占位等待后续接入资源编辑能力。"
          />
        </div>

        <div v-else class="grid h-full place-items-center p-6">
          <EmptyTabSkeleton
            code="EVENTS"
            title="预设事件"
            description="当前批次仅保留模组级预设事件入口，占位等待后续接入事件编排能力。"
          />
        </div>
      </div>
    </div>

    <!-- Empty state: no mod matched -->
    <Card v-else class="rounded-none border-neon-deep/40 bg-panel">
      <CardContent class="py-8 text-center">
        <h4 class="mb-2 text-lg font-bold text-text-main">未找到该模组</h4>
        <p class="mb-5 text-text-dim">当前地址指向的模组不存在，请返回模组库重新选择。</p>
        <Button
          variant="outline"
          class="border-neon-deep bg-neon/5 font-mono tracking-wide text-neon transition-all hover:bg-neon/15 hover:shadow-neon-glow"
          @click="goModLibrary"
        >
          返回模组库
        </Button>
      </CardContent>
    </Card>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent, WorkflowDefinition } from "@tsian/contracts"
import { computed, defineComponent, h, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  type BrowserAiConfig,
  type BrowserEmbeddingConfig,
  getBrowserAiConfig,
  getBrowserEmbeddingConfig,
  getBrowserRetrievalConfig,
  getBrowserRetrievalSettings,
} from "../config/ai"
import {
  createPlatformSave,
  deletePlatformSave,
  getPlatformActiveSaveId,
  listPlatformSaves,
  playFrontendBridge,
  selectPlatformSave,
} from "../platform-host"
import WorkflowEditorCanvas from "../components/workflow/WorkflowEditorCanvas.vue"
import {
  deleteWorkflowDraft,
  getWorkflowDraft,
  saveWorkflowDraft,
} from "../storage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

type DetailTabId = "info" | "workflow" | "archives" | "events"
type WorkflowSaveStatus = "saved" | "dirty" | "saving" | "error"
type WorkflowSource = "builtin" | "draft"

interface DetailTab {
  id: DetailTabId
  label: string
}

interface SaveOption {
  id: string
  name: string
  modId: string
  createdAt: number
  updatedAt: number
}

interface BuiltinModSummary {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  entityTypeCount: number
  archiveCount: number
  eventCount: number
  workflow?: WorkflowDefinition
}

const detailTabs: DetailTab[] = [
  { id: "info", label: "信息" },
  { id: "workflow", label: "工作流" },
  { id: "archives", label: "实体档案" },
  { id: "events", label: "预设事件" },
]

const EmptyTabSkeleton = defineComponent({
  props: {
    code: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
  },
  setup(props) {
    return () => h("div", { class: "grid max-w-xl gap-3 border border-dashed border-neon-muted/30 bg-void/35 p-8 text-center" }, [
      h("p", { class: "font-mono text-xs uppercase tracking-[0.3em] text-neon-muted" }, `EMPTY // ${props.code}`),
      h("h3", { class: "text-2xl font-black uppercase tracking-widest text-text-main" }, props.title),
      h("p", { class: "font-mono text-sm leading-relaxed text-text-dim" }, props.description),
      h("div", { class: "mx-auto mt-3 w-fit border border-neon-muted/40 bg-elevated px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-neon-muted" }, "0 ITEMS // WAITING FOR DATA LINK"),
    ])
  },
})

const route = useRoute()
const router = useRouter()
const builtinMods = ref<BuiltinModSummary[]>([])
const saveOptions = ref<SaveOption[]>([])
const activeSaveId = ref("")
const selectedSaveId = ref("")
const currentMod = ref<BuiltinModSummary | null>(null)
const currentModSaves = ref<SaveOption[]>([])
const currentModWorkflow = ref<WorkflowDefinition | undefined>(undefined)
const chatModelSummary = ref("未配置")
const retrievalModelSummary = ref("未配置")
const embeddingModelSummary = ref("未配置")
const retrievalEnhancedSummary = ref("关闭")
const activeTabId = ref<DetailTabId>("info")
const workflowSaveStatus = ref<WorkflowSaveStatus>("saved")
const workflowSource = ref<WorkflowSource>("builtin")
const savedWorkflowJson = ref("")
const workflowSourceLabel = computed(() => workflowSource.value === "draft" ? "本地草稿" : "内置工作流")

function formatModelSummary(
  config: { baseUrl: string; model: string } | null,
): string {
  if (!config) {
    return "未配置"
  }
  return `${config.model} · ${config.baseUrl}`
}

function refreshConfigSummary() {
  const chat = getBrowserAiConfig() as BrowserAiConfig | null
  const retrieval = getBrowserRetrievalConfig() as BrowserAiConfig | null
  const embedding = getBrowserEmbeddingConfig() as BrowserEmbeddingConfig | null
  chatModelSummary.value = formatModelSummary(chat)
  retrievalModelSummary.value = formatModelSummary(retrieval)
  embeddingModelSummary.value = formatModelSummary(embedding)
  retrievalEnhancedSummary.value = getBrowserRetrievalSettings().aiEnhanced ? "开启" : "关闭"
}

function formatDateTime(input: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input)
}

function findBuiltinModById(modId: string): BuiltinModSummary | null {
  return builtinMods.value.find((mod) => mod.id === modId) ?? null
}

async function syncCurrentModContext(modId: string) {
  currentMod.value = findBuiltinModById(modId)
  currentModSaves.value = saveOptions.value.filter((save) => save.modId === modId)

  if (!currentMod.value) {
    currentModWorkflow.value = undefined
    workflowSource.value = "builtin"
    savedWorkflowJson.value = ""
    workflowSaveStatus.value = "saved"
    return
  }

  const draft = await getWorkflowDraft(modId)
  currentModWorkflow.value = draft?.definition ?? currentMod.value.workflow
  workflowSource.value = draft ? "draft" : "builtin"
  savedWorkflowJson.value = currentModWorkflow.value ? JSON.stringify(currentModWorkflow.value) : ""
  workflowSaveStatus.value = "saved"
}

function syncSelectedSaveForCurrentMod() {
  const saves = currentModSaves.value
  if (saves.some((save) => save.id === selectedSaveId.value)) {
    return
  }
  if (activeSaveId.value && saves.some((save) => save.id === activeSaveId.value)) {
    selectedSaveId.value = activeSaveId.value
    return
  }
  selectedSaveId.value = saves[0]?.id ?? ""
}

async function refreshBuiltinMods() {
  const result = await playFrontendBridge.query.query<ModStaticContent>({
    resource: "builtin-mods",
  })
  builtinMods.value = result.items.map((mod) => ({
    id: mod.manifest.id,
    name: mod.manifest.name,
    version: mod.manifest.version,
    author: mod.manifest.author,
    description: mod.manifest.description,
    entityTypeCount: mod.entityTypeDefinitions.length,
    archiveCount: mod.archiveCatalog.length,
    eventCount: mod.eventCatalog.length,
    workflow: mod.manifest.workflow,
  }))
}

async function refreshSaves() {
  saveOptions.value = (await listPlatformSaves()).map((save) => ({
    id: save.id,
    name: save.name,
    modId: save.modId,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
  }))
  activeSaveId.value = (await getPlatformActiveSaveId()) ?? ""
}

function currentModIdFromRoute(): string {
  const raw = route.params.id
  if (typeof raw === "string" && raw.length > 0) {
    return raw
  }
  return ""
}

async function handleCreateSave() {
  if (!currentMod.value) {
    return
  }
  const created = await createPlatformSave({ modId: currentMod.value.id })
  await refreshSaves()
  await syncCurrentModContext(currentMod.value.id)
  selectedSaveId.value = created.id
  router.push("/play")
}

async function handleContinueSave(saveId: string) {
  await selectPlatformSave(saveId)
  await refreshSaves()
  router.push("/play")
}

async function handleDeleteSave(saveId: string) {
  await deletePlatformSave(saveId)
  await refreshSaves()
  if (currentMod.value) {
    await syncCurrentModContext(currentMod.value.id)
    syncSelectedSaveForCurrentMod()
  }
}

function handleWorkflowChange(definition: WorkflowDefinition) {
  currentModWorkflow.value = definition
  const definitionJson = JSON.stringify(definition)
  if (definitionJson !== savedWorkflowJson.value) {
    workflowSaveStatus.value = "dirty"
  } else if (workflowSaveStatus.value !== "saving") {
    workflowSaveStatus.value = "saved"
  }
}

async function handleSaveWorkflowDraft(definition: WorkflowDefinition) {
  if (!currentMod.value) {
    return
  }

  workflowSaveStatus.value = "saving"
  try {
    const draft = await saveWorkflowDraft(currentMod.value.id, definition)
    currentModWorkflow.value = draft.definition
    workflowSource.value = "draft"
    savedWorkflowJson.value = JSON.stringify(draft.definition)
    workflowSaveStatus.value = "saved"
  } catch {
    workflowSaveStatus.value = "error"
  }
}

async function handleResetWorkflowDraft() {
  if (!currentMod.value) {
    return
  }

  await deleteWorkflowDraft(currentMod.value.id)
  currentModWorkflow.value = currentMod.value.workflow
  workflowSource.value = "builtin"
  savedWorkflowJson.value = currentModWorkflow.value ? JSON.stringify(currentModWorkflow.value) : ""
  workflowSaveStatus.value = "saved"
}

function goSettings() {
  router.push("/settings")
}

function goModLibrary() {
  router.push("/mod")
}

onMounted(async () => {
  refreshConfigSummary()
  await refreshBuiltinMods()
  await refreshSaves()
  await syncCurrentModContext(currentModIdFromRoute())
  syncSelectedSaveForCurrentMod()
})

watch(
  () => route.params.id,
  async () => {
    await syncCurrentModContext(currentModIdFromRoute())
    syncSelectedSaveForCurrentMod()
  },
)
</script>
