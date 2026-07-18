<script setup lang="ts">
/**
 * TraitCards — 角色概况页的天赋/特质摘要卡片。
 *
 * 概况页只展示精美摘要；完整说明由 TraitDetailModal 承担。
 */
import { computed } from "vue"
import type { CharacterTrait } from "../../lib/character-types"

const props = defineProps<{
  traits: CharacterTrait[]
}>()

const emit = defineEmits<{
  open: [trait: CharacterTrait]
}>()

interface TraitCardRow {
  trait: CharacterTrait
  title: string
  preview: string
  effectCount: number
}

const rows = computed<TraitCardRow[]>(() => {
  return props.traits.map((trait) => {
    const title = trait.name?.trim() || trait.id
    const firstEffect = trait.effects?.find((effect) => effect.trim().length > 0)
    return {
      trait,
      title,
      preview: trait.description?.trim() || firstEffect || "暂无详细记载。",
      effectCount: trait.effects?.length ?? 0,
    }
  })
})

function onOpen(trait: CharacterTrait) {
  emit("open", trait)
}
</script>

<template>
  <div class="trait-card-grid">
    <button
      v-for="row in rows"
      :key="row.trait.id"
      type="button"
      class="trait-card"
      @click="onOpen(row.trait)"
    >
      <span class="trait-sheen" aria-hidden="true"></span>
      <span class="trait-mark" aria-hidden="true"></span>
      <span class="trait-content">
        <span class="trait-kicker">稳定特质</span>
        <span class="trait-title">{{ row.title }}</span>
        <span class="trait-preview">{{ row.preview }}</span>
        <span class="trait-meta">
          <span>{{ row.trait.id }}</span>
          <span v-if="row.effectCount > 0">{{ row.effectCount }} 条效果</span>
        </span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.trait-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.trait-card {
  position: relative;
  min-height: 142px;
  overflow: hidden;
  padding: 15px 16px 14px;
  border: 1px solid rgba(181, 137, 61, 0.22);
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.08), rgba(155, 58, 46, 0.055) 45%, rgba(6, 6, 8, 0.24)),
    rgba(12, 6, 7, 0.48);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.08),
    inset 0 -18px 36px rgba(0, 0, 0, 0.14),
    0 14px 28px rgba(0, 0, 0, 0.14);
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.trait-card::before {
  content: "";
  position: absolute;
  inset: 8px;
  border: 1px solid rgba(181, 137, 61, 0.075);
  border-radius: 8px;
  pointer-events: none;
}
.trait-card:hover,
.trait-card:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(232, 169, 72, 0.44);
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.12), rgba(155, 58, 46, 0.07) 45%, rgba(6, 6, 8, 0.22)),
    rgba(15, 7, 8, 0.58);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.12),
    inset 0 -18px 36px rgba(0, 0, 0, 0.16),
    0 16px 32px rgba(0, 0, 0, 0.18),
    0 0 18px rgba(181, 137, 61, 0.12);
}
.trait-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 0%, rgba(232, 169, 72, 0.10) 36%, transparent 58%);
  opacity: 0.36;
  transform: translateX(-20%);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.trait-card:hover .trait-sheen,
.trait-card:focus-visible .trait-sheen {
  opacity: 0.58;
  transform: translateX(-10%);
}
.trait-mark {
  position: absolute;
  right: 18px;
  top: 18px;
  width: 13px;
  height: 13px;
  border: 1px solid rgba(232, 169, 72, 0.42);
  transform: rotate(45deg);
  box-shadow: 0 0 10px rgba(181, 137, 61, 0.12);
}
.trait-mark::after {
  content: "";
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 8px rgba(232, 169, 72, 0.34);
}
.trait-content {
  position: relative;
  z-index: 1;
  min-height: 112px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.trait-kicker {
  width: fit-content;
  padding: 1px 7px 2px;
  border: 1px solid rgba(181, 137, 61, 0.20);
  border-radius: 999px;
  color: var(--prose-muted);
  background: rgba(6, 6, 8, 0.22);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.08em;
}
.trait-title {
  max-width: calc(100% - 28px);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 1.12rem;
  color: var(--ember-bright);
  letter-spacing: 0.05em;
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.16);
}
.trait-preview {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  color: var(--prose-muted);
  font-size: 0.78rem;
  line-height: 1.65;
}
.trait-meta {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--prose-faint);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.04em;
}
.trait-meta span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
