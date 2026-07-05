<script setup lang="ts">
/**
 * CharacterPortrait — 角色立绘占位栏（角色卡左侧固定栏）。
 *
 * design §4.7 / D6 / R11：
 * - 3:4.15 比例（参考预览 HTML .portrait-frame）。
 * - 暗色仪式风边框 + 内层细线 + 底部渐变蒙层。
 * - 内容：首字占位（name[0]），font-display，ember-bright 色，text-shadow 微光。
 * - 无图片时不显示任何图片相关 UI；不预留上传按钮。
 *
 * 切换 tab 时立绘栏不变（预览 HTML 核心决策）——本组件由 CharacterCard 在
 * tabs 之外渲染。
 */
import { computed } from "vue"

const props = defineProps<{
  name: string
}>()

const glyph = computed(() => {
  const n = props.name
  return n.length > 0 ? n.charAt(0) : "?"
})
</script>

<template>
  <div class="portrait-frame">
    <span class="portrait-glyph">{{ glyph }}</span>
  </div>
</template>

<style scoped>
.portrait-frame {
  width: 100%;
  max-width: 340px;
  aspect-ratio: 3 / 4.15;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background:
    radial-gradient(circle at 50% 36%, rgba(181, 137, 61, 0.12), transparent 62%),
    radial-gradient(circle at 50% 62%, rgba(155, 58, 46, 0.08), transparent 65%),
    var(--void-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.02),
    0 18px 50px rgba(0, 0, 0, 0.35);
}
.portrait-frame::before {
  /* 内层细线 */
  content: "";
  position: absolute;
  inset: 10px;
  border: 1px solid rgba(181, 137, 61, 0.12);
  border-radius: 7px;
  pointer-events: none;
}
.portrait-frame::after {
  /* 底部渐变蒙层 */
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 24%;
  background: linear-gradient(transparent, rgba(6, 6, 8, 0.48));
  pointer-events: none;
}
.portrait-glyph {
  position: relative;
  z-index: 1;
  font-family: var(--font-display);
  font-size: clamp(5rem, 11vw, 8rem);
  color: var(--ember-bright);
  font-weight: 700;
  text-shadow: 0 0 28px rgba(232, 169, 72, 0.16);
}
</style>
