<script setup lang="ts">
/**
 * TraitDetailModal — 天赋/特质详情弹窗。
 *
 * 由概况页 TraitCards 点击打开；ESC / 遮罩 / 关闭按钮关闭。
 */
import { computed, onMounted, onUnmounted } from "vue"
import type { CharacterTrait } from "../../lib/character-types"

const props = defineProps<{
  trait: CharacterTrait | null
}>()

const emit = defineEmits<{
  close: []
}>()

const title = computed(() => props.trait?.name?.trim() || props.trait?.id || "天赋特质")
const description = computed(() => props.trait?.description?.trim() || "暂无详细描述。")
const effects = computed(() => props.trait?.effects ?? [])
const hasEffects = computed(() => effects.value.length > 0)

function onBackdropClick() {
  emit("close")
}

function onCardClick(e: MouseEvent) {
  e.stopPropagation()
}

function onClose() {
  emit("close")
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.trait) {
    e.preventDefault()
    emit("close")
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
})
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown)
})
</script>

<template>
  <div v-if="trait" class="modal-mask" role="presentation" @click="onBackdropClick">
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      @click="onCardClick"
    >
      <button
        type="button"
        class="modal-close"
        aria-label="关闭"
        @click="onClose"
      >×</button>

      <div class="trait-header">
        <span class="trait-mark" aria-hidden="true"></span>
        <div class="trait-title-wrap">
          <div class="trait-kicker">稳定特质</div>
          <h2 class="trait-title">{{ title }}</h2>
          <div class="trait-id">{{ trait.id }}</div>
        </div>
      </div>

      <section class="trait-section">
        <div class="section-title">记述</div>
        <p class="trait-description">{{ description }}</p>
      </section>

      <section class="trait-section">
        <div class="section-title">效果</div>
        <ul v-if="hasEffects" class="effect-list">
          <li v-for="(effect, idx) in effects" :key="`effect-${idx}`" class="effect-item">
            <span class="effect-bullet" aria-hidden="true"></span>
            <span>{{ effect }}</span>
          </li>
        </ul>
        <p v-else class="trait-empty">暂无明确效果。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 6, 8, 0.72);
  backdrop-filter: blur(7px);
}
.modal-card {
  position: relative;
  width: min(560px, 100%);
  max-height: 82vh;
  overflow-y: auto;
  border: 1px solid rgba(181, 137, 61, 0.34);
  border-radius: 14px;
  padding: 26px 28px 24px;
  background:
    radial-gradient(circle at 28% 0%, rgba(181, 137, 61, 0.12), transparent 36%),
    linear-gradient(135deg, rgba(181, 137, 61, 0.07), rgba(155, 58, 46, 0.045) 42%, rgba(6, 6, 8, 0.18)),
    var(--void-deep);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 28px 70px rgba(0, 0, 0, 0.54),
    0 0 24px rgba(181, 137, 61, 0.10);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.modal-card::before {
  content: "";
  position: absolute;
  inset: 9px;
  border: 1px solid rgba(181, 137, 61, 0.10);
  border-radius: 10px;
  pointer-events: none;
}
.modal-close {
  position: absolute;
  top: 11px;
  right: 13px;
  z-index: 2;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(181, 137, 61, 0.28);
  border-radius: 50%;
  background: rgba(6, 6, 8, 0.62);
  color: var(--prose-muted);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
}
.modal-close:hover,
.modal-close:focus-visible {
  border-color: rgba(232, 169, 72, 0.56);
  color: var(--ember-bright);
  background: rgba(14, 7, 8, 0.86);
}
.trait-header {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding-right: 26px;
}
.trait-mark {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-top: 7px;
  border: 1px solid rgba(232, 169, 72, 0.48);
  transform: rotate(45deg);
  box-shadow: 0 0 14px rgba(181, 137, 61, 0.16);
}
.trait-mark::after {
  content: "";
  position: absolute;
  inset: 7px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 10px rgba(232, 169, 72, 0.44);
}
.trait-title-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.trait-kicker {
  width: fit-content;
  padding: 1px 8px 2px;
  border: 1px solid rgba(181, 137, 61, 0.24);
  border-radius: 999px;
  background: rgba(6, 6, 8, 0.24);
  color: var(--prose-muted);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
}
.trait-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.72rem;
  line-height: 1.18;
  color: var(--ember-bright);
  letter-spacing: 0.06em;
  text-shadow: 0 0 16px rgba(232, 169, 72, 0.18);
}
.trait-id {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--prose-faint);
  letter-spacing: 0.04em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.trait-section {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.section-title {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--prose-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.trait-description,
.trait-empty {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.86rem;
  line-height: 1.82;
  color: var(--prose-muted);
}
.trait-empty {
  color: var(--prose-faint);
  font-style: italic;
}
.effect-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.effect-item {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 9px;
  align-items: baseline;
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 0.86rem;
  line-height: 1.72;
}
.effect-bullet {
  width: 6px;
  height: 6px;
  border: 1px solid var(--ember);
  transform: rotate(45deg);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.18);
}
</style>
