<template>
  <div class="grid h-full min-h-[260px] place-items-center p-6">
    <div class="max-w-md text-center">
      <template v-if="hasActiveCard">
        <span class="mx-auto grid h-14 w-14 place-items-center border border-neon/40 bg-neon/8 text-neon">
          <Sparkles class="h-7 w-7" aria-hidden="true" />
        </span>
        <p class="mt-4 font-mono text-xs uppercase tracking-[0.22em] text-neon">桌面助手</p>
        <p class="mt-2 text-sm leading-6 text-text-dim">
          向助手询问当前游戏卡的内容、Agent、Skill 或编辑方式。
        </p>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion.label"
            type="button"
            class="retro-focus border border-neon-deep/40 bg-panel/50 px-3 py-1.5 font-mono text-xs text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
            @click="$emit('suggest', suggestion.message)"
          >
            {{ suggestion.label }}
          </button>
        </div>
      </template>
      <template v-else>
        <span class="mx-auto grid h-14 w-14 place-items-center border border-neon-muted/40 bg-panel/60 text-neon-muted">
          <Bot class="h-7 w-7" aria-hidden="true" />
        </span>
        <p class="mt-4 font-mono text-xs uppercase tracking-[0.22em] text-warning">未加载游戏卡</p>
        <p class="mt-2 text-sm leading-6 text-text-dim">
          桌面助手需要一张游戏卡作为上下文。请先创建、导入或加载一张游戏卡。
        </p>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            @click="$emit('openLibrary')"
          >
            去我的应用
          </button>
          <button
            type="button"
            class="retro-focus inline-flex h-8 items-center gap-2 border border-neon-deep/40 bg-elevated px-3 font-mono text-xs text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
            @click="$emit('openMarket')"
          >
            去创意工坊
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Bot, Sparkles } from "lucide-vue-next"
import type { AssistantSuggestion } from "./types"

defineProps<{
  hasActiveCard: boolean
  suggestions: AssistantSuggestion[]
}>()

defineEmits<{
  suggest: [message: string]
  openLibrary: []
  openMarket: []
}>()
</script>
