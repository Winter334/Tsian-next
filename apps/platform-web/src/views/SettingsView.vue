<template>
  <!-- 设置页：AI 配置与检索参数 -->
  <section class="grid gap-6 mt-6">
    <div class="grid gap-2">
      <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">设置</p>
      <h2 class="text-2xl font-bold text-text-main">平台设置</h2>
      <p class="text-base text-text-dim leading-normal">
        当前阶段先提供最小可写入口：通用聊天 AI、检索 AI、Embedding 和检索参数都可以直接在浏览器本地保存。
      </p>
    </div>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="grid gap-2">
            <p class="font-mono text-xs tracking-wider uppercase text-neon-muted">当前生效</p>
            <CardTitle class="text-xl text-text-main">本地配置状态</CardTitle>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              class="border-neon text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
              type="button"
              @click="handleSaveSettings"
            >
              保存本地配置
            </Button>
            <Button
              variant="outline"
              class="border-neon-deep/60 text-text-dim hover:bg-elevated transition-colors font-mono tracking-wide"
              type="button"
              @click="handleResetSettings"
            >
              重置为环境默认
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Badge variant="outline" class="justify-start border-neon-deep/50 text-text-dim font-mono font-normal">
            当前生效聊天模型：{{ chatModelSummary }}
          </Badge>
          <Badge variant="outline" class="justify-start border-neon-deep/50 text-text-dim font-mono font-normal">
            当前生效检索模型：{{ retrievalModelSummary }}
          </Badge>
          <Badge variant="outline" class="justify-start border-neon-deep/50 text-text-dim font-mono font-normal">
            当前生效嵌入模型：{{ embeddingModelSummary }}
          </Badge>
          <Badge variant="outline" class="justify-start border-neon-deep/50 text-text-dim font-mono font-normal">
            当前检索增强：{{ retrievalEnhancedSummary }}
          </Badge>
        </div>
        <p
          v-if="settingsFeedback"
          class="text-neon bg-neon/10 border border-neon-deep/40 rounded px-3 py-2 text-sm"
        >
          {{ settingsFeedback }}
        </p>
        <p
          v-if="settingsError"
          class="text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2 text-sm"
        >
          {{ settingsError }}
        </p>
      </CardContent>
    </Card>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">AI 配置</p>
          <CardTitle class="text-xl text-text-main">通用聊天 AI</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4 pt-0">
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">Base URL</Label>
            <Input
              v-model="platformConfigDraft.chat.baseUrl"
              type="text"
              :placeholder="effectiveChatConfig?.baseUrl || 'https://example.com/v1'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">Model</Label>
            <Input
              v-model="platformConfigDraft.chat.model"
              type="text"
              :placeholder="effectiveChatConfig?.model || '模型名'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">API Key</Label>
            <Input
              v-model="platformConfigDraft.chat.apiKey"
              type="password"
              :placeholder="effectiveChatConfig ? '已配置，可留空回退' : 'sk-...'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <p class="text-xs text-text-dim">
            这一组同时服务正文 AI 和维护 AI。留空表示回退到浏览器环境变量。
          </p>
        </CardContent>
      </Card>

      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">AI 配置</p>
          <CardTitle class="text-xl text-text-main">检索 AI</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4 pt-0">
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">Base URL</Label>
            <Input
              v-model="platformConfigDraft.retrieval.baseUrl"
              type="text"
              :placeholder="effectiveRetrievalConfig?.baseUrl || '留空表示跟随通用聊天配置'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">Model</Label>
            <Input
              v-model="platformConfigDraft.retrieval.model"
              type="text"
              :placeholder="effectiveRetrievalConfig?.model || '留空表示跟随通用聊天配置'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">API Key</Label>
            <Input
              v-model="platformConfigDraft.retrieval.apiKey"
              type="password"
              :placeholder="effectiveRetrievalConfig ? '已配置，可留空回退' : '留空表示跟随通用聊天配置'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <p class="text-xs text-text-dim">
            留空时按当前代码口径回退到 `VITE_RETRIEVAL_*`，再回退到通用聊天配置。
          </p>
        </CardContent>
      </Card>

      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">AI 配置</p>
          <CardTitle class="text-xl text-text-main">Embedding</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4 pt-0">
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">Base URL</Label>
            <Input
              v-model="platformConfigDraft.embedding.baseUrl"
              type="text"
              :placeholder="effectiveEmbeddingConfig?.baseUrl || '留空表示沿用通用聊天配置'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">Model</Label>
            <Input
              v-model="platformConfigDraft.embedding.model"
              type="text"
              :placeholder="effectiveEmbeddingConfig?.model || 'Qwen/Qwen3-Embedding-8B'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">API Key</Label>
            <Input
              v-model="platformConfigDraft.embedding.apiKey"
              type="password"
              :placeholder="effectiveEmbeddingConfig ? '已配置，可留空回退' : '留空表示沿用通用聊天配置'"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
            />
          </div>
          <p class="text-xs text-text-dim">
            Embedding 的 `baseUrl / apiKey` 可沿用通用聊天配置，但 `model` 仍建议单独明确填写。
          </p>
        </CardContent>
      </Card>

      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">平台</p>
          <CardTitle class="text-xl text-text-main">当前概况</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-1.5 pt-0">
          <span class="text-sm text-text-dim font-mono">内置模组：{{ builtinModCount }}</span>
          <span class="text-sm text-text-dim font-mono">本地存档：{{ saveOptionCount }}</span>
          <span class="text-sm text-text-dim font-mono">当前激活存档：{{ activeSaveId || "无" }}</span>
          <span class="text-sm text-text-dim font-mono">当前 localStorage 覆盖：{{ aiStatus }}</span>
        </CardContent>
      </Card>

      <Card class="bg-panel border-neon-deep/40 lg:col-span-2">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">参数</p>
          <CardTitle class="text-xl text-text-main">检索参数</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4 pt-0">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-3">
              <Switch
                :checked="platformConfigDraft.retrievalSettings.aiEnhanced"
                class="data-[state=checked]:bg-neon data-[state=unchecked]:bg-elevated"
                @update:checked="platformConfigDraft.retrievalSettings.aiEnhanced = $event"
              />
              <Label class="text-sm text-text-main font-mono">开启 AI 增强检索</Label>
            </div>
            <span class="text-xs text-text-dim leading-normal">
              关闭时只走结构检索；开启后会额外触发关键词提取与向量检索。
            </span>
          </div>

          <Separator class="bg-neon-deep/30" />

          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">最近消息数</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.recentMessageLimit" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">候选事件上限</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.maxCandidates" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">预设事件注入上限</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.maxCatalogInjected" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">预设事件分数阈值</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.minCatalogEventScore" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">基础 seed 数量</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.baseSeedEventLimit" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">复杂剧情 seed 数量</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.complexSeedEventLimit" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">复杂实体阈值</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.complexEntityThreshold" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">相邻事件扩展数</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.maxChainNeighborsPerSeed" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">事件注入上限</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.maxInjectedEvents" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">seed 分数阈值</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.minSeedScore" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">桥接实体上限</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.bridgeEntityLimit" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">桥接实体分数阈值</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.minBridgeEntityScore" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">语义事件上限</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.semanticEventLimit" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">语义档案上限</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.semanticArchiveLimit" type="number" min="0" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
            <div class="grid gap-1.5">
              <Label class="text-xs text-text-dim font-mono">语义相似度阈值</Label>
              <Input v-model.number="platformConfigDraft.retrievalSettings.semanticScoreThreshold" type="number" min="0" step="0.01" class="bg-elevated border-neon-deep/40 text-text-main focus:border-neon focus:ring-neon/20" />
            </div>
          </div>
        </CardContent>
        <CardFooter class="pt-0">
          <p class="text-xs text-text-dim leading-normal">
            检索参数会随保存动作写入浏览器本地配置。
          </p>
        </CardFooter>
      </Card>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { onMounted, ref } from "vue"
import {
  type BrowserAiConfig,
  type BrowserEmbeddingConfig,
  type BrowserPlatformConfigDraft,
  type BrowserRetrievalSettings,
  getBrowserAiConfig,
  getBrowserEmbeddingConfig,
  getBrowserPlatformConfigDraft,
  getBrowserPlatformConfigStorageState,
  getBrowserRetrievalConfig,
  getBrowserRetrievalSettings,
  resetBrowserPlatformConfigDraft,
  saveBrowserPlatformConfigDraft,
} from "../config/ai"
import {
  getPlatformActiveSaveId,
  listPlatformSaves,
  playFrontendBridge,
} from "../platform-host"

const effectiveChatConfig = ref<BrowserAiConfig | null>(null)
const effectiveRetrievalConfig = ref<BrowserAiConfig | null>(null)
const effectiveEmbeddingConfig = ref<BrowserEmbeddingConfig | null>(null)
const effectiveRetrievalSettings = ref<BrowserRetrievalSettings>(getBrowserRetrievalSettings())
const platformConfigDraft = ref<BrowserPlatformConfigDraft>(getBrowserPlatformConfigDraft())
const chatModelSummary = ref("未配置")
const retrievalModelSummary = ref("未配置")
const embeddingModelSummary = ref("未配置")
const retrievalEnhancedSummary = ref("关闭")
const aiStatus = ref("checking...")
const settingsFeedback = ref("")
const settingsError = ref("")
const builtinModCount = ref(0)
const saveOptionCount = ref(0)
const activeSaveId = ref("")

function formatModelSummary(config: { baseUrl: string; model: string } | null): string {
  if (!config) {
    return "未配置"
  }
  return `${config.model} · ${config.baseUrl}`
}

function clonePlatformConfigDraft(input: BrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  return {
    chat: { ...input.chat },
    retrieval: { ...input.retrieval },
    embedding: { ...input.embedding },
    retrievalSettings: { ...input.retrievalSettings },
  }
}

function platformStatusText(): string {
  return [
    `chat=${getBrowserAiConfig() ? "configured" : "missing"}`,
    `retrieval=${getBrowserRetrievalConfig() ? "configured" : "missing"}`,
    `embed=${getBrowserEmbeddingConfig() ? "configured" : "missing"}`,
    `local=${getBrowserPlatformConfigStorageState()}`,
  ].join(" | ")
}

function refreshPlatformConfigState(options: { reloadDraft?: boolean } = {}) {
  effectiveChatConfig.value = getBrowserAiConfig()
  effectiveRetrievalConfig.value = getBrowserRetrievalConfig()
  effectiveEmbeddingConfig.value = getBrowserEmbeddingConfig()
  effectiveRetrievalSettings.value = getBrowserRetrievalSettings()
  chatModelSummary.value = formatModelSummary(effectiveChatConfig.value)
  retrievalModelSummary.value = formatModelSummary(effectiveRetrievalConfig.value)
  embeddingModelSummary.value = formatModelSummary(effectiveEmbeddingConfig.value)
  retrievalEnhancedSummary.value = effectiveRetrievalSettings.value.aiEnhanced ? "开启" : "关闭"
  aiStatus.value = platformStatusText()

  if (options.reloadDraft) {
    platformConfigDraft.value = clonePlatformConfigDraft(getBrowserPlatformConfigDraft())
  }
}

function handleSaveSettings() {
  try {
    saveBrowserPlatformConfigDraft(platformConfigDraft.value)
    refreshPlatformConfigState({ reloadDraft: true })
    settingsError.value = ""
    settingsFeedback.value = "平台本地配置已保存，新一轮 AI 请求将直接读取这份配置。"
  } catch (error) {
    settingsFeedback.value = ""
    settingsError.value =
      error instanceof Error ? error.message : "保存平台配置时发生未知错误。"
  }
}

function handleResetSettings() {
  resetBrowserPlatformConfigDraft()
  refreshPlatformConfigState({ reloadDraft: true })
  settingsError.value = ""
  settingsFeedback.value = "本地覆盖已清空，当前已回退到环境变量和默认检索参数。"
}

async function refreshOverview() {
  const result = await playFrontendBridge.query.query<ModStaticContent>({
    resource: "builtin-mods",
  })
  builtinModCount.value = result.items.length
  const saves = await listPlatformSaves()
  saveOptionCount.value = saves.length
  activeSaveId.value = (await getPlatformActiveSaveId()) ?? ""
}

onMounted(async () => {
  refreshPlatformConfigState({ reloadDraft: true })
  await refreshOverview()
})
</script>
