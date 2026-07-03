<template>
  <FloatingWindow
    :title="dialogTitle"
    width-class="max-w-xl"
    overlay="dim"
    :close-on-overlay-click="true"
    @close="$emit('close')"
  >
    <div class="grid max-h-[min(72vh,34rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <header class="min-w-0 border-b border-neon-deep/30 pb-3">
        <h2 class="truncate text-base font-bold text-text-main">{{ pkg.name }}</h2>
        <p class="mt-1 truncate font-mono text-[11px] text-text-dim">{{ pkg.resourceId }}</p>
      </header>

      <div v-if="loading" class="grid place-items-center py-8">
        <p class="font-mono text-xs text-text-dim">读取本地资源…</p>
      </div>
      <div v-else-if="options.length === 0" class="py-8 text-center text-sm text-text-dim">
        没有可替换的{{ resourceLabel }}。
      </div>
      <div v-else class="min-h-0 overflow-y-auto pr-1">
        <div class="grid gap-2">
          <button
            v-for="option in options"
            :key="option.key"
            type="button"
            class="retro-focus grid min-w-0 gap-1 border border-neon-deep/35 bg-elevated/60 p-3 text-left text-text-main hover:border-neon-deep"
            @click="$emit('select', option.selection)"
          >
            <span class="min-w-0 truncate font-mono text-xs font-bold">{{ option.label }}</span>
            <span class="break-words text-xs leading-5 text-text-dim">{{ option.summary || '暂无简介' }}</span>
            <span class="min-w-0 truncate font-mono text-[10px] text-text-dim/80">{{ option.resourceId }}</span>
          </button>
        </div>
      </div>
    </div>
  </FloatingWindow>
</template>

<script setup lang="ts">
import type { MarketPackage } from "@tsian/contracts"
import type { LocalGameCardView } from "@/storage/game-cards"
import { computed } from "vue"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import { getGameCardCoverUrl } from "@/lib/game-card-display"
import type { AgentUploadOption, MarketUploadSelectionPayload, SkillUploadOption } from "./types"

interface ReplacementOption {
  key: string
  label: string
  summary: string
  resourceId: string
  selection: MarketUploadSelectionPayload
}

const props = defineProps<{
  pkg: MarketPackage
  cards: LocalGameCardView[]
  agentOptions: AgentUploadOption[]
  skillOptions: SkillUploadOption[]
  loading: boolean
}>()

defineEmits<{
  close: []
  select: [selection: MarketUploadSelectionPayload]
}>()

const resourceLabel = computed(() => {
  switch (props.pkg.resourceType) {
    case "agent":
      return " Agent"
    case "skill":
      return " Skill"
    case "game_card":
    default:
      return "游戏卡"
  }
})

const dialogTitle = computed(() => `选择替换${resourceLabel.value}`)

const options = computed<ReplacementOption[]>(() => {
  switch (props.pkg.resourceType) {
    case "agent":
      return props.agentOptions.map((option) => ({
        key: option.key,
        label: option.label,
        summary: option.summary,
        resourceId: option.resourceId,
        selection: { resourceType: "agent", source: option.source },
      }))
    case "skill":
      return props.skillOptions.map((option) => ({
        key: option.key,
        label: option.label,
        summary: option.summary,
        resourceId: option.resourceId,
        selection: { resourceType: "skill", source: option.source },
      }))
    case "game_card":
    default:
      return props.cards.map((card) => ({
        key: card.id,
        label: card.manifest.name || card.id,
        summary: card.manifest.summary || (getGameCardCoverUrl(card) ? "有封面" : "暂无简介"),
        resourceId: card.manifest.id,
        selection: { resourceType: "game_card", cardId: card.id },
      }))
  }
})
</script>
