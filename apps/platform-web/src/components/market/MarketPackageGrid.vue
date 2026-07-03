<template>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <button
      v-for="pkg in packages"
      :key="pkg.id"
      type="button"
      class="retro-focus selection-tile grid gap-2 border p-3 text-left"
      @click="$emit('open', pkg.id)"
    >
      <div class="flex gap-3">
        <div class="grid h-16 w-16 shrink-0 place-items-center overflow-hidden border border-neon-deep/30 bg-panel">
          <img
            v-if="pkg.coverUrl"
            :src="pkg.coverUrl"
            :alt="pkg.name"
            class="h-full w-full object-cover"
          />
          <span v-else class="text-lg font-bold text-neon">{{ pkg.name.charAt(0).toUpperCase() }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-bold text-text-main">{{ pkg.name }}</h3>
          <p class="mt-0.5 line-clamp-2 text-xs text-text-dim">{{ pkg.summary }}</p>
        </div>
      </div>
      <div class="flex items-center justify-between border-t border-neon-deep/20 pt-2 font-mono text-[10px] text-text-dim">
        <span class="truncate">{{ pkg.resourceAuthor || "未知作者" }}</span>
        <span class="flex items-center gap-1">
          <Download class="h-3 w-3" aria-hidden="true" />
          {{ pkg.downloadCount }}
        </span>
      </div>
      <div v-if="pkg.tags.length > 0" class="flex flex-wrap gap-1">
        <span
          v-for="tag in pkg.tags"
          :key="tag"
          class="border border-neon-deep/30 px-1.5 py-0.5 font-mono text-[10px] text-text-dim"
        >
          #{{ tag }}
        </span>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { MarketPackage } from "@tsian/contracts"
import { Download } from "lucide-vue-next"

defineProps<{
  packages: MarketPackage[]
}>()

defineEmits<{
  open: [id: string]
}>()
</script>
