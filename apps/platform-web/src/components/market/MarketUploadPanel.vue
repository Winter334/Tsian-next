<template>
  <div class="grid gap-4">
    <div class="grid gap-2">
      <p class="font-mono text-xs text-text-dim">选择资源类型：</p>
      <div class="grid gap-2 sm:grid-cols-3">
        <button
          v-for="option in resourceTypes"
          :key="option.type"
          type="button"
          class="retro-focus grid gap-1 border p-3 text-left font-mono text-xs"
          :class="uploadType === option.type
            ? 'border-neon bg-neon/10 text-neon'
            : 'border-neon-deep/35 bg-elevated/60 text-text-dim hover:text-text-main'"
          @click="selectUploadType(option.type)"
        >
          <span class="font-bold">{{ option.label }}</span>
          <span class="text-[10px] opacity-75">{{ option.description }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="grid place-items-center py-12">
      <p class="font-mono text-xs text-text-dim">读取本地资源…</p>
    </div>
    <div v-else class="grid gap-3">
      <template v-if="uploadType === 'game_card'">
        <p v-if="cards.length === 0" class="text-sm text-text-dim">本地没有可上传的游戏卡。</p>
        <button
          v-for="card in cards"
          :key="card.id"
          type="button"
          class="retro-focus selection-tile grid gap-2 border p-3 text-left"
          :class="{ 'selection-tile--active': selectedCardId === card.id }"
          @click="selectCard(card.id)"
        >
          <div class="flex gap-3">
            <div class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden border border-neon-deep/30 bg-panel">
              <img
                v-if="getGameCardCoverUrl(card)"
                :src="getGameCardCoverUrl(card) ?? ''"
                :alt="card.manifest.name || ''"
                class="h-full w-full object-cover"
              />
              <span v-else class="text-sm font-bold text-neon">{{ (card.manifest.name || '?').charAt(0).toUpperCase() }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-sm font-bold text-text-main">{{ card.manifest.name || "未命名" }}</h3>
              <p class="mt-0.5 line-clamp-1 text-xs text-text-dim">{{ card.manifest.summary || "暂无简介" }}</p>
              <p class="mt-0.5 font-mono text-[10px] text-text-dim">v{{ card.manifest.version }}</p>
            </div>
          </div>
        </button>
      </template>

      <template v-else-if="uploadType === 'agent'">
        <p v-if="agentOptions.length === 0" class="text-sm text-text-dim">没有可上传的 Agent。</p>
        <button
          v-for="option in agentOptions"
          :key="option.key"
          type="button"
          class="retro-focus selection-tile grid gap-1 border p-3 text-left"
          :class="{ 'selection-tile--active': selectedAgentKey === option.key }"
          @click="selectAgent(option.key)"
        >
          <span class="text-sm font-bold text-text-main">{{ option.label }}</span>
          <span class="text-xs text-text-dim">{{ option.summary || '暂无简介' }}</span>
          <span class="font-mono text-[10px] text-text-dim">{{ option.resourceId }}</span>
        </button>
      </template>

      <template v-else>
        <p v-if="skillOptions.length === 0" class="text-sm text-text-dim">没有可上传的 Skill。</p>
        <button
          v-for="option in skillOptions"
          :key="option.key"
          type="button"
          class="retro-focus selection-tile grid gap-1 border p-3 text-left"
          :class="{ 'selection-tile--active': selectedSkillKey === option.key }"
          @click="selectSkill(option.key)"
        >
          <span class="text-sm font-bold text-text-main">{{ option.label }}</span>
          <span class="text-xs text-text-dim">{{ option.summary || '暂无简介' }}</span>
          <span class="font-mono text-[10px] text-text-dim">{{ option.resourceId }}</span>
        </button>
      </template>

      <div v-if="hasSelection" class="grid gap-3 border-t border-neon-deep/20 pt-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="grid gap-1">
            <span class="font-mono text-[10px] text-text-dim">标题（可选）</span>
            <input
              v-model="title"
              type="text"
              class="retro-focus retro-select-surface border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
              placeholder="资源标题"
            />
          </label>
          <label class="grid gap-1">
            <span class="font-mono text-[10px] text-text-dim">版本（可选）</span>
            <input
              v-model="version"
              type="text"
              class="retro-focus retro-select-surface border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
              placeholder="0.1.0"
            />
          </label>
        </div>
        <label class="grid gap-1">
          <span class="font-mono text-[10px] text-text-dim">作者（可选）</span>
          <input
            v-model="author"
            type="text"
            class="retro-focus retro-select-surface border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
            placeholder="作者名"
          />
        </label>
        <label class="grid gap-1">
          <span class="font-mono text-[10px] text-text-dim">简介（可选）</span>
          <textarea
            v-model="summary"
            rows="2"
            class="retro-focus retro-select-surface border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
            placeholder="资源简介"
          />
        </label>
        <label class="grid gap-1">
          <span class="font-mono text-[10px] text-text-dim">Tags（可选，逗号分隔）</span>
          <input
            v-model="tags"
            type="text"
            class="retro-focus retro-select-surface border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
            placeholder="tool, narrative"
          />
        </label>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-4 font-mono text-xs"
          :disabled="uploading"
          @click="submit"
        >
          <Upload class="h-3.5 w-3.5" aria-hidden="true" />
          {{ uploading ? "上传中…" : "确认上传" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MarketResourceType } from "@tsian/contracts"
import type { LocalGameCardView } from "@/storage/game-cards"
import { computed, ref, watch } from "vue"
import { Upload } from "lucide-vue-next"
import { getGameCardCoverUrl } from "@/lib/game-card-display"
import type {
  AgentUploadOption,
  MarketResourceTypeOption,
  MarketUploadSubmitPayload,
  SkillUploadOption,
} from "./types"

const props = defineProps<{
  resourceTypes: MarketResourceTypeOption[]
  initialType: MarketResourceType
  cards: LocalGameCardView[]
  agentOptions: AgentUploadOption[]
  skillOptions: SkillUploadOption[]
  loading: boolean
  uploading: boolean
}>()

const emit = defineEmits<{
  submit: [payload: MarketUploadSubmitPayload]
}>()

const uploadType = ref<MarketResourceType>(props.initialType)
const selectedCardId = ref("")
const selectedAgentKey = ref("")
const selectedSkillKey = ref("")
const title = ref("")
const summary = ref("")
const author = ref("")
const version = ref("")
const tags = ref("")

const selectedAgent = computed(() => props.agentOptions.find((option) => option.key === selectedAgentKey.value) ?? null)
const selectedSkill = computed(() => props.skillOptions.find((option) => option.key === selectedSkillKey.value) ?? null)
const hasSelection = computed(() => {
  if (uploadType.value === "game_card") return Boolean(selectedCardId.value)
  if (uploadType.value === "agent") return Boolean(selectedAgent.value)
  return Boolean(selectedSkill.value)
})

watch(() => props.initialType, (value) => {
  uploadType.value = value
  clearSelection()
})

function selectUploadType(type: MarketResourceType): void {
  uploadType.value = type
  clearSelection()
}

function clearSelection(): void {
  selectedCardId.value = ""
  selectedAgentKey.value = ""
  selectedSkillKey.value = ""
  title.value = ""
  summary.value = ""
  author.value = ""
  version.value = ""
  tags.value = ""
}

function selectCard(cardId: string): void {
  selectedCardId.value = cardId
  const card = props.cards.find((candidate) => candidate.id === cardId)
  title.value = card?.manifest.name ?? ""
  summary.value = card?.manifest.summary ?? ""
  author.value = card?.manifest.author?.name ?? ""
  version.value = card?.manifest.version ?? ""
}

function selectAgent(key: string): void {
  selectedAgentKey.value = key
  const option = selectedAgent.value
  title.value = option?.label ?? ""
  summary.value = option?.summary ?? ""
  version.value = "0.1.0"
}

function selectSkill(key: string): void {
  selectedSkillKey.value = key
  const option = selectedSkill.value
  title.value = option?.label ?? ""
  summary.value = option?.summary ?? ""
  version.value = "0.1.0"
}

function submit(): void {
  const common = {
    title: title.value || undefined,
    summary: summary.value || undefined,
    author: author.value || undefined,
    version: version.value || undefined,
    tags: tags.value || undefined,
  }
  if (uploadType.value === "game_card" && selectedCardId.value) {
    emit("submit", { resourceType: "game_card", cardId: selectedCardId.value, ...common })
    return
  }
  if (uploadType.value === "agent" && selectedAgent.value) {
    emit("submit", { resourceType: "agent", source: selectedAgent.value.source, ...common })
    return
  }
  if (uploadType.value === "skill" && selectedSkill.value) {
    emit("submit", { resourceType: "skill", source: selectedSkill.value.source, ...common })
  }
}
</script>
