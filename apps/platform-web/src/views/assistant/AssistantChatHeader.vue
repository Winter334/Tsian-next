<template>
  <header class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/30 bg-[#2d2a23] px-4 py-2.5">
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="grid h-7 w-7 shrink-0 place-items-center border border-neon/45 bg-neon/10 text-neon">
        <Bot class="h-4 w-4" aria-hidden="true" />
      </span>
      <div class="min-w-0 leading-tight">
        <h1 class="truncate text-sm font-bold text-text-main">桌面助手</h1>
        <p class="truncate font-mono text-[10px] uppercase tracking-wider text-text-dim">
          {{ cardTitle }}
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <!-- 预设(服务商)下拉:一级,立即持久化.
           有任意会话(含后台)生成中时禁用——防止切走会话的后台 turn 与
           新选预设/模型打架(正在跑的 turn 已锁定 config,但全局 agent.json
           被改会影响下一次发送)。治标方案:运行中不让动模型配置。 -->
      <Select
        :model-value="assistantProviderPresetId || '__platform_default__'"
        :disabled="runningSessionCount > 0"
        @update:model-value="(value) => $emit('presetChange', value as string)"
      >
        <SelectTrigger
          class="h-8 w-auto min-w-[6rem] max-w-[10rem] px-2 text-[11px]"
          :title="runningSessionCount > 0 ? '有会话正在生成，暂不可切换服务商' : '服务商预设'"
        >
          <SelectValue placeholder="平台默认" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__platform_default__">平台默认</SelectItem>
          <SelectItem
            v-for="preset in providerPresets"
            :key="preset.id"
            :value="preset.id"
          >
            {{ preset.name }}
          </SelectItem>
        </SelectContent>
      </Select>

      <!-- 模型下拉:二级,依赖预设选中.列出该预设的 models.
           额外禁用条件:有任意会话生成中(同预设下拉理由)。 -->
      <Select
        :model-value="assistantModelId || '__preset_default__'"
        :disabled="!assistantProviderPresetId || assistantModels.length === 0 || runningSessionCount > 0"
        @update:model-value="(value) => $emit('modelChange', value as string)"
      >
        <SelectTrigger
          class="h-8 w-auto min-w-[6rem] max-w-[10rem] px-2 text-[11px]"
          :title="runningSessionCount > 0 ? '有会话正在生成，暂不可切换模型' : (!assistantProviderPresetId ? '请先选择服务商' : '模型')"
        >
          <SelectValue placeholder="预设默认" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__preset_default__">预设默认</SelectItem>
          <SelectItem
            v-for="model in assistantModels"
            :key="model.id"
            :value="model.id"
          >
            {{ model.label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <!-- 上下文窗口环:已用 input tokens / contextWindow.每轮回复后更新. -->
      <ContextRing
        :used="contextUsed"
        :total="contextTotal"
        :size="28"
      />

      <button
        type="button"
        class="retro-focus grid h-8 w-8 place-items-center border border-neon-deep/55 bg-elevated text-text-dim hover:text-neon"
        :title="configButtonTitle"
        aria-label="助手配置"
        @click="$emit('openConfig')"
      >
        <Settings class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Bot, Settings } from "lucide-vue-next"
import ContextRing from "@/components/assistant/ContextRing.vue"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

defineProps<{
  cardTitle: string
  providerPresets: Array<{ id: string; name: string }>
  assistantProviderPresetId: string
  assistantModelId: string
  assistantModels: Array<{ id: string; label: string; contextWindow: number | null }>
  contextUsed: number
  contextTotal: number
  runningSessionCount: number
  configButtonTitle: string
}>()

defineEmits<{
  presetChange: [presetId: string]
  modelChange: [modelId: string]
  openConfig: []
}>()
</script>
