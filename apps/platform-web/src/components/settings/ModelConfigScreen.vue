<template>
  <div v-if="preset" class="grid min-h-0 content-start overflow-auto p-3">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="grid gap-1">
        <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">回退策略</Label>
        <Select
          :model-value="preset.fallbackStrategy"
          @update:model-value="(value) => emit('setStrategy', value as 'primary-only' | 'ordered')"
        >
          <SelectTrigger class="h-8 w-[180px]">
            <SelectValue placeholder="选择回退策略" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="primary-only">仅主模型</SelectItem>
            <SelectItem value="ordered">按顺序回退</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div class="border border-neon-deep/35 bg-panel/40">
      <div class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-2 border-b border-neon-deep/25 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
        <span class="w-8 text-center">序</span>
        <span>模型</span>
        <span class="w-16 text-center">状态</span>
        <span class="w-24 text-center">参数</span>
        <span class="w-24 text-right">操作</span>
      </div>

      <div
        v-for="(model, index) in preset.models"
        :key="model.id"
        class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 border-b border-neon-deep/15 px-3 py-2 last:border-b-0"
      >
        <span class="w-8 text-center font-mono text-[11px] text-text-dim">{{ index + 1 }}</span>
        <span class="min-w-0">
          <span class="block truncate font-mono text-xs text-text-main">{{ model.id || "(未命名模型)" }}</span>
          <span class="block font-mono text-[10px] text-text-dim/80">{{ roleLabel(index) }}</span>
        </span>
        <span class="flex w-16 items-center justify-center">
          <Switch
            :model-value="model.enabled"
            @update:model-value="(value) => emit('patchModel', { id: model.id, patch: { enabled: Boolean(value) } })"
          />
        </span>
        <span class="flex w-24 items-center justify-center">
          <button
            type="button"
            class="retro-focus retro-select-surface inline-flex h-7 items-center gap-1 border border-neon-deep/40 bg-elevated px-2 font-mono text-[10px] uppercase tracking-wider text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
            title="编辑参数"
            @click="emit('editModelParams', model.id)"
          >
            <SlidersHorizontal class="h-3 w-3" aria-hidden="true" />
            编辑
          </button>
        </span>
        <span class="flex w-24 items-center justify-end gap-1">
          <button
            type="button"
            class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon disabled:opacity-30"
            :disabled="index === 0"
            title="上移"
            @click="emit('moveModel', { id: model.id, direction: 'up' })"
          >
            <ChevronUp class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon disabled:opacity-30"
            :disabled="index === preset.models.length - 1"
            title="下移"
            @click="emit('moveModel', { id: model.id, direction: 'down' })"
          >
            <ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="retro-focus grid h-6 w-6 place-items-center border border-danger/40 bg-danger/8 text-danger/85 transition-colors hover:bg-danger/20 hover:text-danger disabled:opacity-30"
            :disabled="preset.models.length <= 1"
            title="删除模型"
            @click="emit('deleteModel', model.id)"
          >
            <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>

      <div
        v-if="preset.models.length === 0"
        class="grid place-items-center px-3 py-10 text-center"
      >
        <div class="grid max-w-xs gap-2">
          <p class="font-mono text-xs text-text-dim">尚未添加模型</p>
          <p class="text-xs leading-5 text-text-dim/80">点击右上「添加模型」，拉取或输入模型 id。</p>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="grid h-full place-items-center p-6">
    <p class="text-sm text-text-dim">未选择服务商预设。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import {
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Trash2,
} from "lucide-vue-next"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { BrowserAiProviderPreset } from "@/config/ai"

const props = defineProps<{
  preset: BrowserAiProviderPreset | null
}>()

const emit = defineEmits<{
  (e: "deleteModel", id: string): void
  (e: "moveModel", payload: { id: string; direction: "up" | "down" }): void
  (e: "patchModel", payload: { id: string; patch: Partial<{ enabled: boolean }> }): void
  (e: "editModelParams", modelId: string): void
  (e: "setStrategy", strategy: "primary-only" | "ordered"): void
}>()

function roleLabel(index: number): string {
  if (index === 0) {
    return "主模型"
  }
  return props.preset?.fallbackStrategy === "ordered" ? `回退 #${index}` : "回退(未启用)"
}
</script>
