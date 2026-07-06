<template>
  <div class="grid gap-4">
    <div class="grid gap-2">
      <p class="font-mono text-xs text-text-dim">选择资源类型：</p>
      <div class="grid gap-2 sm:grid-cols-4">
        <button
          v-for="option in resourceTypes"
          :key="option.type"
          type="button"
          class="retro-focus grid gap-1 border p-3 text-left font-mono text-xs"
          :class="uploadType === option.type
            ? [option.accentClass, 'bg-neon/10']
            : 'border-neon-deep/35 bg-elevated/60 text-text-dim hover:text-text-main'"
          @click="selectUploadType(option.type)"
        >
          <span class="flex items-center gap-1.5 font-bold">
            <component :is="option.icon" class="h-3.5 w-3.5" aria-hidden="true" />
            {{ option.label }}
          </span>
          <span class="text-[10px] opacity-75">{{ option.description }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="grid place-items-center py-12">
      <p class="font-mono text-xs text-text-dim">读取本地资源…</p>
    </div>
    <div v-else class="grid gap-3">
      <p class="font-mono text-[11px] text-text-dim">选择一个本地资源后填写上传信息。</p>

      <template v-if="uploadType === 'game_card'">
        <p v-if="cards.length === 0" class="text-sm text-text-dim">本地没有可上传的游戏卡。</p>
        <div v-else class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <button
            v-for="card in cards"
            :key="card.id"
            type="button"
            class="retro-focus selection-tile group relative aspect-[4/5] w-full overflow-hidden border border-neon-deep/40 transition-shadow group-hover:shadow-neon-glow disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="uploading"
            @click="selectCard(card.id)"
          >
            <img
              v-if="getGameCardCoverUrl(card)"
              :src="getGameCardCoverUrl(card) ?? ''"
              :alt="card.manifest.name || ''"
              class="absolute inset-0 h-full w-full object-cover"
            />
            <div v-else :class="gameCardVisual.coverClass" class="absolute inset-0 grid place-items-center">
              <component :is="gameCardVisual.icon" class="h-10 w-10 text-text-main/70" aria-hidden="true" />
            </div>
            <div class="pointer-events-none absolute inset-0 bg-noise opacity-30 mix-blend-overlay" aria-hidden="true" />
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/85 to-transparent p-2.5">
              <h3 class="truncate text-xs font-bold text-text-main">{{ card.manifest.name || "未命名" }}</h3>
              <p class="mt-0.5 truncate text-[10px] leading-3.5 text-text-dim/90">{{ card.manifest.summary || "暂无简介" }}</p>
              <div class="mt-1 flex items-center justify-between font-mono text-[10px] text-text-dim">
                <span class="truncate">v{{ card.manifest.version }}</span>
                <span class="truncate">{{ card.manifest.author?.name || "未知作者" }}</span>
              </div>
            </div>
          </button>
        </div>
      </template>

      <template v-else-if="uploadType === 'agent'">
        <p v-if="agentOptions.length === 0" class="text-sm text-text-dim">当前加载卡没有可上传的 Agent。</p>
        <div v-else class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <button
            v-for="option in agentOptions"
            :key="option.key"
            type="button"
            class="retro-focus selection-tile group relative aspect-[4/5] w-full overflow-hidden border border-neon-deep/40 transition-shadow group-hover:shadow-neon-glow disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="uploading"
            @click="selectAgent(option.key)"
          >
            <div :class="agentVisual.coverClass" class="absolute inset-0 grid place-items-center">
              <component :is="agentVisual.icon" class="h-10 w-10 text-text-main/70" aria-hidden="true" />
            </div>
            <div class="pointer-events-none absolute inset-0 bg-noise opacity-30 mix-blend-overlay" aria-hidden="true" />
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/85 to-transparent p-2.5">
              <h3 class="truncate text-xs font-bold text-text-main">{{ option.label }}</h3>
              <p class="mt-0.5 truncate text-[10px] leading-3.5 text-text-dim/90">{{ option.summary || '暂无简介' }}</p>
              <div class="mt-1 font-mono text-[10px] text-text-dim">
                <span class="truncate">{{ option.resourceId }}</span>
              </div>
            </div>
          </button>
        </div>
      </template>

      <template v-else-if="uploadType === 'skill'">
        <p v-if="skillOptions.length === 0" class="text-sm text-text-dim">当前加载卡没有可上传的 Skill。</p>
        <div v-else class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <button
            v-for="option in skillOptions"
            :key="option.key"
            type="button"
            class="retro-focus selection-tile group relative aspect-[4/5] w-full overflow-hidden border border-neon-deep/40 transition-shadow group-hover:shadow-neon-glow disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="uploading"
            @click="selectSkill(option.key)"
          >
            <div :class="skillVisual.coverClass" class="absolute inset-0 grid place-items-center">
              <component :is="skillVisual.icon" class="h-10 w-10 text-text-main/70" aria-hidden="true" />
            </div>
            <div class="pointer-events-none absolute inset-0 bg-noise opacity-30 mix-blend-overlay" aria-hidden="true" />
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/85 to-transparent p-2.5">
              <h3 class="truncate text-xs font-bold text-text-main">{{ option.label }}</h3>
              <p class="mt-0.5 truncate text-[10px] leading-3.5 text-text-dim/90">{{ option.summary || '暂无简介' }}</p>
              <div class="mt-1 font-mono text-[10px] text-text-dim">
                <span class="truncate">{{ option.resourceId }}</span>
              </div>
            </div>
          </button>
        </div>
      </template>

      <template v-else-if="uploadType === 'tool'">
        <p v-if="toolOptions.length === 0" class="text-sm text-text-dim">当前加载卡没有可上传的 Tool。</p>
        <div v-else class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          <button
            v-for="option in toolOptions"
            :key="option.key"
            type="button"
            class="retro-focus selection-tile group relative aspect-[4/5] w-full overflow-hidden border border-neon-deep/40 transition-shadow group-hover:shadow-neon-glow disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="uploading"
            @click="selectTool(option.key)"
          >
            <div :class="toolVisual.coverClass" class="absolute inset-0 grid place-items-center">
              <component :is="toolVisual.icon" class="h-10 w-10 text-text-main/70" aria-hidden="true" />
            </div>
            <div class="pointer-events-none absolute inset-0 bg-noise opacity-30 mix-blend-overlay" aria-hidden="true" />
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/85 to-transparent p-2.5">
              <h3 class="truncate text-xs font-bold text-text-main">{{ option.label }}</h3>
              <p class="mt-0.5 truncate text-[10px] leading-3.5 text-text-dim/90">{{ option.summary || '暂无简介' }}</p>
              <div class="mt-1 font-mono text-[10px] text-text-dim">
                <span class="truncate">{{ option.resourceId }}</span>
              </div>
            </div>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MarketResourceType } from "@tsian/contracts"
import type { LocalGameCardView } from "@/storage/game-cards"
import { ref, watch } from "vue"
import { getGameCardCoverUrl } from "@/lib/game-card-display"
import { getResourceTypeVisual } from "./resource-type-visual"
import type {
  AgentUploadOption,
  MarketResourceTypeOption,
  MarketUploadSelectionPayload,
  SkillUploadOption,
  ToolUploadOption,
} from "./types"

const props = defineProps<{
  resourceTypes: MarketResourceTypeOption[]
  initialType: MarketResourceType
  cards: LocalGameCardView[]
  agentOptions: AgentUploadOption[]
  skillOptions: SkillUploadOption[]
  toolOptions: ToolUploadOption[]
  loading: boolean
  uploading: boolean
}>()

const emit = defineEmits<{
  "prepare-upload": [payload: MarketUploadSelectionPayload]
}>()

const uploadType = ref<MarketResourceType>(props.initialType)

const gameCardVisual = getResourceTypeVisual("game_card")
const agentVisual = getResourceTypeVisual("agent")
const skillVisual = getResourceTypeVisual("skill")
const toolVisual = getResourceTypeVisual("tool")

watch(() => props.initialType, (value) => {
  uploadType.value = value
})

function selectUploadType(type: MarketResourceType): void {
  uploadType.value = type
}

function selectCard(cardId: string): void {
  emit("prepare-upload", { resourceType: "game_card", cardId })
}

function selectAgent(key: string): void {
  const option = props.agentOptions.find((candidate) => candidate.key === key)
  if (option) {
    emit("prepare-upload", { resourceType: "agent", source: option.source })
  }
}

function selectSkill(key: string): void {
  const option = props.skillOptions.find((candidate) => candidate.key === key)
  if (option) {
    emit("prepare-upload", { resourceType: "skill", source: option.source })
  }
}

function selectTool(key: string): void {
  const option = props.toolOptions.find((candidate) => candidate.key === key)
  if (option) {
    emit("prepare-upload", { resourceType: "tool", source: option.source })
  }
}
</script>
