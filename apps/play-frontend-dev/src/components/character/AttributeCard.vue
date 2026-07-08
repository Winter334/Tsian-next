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
    <div class="attribute-card-sheen" aria-hidden="true"></div>
    <div class="attribute-watermark" aria-hidden="true">{{ name }}</div>
    <div class="attribute-head">
      <span class="attribute-name">{{ name }}</span>
    </div>
    <div class="attribute-value-wrap">
      <span class="attribute-value">{{ value === null ? "—" : value }}</span>
    </div>
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
  min-height: 112px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  border: 1px solid rgba(181, 137, 61, 0.24);
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.075), rgba(155, 58, 46, 0.055) 44%, rgba(6, 6, 8, 0.30)),
    rgba(14, 7, 7, 0.58);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.10),
    inset 0 -18px 38px rgba(0, 0, 0, 0.18),
    0 16px 32px rgba(0, 0, 0, 0.16);
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, transform 0.2s;
}
.attribute-card::before,
.attribute-card::after {
  content: "";
  position: absolute;
  pointer-events: none;
}
.attribute-card::before {
  inset: 8px;
  border: 1px solid rgba(181, 137, 61, 0.08);
  border-radius: 8px;
}
.attribute-card::after {
  right: -18px;
  bottom: -34px;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232, 169, 72, 0.13), transparent 68%);
  opacity: 0.7;
}
.attribute-card:hover {
  transform: translateY(-1px);
  border-color: rgba(232, 169, 72, 0.42);
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.10), rgba(155, 58, 46, 0.07) 44%, rgba(6, 6, 8, 0.28)),
    rgba(16, 8, 8, 0.66);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.14),
    inset 0 -18px 38px rgba(0, 0, 0, 0.20),
    0 18px 36px rgba(0, 0, 0, 0.20),
    0 0 16px rgba(181, 137, 61, 0.10);
}
.attribute-card-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 0%, rgba(232, 169, 72, 0.10) 34%, transparent 56%);
  opacity: 0.42;
  transform: translateX(-18%);
  transition: opacity 0.2s, transform 0.2s;
}
.attribute-card:hover .attribute-card-sheen {
  opacity: 0.62;
  transform: translateX(-10%);
}
.attribute-watermark {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 48%;
  transform: translateY(-50%);
  font-family: var(--font-display);
  font-size: clamp(2.4rem, 4.1vw, 4rem);
  line-height: 1;
  color: rgba(232, 169, 72, 0.055);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
  pointer-events: none;
  user-select: none;
}
.attribute-head,
.attribute-value-wrap {
  position: relative;
  z-index: 1;
}
.attribute-head {
  display: flex;
  align-items: center;
  min-width: 0;
}
.attribute-name {
  font-family: var(--font-display);
  font-size: 1.14rem;
  color: var(--prose);
  letter-spacing: 0.04em;
  text-shadow: 0 0 10px rgba(181, 137, 61, 0.12);
}
.attribute-value-wrap {
  align-self: flex-end;
  min-width: 58px;
  padding: 5px 0 0;
  display: flex;
  justify-content: flex-end;
}
.attribute-value {
  font-family: var(--font-display);
  font-size: 2.08rem;
  color: var(--ember-bright);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 12px rgba(232, 169, 72, 0.16);
}
</style>
