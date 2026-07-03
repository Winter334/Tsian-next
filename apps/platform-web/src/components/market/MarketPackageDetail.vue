<template>
  <div class="grid gap-4">
    <div class="retro-inset relative aspect-[16/9] overflow-hidden">
      <img
        v-if="pkg.coverUrl && !coverFailed"
        :src="pkg.coverUrl"
        :alt="pkg.name"
        class="absolute inset-0 h-full w-full object-cover"
        decoding="async"
        @error="coverFailed = true"
      />
      <div v-else :class="visual.coverClass" class="absolute inset-0 grid place-items-center">
        <component :is="visual.icon" class="h-20 w-20 text-text-main/60" aria-hidden="true" />
      </div>
      <div class="pointer-events-none absolute inset-0 bg-noise opacity-30 mix-blend-overlay" aria-hidden="true" />

      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/86 to-transparent p-5">
        <div class="max-w-3xl">
          <span
            :class="visual.accentClass"
            class="inline-flex items-center gap-1 border bg-void/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
          >
            <component :is="visual.icon" class="h-3 w-3" aria-hidden="true" />
            {{ visual.label }}
          </span>
          <h1 class="mt-2 text-2xl font-black leading-tight text-text-main md:text-3xl">{{ pkg.name }}</h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-text-main/90">{{ pkg.summary }}</p>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3 font-mono text-[11px] text-text-dim">
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

    <div v-if="pkg.tags.length > 0" class="flex flex-wrap gap-1">
      <span
        v-for="tag in pkg.tags"
        :key="tag"
        class="border border-neon-deep/30 bg-neon/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-muted transition-colors hover:text-neon"
      >
        #{{ tag }}
      </span>
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
import { computed, ref, watch } from "vue"
import { Download, PenLine, Tag } from "lucide-vue-next"
import { getResourceTypeVisual } from "./resource-type-visual"

const props = defineProps<{
  pkg: MarketPackage
  installing: boolean
}>()

defineEmits<{
  install: [pkg: MarketPackage]
}>()

const visual = computed(() => getResourceTypeVisual(props.pkg.resourceType))
const coverFailed = ref(false)

watch(() => props.pkg.id, () => {
  coverFailed.value = false
})

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}
</script>
