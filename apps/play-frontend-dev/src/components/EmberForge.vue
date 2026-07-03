<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue"

/**
 * EmberForge — 余烬凝笔。
 *
 * 余烬粒子从四周随机方向缓慢飘向中心焦点，到达后缩小变亮，
 * 偶尔迸出一圈微小火花。中心有 ember-bright 核心微光呼吸明灭。
 * 暗示"思绪在凝聚成文"。
 *
 * 两种用法：
 * - inline（StoryView 文字末尾）：小尺寸，inline-block
 * - standalone（访谈等待）：稍大，独立显示
 */
const props = withDefaults(
  defineProps<{
    /** inline = 跟在文字末尾；standalone = 独立居中显示 */
    variant?: "inline" | "standalone"
    /** 是否活跃（false 时停止动画，用于 v-if 外部的平滑控制） */
    active?: boolean
  }>(),
  { variant: "inline", active: true },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
let rafId = 0
let ctx: CanvasRenderingContext2D | null = null

interface ForgeParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  baseSize: number
  color: string
  life: number
  maxLife: number
  spark: boolean
}

const COLORS = [
  "rgba(232, 169, 72, 0.7)",
  "rgba(181, 137, 61, 0.5)",
  "rgba(212, 201, 180, 0.35)",
  "rgba(155, 58, 46, 0.3)",
]

let particles: ForgeParticle[] = []
let centerX = 0
let centerY = 0
let sparkTimer = 0
let corePulse = 0

function spawnParticle(w: number, h: number): ForgeParticle {
  const angle = Math.random() * Math.PI * 2
  const dist = Math.max(w, h) * (0.4 + Math.random() * 0.3)
  const baseSize = Math.random() * 1.8 + 0.6
  return {
    x: centerX + Math.cos(angle) * dist,
    y: centerY + Math.sin(angle) * dist,
    vx: 0,
    vy: 0,
    size: baseSize,
    baseSize,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    life: 0,
    maxLife: 60 + Math.random() * 40,
    spark: false,
  }
}

function tick() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) {
    rafId = requestAnimationFrame(tick)
    return
  }
  const w = canvas.width / (window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio)
  const h = canvas.height / (window.devicePixelRatio > 2 ? 2 : window.devicePixelRatio)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  corePulse += 0.04

  // 中心核心微光
  const coreRadius = 3 + Math.sin(corePulse) * 1.5
  const coreGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius * 4)
  coreGlow.addColorStop(0, "rgba(232, 169, 72, 0.6)")
  coreGlow.addColorStop(0.4, "rgba(232, 169, 72, 0.2)")
  coreGlow.addColorStop(1, "rgba(232, 169, 72, 0)")
  ctx.fillStyle = coreGlow
  ctx.beginPath()
  ctx.arc(centerX, centerY, coreRadius * 4, 0, Math.PI * 2)
  ctx.fill()

  // 核心实心点
  ctx.fillStyle = "rgba(232, 169, 72, 0.8)"
  ctx.beginPath()
  ctx.arc(centerX, centerY, coreRadius * 0.6, 0, Math.PI * 2)
  ctx.fill()

  // 偶尔迸发火花
  sparkTimer++
  if (sparkTimer > 50 && Math.random() < 0.04) {
    sparkTimer = 0
    const sparkAngle = Math.random() * Math.PI * 2
    particles.push({
      x: centerX,
      y: centerY,
      vx: Math.cos(sparkAngle) * (1.5 + Math.random()),
      vy: Math.sin(sparkAngle) * (1.5 + Math.random()),
      size: 1.2,
      baseSize: 1.2,
      color: "rgba(232, 169, 72, 0.8)",
      life: 0,
      maxLife: 15 + Math.random() * 10,
      spark: true,
    })
  }

  // 更新粒子
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!
    p.life++

    if (p.spark) {
      // 火花：向外飞 + 减速 + 消失
      p.x += p.vx
      p.y += p.vy
      p.vx *= 0.92
      p.vy *= 0.92
      p.size = p.baseSize * (1 - p.life / p.maxLife)
      if (p.life >= p.maxLife) {
        particles.splice(i, 1)
        continue
      }
    } else {
      // 聚拢粒子：朝中心移动，越近越快越亮
      const dx = centerX - p.x
      const dy = centerY - p.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const pull = 0.015 + (1 - dist / (Math.max(w, h) * 0.7)) * 0.03
      p.vx += dx * pull
      p.vy += dy * pull
      p.vx *= 0.95
      p.vy *= 0.95
      p.x += p.vx
      p.y += p.vy

      // 到达中心：重置为远处
      if (dist < 3 || p.life >= p.maxLife) {
        particles[i] = spawnParticle(w, h)
        continue
      }
      // 越近越亮越小
      const closeness = 1 - dist / (Math.max(w, h) * 0.7)
      p.size = p.baseSize * (0.4 + closeness * 0.8)
    }

    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }

  rafId = requestAnimationFrame(tick)
}

function resize() {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = Math.min(window.devicePixelRatio, 2)
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx = canvas.getContext("2d")
  if (ctx) {
    ctx.scale(dpr, dpr)
  }
  centerX = rect.width / 2
  centerY = rect.height / 2
}

function start() {
  resize()
  const rect = canvasRef.value?.getBoundingClientRect()
  const w = rect?.width ?? 80
  const h = rect?.height ?? 40
  particles = Array.from({ length: 5 }, () => spawnParticle(w, h))
  rafId = requestAnimationFrame(tick)
}

function stop() {
  cancelAnimationFrame(rafId)
}

onMounted(() => {
  if (props.active) start()
})

onUnmounted(stop)

watch(
  () => props.active,
  (active) => {
    if (active) start()
    else stop()
  },
)
</script>

<template>
  <canvas
    ref="canvasRef"
    class="ember-forge"
    :class="{ standalone: variant === 'standalone' }"
    aria-hidden="true"
  />
</template>

<style scoped>
.ember-forge {
  display: inline-block;
  vertical-align: text-bottom;
  width: 50px;
  height: 24px;
}
.ember-forge.standalone {
  display: block;
  width: 80px;
  height: 48px;
  margin: 32px 0;
}
</style>
