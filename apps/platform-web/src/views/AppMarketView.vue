<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex flex-wrap items-center gap-2">
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
          :disabled="importing"
          @click="openPackagePicker"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          本地安装卡包
        </button>
        <input
          ref="packageInput"
          type="file"
          class="hidden"
          accept=".tsian-card.zip,application/zip"
          @change="handlePackageSelected"
        />
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="openUploadScreen"
        >
          <Upload class="h-3.5 w-3.5" aria-hidden="true" />
          上传资源
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="sortMode"
          class="retro-focus retro-select-surface min-w-[100px] border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
          @change="refresh"
        >
          <option value="newest">最新</option>
          <option value="downloads">下载量</option>
        </select>
        <MarketTagFilter v-model="tagQuery" @update:model-value="onTagInput" />
        <label class="relative min-w-[220px]">
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

    <main class="m-3 grid min-h-0 gap-3 overflow-auto lg:grid-cols-[220px_minmax(0,1fr)]">
      <MarketResourceTypeSidebar
        v-model="currentType"
        :options="resourceTypeOptions"
        :counts="resourceCounts"
        @update:model-value="switchType"
      />

      <section class="retro-inset min-h-0 overflow-auto p-3">
        <div v-if="screen.kind === 'list'" class="grid gap-3">
          <div v-if="loading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">加载中…</p>
          </div>
          <div v-else-if="packages.length === 0" class="grid place-items-center py-12">
            <Store class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">
              {{ emptyMessage }}
            </p>
          </div>
          <MarketPackageGrid v-else :packages="packages" @open="openDetail" />
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
            @install="handleDownloadInstall"
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
            :cards="localCards"
            :agent-options="agentUploadOptions"
            :skill-options="skillUploadOptions"
            :loading="localResourcesLoading"
            :uploading="uploading"
            @submit="handleUpload"
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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { ArrowLeft, Download, Search, Store, Upload, UserRound } from "lucide-vue-next"
import type { AgentRegistryEntry, MarketPackage, MarketResourceType, SkillRegistryEntry, WorkspaceFile } from "@tsian/contracts"
import type { LocalGameCardView } from "@/storage/game-cards"
import { buildAgentRegistry, buildSkillRegistry } from "@/agent-runtime/registry"
import { toast } from "@/composables/useToast"
import { confirm } from "@/composables/useConfirm"
import { getGameCardTitle } from "@/lib/game-card-display"
import { marketApi } from "@/platform-host/api-client"
import {
  exportAgentPackage,
  exportPlatformGameCardPackage,
  exportSkillPackage,
  getPlatformActiveGameCard,
  importPlatformGameCardPackage,
  inspectResourcePackage,
  installAgentPackage,
  installSkillPackage,
  listPlatformGameCards,
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
import MarketResourceTypeSidebar from "@/components/market/MarketResourceTypeSidebar.vue"
import MarketTagFilter from "@/components/market/MarketTagFilter.vue"
import MarketUploadPanel from "@/components/market/MarketUploadPanel.vue"
import type {
  AgentUploadOption,
  MarketInstallDialogState,
  MarketInstallTargetOption,
  MarketResourceTypeOption,
  MarketUploadSubmitPayload,
  SkillUploadOption,
} from "@/components/market/types"

type Screen =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  | { kind: "upload" }

const router = useRouter()
const { loggedIn } = useAuth()
const desktop = useDesktopWindows()

const resourceTypeOptions: MarketResourceTypeOption[] = [
  { type: "game_card", label: "游戏卡", description: "完整卡包" },
  { type: "agent", label: "Agent", description: "角色与流程代理" },
  { type: "skill", label: "Skill", description: "可复用能力" },
]
const packageInput = ref<HTMLInputElement | null>(null)

const screen = ref<Screen>({ kind: "list" })
const currentType = ref<MarketResourceType>("game_card")
const packages = ref<MarketPackage[]>([])
const resourceCounts = ref<Partial<Record<MarketResourceType, number>>>({})
const loading = ref(false)
const searchQuery = ref("")
const tagQuery = ref("")
const sortMode = ref<"newest" | "downloads">("newest")
let searchTimer: ReturnType<typeof setTimeout> | null = null
let tagTimer: ReturnType<typeof setTimeout> | null = null

const detailPackage = ref<MarketPackage | null>(null)
const detailLoading = ref(false)

const localCards = ref<LocalGameCardView[]>([])
const cardFilesById = ref<Record<string, WorkspaceFile[]>>({})
const assistantFiles = ref<WorkspaceFile[]>([])
const localResourcesLoading = ref(false)

const importing = ref(false)
const installing = ref(false)
const uploading = ref(false)
const feedback = ref("")
const errorMessage = ref("")
const pendingInstallBlob = ref<Blob | null>(null)
const installDialog = ref<MarketInstallDialogState | null>(null)

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

const emptyMessage = computed(() => {
  if (searchQuery.value || tagQuery.value) {
    return "没有匹配的资源。"
  }
  switch (currentType.value) {
    case "agent":
      return "创意工坊还没有 Agent，成为第一个上传者吧。"
    case "skill":
      return "创意工坊还没有 Skill，成为第一个上传者吧。"
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
  loading.value = true
  errorMessage.value = ""
  try {
    packages.value = await marketApi.list({
      resourceType: currentType.value,
      q: searchQuery.value || undefined,
      tag: tagQuery.value || undefined,
      sort: sortMode.value,
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载创意工坊列表失败。"
  } finally {
    loading.value = false
  }
}

async function refreshCounts(): Promise<void> {
  const entries = await Promise.all(resourceTypeOptions.map(async (option) => {
    try {
      const items = await marketApi.list({ resourceType: option.type })
      return [option.type, items.length] as const
    } catch {
      return [option.type, 0] as const
    }
  }))
  resourceCounts.value = Object.fromEntries(entries) as Partial<Record<MarketResourceType, number>>
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
    loadLocalResources()
  }
}

async function loadLocalResources(options: { installMode?: boolean } = {}): Promise<void> {
  localResourcesLoading.value = true
  try {
    const cards = options.installMode
      ? activeInstallTargetCards(await getPlatformActiveGameCard())
      : (await listPlatformGameCards()).filter((card) => card.source !== "builtin")
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

async function handleUpload(payload: MarketUploadSubmitPayload): Promise<void> {
  uploading.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const blob = payload.resourceType === "game_card"
      ? await exportPlatformGameCardPackage(payload.cardId)
      : payload.resourceType === "agent"
        ? await exportAgentPackage(payload.source)
        : await exportSkillPackage(payload.source)
    const pkg = await marketApi.upload(blob, {
      resourceType: payload.resourceType,
      title: payload.title,
      summary: payload.summary,
      author: payload.author,
      version: payload.version,
      tags: payload.tags,
    })
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
    await loadLocalResources({ installMode: true })
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
  const cards = await listPlatformGameCards()
  const existing = cards.find((card) => card.manifest.id === pkg.resourceId)
  if (existing) {
    const confirmed = await confirm({
      title: "卡包已安装",
      message: `本地已有同名卡包「${existing.manifest.name || pkg.resourceId}」。覆盖将替换本地内容，无法撤销。`,
      severity: "danger",
      confirmText: "覆盖",
    })
    if (!confirmed) {
      return
    }
  }

  const blob = await marketApi.download(pkg.id)
  const imported = await importPlatformGameCardPackage(blob)
  feedback.value = `已安装：${getGameCardTitle(imported)}`
  toast.success(`已安装：${getGameCardTitle(imported)}`)
}

function buildInstallOptions(resourceType: MarketPackage["resourceType"], resourceId: string): MarketInstallTargetOption[] {
  if (resourceType === "agent") {
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
        description: "替换助手定义和 skills，保留 sessions/traces/notes。",
        severity: "danger",
        requiresConfirm: true,
        confirmTitle: "覆盖桌面助手",
        confirmMessage: "将替换当前桌面助手定义，保留会话、trace 和 notes。此操作无法自动撤销。",
        resourceType: "agent" as const,
        target: { kind: "assistant" as const },
      },
    ]
  }

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
    } else {
      await installSkillPackage(blob, option.target)
    }
    toast.success("资源已安装。")
    feedback.value = "资源已安装。"
    installDialog.value = null
    pendingInstallBlob.value = null
    await loadLocalResources({ installMode: true })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "安装资源失败。"
  } finally {
    installing.value = false
  }
}

function openPackagePicker(): void {
  packageInput.value?.click()
}

async function handlePackageSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) {
    return
  }
  importing.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const imported = await importPlatformGameCardPackage(file)
    feedback.value = `已安装：${getGameCardTitle(imported)}`
    toast.success(`已导入：${getGameCardTitle(imported)}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "安装游戏卡包失败。"
  } finally {
    importing.value = false
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
</script>
