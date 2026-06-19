<template>
  <div class="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
    <!-- Provider type sidebar (resident built-in types, no add/remove) -->
    <aside class="flex min-h-0 flex-col border-r border-neon-deep/30 bg-[#2a271f]">
      <div class="border-b border-neon-deep/25 px-3 py-2.5">
        <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">提供商类型</p>
      </div>

      <div class="min-h-0 flex-1 overflow-auto py-1">
        <button
          v-for="type in draft.providerTypes"
          :key="type.id"
          type="button"
          class="retro-focus group relative block w-full px-3 py-2 text-left transition-colors"
          :class="type.id === activeTypeId
            ? 'bg-neon/10 text-neon'
            : isTypeAvailable(type)
              ? 'text-text-dim hover:bg-panel/40 hover:text-text-main'
              : 'text-text-dim/40'"
          @click="emit('selectType', type.id)"
        >
          <span class="flex items-center gap-1.5">
            <span class="truncate text-xs font-bold">{{ type.name }}</span>
            <span
              v-if="!isTypeAvailable(type)"
              class="font-mono text-[9px] uppercase tracking-wider text-text-dim/50"
            >敬请期待</span>
          </span>
          <span class="mt-0.5 block font-mono text-[10px] text-text-dim/80">{{ type.presets.length }} 个预设</span>
          <span
            v-if="type.id === activeTypeId"
            class="absolute inset-y-1 left-0 w-0.5 bg-neon"
            aria-hidden="true"
          />
        </button>
      </div>
    </aside>

    <!-- Preset cards -->
    <section class="grid min-h-0 overflow-auto p-4">
      <div v-if="activeType" class="grid content-start gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/25 pb-3">
          <div class="min-w-0">
            <p class="font-mono text-[10px] uppercase tracking-wider text-neon">{{ activeType.name }}</p>
            <h2 class="mt-1 text-sm font-bold text-text-main">{{ activeType.presets.length }} 个预设</h2>
          </div>
          <button
            v-if="isTypeAvailable(activeType)"
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            @click="emit('addPreset', activeType.id)"
          >
            <Plus class="h-3.5 w-3.5" aria-hidden="true" />
            添加预设
          </button>
        </div>

        <!-- Upcoming type notice -->
        <div
          v-if="!isTypeAvailable(activeType)"
          class="grid place-items-center border border-neon-deep/30 bg-panel/40 px-4 py-10 text-center"
        >
          <div class="grid max-w-xs gap-2">
            <p class="font-mono text-sm font-bold text-text-main">{{ activeType.name }} 即将支持</p>
            <p class="text-sm leading-6 text-text-dim">该协议的调用路径尚在开发中，暂不可添加预设。请先用 OpenAI 兼容类型。</p>
          </div>
        </div>

        <div
          v-else
          class="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          :class="activeType.presets.length === 0 ? 'place-content-center' : ''"
        >
          <article
            v-for="preset in activeType.presets"
            :key="preset.id"
            class="retro-inset grid content-start gap-2.5 p-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-bold text-text-main">{{ preset.name || "未命名" }}</p>
              <p class="mt-0.5 truncate font-mono text-[10px] text-text-dim/80">{{ preset.baseUrl || "未设置接口地址" }}</p>
            </div>

            <div class="grid gap-1 font-mono text-[10px] text-text-dim/80">
              <p>主模型：<span class="text-neon">{{ primaryModelId(preset) || "未配置" }}</span></p>
              <p>{{ preset.models.length }} 个模型 · {{ strategyLabel(preset.fallbackStrategy) }}</p>
            </div>

            <div class="mt-auto flex items-center gap-1.5 pt-1">
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 flex-1 items-center justify-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider"
                @click="emit('enterModels', activeType.id, preset.id)"
              >
                <Settings2 class="h-3 w-3" aria-hidden="true" />
                模型配置
              </button>
              <button
                type="button"
                class="retro-focus grid h-7 w-7 shrink-0 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-danger/55 hover:text-danger"
                title="删除预设"
                @click="emit('deletePreset', activeType.id, preset.id)"
              >
                <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </article>

          <div
            v-if="activeType.presets.length === 0"
            class="grid place-items-center border border-neon-deep/30 bg-panel/40 px-4 py-10 text-center md:col-span-2 xl:col-span-3"
          >
            <div class="grid max-w-xs gap-2">
              <p class="font-mono text-xs text-text-dim">该类型下尚无预设</p>
              <p class="text-xs leading-5 text-text-dim/80">点击右上「添加预设」创建你的第一个服务商配置。</p>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="grid h-full place-items-center p-6">
        <div class="grid max-w-md gap-3 text-center">
          <div class="mx-auto grid h-12 w-12 place-items-center border border-neon-deep/45 bg-elevated/50 text-neon">
            <Server class="h-5 w-5" aria-hidden="true" />
          </div>
          <p class="font-mono text-sm font-bold text-text-main">尚未选择提供商类型</p>
          <p class="text-sm leading-6 text-text-dim">从左侧选择一个提供商类型，再在该类型下创建预设。</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Plus, Server, Settings2, Trash2 } from "lucide-vue-next"
import {
  PROVIDER_TYPE_KINDS,
  type BrowserAiFallbackStrategy,
  type BrowserAiProviderPreset,
  type BrowserAiProviderType,
  type BrowserPlatformConfigDraft,
} from "@/config/ai"

const props = defineProps<{
  draft: BrowserPlatformConfigDraft
  activeTypeId: string
}>()

const emit = defineEmits<{
  (e: "selectType", typeId: string): void
  (e: "addPreset", typeId: string): void
  (e: "deletePreset", typeId: string, presetId: string): void
  (e: "enterModels", typeId: string, presetId: string): void
  (e: "patchPreset", payload: { typeId: string; presetId: string; patch: Partial<BrowserAiProviderPreset> }): void
}>()

const activeType = computed(
  () => props.draft.providerTypes.find((type) => type.id === props.activeTypeId) ?? null,
)

function isTypeAvailable(type: BrowserAiProviderType): boolean {
  return PROVIDER_TYPE_KINDS.find((entry) => entry.kind === type.kind)?.available ?? false
}

function primaryModelId(preset: BrowserAiProviderPreset): string {
  return preset.models.find((model) => model.enabled)?.id ?? preset.models[0]?.id ?? ""
}

function strategyLabel(strategy: BrowserAiFallbackStrategy): string {
  return strategy === "ordered" ? "按顺序回退" : "仅主模型"
}
</script>
