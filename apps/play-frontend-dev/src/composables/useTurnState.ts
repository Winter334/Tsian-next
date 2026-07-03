import { onBeforeUnmount, ref } from "vue"
import type { Ref } from "vue"

/**
 * useTurnState — 轮次状态机补充：实时计时器 + 滚动跟随。
 *
 * design §3：替代 main.ts 模块级 let（turnTimer/userPinnedToBottom）。
 * useTsian 已管 turnPhase/currentTurn 响应式状态，本 composable 补充：
 * - turnTimer：实时耗时计时（beginTurn 启动，finalizeTurn 停止），200ms 更新 meta
 * - userPinnedToBottom：用户滚动到底附近时自动跟随，上滚浏览时不强制拉回
 *
 * @param scrollEl 故事滚动容器 ref
 * @param turnActive 当前是否回合进行中（响应式）
 */
export function useTurnState(
  scrollEl: Ref<HTMLElement | null>,
  turnActive: Ref<boolean>,
) {
  const elapsedMs = ref(0)
  const userPinnedToBottom = ref(true)
  let turnStartedAt = 0
  let timerId: ReturnType<typeof setInterval> | null = null

  function handleScroll() {
    const el = scrollEl.value
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    userPinnedToBottom.value = dist < 80
  }

  /** 启动实时计时器（回合开始时调）。 */
  function beginTurnTimer() {
    stopTurnTimer()
    turnStartedAt = Date.now()
    elapsedMs.value = 0
    timerId = setInterval(() => {
      elapsedMs.value = Date.now() - turnStartedAt
    }, 200)
  }

  /** 停止计时器（回合结束时调）。 */
  function stopTurnTimer() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
    if (turnStartedAt) {
      elapsedMs.value = Date.now() - turnStartedAt
    }
  }

  /** 重置计时器（restore 回溯后调）——丢弃上一轮残留的 elapsedMs，
   *  避免重建后的 TurnMeta 显示被抹除轮的耗时。 */
  function resetTurnTimer() {
    stopTurnTimer()
    elapsedMs.value = 0
    turnStartedAt = 0
  }

  /** 滚动到底（仅当用户 pinned 时）。 */
  function maybeScrollDown() {
    if (!userPinnedToBottom.value) return
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  }

  onBeforeUnmount(() => {
    if (timerId) clearInterval(timerId)
  })

  return {
    elapsedMs,
    userPinnedToBottom,
    handleScroll,
    beginTurnTimer,
    stopTurnTimer,
    resetTurnTimer,
    maybeScrollDown,
  }
}

/** 把毫秒格式化成人类可读耗时（如 "4.2s"、"1.3min"）。 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}min`
}

/** 把 token 数格式化成紧凑显示（如 "1.2k"、"12k"、"1.3M"）。 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
