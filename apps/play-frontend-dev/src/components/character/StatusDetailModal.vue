<script setup lang="ts">
/**
 * StatusDetailModal — 当前状态详情弹窗。
 *
 * 由角色概况页点击真实 status 打开；交互沿用物品/特质详情弹窗：
 * 遮罩 / 关闭按钮 / Escape 关闭。
 */
import { computed, onMounted, onUnmounted } from "vue"
import type { CharacterStatus } from "../../lib/character-types"

const props = defineProps<{
  status: CharacterStatus | null
}>()

const emit = defineEmits<{
  close: []
}>()

const title = computed(() => props.status?.name?.trim() || props.status?.description?.trim() || props.status?.id || "当前状态")
const description = computed(() => props.status?.description?.trim() || "暂无详细记述。")
const toneClass = computed(() => `tone-${props.status?.polarity ?? "neutral"}`)
const polarityLabel = computed(() => {
  switch (props.status?.polarity) {
    case "positive":
      return "正面状态"
    case "negative":
      return "异常状态"
    case "neutral":
      return "中性状态"
    default:
      return "当前状态"
  }
})
const polarityKicker = computed(() => {
  switch (props.status?.polarity) {
    case "positive":
      return "清益"
    case "negative":
      return "异兆"
    case "neutral":
      return "常态"
    default:
      return "状态"
  }
})

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
  if (e.key === "Escape" && props.status) {
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
  <div v-if="status" class="modal-mask" role="presentation" @click="onBackdropClick">
    <div
      class="modal-card"
      :class="toneClass"
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

      <header class="status-header">
        <span class="status-sigil" aria-hidden="true">
          <span class="status-sigil-core"></span>
        </span>
        <div class="status-title-wrap">
          <div class="status-kicker">{{ polarityKicker }} · {{ polarityLabel }}</div>
          <h2 class="status-title">{{ title }}</h2>
        </div>
      </header>

      <section class="status-section">
        <div class="section-title">状态记述</div>
        <p class="status-description">{{ description }}</p>
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
  --status-tone: var(--ember-bright);
  --status-tone-soft: rgba(181, 137, 61, 0.16);
  --status-tone-line: rgba(181, 137, 61, 0.36);
  position: relative;
  width: min(540px, 100%);
  max-height: 82vh;
  overflow-y: auto;
  border: 1px solid var(--status-tone-line);
  border-radius: 14px;
  padding: 26px 28px 24px;
  background:
    radial-gradient(circle at 20% 0%, var(--status-tone-soft), transparent 38%),
    linear-gradient(135deg, rgba(181, 137, 61, 0.07), rgba(155, 58, 46, 0.045) 44%, rgba(6, 6, 8, 0.22)),
    var(--void-deep);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 28px 70px rgba(0, 0, 0, 0.54),
    0 0 26px color-mix(in srgb, var(--status-tone) 18%, transparent);
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
.modal-card::after {
  content: "";
  position: absolute;
  top: 0;
  right: 34px;
  width: 1px;
  height: 72px;
  background: linear-gradient(180deg, var(--status-tone), transparent);
  opacity: 0.34;
  pointer-events: none;
}
.modal-card.tone-positive {
  --status-tone: #9fc985;
  --status-tone-soft: rgba(126, 169, 104, 0.15);
  --status-tone-line: rgba(126, 169, 104, 0.42);
}
.modal-card.tone-negative {
  --status-tone: #d78272;
  --status-tone-soft: rgba(155, 58, 46, 0.20);
  --status-tone-line: rgba(199, 109, 90, 0.42);
}
.modal-card.tone-neutral {
  --status-tone: var(--ember-bright);
  --status-tone-soft: rgba(181, 137, 61, 0.15);
  --status-tone-line: rgba(181, 137, 61, 0.36);
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
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}
.modal-close:hover,
.modal-close:focus-visible {
  border-color: var(--status-tone-line);
  color: var(--status-tone);
  background: rgba(14, 7, 8, 0.86);
  transform: translateY(-1px);
}
.status-header {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding-right: 28px;
}
.status-sigil {
  position: relative;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-top: 7px;
  border: 1px solid var(--status-tone-line);
  border-radius: 9px;
  transform: rotate(45deg);
  background:
    radial-gradient(circle, color-mix(in srgb, var(--status-tone) 18%, transparent), transparent 62%),
    rgba(6, 6, 8, 0.38);
  box-shadow: 0 0 18px color-mix(in srgb, var(--status-tone) 18%, transparent);
}
.status-sigil-core {
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: var(--status-tone);
  box-shadow: 0 0 12px color-mix(in srgb, var(--status-tone) 48%, transparent);
}
.status-title-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.status-kicker {
  width: fit-content;
  padding: 1px 8px 2px;
  border: 1px solid var(--status-tone-line);
  border-radius: 999px;
  background: rgba(6, 6, 8, 0.24);
  color: color-mix(in srgb, var(--status-tone) 72%, var(--prose-muted));
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.10em;
}
.status-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.72rem;
  line-height: 1.18;
  color: var(--status-tone);
  letter-spacing: 0.06em;
  text-shadow: 0 0 16px color-mix(in srgb, var(--status-tone) 22%, transparent);
}
.status-section {
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
.status-description {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.88rem;
  line-height: 1.82;
  color: var(--prose-muted);
}
@media (max-width: 560px) {
  .modal-card {
    padding: 24px 22px 22px;
  }
}
</style>
