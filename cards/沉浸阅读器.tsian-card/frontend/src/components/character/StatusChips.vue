<script setup lang="ts">
/**
 * StatusChips — 当前状态 chips（概况页状态区）。
 *
 * design §4.4 / D5 / R8：
 * - 逐项 status 札记；polarity 决定颜色 tone。
 * - 默认只显示 name；点击打开 StatusDetailModal 查看 description / id。
 * - 不展示 level / minor / severe 等内部字段值。
 * - polarity 颜色映射（design §6）：
 *   positive → #7ea968；negative → --blood/#c76d5a；neutral → --prose-dim。
 *
 * task 07-05-status-bar-character-field-pinning：
 * - 每个 status 加 PinButton；`entityRef` 由父组件传入（null 时不渲染 pin）。
 * - 父容器 `.status-chip` 设 `position: relative` 承载 pin。
 */
import { ref } from "vue"
import type { CharacterStatus } from "../../lib/character-types"
import PinButton from "./PinButton.vue"
import StatusDetailModal from "./StatusDetailModal.vue"

const props = defineProps<{
  status: CharacterStatus[]
  /** 当前角色 entity ref；用于构造钉选 target。null 时不渲染 PinButton。 */
  entityRef: string | null
}>()

void props

const selectedStatus = ref<CharacterStatus | null>(null)

function statusText(s: CharacterStatus): string {
  return s.name?.trim() || s.description?.trim() || s.id.trim() || s.id
}

function pinLabel(s: CharacterStatus): string {
  return s.name?.trim() || s.id.trim() || s.id
}

function statusToneLabel(s: CharacterStatus): string {
  switch (s.polarity) {
    case "positive":
      return "清益"
    case "negative":
      return "异兆"
    case "neutral":
      return "状态"
    default:
      return "状态"
  }
}

function openStatus(s: CharacterStatus): void {
  selectedStatus.value = s
}

function closeStatus(): void {
  selectedStatus.value = null
}
</script>

<template>
  <div v-if="status.length > 0" class="status-chips">
    <span
      v-for="s in status"
      :key="s.id"
      class="status-chip"
      :class="s.polarity ? `polarity-${s.polarity}` : 'polarity-neutral'"
    >
      <button
        type="button"
        class="status-chip-trigger"
        :aria-label="`查看状态详情：${statusText(s)}`"
        @click="openStatus(s)"
      >
        <span class="status-glow" aria-hidden="true"></span>
        <span class="status-mark" aria-hidden="true"></span>
        <span class="status-copy">
          <span class="status-kicker">{{ statusToneLabel(s) }}</span>
          <span class="status-name">{{ statusText(s) }}</span>
        </span>
      </button>
      <PinButton
        v-if="entityRef"
        :target="{
          entityRef,
          kind: 'status',
          key: s.id,
          label: pinLabel(s),
        }"
      />
    </span>
  </div>

  <StatusDetailModal :status="selectedStatus" @close="closeStatus" />
</template>

<style scoped>
.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
.status-chip {
  --status-tone: var(--ember-bright);
  --status-tone-soft: rgba(181, 137, 61, 0.11);
  --status-tone-line: rgba(181, 137, 61, 0.26);
  position: relative;
  display: inline-flex;
  max-width: min(230px, 100%);
}
.status-chip.polarity-positive {
  --status-tone: #9fc985;
  --status-tone-soft: rgba(126, 169, 104, 0.12);
  --status-tone-line: rgba(126, 169, 104, 0.34);
}
.status-chip.polarity-negative {
  --status-tone: #d78272;
  --status-tone-soft: rgba(155, 58, 46, 0.16);
  --status-tone-line: rgba(199, 109, 90, 0.36);
}
.status-chip.polarity-neutral {
  --status-tone: var(--ember-bright);
  --status-tone-soft: rgba(181, 137, 61, 0.10);
  --status-tone-line: rgba(181, 137, 61, 0.24);
}
.status-chip-trigger {
  position: relative;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 7px 30px 7px 10px;
  border: 1px solid var(--status-tone-line);
  border-radius: 11px;
  background:
    linear-gradient(135deg, var(--status-tone-soft), rgba(155, 58, 46, 0.035) 46%, rgba(6, 6, 8, 0.10)),
    rgba(10, 5, 6, 0.32);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.05),
    inset 0 -14px 26px rgba(0, 0, 0, 0.12);
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.status-chip-trigger::before {
  content: "";
  position: absolute;
  inset: 5px;
  border: 1px solid rgba(181, 137, 61, 0.07);
  border-radius: 8px;
  pointer-events: none;
}
.status-chip-trigger:hover,
.status-chip-trigger:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--status-tone) 64%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--status-tone) 16%, transparent), rgba(155, 58, 46, 0.052) 46%, rgba(6, 6, 8, 0.12)),
    rgba(13, 6, 7, 0.46);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.08),
    inset 0 -14px 26px rgba(0, 0, 0, 0.14),
    0 0 16px color-mix(in srgb, var(--status-tone) 13%, transparent);
}
.status-chip-trigger:focus-visible {
  outline: 1px solid color-mix(in srgb, var(--status-tone) 70%, transparent);
  outline-offset: 2px;
}
.status-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 0%, color-mix(in srgb, var(--status-tone) 10%, transparent) 38%, transparent 62%);
  opacity: 0.26;
  transform: translateX(-24%);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.status-chip-trigger:hover .status-glow,
.status-chip-trigger:focus-visible .status-glow {
  opacity: 0.48;
  transform: translateX(-10%);
}
.status-mark {
  position: relative;
  z-index: 1;
  width: 8px;
  height: 8px;
  border: 1px solid var(--status-tone-line);
  transform: rotate(45deg);
  box-shadow: 0 0 9px color-mix(in srgb, var(--status-tone) 22%, transparent);
}
.status-mark::after {
  content: "";
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--status-tone);
  box-shadow: 0 0 7px color-mix(in srgb, var(--status-tone) 42%, transparent);
}
.status-copy {
  position: relative;
  z-index: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.status-kicker {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.10em;
  color: color-mix(in srgb, var(--status-tone) 72%, var(--prose-faint));
}
.status-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-serif);
  font-size: 0.82rem;
  line-height: 1.35;
  color: var(--prose);
}
.status-chip-trigger:hover .status-name,
.status-chip-trigger:focus-visible .status-name {
  color: color-mix(in srgb, var(--status-tone) 42%, var(--prose));
}
/* 父 hover 时 PinButton 半显 */
.status-chip:hover :deep(.pin-btn),
.status-chip :deep(.pin-btn:focus-visible),
.status-chip :deep(.pin-btn.active) {
  opacity: 0.9;
}
</style>
