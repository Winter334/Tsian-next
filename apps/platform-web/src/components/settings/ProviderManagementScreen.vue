<template>
  <div class="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
    <!-- Provider sidebar -->
    <aside class="flex min-h-0 flex-col border-r border-neon-deep/30 bg-[#2a271f]">
      <div class="flex items-center justify-between border-b border-neon-deep/25 px-3 py-2.5">
        <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">提供商预设</p>
        <button
          type="button"
          class="retro-focus retro-select-surface grid h-6 w-6 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          title="新增预设"
          @click="emit('addProvider')"
        >
          <Plus class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto py-1">
        <button
          v-for="provider in draft.providers"
          :key="provider.id"
          type="button"
          class="retro-focus group relative block w-full px-3 py-2 text-left transition-colors"
          :class="provider.id === activeProviderId
            ? 'bg-neon/10 text-neon'
            : 'text-text-dim hover:bg-panel/40 hover:text-text-main'"
          @click="emit('selectProvider', provider.id)"
        >
          <span class="block truncate text-xs font-bold">{{ provider.name || "未命名服务商" }}</span>
          <span class="mt-0.5 block font-mono text-[10px] text-text-dim/80">
            {{ provider.models.length }} 个模型 · {{ strategyLabel(provider.fallbackStrategy) }}
          </span>
          <span
            v-if="provider.id === activeProviderId"
            class="absolute inset-y-1 left-0 w-0.5 bg-neon"
            aria-hidden="true"
          />
        </button>
        <p
          v-if="draft.providers.length === 0"
          class="px-3 py-6 text-center text-xs text-text-dim/70"
        >
          暂无预设
        </p>
      </div>
    </aside>

    <!-- Provider detail -->
    <section class="grid min-h-0 overflow-auto p-4">
      <div v-if="activeProvider" class="grid content-start gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/25 pb-3">
          <div class="min-w-0">
            <p class="font-mono text-[10px] uppercase tracking-wider text-neon">服务商预设</p>
            <h2 class="mt-1 truncate text-sm font-bold text-text-main">{{ activeProvider.name || "未命名服务商" }}</h2>
          </div>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center justify-center gap-2 px-3 font-mono text-xs disabled:opacity-45"
            :disabled="!activeProvider.models.length && !activeProvider.baseUrl"
            @click="emit('enterModels', activeProvider.id)"
          >
            <Settings2 class="h-3.5 w-3.5" aria-hidden="true" />
            进入模型配置
          </button>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="grid gap-2">
            <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">预设名称</Label>
            <Input
              :model-value="activeProvider.name"
              type="text"
              placeholder="OpenAI 兼容服务"
              class="retro-focus retro-select-surface h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              @update:model-value="(value) => patchProvider({ name: String(value) })"
            />
          </div>
          <div class="grid gap-2">
            <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">接口地址</Label>
            <Input
              :model-value="activeProvider.baseUrl"
              type="text"
              placeholder="https://example.com/v1"
              class="retro-focus retro-select-surface h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              @update:model-value="(value) => patchProvider({ baseUrl: String(value) })"
            />
          </div>
        </div>

        <div class="grid gap-2">
          <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">API 密钥</Label>
          <Input
            :model-value="activeProvider.apiKey"
            type="password"
            placeholder="sk-..."
            class="retro-focus retro-select-surface h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            @update:model-value="(value) => patchProvider({ apiKey: String(value) })"
          />
        </div>

        <div class="grid gap-2 border border-neon-deep/30 bg-panel/40 p-3">
          <p class="font-mono text-[11px] uppercase tracking-wider text-text-dim">模型摘要</p>
          <div class="grid gap-2 text-xs leading-5 text-text-main">
            <p v-if="primaryModel">主模型：<span class="font-mono text-neon">{{ primaryModel.id }}</span></p>
            <p v-else class="text-text-dim">尚未配置模型，进入模型配置后添加。</p>
            <p>共 {{ activeProvider.models.length }} 个模型 · 回退策略：{{ strategyLabel(activeProvider.fallbackStrategy) }}</p>
            <p v-if="activeProvider.fetchedModels.length" class="text-text-dim">
              已拉取 {{ activeProvider.fetchedModels.length }} 个可选模型 · {{ formatFetchedAt(activeProvider.modelsFetchedAt) }}
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs text-danger/90 hover:!border-danger/60 hover:!text-danger"
            @click="emit('deleteProvider', activeProvider.id)"
          >
            <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
            删除预设
          </button>
        </div>
      </div>

      <div v-else class="grid h-full place-items-center p-6">
        <div class="grid max-w-md gap-3 text-center">
          <div class="mx-auto grid h-12 w-12 place-items-center border border-neon-deep/45 bg-elevated/50 text-neon">
            <Server class="h-5 w-5" aria-hidden="true" />
          </div>
          <p class="font-mono text-sm font-bold text-text-main">没有本地服务商预设</p>
          <p class="text-sm leading-6 text-text-dim">当前会继续使用环境默认配置；新增预设后可拉取模型并保存为本地默认。</p>
          <button
            type="button"
            class="retro-button retro-focus mx-auto inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            @click="emit('addProvider')"
          >
            <Plus class="h-3.5 w-3.5" aria-hidden="true" />
            新增预设
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Plus, Server, Settings2, Trash2 } from "lucide-vue-next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  BrowserAiProviderPreset,
  BrowserAiFallbackStrategy,
  BrowserPlatformConfigDraft,
} from "@/config/ai"

const props = defineProps<{
  draft: BrowserPlatformConfigDraft
  activeProviderId: string
}>()

const emit = defineEmits<{
  (e: "selectProvider", id: string): void
  (e: "addProvider"): void
  (e: "deleteProvider", id: string): void
  (e: "enterModels", id: string): void
  (e: "patchProvider", patch: Partial<BrowserAiProviderPreset> & { id: string }): void
}>()

const activeProvider = computed(() =>
  props.draft.providers.find((provider) => provider.id === props.activeProviderId) ?? null,
)

const primaryModel = computed(
  () => activeProvider.value?.models.find((model) => model.enabled) ?? activeProvider.value?.models[0] ?? null,
)

function strategyLabel(strategy: BrowserAiFallbackStrategy): string {
  return strategy === "ordered" ? "按顺序回退" : "仅主模型"
}

function patchProvider(patch: Partial<BrowserAiProviderPreset>): void {
  if (!activeProvider.value) {
    return
  }
  emit("patchProvider", { ...patch, id: activeProvider.value.id })
}

function formatFetchedAt(value: string): string {
  if (!value) {
    return "刚刚"
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleString()
}
</script>
