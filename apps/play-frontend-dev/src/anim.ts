// apps/play-frontend-dev/src/anim.ts
// 集中的 GSAP 动画入口。免费核心 + 按需注册插件。
// 所有 UI 动画的复用工具集中在此；后续渐进调优只改这个文件，
// 不再引入第二个动画库。
//
// 设计原则：
// - 持久 DOM 元素用 GSAP timeline 编排；每次 render 整体重绘的区域，
//   在重绘后调用对应的 enter 动画函数（不依赖跨 render 的 DOM 引用）。
// - CSS 只保留静态样式；动效（缓动、时长、stagger、keyframes）归 GSAP。

import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { Flip } from "gsap/Flip"

gsap.registerPlugin(ScrollTrigger, Flip)

export { gsap, ScrollTrigger, Flip }

// ── 主题缓动曲线（烛火书卷风格：柔和、不机械）──
export const EASE = {
  ember: "power2.out",        // 暖光渐隐
  emberIn: "power2.in",       // 暖光渐显
  soft: "power3.out",         // 通用柔和出场
  settle: "elastic.out(1, 0.6)", // 轻微回弹落定
  flow: "sine.inOut",         // 流光/呼吸
} as const

// ── 步骤切换入场（替代 .setup-entering CSS 动画）──
// 对整张 shell 做 fade + slide up。
export function animateStepEnter(shell: HTMLElement): void {
  gsap.fromTo(shell,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.36, ease: EASE.soft, clearProps: "opacity,transform" },
  )
}

// ── 方法卡片 / 分支卡片 hover ──
// 多层动效：上浮 + 描边亮度 + 内发光。比纯 CSS transition 更细腻。
export function attachCardHover(card: HTMLElement): void {
  const enter = () => gsap.to(card, {
    y: -4,
    duration: 0.28,
    ease: EASE.soft,
    boxShadow: "0 14px 36px rgba(0,0,0,0.34), inset 0 0 32px rgba(212,162,76,0.14)",
  })
  const leave = () => gsap.to(card, {
    y: 0,
    duration: 0.26,
    ease: EASE.ember,
    boxShadow: "0 0 0 rgba(0,0,0,0), inset 0 0 0 rgba(212,162,76,0)",
  })
  card.addEventListener("mouseenter", enter)
  card.addEventListener("mouseleave", leave)
}

// ── 烛火呼吸（running 态三点）──
// 比纯 CSS 更接近真火：不规则明灭 + 轻微位移。
export function animateEmbers(embers: HTMLElement): gsap.core.Timeline {
  const dots = embers.querySelectorAll<HTMLElement>(".setup-ember")
  const tl = gsap.timeline({ repeat: -1 })
  dots.forEach((dot, i) => {
    tl.to(dot, {
      opacity: 1,
      scale: 1.15,
      x: gsap.utils.random(-1.5, 1.5),
      duration: gsap.utils.random(0.7, 1.1),
      ease: EASE.flow,
    }, i * 0.25)
      .to(dot, {
        opacity: 0.4,
        scale: 0.75,
        x: gsap.utils.random(-1.5, 1.5),
        duration: gsap.utils.random(0.8, 1.2),
        ease: EASE.flow,
      }, "<+0.1")
  })
  return tl
}

// ── stepper 进度填充 ──
// 对 fill 元素做 scaleX 动画（比 CSS transition 更可控的缓动）。
export function animateStepperFill(fill: HTMLElement, ratio: number): void {
  gsap.to(fill, {
    scaleX: ratio,
    duration: 0.6,
    ease: EASE.flow,
  })
}

// ── 阶段文案切换（running 态）──
export function animateStageText(el: HTMLElement, text: string): void {
  gsap.to(el, {
    opacity: 0,
    y: 4,
    duration: 0.18,
    ease: EASE.ember,
    onComplete: () => {
      el.textContent = text
      gsap.to(el, { opacity: 1, y: 0, duration: 0.26, ease: EASE.soft })
    },
  })
}
