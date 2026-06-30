<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue"
import { easeInOut, initBurningGl, type BurnContext } from "../lib/shader"

/**
 * BurningReveal — WebGL 燃烧幕布（纸张纹理）。
 *
 * 时序契约（挂载即燃烧，延迟显示，消除前摇）：
 * - 挂载时：同步初始化 WebGL + 生成纸张纹理 + 立即开始 rAF 燃烧（progress 从 0 跑起），
 *   canvas visibility:hidden（不遮挡 idle 层 logo 动画）。
 * - delay 后（默认 250ms，等 logo 动画结束）：canvas 显示。
 *   此时 progress ≈ easeInOut(0.25/8) ≈ 2%，画面几乎仍是静止纸张，无缝衔接。
 * - 燃烧 u_progress 0→1（easeInOut，duration 8s），从边缘 fbm 推进烧蚀。
 * - 烧穿区 alpha=0 真透明，露出下层向导/主游玩态。
 * - 完成：canvas display:none + emit revealed。
 *
 * 关键：燃烧在挂载瞬间就开始（rAF 跑着），canvas 只是延迟显示。
 * 这样前摇 = delay（logo 动画时间），而非 delay + 燃烧等待。点击响应感最强。
 *
 * WebGL 不可用时直接 emit revealed（design §7 风险 1，已接受无 fallback）。
 */
const props = withDefaults(
  defineProps<{
    duration?: number
    /** canvas 延迟显示毫秒数（等 logo 动画结束），期间 rAF 已在跑 */
    delay?: number
  }>(),
  { duration: 8000, delay: 250 },
)

const emit = defineEmits<{
  shown: []
  revealed: []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const visible = ref(false)
let ctx: BurnContext | null = null
let rafId = 0
let startTime = 0
let showTimer = 0
let burning = false

function resize() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  const dpr = Math.min(window.devicePixelRatio, 2)
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  ctx.gl.viewport(0, 0, canvas.width, canvas.height)
  ctx.gl.uniform2f(ctx.uniforms["u_resolution"], canvas.width, canvas.height)
}

function drawFrame(progress: number, time: number) {
  if (!ctx) return
  ctx.gl.clear(ctx.gl.COLOR_BUFFER_BIT)
  ctx.gl.uniform1f(ctx.uniforms["u_time"], time)
  ctx.gl.uniform1f(ctx.uniforms["u_progress"], progress)
  ctx.gl.activeTexture(ctx.gl.TEXTURE0)
  ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, ctx.textTexture)
  ctx.gl.uniform1i(ctx.uniforms["u_text"], 0)
  ctx.gl.drawArrays(ctx.gl.TRIANGLE_STRIP, 0, 4)
}

function render() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  const now = performance.now()
  const elapsed = (now - startTime) / props.duration

  if (elapsed >= 1) {
    canvas.style.display = "none"
    burning = false
    emit("revealed")
    return
  }

  drawFrame(easeInOut(elapsed), now)
  rafId = requestAnimationFrame(render)
}

function startBurn() {
  if (burning || !ctx) return
  burning = true
  startTime = performance.now()
  resize()
  rafId = requestAnimationFrame(render)
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  ctx = initBurningGl(canvas)
  if (!ctx) {
    console.error("BurningReveal: WebGL 不可用，跳过燃烧过渡")
    emit("revealed")
    return
  }
  // 立即开始燃烧（rAF 跑起），canvas 仍隐藏
  startBurn()
  // delay 后显示 canvas（此时 progress≈5%，几乎静止，无缝衔接）
  // emit shown 通知父组件：canvas 已盖住，可安全移除 idle 层（避免闪现下层占位）
  showTimer = window.setTimeout(() => {
    visible.value = true
    emit("shown")
  }, props.delay)
  window.addEventListener("resize", resize)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  clearTimeout(showTimer)
  window.removeEventListener("resize", resize)
})
</script>

<template>
  <canvas
    ref="canvasRef"
    class="burning-reveal"
    :style="{ visibility: visible ? 'visible' : 'hidden' }"
    aria-hidden="true"
  />
</template>

<style scoped>
.burning-reveal {
  position: fixed;
  inset: 0;
  z-index: 50;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
