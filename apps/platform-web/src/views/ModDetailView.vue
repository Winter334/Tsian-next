<template>
  <!-- 模组详情：当前模组的存档管理与设置入口 -->
  <section class="grid gap-6 mt-6">
    <Button
      variant="ghost"
      class="w-fit px-0 font-mono text-xs tracking-wider text-neon hover:bg-transparent hover:text-text-main hover:glow-text"
      @click="goModLibrary"
    >
      ← 返回模组库
    </Button>

    <div v-if="currentMod" class="grid gap-6">
      <div class="grid gap-2">
        <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">
          模组详情
        </p>
        <h2 class="text-2xl font-bold text-text-main">{{ currentMod.name }}</h2>
        <p class="text-base text-text-dim leading-normal">
          在这里管理当前模组的存档，也可以跳转到平台设置；真正进入游戏后，不再保留平台壳 UI。
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-4">
        <!-- Hero card: mod info -->
        <Card class="bg-elevated border-neon-deep/40">
          <CardHeader class="pb-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">
                  {{ currentMod.id }}
                </p>
                <CardTitle class="text-xl text-text-main">{{ currentMod.name }}</CardTitle>
              </div>
              <Badge
                variant="outline"
                class="border-neon-deep/60 text-neon-deep font-mono shrink-0"
              >
                v{{ currentMod.version }}
              </Badge>
            </div>
          </CardHeader>

          <CardContent class="grid gap-3 pt-0">
            <p class="text-text-dim leading-normal">
              {{ currentMod.description || "当前模组未提供描述。" }}
            </p>
            <div class="grid gap-1.5">
              <span class="text-sm text-text-dim font-mono">该模组存档：{{ currentModSaves.length }}</span>
              <span class="text-sm text-text-dim font-mono">实体类型：{{ currentMod.entityTypeCount }}</span>
              <span class="text-sm text-text-dim font-mono">预设档案：{{ currentMod.archiveCount }}</span>
              <span class="text-sm text-text-dim font-mono">预设事件：{{ currentMod.eventCount }}</span>
            </div>
          </CardContent>
        </Card>

        <!-- Config status card -->
        <Card class="bg-panel border-neon-deep/40">
          <CardHeader class="pb-3">
            <div>
              <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">
                平台配置
              </p>
              <CardTitle class="text-xl text-text-main">当前状态</CardTitle>
            </div>
          </CardHeader>

          <CardContent class="grid gap-3 pt-0">
            <div class="grid gap-1.5">
              <span class="text-sm text-text-dim font-mono">聊天模型：{{ chatModelSummary }}</span>
              <span class="text-sm text-text-dim font-mono">检索模型：{{ retrievalModelSummary }}</span>
              <span class="text-sm text-text-dim font-mono">嵌入模型：{{ embeddingModelSummary }}</span>
              <span class="text-sm text-text-dim font-mono">检索增强：{{ retrievalEnhancedSummary }}</span>
            </div>
          </CardContent>

          <CardFooter>
            <Button
              variant="outline"
              class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
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
          <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">
            存档
          </p>
          <h3 class="text-xl font-bold text-text-main">当前模组存档</h3>
        </div>
        <Button
          variant="outline"
          class="border-neon text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
          @click="handleCreateSave"
        >
          开始新游戏
        </Button>
      </div>

      <!-- Save cards grid -->
      <div v-if="currentModSaves.length > 0" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card
          v-for="save in currentModSaves"
          :key="save.id"
          class="cursor-pointer transition-colors"
          :class="save.id === selectedSaveId
            ? 'bg-panel border-neon glow-box'
            : 'bg-panel border-neon-deep/40 hover:border-neon-deep/70'"
          @click="selectedSaveId = save.id"
        >
          <CardHeader class="pb-2">
            <div class="flex items-start justify-between gap-3">
              <div>
                <CardTitle class="text-lg text-text-main">{{ save.name }}</CardTitle>
                <p class="text-xs text-text-dim mt-1">
                  {{ formatDateTime(save.updatedAt) }}
                </p>
              </div>
              <Badge
                v-if="save.id === activeSaveId"
                class="bg-neon/10 text-neon border-neon/30 shrink-0"
              >
                当前激活
              </Badge>
            </div>
          </CardHeader>

          <CardContent class="pt-0 pb-3">
            <p class="text-xs text-text-dim">创建时间：{{ formatDateTime(save.createdAt) }}</p>
          </CardContent>

          <CardFooter class="flex flex-wrap gap-3">
            <Button
              variant="outline"
              class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
              @click.stop="handleContinueSave(save.id)"
            >
              继续游戏
            </Button>
            <Button
              variant="outline"
              class="border-danger/40 text-danger hover:bg-danger/10 transition-colors font-mono tracking-wide"
              @click.stop="handleDeleteSave(save.id)"
            >
              删除存档
            </Button>
          </CardFooter>
        </Card>
      </div>

      <!-- Empty state: no saves -->
      <Card v-else class="bg-panel border-neon-deep/40">
        <CardContent class="py-8 text-center">
          <h4 class="text-lg font-bold text-text-main mb-2">当前模组还没有存档</h4>
          <p class="text-text-dim">点击“开始新游戏”后，平台会先创建一个绑定当前模组的新存档，再进入游戏页。</p>
        </CardContent>
      </Card>
    </div>

    <!-- Empty state: no mod matched -->
    <Card v-else class="bg-panel border-neon-deep/40">
      <CardContent class="py-8 text-center">
        <h4 class="text-lg font-bold text-text-main mb-2">未找到该模组</h4>
        <p class="text-text-dim mb-5">当前地址指向的模组不存在，请返回模组库重新选择。</p>
        <Button
          variant="outline"
          class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
          @click="goModLibrary"
        >
          返回模组库
        </Button>
      </CardContent>
    </Card>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { onMounted, ref, watch } from "vue"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

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
}

const route = useRoute()
const router = useRouter()
const builtinMods = ref<BuiltinModSummary[]>([])
const saveOptions = ref<SaveOption[]>([])
const activeSaveId = ref("")
const selectedSaveId = ref("")
const currentMod = ref<BuiltinModSummary | null>(null)
const currentModSaves = ref<SaveOption[]>([])
const chatModelSummary = ref("未配置")
const retrievalModelSummary = ref("未配置")
const embeddingModelSummary = ref("未配置")
const retrievalEnhancedSummary = ref("关闭")

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

function syncCurrentModContext(modId: string) {
  currentMod.value = findBuiltinModById(modId)
  currentModSaves.value = saveOptions.value.filter((save) => save.modId === modId)
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
  syncCurrentModContext(currentMod.value.id)
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
    syncCurrentModContext(currentMod.value.id)
    syncSelectedSaveForCurrentMod()
  }
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
  syncCurrentModContext(currentModIdFromRoute())
  syncSelectedSaveForCurrentMod()
})

watch(
  () => route.params.id,
  () => {
    syncCurrentModContext(currentModIdFromRoute())
    syncSelectedSaveForCurrentMod()
  },
)
</script>
