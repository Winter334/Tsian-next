<template>
  <section class="market-view grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <div class="market-toolbar retro-toolbar border-b px-3 py-2">
      <div class="market-toolbar-primary flex min-w-0 flex-wrap items-center gap-2">
        <button
          v-if="screen.kind !== 'list'"
          type="button"
          class="retro-focus grid h-7 w-7 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          title="返回"
          @click="goBack"
        >
          <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="openUploadScreen"
        >
          <Upload class="h-3.5 w-3.5" aria-hidden="true" />
          上传资源
        </button>
        <select
          v-model="sortMode"
          class="retro-focus retro-select-surface min-w-[100px] border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
          @change="refresh"
        >
          <option value="newest">最新</option>
          <option value="downloads">下载量</option>
        </select>
      </div>
      <div class="market-toolbar-filters flex min-w-0 flex-wrap items-center gap-2">
        <MarketTagFilter class="market-tag-filter" v-model="tagQuery" @update:model-value="onTagInput" />
        <label class="market-search relative min-w-[220px]">
          <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neon-muted" aria-hidden="true" />
          <span class="sr-only">搜索创意工坊</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索创意工坊"
            class="retro-focus retro-select-surface h-7 w-full border border-neon-deep/55 bg-elevated pl-7 pr-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            @input="onSearchInput"
          />
        </label>
      </div>
    </div>

    <main class="market-content m-3 grid min-h-0 gap-3 overflow-auto">
      <MarketResourceTypeSidebar
        class="market-resource-sidebar"
        v-model="currentType"
        :options="resourceTypeOptions"
        :counts="resourceCounts"
        :scope="marketScope"
        @update:model-value="switchType"
        @toggle-scope="toggleMarketScope"
      />

      <div v-if="screen.kind === 'list'" class="market-compact-filters min-w-0 gap-2">
        <label class="min-w-0 flex-1">
          <span class="sr-only">资源类型</span>
          <select
            :value="currentType"
            class="retro-focus retro-select-surface h-8 w-full min-w-0 border border-neon-deep/45 bg-elevated px-2 font-mono text-xs text-text-main"
            @change="switchType(($event.target as HTMLSelectElement).value as MarketResourceType)"
          >
            <option v-for="option in resourceTypeOptions" :key="option.type" :value="option.type">
              {{ option.label }} · {{ resourceCounts[option.type] ?? 0 }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 shrink-0 items-center px-3 font-mono text-xs"
          @click="toggleMarketScope"
        >
          {{ marketScope === "mine" ? "全部资源" : "我的上传" }}
        </button>
      </div>

      <section class="market-result-pane retro-inset min-h-0 overflow-auto p-3">
        <div v-if="screen.kind === 'list'" class="grid gap-3">
          <div v-if="marketScope === 'mine' && !loggedIn" class="grid place-items-center py-12">
            <UserRound class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">登录后管理你发布到创意工坊的资源。</p>
            <button
              type="button"
              class="retro-button retro-focus mt-4 inline-flex h-9 items-center gap-2 px-4 font-mono text-xs"
              @click="openAccountCenter"
            >
              <UserRound class="h-3.5 w-3.5" aria-hidden="true" />
              打开账号中心
            </button>
          </div>
          <div v-else-if="loading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">加载中…</p>
          </div>
          <div v-else-if="packages.length === 0" class="grid place-items-center py-12">
            <Store class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">
              {{ emptyMessage }}
            </p>
          </div>
          <MarketPackageGrid v-else :packages="packages" @open="openDetail" />
          <div v-if="screen.kind === 'list' && packages.length > 0" class="flex justify-center py-2">
            <button
              v-if="nextCursor"
              type="button"
              class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-4 font-mono text-xs"
              :disabled="loadingMore"
              @click="loadMore"
            >
              {{ loadingMore ? "加载中…" : "加载更多" }}
            </button>
            <span v-else class="font-mono text-[11px] text-text-dim">已全部加载</span>
          </div>
        </div>

        <div v-else-if="screen.kind === 'detail'" class="grid gap-4">
          <div v-if="detailLoading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">加载中…</p>
          </div>
          <div v-else-if="!detailPackage" class="grid place-items-center py-12">
            <p class="text-sm text-text-dim">资源不存在或已被删除。</p>
          </div>
          <MarketPackageDetail
            v-else
            :pkg="detailPackage"
            :installing="installing"
            :can-manage="canManageDetail"
            :updating="updatingPackage"
            :deleting="deletingPackage"
            :replacement-label="replacementLabel"
            :replacement-defaults="replacementDefaults"
            :save-token="editSaveToken"
            @install="handleDownloadInstall"
            @start-edit="startEditPackage"
            @cancel-edit="clearReplacement"
            @select-replacement="openReplacementDialog"
            @clear-replacement="clearReplacement"
            @save-edit="handleSavePackageEdit"
            @delete="handleDeletePackage"
          />
        </div>

        <div v-else-if="screen.kind === 'upload'" class="grid gap-4">
          <div v-if="!loggedIn" class="grid place-items-center py-12">
            <UserRound class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">上传资源需要先登录。</p>
            <button
              type="button"
              class="retro-button retro-focus mt-4 inline-flex h-9 items-center gap-2 px-4 font-mono text-xs"
              @click="openAccountCenter"
            >
              <UserRound class="h-3.5 w-3.5" aria-hidden="true" />
              打开账号中心
            </button>
          </div>
          <MarketUploadPanel
            v-else
            :resource-types="resourceTypeOptions"
            :initial-type="currentType"
            :cards="uploadCards"
            :agent-options="agentUploadOptions"
            :skill-options="skillUploadOptions"
            :tool-options="toolUploadOptions"
            :loading="localResourcesLoading"
            :uploading="uploading"
            @prepare-upload="handlePrepareUpload"
          />
        </div>

        <p v-if="feedback" class="mt-4 border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
          {{ feedback }}
        </p>
        <p v-if="errorMessage" class="mt-4 border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {{ errorMessage }}
        </p>
      </section>
    </main>

    <MarketInstallDialog
      v-if="installDialog"
      :state="installDialog"
      @close="installDialog = null"
      @select="handleInstallTargetSelected"
    />

    <MarketReplacementDialog
      v-if="replacementDialogOpen && detailPackage"
      :pkg="detailPackage"
      :cards="uploadCards"
      :agent-options="agentUploadOptions"
      :skill-options="skillUploadOptions"
      :tool-options="toolUploadOptions"
      :loading="localResourcesLoading"
      @close="replacementDialogOpen = false"
      @select="handleReplacementSelected"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { ArrowLeft, Search, Store, Upload, UserRound } from "lucide-vue-next"
import type { MarketPackage, MarketResourceType, SkillRegistryEntry, ToolRegistryEntry, WorkspaceFile } from "@tsian/contracts"
import type { LocalGameCardView } from "@/storage/game-cards"
import { buildAgentRegistry, buildSkillRegistry, buildToolRegistry } from "@/agent-runtime/registry"
import { toast } from "@/composables/useToast"
import { confirm } from "@/composables/useConfirm"
import { openDialogForm } from "@/composables/useDialogForm"
import { getGameCardTitle } from "@/lib/game-card-display"
import { marketApi, type MarketListParams } from "@/platform-host/api-client"
import {
  exportAgentPackage,
  exportPlatformGameCardPackage,
  exportSkillPackage,
  exportToolPackage,
  getPlatformActiveGameCard,
  gameCardMarketOriginFromPackage,
  importPlatformGameCardPackage,
  inspectPlatformGameCardPackage,
  inspectResourcePackage,
  installAgentPackage,
  installSkillPackage,
  installToolPackage,
  listPlatformGameCards,
  listPlatformSaves,
  refreshWorkshopGameCardUpdates,
  updatePlatformGameCardMetadata,
} from "@/platform-host"
import {
  listLocalGameCardContentFiles,
  loadLocalAssistantFiles,
  LOCAL_ASSISTANT_AGENT_ID,
} from "@/storage"
import { useAuth } from "@/composables/useAuth"
import { desktopWindowForLauncher } from "@/desktop-apps"
import { useDesktopWindows } from "@/composables/useDesktopWindows"
import MarketInstallDialog from "@/components/market/MarketInstallDialog.vue"
import MarketPackageDetail from "@/components/market/MarketPackageDetail.vue"
import MarketPackageGrid from "@/components/market/MarketPackageGrid.vue"
import MarketReplacementDialog from "@/components/market/MarketReplacementDialog.vue"
import MarketResourceTypeSidebar from "@/components/market/MarketResourceTypeSidebar.vue"
import MarketTagFilter from "@/components/market/MarketTagFilter.vue"
import MarketUploadPanel from "@/components/market/MarketUploadPanel.vue"
import { resourceTypeOption } from "@/components/market/types"
import { resourceTypeVisuals } from "@/components/market/resource-type-visual"
import type {
  AgentUploadOption,
  MarketInstallDialogState,
  MarketInstallTargetOption,
  MarketResourceTypeOption,
  MarketUploadMetadata,
  MarketUploadSelectionPayload,
  MarketUploadSubmitPayload,
  SkillUploadOption,
  ToolUploadOption,
} from "@/components/market/types"

type MarketScope = "all" | "mine"

type ReplacementSelection = MarketUploadSelectionPayload

type Screen =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  | { kind: "upload" }

const router = useRouter()
const { currentUser, loggedIn } = useAuth()
const desktop = useDesktopWindows()

const resourceTypeOptions: MarketResourceTypeOption[] = [
  resourceTypeOption("game_card", resourceTypeVisuals.game_card, "完整卡包"),
  resourceTypeOption("agent", resourceTypeVisuals.agent, "角色与流程代理"),
  resourceTypeOption("skill", resourceTypeVisuals.skill, "可复用能力"),
  resourceTypeOption("tool", resourceTypeVisuals.tool, "原生函数工具"),
]

const screen = ref<Screen>({ kind: "list" })
const marketScope = ref<MarketScope>("all")
const currentType = ref<MarketResourceType>("game_card")
const packages = ref<MarketPackage[]>([])
const resourceCounts = ref<Partial<Record<MarketResourceType, number>>>({})
const loading = ref(false)
const loadingMore = ref(false)
const nextCursor = ref<string | null>(null)
const searchQuery = ref("")
const tagQuery = ref("")
const sortMode = ref<"newest" | "downloads">("newest")
const pageSize = 24
let listRequestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null
let tagTimer: ReturnType<typeof setTimeout> | null = null

const detailPackage = ref<MarketPackage | null>(null)
const detailLoading = ref(false)

const uploadCards = ref<LocalGameCardView[]>([])
const localCards = ref<LocalGameCardView[]>([])
const cardFilesById = ref<Record<string, WorkspaceFile[]>>({})
const assistantFiles = ref<WorkspaceFile[]>([])
const localResourcesLoading = ref(false)

const installing = ref(false)
const uploading = ref(false)
const feedback = ref("")
const errorMessage = ref("")
const pendingInstallBlob = ref<Blob | null>(null)
const installDialog = ref<MarketInstallDialogState | null>(null)

const updatingPackage = ref(false)
const deletingPackage = ref(false)
const replacementDialogOpen = ref(false)
const replacementSelection = ref<ReplacementSelection | null>(null)
const replacementDefaults = ref<MarketUploadMetadata | null>(null)
const replacementLabel = ref("")
const editSaveToken = ref(0)

const canManageDetail = computed(() => {
  return detailPackage.value?.uploader.id === currentUser.value?.id
})

const agentUploadOptions = computed<AgentUploadOption[]>(() => {
  const options: AgentUploadOption[] = []
  for (const card of localCards.value) {
    const files = cardFilesById.value[card.id] ?? []
    for (const agent of buildAgentRegistry(files)) {
      options.push({
        key: `card:${card.id}:${agent.id}`,
        label: `${agent.title} · ${card.manifest.name || card.id}`,
        summary: agent.summary,
        resourceId: agent.id,
        source: { kind: "card-agent", cardId: card.id, agentId: agent.id },
      })
    }
  }
  const assistant = buildAgentRegistry(assistantFiles.value).find((agent) => agent.id === LOCAL_ASSISTANT_AGENT_ID)
  if (assistant) {
    options.push({
      key: "assistant",
      label: `${assistant.title} · 桌面助手`,
      summary: assistant.summary,
      resourceId: assistant.id,
      source: { kind: "assistant" },
    })
  }
  return options
})

const skillUploadOptions = computed<SkillUploadOption[]>(() => {
  const options: SkillUploadOption[] = []
  for (const card of localCards.value) {
    const files = cardFilesById.value[card.id] ?? []
    for (const skill of buildSkillRegistry(files)) {
      options.push(skillUploadOptionFromRegistry(skill, card))
    }
  }
  for (const skill of buildSkillRegistry(assistantFiles.value, {
    includeShared: false,
    includeLocal: true,
    agentId: LOCAL_ASSISTANT_AGENT_ID,
  })) {
    options.push({
      key: `assistant:${skill.id}`,
      label: `${skill.title} · 桌面助手`,
      summary: skill.summary,
      resourceId: skill.id,
      source: { kind: "assistant-local", skillId: skill.id, skillPath: skill.path },
    })
  }
  return options
})

const toolUploadOptions = computed<ToolUploadOption[]>(() => {
  const options: ToolUploadOption[] = []
  for (const card of localCards.value) {
    const files = cardFilesById.value[card.id] ?? []
    for (const tool of buildToolRegistry(files).tools) {
      options.push(toolUploadOptionFromRegistry(tool, card))
    }
  }
  for (const tool of buildToolRegistry(assistantFiles.value).tools) {
    if (tool.scope !== "agent-local" || tool.agentId !== LOCAL_ASSISTANT_AGENT_ID || !tool.path.startsWith(".tsian/local/assistant/tools/")) {
      continue
    }
    options.push({
      key: `assistant:${tool.id}`,
      label: `${tool.title} · 桌面助手`,
      summary: tool.description,
      resourceId: tool.id,
      source: { kind: "assistant-local", toolId: tool.id, toolPath: tool.path },
    })
  }
  return options
})

const emptyMessage = computed(() => {
  if (marketScope.value === "mine") {
    if (searchQuery.value || tagQuery.value) {
      return "你的上传中没有匹配的资源。"
    }
    return "你还没有上传过这个类型的资源。"
  }
  if (searchQuery.value || tagQuery.value) {
    return "没有匹配的资源。"
  }
  switch (currentType.value) {
    case "agent":
      return "创意工坊还没有 Agent，成为第一个上传者吧。"
    case "skill":
      return "创意工坊还没有 Skill，成为第一个上传者吧。"
    case "tool":
      return "创意工坊还没有 Tool，成为第一个上传者吧。"
    case "game_card":
    default:
      return "创意工坊还没有游戏卡，成为第一个上传者吧。"
  }
})

onMounted(() => {
  refresh()
  refreshCounts()
})

async function refresh(): Promise<void> {
  const requestId = ++listRequestSeq
  loadingMore.value = false
  nextCursor.value = null
  errorMessage.value = ""
  if (marketScope.value === "mine" && !loggedIn.value) {
    packages.value = []
    resourceCounts.value = {}
    loading.value = false
    return
  }

  loading.value = true
  try {
    const result = marketScope.value === "mine"
      ? await marketApi.listMine(listParams())
      : await marketApi.list(listParams())
    if (requestId !== listRequestSeq) {
      return
    }
    packages.value = result.packages
    nextCursor.value = result.nextCursor
  } catch (error) {
    if (requestId === listRequestSeq) {
      errorMessage.value = error instanceof Error ? error.message : "加载创意工坊列表失败。"
    }
  } finally {
    if (requestId === listRequestSeq) {
      loading.value = false
    }
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value || loadingMore.value || (marketScope.value === "mine" && !loggedIn.value)) {
    return
  }
  const requestId = listRequestSeq
  loadingMore.value = true
  errorMessage.value = ""
  try {
    const result = marketScope.value === "mine"
      ? await marketApi.listMine(listParams(nextCursor.value))
      : await marketApi.list(listParams(nextCursor.value))
    if (requestId !== listRequestSeq) {
      return
    }
    packages.value = [...packages.value, ...result.packages]
    nextCursor.value = result.nextCursor
  } catch (error) {
    if (requestId === listRequestSeq) {
      errorMessage.value = error instanceof Error ? error.message : "加载更多资源失败。"
    }
  } finally {
    if (requestId === listRequestSeq) {
      loadingMore.value = false
    }
  }
}

function listParams(cursor?: string): MarketListParams {
  return {
    resourceType: currentType.value,
    q: searchQuery.value || undefined,
    tag: tagQuery.value || undefined,
    sort: sortMode.value,
    limit: pageSize,
    cursor,
  }
}

async function refreshCounts(): Promise<void> {
  if (marketScope.value === "mine" && !loggedIn.value) {
    resourceCounts.value = {}
    return
  }
  try {
    const result = marketScope.value === "mine"
      ? await marketApi.countsMine()
      : await marketApi.counts()
    resourceCounts.value = result.counts
  } catch {
    resourceCounts.value = {}
  }
}

function onSearchInput(): void {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => refresh(), 300)
}

function onTagInput(): void {
  if (tagTimer) {
    clearTimeout(tagTimer)
  }
  tagTimer = setTimeout(() => refresh(), 300)
}

function switchType(type: MarketResourceType): void {
  currentType.value = type
  detailPackage.value = null
  screen.value = { kind: "list" }
  refresh()
}

function toggleMarketScope(): void {
  marketScope.value = marketScope.value === "mine" ? "all" : "mine"
  detailPackage.value = null
  screen.value = { kind: "list" }
  refresh()
  refreshCounts()
}

function openDetail(id: string): void {
  screen.value = { kind: "detail", id }
  loadDetail(id)
}

async function loadDetail(id: string): Promise<void> {
  detailLoading.value = true
  detailPackage.value = null
  try {
    detailPackage.value = await marketApi.get(id)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载资源详情失败。"
  } finally {
    detailLoading.value = false
  }
}

function openUploadScreen(): void {
  feedback.value = ""
  errorMessage.value = ""
  screen.value = { kind: "upload" }
  if (loggedIn.value) {
    loadUploadResources()
  }
}

async function loadUploadResources(): Promise<void> {
  localResourcesLoading.value = true
  try {
    const allCards = (await listPlatformGameCards()).filter((card) => card.source !== "builtin")
    const activeCard = activeInstallTargetCards(await getPlatformActiveGameCard())
    const cardsToLoad = cardsById([...allCards, ...activeCard])
    const filesEntries = await Promise.all(cardsToLoad.map(async (card) => [
      card.id,
      (await listLocalGameCardContentFiles(card.id)).map(contentFileToWorkspaceFile),
    ] as const))
    uploadCards.value = allCards
    localCards.value = activeCard
    cardFilesById.value = Object.fromEntries(filesEntries)
    assistantFiles.value = await loadLocalAssistantFiles()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取本地资源失败。"
  } finally {
    localResourcesLoading.value = false
  }
}

async function loadInstallResources(): Promise<void> {
  localResourcesLoading.value = true
  try {
    const cards = activeInstallTargetCards(await getPlatformActiveGameCard())
    const filesEntries = await Promise.all(cards.map(async (card) => [
      card.id,
      (await listLocalGameCardContentFiles(card.id)).map(contentFileToWorkspaceFile),
    ] as const))
    localCards.value = cards
    cardFilesById.value = Object.fromEntries(filesEntries)
    assistantFiles.value = await loadLocalAssistantFiles()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取本地资源失败。"
  } finally {
    localResourcesLoading.value = false
  }
}

async function handlePrepareUpload(selection: MarketUploadSelectionPayload): Promise<void> {
  if (uploading.value) {
    return
  }
  const defaults = uploadMetadataDefaults(selection)
  const values = await openDialogForm({
    title: `上传资源：${defaults.title || uploadTypeLabel(selection.resourceType)}`,
    widthClass: "max-w-md",
    confirmText: "确认上传",
    fields: [
      { name: "title", label: "标题（可选）", type: "text", defaultValue: defaults.title ?? "", placeholder: "资源标题" },
      { name: "version", label: "版本", type: "text", defaultValue: defaults.version ?? "", placeholder: "0.1.0", mono: true },
      { name: "author", label: "作者（可选）", type: "text", defaultValue: defaults.author ?? "", placeholder: "作者名" },
      { name: "summary", label: "简介（可选）", type: "textarea", rows: 3, defaultValue: defaults.summary ?? "", placeholder: "资源简介" },
      { name: "tags", label: "Tags（可选，逗号分隔）", type: "text", defaultValue: defaults.tags ?? "", placeholder: "tool, narrative", mono: true },
    ],
  })
  if (!values) {
    return
  }
  const version = requireVersion(values.version)
  if (!version) {
    return
  }
  await handleUpload({
    ...selection,
    title: optionalFormValue(values.title),
    summary: optionalFormValue(values.summary),
    author: optionalFormValue(values.author),
    version,
    tags: optionalFormValue(values.tags),
  })
}

function uploadMetadataDefaults(selection: MarketUploadSelectionPayload): MarketUploadMetadata {
  if (selection.resourceType === "game_card") {
    const card = uploadCards.value.find((candidate) => candidate.id === selection.cardId)
    return {
      title: card?.manifest.name ?? "",
      summary: card?.manifest.summary ?? "",
      author: card?.manifest.author?.name ?? "",
      version: card?.manifest.version ?? "",
    }
  }
  if (selection.resourceType === "agent") {
    const option = agentUploadOptions.value.find((candidate) => sameAgentSource(candidate.source, selection.source))
    return {
      title: option?.label ?? "",
      summary: option?.summary ?? "",
      version: "0.1.0",
    }
  }
  if (selection.resourceType === "skill") {
    const option = skillUploadOptions.value.find((candidate) => sameSkillSource(candidate.source, selection.source))
    return {
      title: option?.label ?? "",
      summary: option?.summary ?? "",
      version: "0.1.0",
    }
  }
  const option = toolUploadOptions.value.find((candidate) => sameToolSource(candidate.source, selection.source))
  return {
    title: option?.label ?? "",
    summary: option?.summary ?? "",
    version: "0.1.0",
  }
}

function sameAgentSource(left: AgentUploadOption["source"], right: AgentUploadOption["source"]): boolean {
  switch (left.kind) {
    case "assistant":
      return right.kind === "assistant"
    case "card-agent":
      return right.kind === "card-agent" && left.cardId === right.cardId && left.agentId === right.agentId
  }
}

function sameSkillSource(left: SkillUploadOption["source"], right: SkillUploadOption["source"]): boolean {
  switch (left.kind) {
    case "assistant-local":
      return right.kind === "assistant-local" && left.skillId === right.skillId && left.skillPath === right.skillPath
    case "agent-local":
      return right.kind === "agent-local"
        && left.cardId === right.cardId
        && left.agentId === right.agentId
        && left.skillId === right.skillId
        && left.skillPath === right.skillPath
    case "card-shared":
      return right.kind === "card-shared"
        && left.cardId === right.cardId
        && left.skillId === right.skillId
        && left.skillPath === right.skillPath
  }
}

function sameToolSource(left: ToolUploadOption["source"], right: ToolUploadOption["source"]): boolean {
  switch (left.kind) {
    case "assistant-local":
      return right.kind === "assistant-local" && left.toolId === right.toolId && left.toolPath === right.toolPath
    case "agent-local":
      return right.kind === "agent-local"
        && left.cardId === right.cardId
        && left.agentId === right.agentId
        && left.toolId === right.toolId
        && left.toolPath === right.toolPath
    case "card-shared":
      return right.kind === "card-shared"
        && left.cardId === right.cardId
        && left.toolId === right.toolId
        && left.toolPath === right.toolPath
  }
}

function optionalFormValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  return trimmed || undefined
}

function requireVersion(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) {
    toast.error("版本不能为空。")
    return null
  }
  return trimmed
}

function uploadTypeLabel(type: MarketResourceType): string {
  return resourceTypeOptions.find((option) => option.type === type)?.label ?? "资源"
}

async function handleUpload(payload: MarketUploadSubmitPayload): Promise<void> {
  uploading.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const blob = await exportMarketSelection(payload, { version: payload.version })
    const pkg = await marketApi.upload(blob, {
      resourceType: payload.resourceType,
      title: payload.title,
      summary: payload.summary,
      author: payload.author,
      tags: payload.tags,
    })
    if (payload.resourceType === "game_card") {
      await syncUploadedGameCardVersion(payload.cardId, payload.version)
    }
    toast.success(`已上传：${pkg.name}`)
    screen.value = { kind: "list" }
    await refresh()
    await refreshCounts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "上传资源失败。"
  } finally {
    uploading.value = false
  }
}

async function syncUploadedGameCardVersion(cardId: string, version: string | undefined): Promise<void> {
  const targetVersion = version?.trim()
  if (!targetVersion) {
    return
  }
  const card = (await listPlatformGameCards()).find((candidate) => candidate.id === cardId)
  if (!card || card.manifest.version === targetVersion) {
    return
  }
  await updatePlatformGameCardMetadata(card.id, {
    name: card.manifest.name,
    summary: card.manifest.summary,
    authorName: card.manifest.author?.name,
    version: targetVersion,
  })
}

async function handleDownloadInstall(pkg: MarketPackage): Promise<void> {
  installing.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    if (pkg.resourceType === "game_card") {
      await installGameCardPackage(pkg)
      return
    }

    const blob = await marketApi.download(pkg.id)
    const inspection = await inspectResourcePackage(blob)
    await loadInstallResources()
    pendingInstallBlob.value = blob
    installDialog.value = {
      pkg,
      options: buildInstallOptions(pkg.resourceType, inspection.resourceId),
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "下载安装失败。"
  } finally {
    installing.value = false
  }
}

async function installGameCardPackage(pkg: MarketPackage): Promise<void> {
  const blob = await marketApi.download(pkg.id)
  const inspection = await inspectPlatformGameCardPackage(blob)
  const incoming = inspection.manifest
  const cards = await listPlatformGameCards()
  const existing = cards.find((card) => card.manifest.id === incoming.id)
  if (existing) {
    const targetVersion = incoming.version.trim()
    const affectedSaves = (await listPlatformSaves()).filter((save) => {
      if (save.gameCardId !== incoming.id) {
        return false
      }
      const savedVersion = save.gameCardVersion?.trim() ?? ""
      return !savedVersion || savedVersion !== targetVersion
    })
    const saveWarning = affectedSaves.length > 0
      ? `\n\n检测到 ${affectedSaves.length} 个旧版存档，首次继续时会询问是否使用新版。`
      : ""
    const confirmed = await confirm({
      title: "卡包已安装",
      message: `本地已有「${existing.manifest.name || incoming.name || pkg.resourceId}」。安装后将替换本地卡包，已有存档会保留。${saveWarning}`,
      severity: "danger",
      confirmText: "覆盖",
    })
    if (!confirmed) {
      return
    }
  }

  const imported = await importPlatformGameCardPackage(blob, {
    marketOrigin: gameCardMarketOriginFromPackage(pkg),
  })
  await refreshWorkshopGameCardUpdates({ force: true })
  feedback.value = `已安装：${getGameCardTitle(imported)}`
  toast.success(`已安装：${getGameCardTitle(imported)}`)
}

function buildInstallOptions(resourceType: MarketPackage["resourceType"], resourceId: string): MarketInstallTargetOption[] {
  switch (resourceType) {
    case "agent":
      return [
        ...localCards.value.map((card) => {
          const exists = (cardFilesById.value[card.id] ?? []).some((file) => file.path === `agents/${resourceId}/agent.json`)
          return {
            key: `card:${card.id}`,
            label: `安装到游戏卡：${card.manifest.name || card.id}`,
            description: exists ? "已存在同 id Agent，将替换安装。" : "写入该卡的 agents/ 目录。",
            requiresConfirm: exists,
            confirmTitle: "替换 Agent",
            confirmMessage: `游戏卡「${card.manifest.name || card.id}」中已存在 Agent「${resourceId}」。替换会删除旧目录后写入新资源。`,
            resourceType: "agent" as const,
            target: { kind: "card" as const, cardId: card.id },
          }
        }),
        {
          key: "assistant",
          label: "覆盖桌面助手",
          description: "替换助手定义、skills 和 tools，保留 sessions/traces/notes。",
          severity: "danger",
          requiresConfirm: true,
          confirmTitle: "覆盖桌面助手",
          confirmMessage: "将替换当前桌面助手定义、skills 和 tools，保留会话、trace 和 notes。此操作无法自动撤销。",
          resourceType: "agent" as const,
          target: { kind: "assistant" as const },
        },
      ]
    case "skill":
      return buildSkillInstallOptions(resourceId)
    case "tool":
      return buildToolInstallOptions(resourceId)
    case "game_card":
    default:
      return []
  }
}

function buildSkillInstallOptions(resourceId: string): MarketInstallTargetOption[] {
  return [
    ...localCards.value.flatMap((card) => {
      const files = cardFilesById.value[card.id] ?? []
      const cardSharedExists = files.some((file) => file.path === `skills/${resourceId}/SKILL.md`)
      const options: MarketInstallTargetOption[] = [{
        key: `card-shared:${card.id}`,
        label: `安装到卡共享：${card.manifest.name || card.id}`,
        description: cardSharedExists ? "共享 Skill 已存在，将替换安装。" : "写入该卡的 skills/ 目录。",
        requiresConfirm: cardSharedExists,
        confirmTitle: "替换共享 Skill",
        confirmMessage: `游戏卡「${card.manifest.name || card.id}」中已存在共享 Skill「${resourceId}」。替换会删除旧目录后写入新资源。`,
        resourceType: "skill",
        target: { kind: "card-shared", cardId: card.id },
      }]
      for (const agent of buildAgentRegistry(files)) {
        const exists = files.some((file) => file.path === `agents/${agent.id}/skills/${resourceId}/SKILL.md`)
        options.push({
          key: `agent-local:${card.id}:${agent.id}`,
          label: `安装到 ${agent.title}：${card.manifest.name || card.id}`,
          description: exists ? "Agent-local Skill 已存在，将替换安装。" : "写入该 Agent 的 skills/ 目录。",
          requiresConfirm: exists,
          confirmTitle: "替换 Agent Skill",
          confirmMessage: `Agent「${agent.title}」中已存在 Skill「${resourceId}」。替换会删除旧目录后写入新资源。`,
          resourceType: "skill",
          target: { kind: "agent-local", cardId: card.id, agentId: agent.id },
        })
      }
      return options
    }),
    {
      key: "assistant-local",
      label: "安装到桌面助手",
      description: "写入桌面助手的本地 skills/ 目录。",
      requiresConfirm: assistantFiles.value.some((file) => file.path === `.tsian/local/assistant/skills/${resourceId}/SKILL.md`),
      confirmTitle: "替换助手 Skill",
      confirmMessage: `桌面助手中已存在 Skill「${resourceId}」。替换会删除旧目录后写入新资源。`,
      resourceType: "skill",
      target: { kind: "assistant-local" },
    },
  ]
}

function buildToolInstallOptions(resourceId: string): MarketInstallTargetOption[] {
  return [
    ...localCards.value.flatMap((card) => {
      const files = cardFilesById.value[card.id] ?? []
      const cardSharedExists = files.some((file) => file.path === `tools/${resourceId}/tool.json`)
      const options: MarketInstallTargetOption[] = [{
        key: `tool-card-shared:${card.id}`,
        label: `安装到卡共享：${card.manifest.name || card.id}`,
        description: cardSharedExists ? "共享 Tool 已存在，将替换安装。" : "写入该卡的 tools/ 目录。",
        requiresConfirm: cardSharedExists,
        confirmTitle: "替换共享 Tool",
        confirmMessage: `游戏卡「${card.manifest.name || card.id}」中已存在共享 Tool「${resourceId}」。替换会删除旧目录后写入新资源。`,
        resourceType: "tool",
        target: { kind: "card-shared", cardId: card.id },
      }]
      for (const agent of buildAgentRegistry(files)) {
        const exists = files.some((file) => file.path === `agents/${agent.id}/tools/${resourceId}/tool.json`)
        options.push({
          key: `tool-agent-local:${card.id}:${agent.id}`,
          label: `安装到 ${agent.title}：${card.manifest.name || card.id}`,
          description: exists ? "Agent-local Tool 已存在，将替换安装。" : "写入该 Agent 的 tools/ 目录。",
          requiresConfirm: exists,
          confirmTitle: "替换 Agent Tool",
          confirmMessage: `Agent「${agent.title}」中已存在 Tool「${resourceId}」。替换会删除旧目录后写入新资源。`,
          resourceType: "tool",
          target: { kind: "agent-local", cardId: card.id, agentId: agent.id },
        })
      }
      return options
    }),
    {
      key: "tool-assistant-local",
      label: "安装到桌面助手",
      description: "写入桌面助手的本地 tools/ 目录。",
      requiresConfirm: assistantFiles.value.some((file) => file.path === `.tsian/local/assistant/tools/${resourceId}/tool.json`),
      confirmTitle: "替换助手 Tool",
      confirmMessage: `桌面助手中已存在 Tool「${resourceId}」。替换会删除旧目录后写入新资源。`,
      resourceType: "tool",
      target: { kind: "assistant-local" },
    },
  ]
}

async function handleInstallTargetSelected(option: MarketInstallTargetOption): Promise<void> {
  const blob = pendingInstallBlob.value
  if (!blob) {
    installDialog.value = null
    return
  }
  if (option.requiresConfirm) {
    installDialog.value = null
    const confirmed = await confirm({
      title: option.confirmTitle ?? "确认替换",
      message: option.confirmMessage ?? "目标已存在同名资源，是否替换？",
      severity: option.severity === "danger" ? "danger" : "normal",
      confirmText: "替换",
    })
    if (!confirmed) {
      pendingInstallBlob.value = null
      return
    }
  }

  installing.value = true
  try {
    if (option.resourceType === "agent") {
      await installAgentPackage(blob, option.target)
    } else if (option.resourceType === "skill") {
      await installSkillPackage(blob, option.target)
    } else {
      await installToolPackage(blob, option.target)
    }
    toast.success("资源已安装。")
    feedback.value = "资源已安装。"
    installDialog.value = null
    pendingInstallBlob.value = null
    await loadInstallResources()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "安装资源失败。"
  } finally {
    installing.value = false
  }
}

async function exportMarketSelection(
  selection: MarketUploadSelectionPayload,
  options: { version?: string } = {},
): Promise<Blob> {
  switch (selection.resourceType) {
    case "game_card":
      return exportPlatformGameCardPackage(selection.cardId, { version: options.version })
    case "agent":
      return exportAgentPackage(selection.source, { version: options.version })
    case "skill":
      return exportSkillPackage(selection.source, { version: options.version })
    case "tool":
      return exportToolPackage(selection.source, { version: options.version })
  }
}

function startEditPackage(): void {
  clearReplacement()
}

function clearReplacement(): void {
  replacementSelection.value = null
  replacementDefaults.value = null
  replacementLabel.value = ""
}

async function openReplacementDialog(): Promise<void> {
  replacementDialogOpen.value = true
  if (loggedIn.value) {
    await loadUploadResources()
  }
}

function handleReplacementSelected(selection: MarketUploadSelectionPayload): void {
  if (!detailPackage.value || selection.resourceType !== detailPackage.value.resourceType) {
    return
  }
  replacementSelection.value = selection
  replacementDefaults.value = uploadMetadataDefaults(selection)
  replacementLabel.value = replacementSelectionLabel(selection)
  replacementDialogOpen.value = false
}

function replacementSelectionLabel(selection: MarketUploadSelectionPayload): string {
  if (selection.resourceType === "game_card") {
    const card = uploadCards.value.find((candidate) => candidate.id === selection.cardId)
    return card?.manifest.name || card?.manifest.id || "游戏卡"
  }
  if (selection.resourceType === "agent") {
    const option = agentUploadOptions.value.find((candidate) => sameAgentSource(candidate.source, selection.source))
    return option?.label ?? "Agent"
  }
  if (selection.resourceType === "skill") {
    const option = skillUploadOptions.value.find((candidate) => sameSkillSource(candidate.source, selection.source))
    return option?.label ?? "Skill"
  }
  const option = toolUploadOptions.value.find((candidate) => sameToolSource(candidate.source, selection.source))
  return option?.label ?? "Tool"
}

async function handleSavePackageEdit(metadata: Required<MarketUploadMetadata>): Promise<void> {
  const pkg = detailPackage.value
  if (!pkg || updatingPackage.value) {
    return
  }
  updatingPackage.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const replacement = replacementSelection.value
    let replacementVersion: string | undefined
    if (replacement) {
      const requiredVersion = requireVersion(metadata.version)
      if (!requiredVersion) {
        return
      }
      replacementVersion = requiredVersion
    }
    const blob = replacement ? await exportMarketSelection(replacement, { version: replacementVersion }) : null
    const updated = await marketApi.update(pkg.id, blob, {
      resourceType: pkg.resourceType,
      title: metadata.title,
      summary: metadata.summary,
      author: metadata.author,
      tags: metadata.tags,
    })
    if (replacement?.resourceType === "game_card") {
      await syncUploadedGameCardVersion(replacement.cardId, replacementVersion)
    }
    detailPackage.value = updated
    editSaveToken.value++
    clearReplacement()
    toast.success(`已更新：${updated.name}`)
    feedback.value = `已更新：${updated.name}`
    await refresh()
    await refreshCounts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "更新发布失败。"
  } finally {
    updatingPackage.value = false
  }
}

async function handleDeletePackage(pkg: MarketPackage): Promise<void> {
  if (deletingPackage.value) {
    return
  }
  const confirmed = await confirm({
    title: `删除发布物「${pkg.name}」？`,
    message: "删除后将从创意工坊移除，无法撤销。",
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }
  deletingPackage.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    await marketApi.delete(pkg.id)
    toast.success(`已删除：${pkg.name}`)
    detailPackage.value = null
    screen.value = { kind: "list" }
    await refresh()
    await refreshCounts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "删除发布失败。"
  } finally {
    deletingPackage.value = false
  }
}

function openAccountCenter(): void {
  const input = desktopWindowForLauncher("account")
  if (input) {
    desktop.openWindow(input, { width: 1280, height: 720 })
    void router.push(input.routePath)
  }
}

function goBack(): void {
  screen.value = { kind: "list" }
  detailPackage.value = null
}

function activeInstallTargetCards(card: LocalGameCardView | null): LocalGameCardView[] {
  if (!card || card.source === "builtin") {
    return []
  }
  return [card]
}

function cardsById(cards: LocalGameCardView[]): LocalGameCardView[] {
  const seen = new Set<string>()
  const unique: LocalGameCardView[] = []
  for (const card of cards) {
    if (seen.has(card.id)) {
      continue
    }
    seen.add(card.id)
    unique.push(card)
  }
  return unique
}

function contentFileToWorkspaceFile(file: { path: string; content: string; data?: Blob; createdAt: number; updatedAt: number }): WorkspaceFile {
  return {
    path: file.path,
    content: file.content,
    ...(file.data ? { binary: file.data } : {}),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

function skillUploadOptionFromRegistry(skill: SkillRegistryEntry, card: LocalGameCardView): SkillUploadOption {
  return {
    key: `card:${card.id}:${skill.path}`,
    label: `${skill.title} · ${card.manifest.name || card.id}`,
    summary: skill.summary,
    resourceId: skill.id,
    source: skill.scope === "agent-local" && skill.agentId
      ? { kind: "agent-local", cardId: card.id, agentId: skill.agentId, skillId: skill.id, skillPath: skill.path }
      : { kind: "card-shared", cardId: card.id, skillId: skill.id, skillPath: skill.path },
  }
}

function toolUploadOptionFromRegistry(tool: ToolRegistryEntry, card: LocalGameCardView): ToolUploadOption {
  return {
    key: `card:${card.id}:${tool.path}`,
    label: `${tool.title} · ${card.manifest.name || card.id}`,
    summary: tool.description,
    resourceId: tool.id,
    source: tool.scope === "agent-local" && tool.agentId
      ? { kind: "agent-local", cardId: card.id, agentId: tool.agentId, toolId: tool.id, toolPath: tool.path }
      : { kind: "card-shared", cardId: card.id, toolId: tool.id, toolPath: tool.path },
  }
}
</script>

<style scoped>
.market-view {
  container-type: inline-size;
}

.market-toolbar {
  display: grid;
  min-width: 0;
  gap: 0.5rem;
}

.market-toolbar-primary {
  justify-content: space-between;
}

.market-toolbar-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.market-tag-filter,
.market-search {
  min-width: 0;
  width: 100%;
}

.market-content {
  grid-template-columns: minmax(0, 1fr);
}

.market-resource-sidebar {
  display: none;
}

.market-compact-filters {
  display: flex;
}

@container (min-width: 760px) {
  .market-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .market-toolbar-primary {
    justify-content: flex-start;
  }

  .market-toolbar-filters {
    display: flex;
  }

  .market-tag-filter {
    min-width: 160px;
    width: auto;
  }

  .market-search {
    min-width: 220px;
    width: auto;
  }

  .market-content {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .market-resource-sidebar {
    display: grid;
  }

  .market-compact-filters {
    display: none;
  }
}
</style>
