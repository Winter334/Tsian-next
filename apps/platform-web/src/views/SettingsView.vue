<template>
  <section class="grid gap-6 mt-6">
    <div class="grid gap-2">
      <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">设置</p>
      <h2 class="text-2xl font-bold text-text-main">平台设置</h2>
      <p class="text-base text-text-dim leading-normal">
        当前 MVP 只配置 Agent Runtime 使用的 OpenAI 兼容聊天模型。记忆、状态维护和工具配置会在后续运行时能力成型后再进入界面。
      </p>
    </div>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="grid gap-2">
            <p class="font-mono text-xs tracking-wider uppercase text-neon-muted">当前生效</p>
            <CardTitle class="text-xl text-text-main">聊天模型</CardTitle>
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
        <Badge variant="outline" class="justify-start border-neon-deep/50 text-text-dim font-mono font-normal">
          当前生效模型：{{ chatModelSummary }}
        </Badge>
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

    <div class="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4">
      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">AI 配置</p>
          <CardTitle class="text-xl text-text-main">OpenAI 兼容聊天 API</CardTitle>
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
            `master-agent` 和 `narrative-agent` 当前共用这一组模型配置，AI debug 会用不同 label 区分两次调用。
          </p>
        </CardContent>
      </Card>

      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">平台</p>
          <CardTitle class="text-xl text-text-main">当前概况</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-1.5 pt-0">
          <span class="text-sm text-text-dim font-mono">本地会话：{{ saveOptionCount }}</span>
          <span class="text-sm text-text-dim font-mono">当前激活会话：{{ activeSaveId || "无" }}</span>
          <span class="text-sm text-text-dim font-mono">localStorage 覆盖：{{ aiStatus }}</span>
        </CardContent>
      </Card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { onMounted, ref } from "vue"
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
const aiStatus = ref("checking...")
const settingsFeedback = ref("")
const settingsError = ref("")
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
  }
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
