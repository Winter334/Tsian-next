<template>
  <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
    <button
      v-for="pkg in packages"
      :key="pkg.id"
      type="button"
      class="retro-focus selection-tile group relative aspect-[4/5] w-full overflow-hidden border border-neon-deep/40 transition-shadow group-hover:shadow-neon-glow"
      @click="$emit('open', pkg.id)"
    >
      <img
        v-if="coverUrl(pkg) && !failedCoverIds.has(pkg.id)"
        :src="coverUrl(pkg)!"
        :alt="pkg.name"
        class="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        @error="failedCoverIds.add(pkg.id)"
      />
      <div v-else :class="visual(pkg.resourceType).coverClass" class="absolute inset-0 grid place-items-center">
        <component :is="visual(pkg.resourceType).icon" class="h-12 w-12 text-text-main/70" aria-hidden="true" />
      </div>
      <div class="pointer-events-none absolute inset-0 bg-noise opacity-30 mix-blend-overlay" aria-hidden="true" />

      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/85 to-transparent p-3">
        <h3 class="truncate text-sm font-bold text-text-main">{{ pkg.name }}</h3>
        <p class="mt-0.5 truncate text-[11px] leading-4 text-text-dim/90">{{ pkg.summary }}</p>
        <div class="mt-1.5 flex items-center justify-between font-mono text-[10px] text-text-dim">
          <span class="truncate">{{ pkg.resourceAuthor || "未知作者" }}</span>
          <span class="flex shrink-0 items-center gap-1">
            <Download class="h-3 w-3" aria-hidden="true" />
            {{ pkg.downloadCount }}
          </span>
        </div>
        <div v-if="pkg.tags.length > 0" class="mt-1.5 flex flex-wrap gap-1">
          <span
            v-for="tag in pkg.tags"
            :key="tag"
            class="border border-neon-deep/30 bg-neon/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-muted transition-colors hover:text-neon"
          >
            #{{ tag }}
          </span>
        </div>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { MarketPackage } from "@tsian/contracts"
import { reactive } from "vue"
import { Download } from "lucide-vue-next"
import { getResourceTypeVisual } from "./resource-type-visual"

const failedCoverIds = reactive(new Set<string>())

defineProps<{
  packages: MarketPackage[]
}>()

defineEmits<{
  open: [id: string]
}>()

function visual(type: MarketPackage["resourceType"]) {
  return getResourceTypeVisual(type)
}

function coverUrl(pkg: MarketPackage): string | null {
  return pkg.coverThumbUrl ?? pkg.coverUrl
}
</script>
