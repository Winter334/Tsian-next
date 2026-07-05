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
    <span aria-hidden="true" class="pin-glyph">📌</span>
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
  transition: opacity 120ms ease, color 120ms ease, transform 120ms ease;
  color: var(--prose-dim);
  font-size: 0.75rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.pin-glyph {
  filter: grayscale(0.6);
  transition: filter 120ms ease;
}

/* 父容器 hover 时半透明显现（父容器自行加 `position: relative` 与 hover 选择器）。 */
:where(:hover) > .pin-btn,
.pin-btn:focus-visible {
  opacity: 0.7;
}

.pin-btn:hover {
  opacity: 1;
  color: var(--ember-bright);
  transform: scale(1.08);
}

.pin-btn.active {
  opacity: 1;
  color: var(--ember-bright);
}
.pin-btn.active .pin-glyph {
  filter: none;
}
</style>
