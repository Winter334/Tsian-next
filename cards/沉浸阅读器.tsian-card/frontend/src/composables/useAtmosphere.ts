import { onMounted, onUnmounted, ref, type Ref } from "vue"

/**
 * useAtmosphere — 余烬粒子 Canvas + 鼠标 lerp 视差。
 *
 * 参考示例 lachisa 的花瓣粒子算法，改为烛火余烬：暖色微粒从底部上升，
 * 带 sin 摆动 + 鼠标 lerp 牵引。返回一个 canvas ref，挂到全屏覆盖层。
 *
 * 粒子参数：
 * - 暖色微粒（琥珀/暗血/暖白，低 alpha）
 * - 从底部生成，缓慢上升 + 横向 sin 摆动
 * - 鼠标移动时粒子受 lerp 牵引（惯性跟随）
 * - density 控制粒子数（主游玩态稀疏，开屏/向导密集）
 */
export interface AtmosphereOptions {
  /** 粒子数量上限 */
  density?: number
  /** 视差强度（粒子受鼠标牵引幅度，0=禁用） */
  parallax?: number
}

interface Ember {
  x: number
  y: number
  size: number
  speedY: number
  speedX: number
  angle: number
  spin: number
  color: string
  baseX: number
}

const EMBER_COLORS = [
  "rgba(232, 169, 72, 0.35)",  // 琥珀
  "rgba(181, 137, 61, 0.25)",  // 古金
  "rgba(155, 58, 46, 0.20)",   // 血珀
  "rgba(212, 201, 180, 0.18)", // 暖白
]

export function useAtmosphere(
  canvasRef: Ref<HTMLCanvasElement | null>,
  options: AtmosphereOptions = {},
) {
  const { density = 40, parallax = 10 } = options

  let rafId = 0
  let ctx: CanvasRenderingContext2D | null = null
  let embers: Ember[] = []
  let mouseX = 0
  let parallaxX = 0
  let resizeTimeout = 0

  function createEmber(w: number, h: number): Ember {
    const size = Math.random() * 2.5 + 0.8
    return {
      x: Math.random() * w,
      y: h + Math.random() * h * 0.3, // 从底部及以下生成
      baseX: 0,
      size,
      speedY: -(Math.random() * 0.5 + 0.2), // 上升
      speedX: Math.random() * 0.3 - 0.15,
      angle: Math.random() * 360,
      spin: Math.random() * 0.6 - 0.3,
      color: EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)]!,
    }
  }

  function resize() {
    const canvas = canvasRef.value
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr
    ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.scale(dpr, dpr)
    }
  }

  function onMouseMove(e: MouseEvent) {
    mouseX = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2)
  }

  function tick() {
    const canvas = canvasRef.value
    if (!canvas || !ctx) {
      rafId = requestAnimationFrame(tick)
      return
    }
    const w = window.innerWidth
    const h = window.innerHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // lerp 视差
    parallaxX += (-mouseX * parallax - parallaxX) * 0.05

    for (let i = 0; i < embers.length; i++) {
      const e = embers[i]!
      e.y += e.speedY
      e.x += e.speedX + Math.sin(e.y / 50) * 0.2 + parallaxX * 0.02
      e.angle += e.spin

      // 上升到顶部外，回到底部
      if (e.y < -10) {
        e.y = h + 10
        e.x = Math.random() * w
      }

      ctx.save()
      ctx.translate(e.x, e.y)
      ctx.rotate((e.angle * Math.PI) / 180)
      ctx.fillStyle = e.color
      ctx.beginPath()
      // 余烬是微小的发光点，用圆形
      ctx.arc(0, 0, e.size, 0, 2 * Math.PI)
      ctx.fill()
      ctx.restore()
    }

    rafId = requestAnimationFrame(tick)
  }

  function start() {
    resize()
    embers = Array.from({ length: density }, () =>
      createEmber(window.innerWidth, window.innerHeight),
    )
    window.addEventListener("resize", resize)
    window.addEventListener("mousemove", onMouseMove)
    rafId = requestAnimationFrame(tick)
  }

  function stop() {
    cancelAnimationFrame(rafId)
    window.removeEventListener("resize", resize)
    window.removeEventListener("mousemove", onMouseMove)
    clearTimeout(resizeTimeout)
  }

  onMounted(start)
  onUnmounted(stop)

  return { density: ref(density) }
}
