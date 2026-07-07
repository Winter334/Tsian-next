<script setup lang="ts">
/**
 * AttributeCard — 基础维度单卡（属性页）。
 *
 * design §4.5 / D7：
 * - 卡片：name + 大数字（font-display）。
 * - value null 时展示"—"（缺省维度）。
 * - 不展示基准 5（基准只进入规则语义，UI 不解释）。
 *
 * task 07-05-status-bar-character-field-pinning：
 * - 右上角 PinButton；kind=attribute，key=维度键名（由世界观定），label=同键。
 */
import PinButton from "./PinButton.vue"

const props = defineProps<{
  name: string
  value: number | null
  /** 当前角色 entity ref；null 时不渲染 PinButton。 */
  entityRef: string | null
}>()

void props
</script>

<template>
  <div class="attribute-card">
    <span class="attribute-name">{{ name }}</span>
    <span class="attribute-value">{{ value === null ? "—" : value }}</span>
    <PinButton
      v-if="entityRef"
      :target="{
        entityRef,
        kind: 'attribute',
        key: name,
        label: name,
      }"
    />
  </div>
</template>

<style scoped>
.attribute-card {
  position: relative;
  border: 1px solid var(--line);
  background: rgba(181, 137, 61, 0.03);
  border-radius: 10px;
  padding: 14px 16px;
  min-height: 96px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
}
.attribute-card:hover {
  border-color: var(--line-strong);
  background: rgba(181, 137, 61, 0.05);
  box-shadow: 0 0 14px rgba(181, 137, 61, 0.08);
}
.attribute-card:hover :deep(.pin-btn),
.attribute-card :deep(.pin-btn.active) {
  opacity: 0.85;
}
.attribute-name {
  font-size: 0.82rem;
  color: var(--prose-dim);
  letter-spacing: 0.08em;
}
.attribute-value {
  font-family: var(--font-display);
  font-size: 2.2rem;
  color: var(--ember-bright);
  line-height: 1;
  text-align: right;
}
</style>
