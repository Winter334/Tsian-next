<script setup lang="ts">
/** AttributeCard — 双轨中的无框属性印记。 */
import PinButton from "./PinButton.vue"

defineProps<{
  name: string
  value: number | null
  /** 仅主角传入有效 ref。 */
  entityRef: string | null
}>()
</script>

<template>
  <div class="attribute-mark" tabindex="0">
    <span class="attribute-name">{{ name }}</span>
    <span class="attribute-value">{{ value === null ? "—" : value }}</span>
    <PinButton
      v-if="entityRef"
      :target="{ entityRef, kind: 'attribute', key: name, label: name }"
    />
  </div>
</template>

<style scoped>
.attribute-mark {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  min-width: 0;
  overflow: hidden;
  padding: 12px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border: 0;
  border-radius: 8px 1px 10px 2px;
  background:
    linear-gradient(45deg, transparent 49.45%, rgba(181, 137, 61, 0.34) 49.8%, rgba(181, 137, 61, 0.34) 50.2%, transparent 50.55%),
    radial-gradient(circle at 75% 25%, rgba(232, 169, 72, 0.13), transparent 42%),
    linear-gradient(145deg, rgba(181, 137, 61, 0.075), rgba(155, 58, 46, 0.035) 58%, rgba(6, 6, 8, 0.2));
  box-shadow: inset 8px -8px 28px rgba(0, 0, 0, 0.18);
  outline: none;
  transition: background-color 0.18s ease, filter 0.18s ease, transform 0.18s ease;
}

.attribute-mark::after {
  content: "";
  position: absolute;
  left: 9px;
  bottom: 8px;
  width: 24%;
  height: 2px;
  background: linear-gradient(90deg, rgba(232, 169, 72, 0.5), transparent);
  opacity: 0.46;
}

.attribute-mark:hover,
.attribute-mark:focus-visible {
  background:
    linear-gradient(45deg, transparent 49.2%, rgba(232, 169, 72, 0.76) 49.75%, rgba(232, 169, 72, 0.76) 50.25%, transparent 50.8%),
    radial-gradient(circle at 75% 25%, rgba(232, 169, 72, 0.2), transparent 46%),
    linear-gradient(145deg, rgba(181, 137, 61, 0.11), rgba(155, 58, 46, 0.055) 58%, rgba(6, 6, 8, 0.2));
  filter: drop-shadow(0 9px 16px rgba(0, 0, 0, 0.22));
  transform: translateY(-1px);
}

.attribute-mark:focus-visible {
  outline: 2px solid rgba(232, 169, 72, 0.72);
  outline-offset: 2px;
}

.attribute-name,
.attribute-value {
  position: relative;
  z-index: 1;
  align-self: flex-start;
}

.attribute-name {
  max-width: 70%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 0.86rem;
  letter-spacing: 0.06em;
  color: var(--prose-muted);
}

.attribute-value {
  font-family: var(--font-display);
  font-size: clamp(1.45rem, 2.4vw, 2rem);
  line-height: 0.9;
  color: var(--ember-bright);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 14px rgba(232, 169, 72, 0.16);
}

.attribute-mark:hover :deep(.pin-btn),
.attribute-mark:focus-within :deep(.pin-btn),
.attribute-mark :deep(.pin-btn.active) {
  opacity: 0.9;
}

@media (prefers-reduced-motion: reduce) {
  .attribute-mark {
    transition: none;
  }
}
</style>
