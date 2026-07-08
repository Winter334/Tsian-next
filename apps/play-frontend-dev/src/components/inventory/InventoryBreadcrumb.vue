<script setup lang="ts">
/**
 * InventoryBreadcrumb — 模态内嵌套容器导航面包屑。
 *
 * design §6.5 / task 07-04 D5：
 * - props.path：`Array<{ ref, name }>`；path 长度 ≤ 1 时不渲染。
 * - 除最后一段（当前层）外，每段可点击 → emit `navigate(index)`。
 * - 分隔符 `›`（U+203A）。
 * - 主题：`--whisper` 文字 + `--ember` 分隔符 + hover `--ember-bright`。
 */

const props = defineProps<{
  path: Array<{ ref: string; name: string }>
}>()

const emit = defineEmits<{
  navigate: [index: number]
}>()

function onClick(index: number, isLast: boolean) {
  if (isLast) return
  emit("navigate", index)
}
</script>

<template>
  <nav v-if="props.path.length > 1" class="breadcrumb" aria-label="容器路径">
    <template v-for="(seg, i) in props.path" :key="`${i}-${seg.ref}`">
      <button
        type="button"
        class="crumb"
        :class="{ current: i === props.path.length - 1 }"
        :disabled="i === props.path.length - 1"
        @click="onClick(i, i === props.path.length - 1)"
      >{{ seg.name }}</button>
      <span
        v-if="i < props.path.length - 1"
        class="sep"
        aria-hidden="true"
      >›</span>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
}
.crumb {
  background: transparent;
  border: none;
  color: var(--prose-faint);
  font: inherit;
  padding: 2px 4px;
  cursor: pointer;
  transition: color 0.2s;
  border-radius: 4px;
}
.crumb:hover:not(:disabled) {
  color: var(--ember-bright);
}
.crumb:focus-visible {
  outline: 1px solid rgba(232, 169, 72, 0.4);
  outline-offset: 1px;
}
.crumb.current {
  color: var(--prose);
  cursor: default;
}
.crumb:disabled {
  cursor: default;
}
.sep {
  color: var(--ember);
  padding: 0 2px;
  user-select: none;
}
</style>
