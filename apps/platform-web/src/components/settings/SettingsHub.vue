<template>
  <div class="grid h-full min-h-0 place-items-start overflow-auto p-5">
    <div class="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <button
        v-for="entry in entries"
        :key="entry.id"
        type="button"
        class="retro-focus retro-inset group grid gap-3 p-4 text-left transition-colors hover:border-neon/45"
        @click="emit('enter', entry.id)"
      >
        <div class="flex items-center gap-3">
          <span class="grid h-10 w-10 shrink-0 place-items-center border border-neon-deep/45 bg-elevated/50 text-neon">
            <component :is="entry.icon" class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">{{ entry.kind }}</p>
            <h3 class="truncate text-sm font-bold text-text-main group-hover:text-neon">{{ entry.title }}</h3>
          </div>
        </div>
        <p class="text-xs leading-5 text-text-dim">{{ entry.subtitle }}</p>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from "vue"
import { Bot } from "lucide-vue-next"
import { computed } from "vue"
import type { BrowserPlatformConfigDraft } from "@/config/ai"

const props = defineProps<{
  draft: BrowserPlatformConfigDraft
}>()

const emit = defineEmits<{
  (e: "enter", id: string): void
}>()

interface HubEntry {
  id: string
  kind: string
  title: string
  subtitle: string
  icon: Component
}

const entries = computed<HubEntry[]>(() => {
  let presetCount = 0
  let modelCount = 0
  for (const type of props.draft.providerTypes) {
    presetCount += type.presets.length
    for (const preset of type.presets) {
      modelCount += preset.models.length
    }
  }
  return [
    {
      id: "ai-providers",
      kind: "AI",
      title: "AI 提供商",
      subtitle: `${presetCount} 个预设 · ${modelCount} 个模型`,
      icon: Bot,
    },
  ]
})
</script>
