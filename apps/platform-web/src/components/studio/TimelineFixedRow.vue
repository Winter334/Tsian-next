<template>
  <article class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border border-neon-deep/25 bg-void/35 px-3 py-2">
    <LockKeyhole class="h-3.5 w-3.5 text-text-dim/70" aria-hidden="true" />
    <div class="min-w-0">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span v-if="role" class="border px-1.5 py-0.5 font-mono text-[10px] uppercase" :class="roleBadgeClass(role)">
          {{ roleLabel(role) }}
        </span>
        <span class="border border-neon-deep/35 bg-panel/45 px-1.5 py-0.5 font-mono text-[10px] text-text-dim">
          固定
        </span>
        <p class="truncate text-sm font-bold text-text-main">{{ title }}</p>
        <ParamTip v-if="tip" :label="title" :tip="tip" />
        <span
          v-for="source in sources"
          :key="source"
          class="truncate border border-neon-deep/25 bg-elevated/35 px-1.5 py-0.5 text-[10px] text-neon-muted"
        >
          {{ source }}
        </span>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { LockKeyhole } from "lucide-vue-next"
import { ParamTip } from "@/components/ui/tip"
import type { ContextPathRole } from "./message-sequence"
import { roleBadgeClass, roleLabel } from "./message-sequence"

withDefaults(defineProps<{
  title: string
  role?: ContextPathRole
  sources?: string[]
  tip?: string
}>(), {
  sources: () => [],
})
</script>
