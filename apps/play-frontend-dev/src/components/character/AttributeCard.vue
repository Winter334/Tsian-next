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
  aspect-ratio: 0.92;
  min-width: 0;
  overflow: hidden;
  padding: 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  background: transparent;
  outline: none;
  transition: filter 0.22s ease, transform 0.22s ease;
}

.attribute-mark::before,
.attribute-mark::after {
  content: "";
  position: absolute;
  left: -18%;
  top: 50%;
  width: 136%;
  transform: rotate(-45deg);
  transform-origin: center;
  pointer-events: none;
}

.attribute-mark::before {
  height: 1px;
  background: linear-gradient(90deg, transparent 6%, rgba(181, 137, 61, 0.32) 16%, rgba(232, 169, 72, 0.95) 50%, rgba(181, 137, 61, 0.34) 84%, transparent 94%);
  opacity: 0.78;
  box-shadow: 0 0 8px rgba(232, 169, 72, 0.24);
}

.attribute-mark::after {
  height: 5px;
  background: linear-gradient(90deg, transparent 14%, rgba(232, 169, 72, 0.02) 30%, rgba(232, 169, 72, 0.22) 50%, rgba(232, 169, 72, 0.02) 70%, transparent 86%);
  opacity: 0;
  filter: blur(2px);
  transform: rotate(-45deg) translateX(-18%);
  transition: opacity 0.24s ease, transform 0.34s ease;
}

.attribute-mark:hover,
.attribute-mark:focus-visible {
  filter: drop-shadow(0 9px 18px rgba(232, 169, 72, 0.14)) drop-shadow(0 10px 18px rgba(0, 0, 0, 0.18));
  transform: translateY(-2px) scale(1.035);
}

.attribute-mark:hover::before,
.attribute-mark:focus-visible::before {
  background: linear-gradient(90deg, transparent 4%, rgba(232, 169, 72, 0.5) 16%, rgba(255, 219, 142, 1) 50%, rgba(232, 169, 72, 0.54) 84%, transparent 96%);
  opacity: 1;
  box-shadow: 0 0 14px rgba(232, 169, 72, 0.52);
}

.attribute-mark:hover::after,
.attribute-mark:focus-visible::after {
  opacity: 1;
  transform: rotate(-45deg) translateX(18%);
}

.attribute-mark:focus-visible {
  outline: 2px solid rgba(232, 169, 72, 0.72);
  outline-offset: 2px;
}

.attribute-name,
.attribute-value {
  position: absolute;
  z-index: 1;
  max-width: calc(100% - 14px);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.attribute-name {
  top: 9px;
  left: 10px;
  font-family: var(--font-display);
  font-size: 0.98rem;
  letter-spacing: 0.075em;
  color: var(--prose-muted);
  transition: color 0.2s ease, text-shadow 0.2s ease;
}

.attribute-value {
  right: 10px;
  bottom: 9px;
  font-family: var(--font-display);
  font-size: clamp(1.28rem, 2vw, 1.72rem);
  line-height: 0.9;
  color: var(--ember-bright);
  font-variant-numeric: tabular-nums;
  text-align: right;
  text-shadow: 0 0 14px rgba(232, 169, 72, 0.16);
  transition: color 0.2s ease, text-shadow 0.2s ease;
}

.attribute-mark:hover .attribute-name,
.attribute-mark:focus-visible .attribute-name {
  color: var(--prose);
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.2);
}

.attribute-mark:hover .attribute-value,
.attribute-mark:focus-visible .attribute-value {
  color: #ffd98e;
  text-shadow: 0 0 18px rgba(232, 169, 72, 0.45);
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
