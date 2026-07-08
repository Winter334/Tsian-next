<script setup lang="ts">
/**
 * PinButton — 角色卡字段旁的"钉选到状态栏"小按钮。
 *
 * 对齐 design.md §8：
 * - Props `target: Omit<PinTarget, "addedAt">`。
 * - 通过 `useStatusBarPins` 读 active 态、执行 toggle。
 * - 使用 absolute 定位；父容器必须设 `position: relative`。
 * - 默认 hover 才显示；active 时常显（`--ember-bright`）。
 * - `@click.stop` 避免冒泡触发父 chip 的点击行为。
 */
import { computed } from "vue"
import { useStatusBarPins } from "../../composables/useStatusBarPins"
import type { PinTarget } from "../../lib/pin-types"

const props = defineProps<{
  target: Omit<PinTarget, "addedAt">
}>()

const { isPinned, togglePin } = useStatusBarPins()

const active = computed<boolean>(() => isPinned(props.target.kind, props.target.key))

function onClick(): void {
  togglePin(props.target)
}
</script>

<template>
  <button
    type="button"
    class="pin-btn"
    :class="{ active }"
    :aria-label="active ? '取消钉选到状态栏' : '钉选到状态栏'"
    :aria-pressed="active"
    :title="active ? '取消钉选' : '钉选到状态栏'"
    @click.stop="onClick"
  >
    <svg
      aria-hidden="true"
      class="pin-icon"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="17.6" cy="6.4" r="1.6" />
      <path d="M18.7 5.3 20.2 3.8" />
      <path d="M16.4 7.6 9.2 14.8" />
      <path d="M9.2 14.8 4.7 19.3" />
      <path d="M8.1 15.9 10.7 18.5" />
    </svg>
  </button>
</template>

<style scoped>
.pin-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  opacity: 0;
  transition: opacity 140ms ease, color 140ms ease, transform 140ms ease;
  color: var(--prose-faint);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.pin-icon {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform-origin: 50% 50%;
  transition: transform 140ms ease, filter 140ms ease;
}
.pin-icon circle {
  fill: currentColor;
  stroke: none;
}

/* 父容器 hover 时半透明显现（父容器自行加 `position: relative` 与 hover 选择器）。 */
:where(:hover) > .pin-btn,
.pin-btn:focus-visible {
  opacity: 0.7;
}

.pin-btn:hover {
  opacity: 1;
  color: var(--ember-bright);
  transform: translateY(-1px) rotate(-5deg) scale(1.06);
}

.pin-btn.active {
  opacity: 1;
  color: var(--ember-bright);
}
.pin-btn.active .pin-icon {
  filter: drop-shadow(0 0 4px rgba(232, 169, 72, 0.42));
}
</style>
