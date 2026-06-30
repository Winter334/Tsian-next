<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue"
import gsap from "gsap"

/**
 * TsianLogo — 活 Logo（idle 转动动效）。
 *
 * 几何来源：F:/workspace/tmp/logo/tsian.svg（旋转方框 + 十字裂隙星 + 中心奇点 + 对角线）。
 * 配色 A+ 烛火琥珀系（CSS 变量）：外框 ember/内框 ember-bright/对角线 whisper/核心裂隙星渐变/奇点 ember-bright。
 *
 * idle：GSAP 驱动外框 40s 缓转 / 内框 30s 反向 / 对角线呼吸 / 核心脉动 / 奇点脉冲。
 * 点击：emit click 立即触发（父组件并行挂载 BurningReveal 偷偷初始化），
 *   同时播放丰富消失动效：核心充能脉动 + 奇点闪光 + 整体膨胀淡出（~0.45s），
 *   动画结束 emit done → 父组件触发幕布燃烧。动画填充初始化时间，无空白等待。
 *   logo 不做进纹理（避免 SVG→纹理渲染不一致造成剧变），idle 层 logo 淡出后由幕布独立燃烧。
 */
withDefaults(
  defineProps<{
    animated?: boolean
    size?: number
  }>(),
  { animated: true, size: 240 },
)

const emit = defineEmits<{
  click: []
  done: []
}>()

const rootRef = ref<SVGSVGElement | null>(null)
const outerFrame = ref<SVGRectElement | null>(null)
const innerFrame = ref<SVGRectElement | null>(null)
const diagonals = ref<SVGGElement | null>(null)
const core = ref<SVGGElement | null>(null)
const singularity = ref<SVGRectElement | null>(null)

onMounted(() => {
  // 外框 40s 缓转
  gsap.to(outerFrame.value, {
    rotation: "+=360",
    svgOrigin: "100 100",
    duration: 40,
    repeat: -1,
    ease: "none",
  })
  // 内框 30s 反向
  gsap.to(innerFrame.value, {
    rotation: "-=360",
    svgOrigin: "100 100",
    duration: 30,
    repeat: -1,
    ease: "none",
  })
  // 对角线 opacity 呼吸
  gsap.to(diagonals.value, {
    opacity: 0.55,
    duration: 3,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  })
  // 核心 scale 脉动
  gsap.to(core.value, {
    scale: 1.08,
    svgOrigin: "100 100",
    duration: 2,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  })
  // 奇点 glow 脉冲
  gsap.to(singularity.value, {
    scale: 1.4,
    svgOrigin: "100 100",
    opacity: 0.7,
    duration: 1.5,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  })
})

onUnmounted(() => {
  gsap.killTweensOf([rootRef.value, outerFrame.value, innerFrame.value, diagonals.value, core.value, singularity.value])
})

function onClick() {
  // emit click 立即触发（父组件并行挂载 BurningReveal，幕布在背后开始燃烧）
  emit("click")
  // 停掉 idle 转动
  gsap.killTweensOf([outerFrame.value, innerFrame.value, diagonals.value, core.value, singularity.value])
  // 快速消失动效：脉动 + 淡出并行（合计 0.4s），充能仪式感
  gsap.timeline()
    // 充能：核心 + 奇点同步脉动变亮（0.12s）
    .to(core.value, { scale: 1.15, svgOrigin: "100 100", duration: 0.12, ease: "power2.in" }, 0)
    .to(singularity.value, { scale: 2.2, opacity: 1, svgOrigin: "100 100", duration: 0.12, ease: "power2.in" }, 0)
    // 释放：整体膨胀 + 淡出（0.4s，与脉动并行，从 0 开始）
    .to(rootRef.value, { scale: 1.08, opacity: 0, duration: 0.4, ease: "power2.out" }, 0)
    .call(() => emit("done"))
}
</script>

<template>
  <svg
    ref="rootRef"
    class="tsian-logo"
    viewBox="0 0 200 200"
    :width="size"
    :height="size"
    @click="onClick"
  >
    <defs>
      <linearGradient id="tsian-rift-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color: #e8a948" />
        <stop offset="100%" style="stop-color: #9b3a2e" />
      </linearGradient>
      <filter id="tsian-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>

    <rect ref="outerFrame" class="logo-outer" x="50" y="50" width="100" height="100" fill="none" stroke-width="2" opacity="0.6" transform="rotate(45 100 100)" />
    <rect ref="innerFrame" class="logo-inner" x="52" y="52" width="96" height="96" fill="none" stroke-width="1.2" opacity="0.4" transform="rotate(22.5 100 100)" />
    <g ref="diagonals" class="logo-diagonals" stroke-width="0.8" opacity="0.3">
      <line x1="100" y1="20" x2="100" y2="180" />
      <line x1="20" y1="100" x2="180" y2="100" />
    </g>
    <g ref="core" class="logo-core">
      <path class="logo-rift" d="M100 12 L112 88 L188 100 L112 112 L100 188 L88 112 L12 100 L88 88 Z" filter="url(#tsian-glow)" />
      <path class="logo-tear" d="M100 35 L108 92 L165 100 L108 108 L100 165 L92 108 L35 100 L92 92 Z" fill="none" stroke-width="1.2" opacity="0.8" />
      <rect ref="singularity" class="logo-singularity" x="96" y="96" width="8" height="8" transform="rotate(45 100 100)" />
    </g>
  </svg>
</template>

<style scoped>
.tsian-logo {
  cursor: pointer;
  overflow: visible;
}
.logo-outer { stroke: var(--ember); }
.logo-inner { stroke: var(--ember-bright); }
.logo-diagonals { stroke: var(--whisper); }
.logo-rift { fill: url(#tsian-rift-grad); }
.logo-tear { stroke: var(--prose); }
.logo-singularity { fill: var(--ember-bright); }
</style>
