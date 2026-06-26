/**
 * platform-host 的跨子模块共享状态单例。子模块通过访问器拿引用，避免相互 import 产生
 * 循环依赖。详见任务 06-22-split-platform-host-index 的 design.md。
 */

let platformHostReady = false
let resolvePlatformHostReady: (() => void) | null = null
const platformHostReadyPromise = new Promise<void>((resolve) => {
  resolvePlatformHostReady = resolve
})

export function isPlatformHostReady(): boolean {
  return platformHostReady
}

export function markPlatformHostReady(): void {
  if (platformHostReady) {
    return
  }
  platformHostReady = true
  resolvePlatformHostReady?.()
  resolvePlatformHostReady = null
}

export async function waitForPlatformHostReady(): Promise<void> {
  if (platformHostReady) {
    return
  }
  await platformHostReadyPromise
}
