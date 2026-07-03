<template>
  <div class="grid gap-4">
    <div class="flex gap-4">
      <div class="grid h-24 w-24 shrink-0 place-items-center overflow-hidden border border-neon-deep/30 bg-panel">
        <img
          v-if="pkg.coverUrl"
          :src="pkg.coverUrl"
          :alt="pkg.name"
          class="h-full w-full object-cover"
        />
        <span v-else class="text-2xl font-bold text-neon">{{ pkg.name.charAt(0).toUpperCase() }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 class="text-lg font-bold text-text-main">{{ pkg.name }}</h2>
            <p class="mt-1 text-sm text-text-dim">{{ pkg.summary }}</p>
          </div>
          <span class="border border-neon-deep/40 px-2 py-1 font-mono text-[10px] text-text-dim">
            {{ resourceLabel }}
          </span>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11px] text-text-dim">
          <span class="flex items-center gap-1">
            <PenLine class="h-3.5 w-3.5" aria-hidden="true" />
            {{ pkg.resourceAuthor || "未知作者" }}
          </span>
          <span v-if="pkg.resourceVersion" class="flex items-center gap-1">
            <Tag class="h-3.5 w-3.5" aria-hidden="true" />
            v{{ pkg.resourceVersion }}
          </span>
          <span class="flex items-center gap-1">
            <Download class="h-3.5 w-3.5" aria-hidden="true" />
            {{ pkg.downloadCount }} 次下载
          </span>
          <span>{{ formatDate(pkg.createdAt) }}</span>
        </div>
        <div v-if="pkg.tags.length > 0" class="mt-3 flex flex-wrap gap-1">
          <span
            v-for="tag in pkg.tags"
            :key="tag"
            class="border border-neon-deep/30 px-1.5 py-0.5 font-mono text-[10px] text-text-dim"
          >
            #{{ tag }}
          </span>
        </div>
      </div>
    </div>
    <button
      type="button"
      class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-4 font-mono text-xs"
      :disabled="installing"
      @click="$emit('install', pkg)"
    >
      <Download class="h-3.5 w-3.5" aria-hidden="true" />
      {{ installing ? "安装中…" : "下载并安装" }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { MarketPackage } from "@tsian/contracts"
import { computed } from "vue"
import { Download, PenLine, Tag } from "lucide-vue-next"

const props = defineProps<{
  pkg: MarketPackage
  installing: boolean
}>()

defineEmits<{
  install: [pkg: MarketPackage]
}>()

const resourceLabel = computed(() => {
  switch (props.pkg.resourceType) {
    case "agent":
      return "Agent"
    case "skill":
      return "Skill"
    case "game_card":
    default:
      return "游戏卡"
  }
})

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}
</script>
