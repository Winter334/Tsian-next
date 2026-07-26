<script setup lang="ts">
/** CharacterStageHighlights — 立绘下方的当前态势与稳定特质摘要。 */
import { computed, ref } from "vue"
import type { CharacterStatus, CharacterTrait } from "../../lib/character-types"
import StatusChips from "./StatusChips.vue"
import TraitDetailModal from "./TraitDetailModal.vue"

const props = defineProps<{
  status?: CharacterStatus[]
  traits?: CharacterTrait[]
  entityRef: string | null
}>()

interface TraitRow {
  trait: CharacterTrait
  title: string
  preview: string
  effectCount: number
}

const statusList = computed(() => props.status ?? [])
const traitRows = computed<TraitRow[]>(() => (props.traits ?? []).map((trait) => {
  const firstEffect = trait.effects?.find((effect) => effect.trim().length > 0)
  return {
    trait,
    title: trait.name?.trim() || trait.id,
    preview: trait.description?.trim() || firstEffect || "暂无详细记载。",
    effectCount: trait.effects?.length ?? 0,
  }
}))
const hasStatus = computed(() => statusList.value.length > 0)
const hasTraits = computed(() => traitRows.value.length > 0)
const selectedTrait = ref<CharacterTrait | null>(null)

function openTrait(trait: CharacterTrait): void {
  selectedTrait.value = trait
}

function closeTrait(): void {
  selectedTrait.value = null
}
</script>

<template>
  <section v-if="hasStatus || hasTraits" class="stage-highlights" aria-label="角色态势">
    <header class="stage-highlights-head">
      <span>角色态势</span>
      <span class="stage-highlights-line" aria-hidden="true"></span>
    </header>

    <StatusChips
      v-if="hasStatus"
      class="stage-status"
      :status="statusList"
      :entity-ref="entityRef"
    />

    <div v-if="hasTraits" class="stage-trait-grid">
      <button
        v-for="row in traitRows"
        :key="row.trait.id"
        type="button"
        class="stage-trait"
        :aria-label="`查看天赋特质：${row.title}`"
        @click="openTrait(row.trait)"
      >
        <span class="stage-trait-mark" aria-hidden="true"></span>
        <span class="stage-trait-copy">
          <span class="stage-trait-title">{{ row.title }}</span>
          <span class="stage-trait-preview">{{ row.preview }}</span>
        </span>
        <span v-if="row.effectCount > 0" class="stage-trait-count">{{ row.effectCount }}</span>
      </button>
    </div>

    <TraitDetailModal :trait="selectedTrait" @close="closeTrait" />
  </section>
</template>

<style scoped>
.stage-highlights {
  position: relative;
  overflow-y: auto;
  scrollbar-width: none;
  display: grid;
  gap: 9px;
  padding: 12px 12px 14px;
  box-sizing: border-box;
  border-radius: 14px;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(181, 137, 61, 0.08), transparent 58%),
    linear-gradient(180deg, rgba(6, 6, 8, 0.08), rgba(6, 6, 8, 0.42));
  box-shadow: inset 0 1px 0 rgba(232, 169, 72, 0.05);
  mask-image: linear-gradient(black 0, black 92%, transparent 100%);
}

.stage-highlights::-webkit-scrollbar {
  display: none;
}

.stage-highlights-head {
  display: flex;
  align-items: center;
  gap: 9px;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.14em;
  color: var(--prose-faint);
}

.stage-highlights-line {
  height: 1px;
  flex: 1;
  background: linear-gradient(90deg, rgba(181, 137, 61, 0.42), transparent);
}

.stage-status :deep(.status-chips) {
  gap: 6px;
}

.stage-status :deep(.status-chip) {
  max-width: min(190px, 100%);
}

.stage-status :deep(.status-chip-trigger) {
  padding: 5px 28px 5px 9px;
  border-radius: 9px;
}

.stage-status :deep(.status-kicker) {
  font-size: 0.52rem;
}

.stage-status :deep(.status-name) {
  font-size: 0.76rem;
}

.stage-trait-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}

.stage-trait {
  position: relative;
  min-width: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 9px;
  border: 1px solid rgba(181, 137, 61, 0.16);
  border-radius: 10px;
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.07), rgba(155, 58, 46, 0.035) 52%, rgba(6, 6, 8, 0.10)),
    rgba(8, 4, 5, 0.24);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background 0.18s ease;
}

.stage-trait::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent, rgba(232, 169, 72, 0.10), transparent);
  opacity: 0;
  transform: translateX(-24%);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.stage-trait:hover,
.stage-trait:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(232, 169, 72, 0.38);
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.11), rgba(155, 58, 46, 0.048) 52%, rgba(6, 6, 8, 0.12)),
    rgba(11, 5, 6, 0.34);
  box-shadow: 0 0 16px rgba(181, 137, 61, 0.10);
}

.stage-trait:hover::before,
.stage-trait:focus-visible::before {
  opacity: 0.5;
  transform: translateX(-8%);
}

.stage-trait:focus-visible {
  outline: 1px solid rgba(232, 169, 72, 0.58);
  outline-offset: 2px;
}

.stage-trait-mark {
  position: relative;
  z-index: 1;
  width: 8px;
  height: 8px;
  border: 1px solid rgba(232, 169, 72, 0.42);
  transform: rotate(45deg);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.16);
}

.stage-trait-mark::after {
  content: "";
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 7px rgba(232, 169, 72, 0.32);
}

.stage-trait-copy {
  position: relative;
  z-index: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.stage-trait-title,
.stage-trait-preview {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stage-trait-title {
  font-family: var(--font-display);
  font-size: 0.9rem;
  letter-spacing: 0.05em;
  color: var(--ember-bright);
}

.stage-trait-preview {
  font-size: 0.68rem;
  color: var(--prose-faint);
}

.stage-trait-count {
  position: relative;
  z-index: 1;
  min-width: 16px;
  color: var(--prose-faint);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  text-align: right;
}

@media (max-width: 720px) {
  .stage-highlights {
    width: 100%;
    max-height: none;
    gap: 7px;
    padding: 10px 10px 12px;
    border-radius: 10px;
    mask-image: none;
  }

  .stage-highlights-head {
    font-size: 0.54rem;
  }

  .stage-trait-grid {
    grid-template-columns: 1fr;
    gap: 7px;
  }

  .stage-trait {
    min-height: 44px;
    padding: 7px 8px;
    border-radius: 8px;
  }

  .stage-trait-title {
    font-size: 0.82rem;
  }

  .stage-trait-preview {
    font-size: 0.62rem;
  }
}

@media (max-width: 900px) {
  .stage-trait-grid {
    grid-template-columns: 1fr;
  }
}
</style>
