<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Control Panel</p>
        <h1 class="truncate text-base font-bold text-text-main">控制面板</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs"
          :class="effectiveChatConfig ? 'border-neon/45 bg-neon/10 text-neon' : 'border-warning/45 bg-warning/10 text-warning'"
        >
          <CheckCircle2 v-if="effectiveChatConfig" class="h-3.5 w-3.5" aria-hidden="true" />
          <AlertTriangle v-else class="h-3.5 w-3.5" aria-hidden="true" />
          {{ effectiveChatConfig ? "模型已配置" : "模型未配置" }}
        </span>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="handleSaveSettings"
        >
          <Save class="h-3.5 w-3.5" aria-hidden="true" />
          保存
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="handleResetSettings"
        >
          <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
          重置
        </button>
      </div>
    </header>

    <main class="min-h-0 overflow-auto p-3">
      <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section class="retro-inset grid gap-4 p-4">
          <div class="grid gap-3 border-b border-neon-deep/25 pb-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div class="min-w-0">
              <p class="font-mono text-xs uppercase tracking-wider text-neon">Agent Runtime 模型</p>
              <p class="mt-2 text-sm leading-6 text-text-dim">
                当前平台使用一组 OpenAI 兼容聊天 API。未填写的本地字段会回退到环境默认。
              </p>
            </div>
            <div class="grid min-w-52 gap-1 border border-neon-deep/35 bg-elevated/35 p-3 font-mono text-[11px] text-text-dim">
              <span>localStorage: {{ aiStatus }}</span>
              <span>本地会话: {{ saveOptionCount }}</span>
              <span class="truncate">活动存档: {{ activeSaveId || "无" }}</span>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-3">
            <div
              v-for="item in effectiveConfigTiles"
              :key="item.label"
              class="border border-neon-deep/35 bg-panel/65 p-3"
            >
              <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">{{ item.label }}</p>
              <p class="mt-2 truncate font-mono text-sm font-bold text-text-main">{{ item.value }}</p>
              <p class="mt-1 font-mono text-[11px]" :class="item.local ? 'text-neon' : 'text-text-dim'">{{ item.source }}</p>
            </div>
          </div>

          <div class="grid gap-4">
            <div class="grid gap-2">
              <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">接口地址</Label>
              <Input
                v-model="platformConfigDraft.chat.baseUrl"
                type="text"
                :placeholder="effectiveChatConfig?.baseUrl || 'https://example.com/v1'"
                class="retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </div>
            <div class="grid gap-2">
              <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">模型</Label>
              <Input
                v-model="platformConfigDraft.chat.model"
                type="text"
                :placeholder="effectiveChatConfig?.model || '模型名'"
                class="retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </div>
            <div class="grid gap-2">
              <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">API 密钥</Label>
              <Input
                v-model="platformConfigDraft.chat.apiKey"
                type="password"
                :placeholder="effectiveChatConfig ? '已配置，可留空回退' : 'sk-...'"
                class="retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </div>
          </div>

          <div
            v-if="settingsFeedback || settingsError"
            class="border px-3 py-2 text-sm"
            :class="settingsError ? 'border-danger/45 bg-danger/10 text-danger' : 'border-neon/45 bg-neon/10 text-neon'"
          >
            {{ settingsError || settingsFeedback }}
          </div>
        </section>

        <aside class="retro-inset grid content-start gap-3 p-4">
          <div class="grid h-12 w-12 place-items-center border border-neon-deep/45 bg-elevated/50 text-neon">
            <SlidersHorizontal class="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p class="font-mono text-xs uppercase tracking-wider text-neon">配置来源</p>
            <p class="mt-2 text-sm leading-6 text-text-dim">
              本地覆盖只保存在当前浏览器。重置后会清空本地覆盖，并重新读取环境默认。
            </p>
          </div>
          <div class="grid gap-2">
            <div
              v-for="item in overrideRows"
              :key="item.label"
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border border-neon-deep/30 bg-panel/55 px-3 py-2"
            >
              <span class="font-mono text-xs text-text-main">{{ item.label }}</span>
              <span class="font-mono text-[11px]" :class="item.local ? 'text-neon' : 'text-text-dim'">{{ item.source }}</span>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <span class="font-mono text-[11px] text-text-dim">当前生效模型：{{ chatModelSummary }}</span>
      <span class="font-mono text-[11px] text-text-dim">API key 只以密码输入保存，不在摘要中明文显示</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, CheckCircle2, RotateCcw, Save, SlidersHorizontal } from "lucide-vue-next"
import { computed, onMounted, ref } from "vue"
import {
  type BrowserAiConfig,
  type BrowserPlatformConfigDraft,
  getBrowserAiConfig,
  getBrowserPlatformConfigDraft,
  getBrowserPlatformConfigStorageState,
  resetBrowserPlatformConfigDraft,
  saveBrowserPlatformConfigDraft,
} from "../config/ai"
import {
  getPlatformActiveSaveId,
  listPlatformSaves,
} from "../platform-host"

const effectiveChatConfig = ref<BrowserAiConfig | null>(null)
const platformConfigDraft = ref<BrowserPlatformConfigDraft>(getBrowserPlatformConfigDraft())
const chatModelSummary = ref("未配置")
const aiStatus = ref("检查中")
const settingsFeedback = ref("")
const settingsError = ref("")
const saveOptionCount = ref(0)
const activeSaveId = ref("")

const overrideRows = computed(() => [
  overrideRow("接口地址", platformConfigDraft.value.chat.baseUrl),
  overrideRow("模型", platformConfigDraft.value.chat.model),
  overrideRow("API 密钥", platformConfigDraft.value.chat.apiKey),
])

const effectiveConfigTiles = computed(() => [
  configTile("Base URL", effectiveChatConfig.value?.baseUrl ?? "未配置", "接口地址", platformConfigDraft.value.chat.baseUrl),
  configTile("Model", effectiveChatConfig.value?.model ?? "未配置", "模型", platformConfigDraft.value.chat.model),
  configTile("API Key", effectiveChatConfig.value ? maskSecret(platformConfigDraft.value.chat.apiKey) : "未配置", "API 密钥", platformConfigDraft.value.chat.apiKey),
])

function formatModelSummary(config: { baseUrl: string; model: string } | null): string {
  if (!config) {
    return "未配置"
  }
  return `${config.model} · ${config.baseUrl}`
}

function clonePlatformConfigDraft(input: BrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  return {
    chat: { ...input.chat },
  }
}

function overrideRow(label: string, value: string): { label: string; source: string; local: boolean } {
  const local = value.trim().length > 0
  return {
    label,
    source: local ? "本地覆盖" : "环境默认",
    local,
  }
}

function configTile(
  label: string,
  value: string,
  sourceLabel: string,
  sourceValue: string,
): { label: string; value: string; source: string; local: boolean } {
  const source = overrideRow(sourceLabel, sourceValue)
  return {
    label,
    value,
    source: source.source,
    local: source.local,
  }
}

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return "已配置（未明文显示）"
  }
  if (trimmed.length <= 8) {
    return "••••"
  }
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`
}

function refreshPlatformConfigState(options: { reloadDraft?: boolean } = {}) {
  effectiveChatConfig.value = getBrowserAiConfig()
  chatModelSummary.value = formatModelSummary(effectiveChatConfig.value)
  aiStatus.value = getBrowserPlatformConfigStorageState()

  if (options.reloadDraft) {
    platformConfigDraft.value = clonePlatformConfigDraft(getBrowserPlatformConfigDraft())
  }
}

function handleSaveSettings() {
  try {
    saveBrowserPlatformConfigDraft(platformConfigDraft.value)
    refreshPlatformConfigState({ reloadDraft: true })
    settingsError.value = ""
    settingsFeedback.value = "平台本地配置已保存，新一轮 Agent Runtime 调用将直接读取这份配置。"
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
  settingsFeedback.value = "本地覆盖已清空，当前已回退到环境变量。"
}

async function refreshOverview() {
  const saves = await listPlatformSaves()
  saveOptionCount.value = saves.length
  activeSaveId.value = (await getPlatformActiveSaveId()) ?? ""
}

onMounted(async () => {
  refreshPlatformConfigState({ reloadDraft: true })
  await refreshOverview()
})
</script>
