import { onBeforeUnmount, onMounted, readonly, ref } from "vue"
import { presenceApi } from "@/platform-host/api-client"

const HEARTBEAT_INTERVAL_MS = 30_000

const onlineCount = ref<number | null>(null)
const loading = ref(false)
const errorMessage = ref("")
let heartbeatTimer: number | null = null
let mountedConsumers = 0

export function usePresence() {
  onMounted(() => {
    mountedConsumers += 1
    if (mountedConsumers === 1) {
      void heartbeat()
      heartbeatTimer = window.setInterval(() => {
        void heartbeat()
      }, HEARTBEAT_INTERVAL_MS)
    }
  })

  onBeforeUnmount(() => {
    mountedConsumers = Math.max(0, mountedConsumers - 1)
    if (mountedConsumers === 0 && heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  })

  return {
    onlineCount: readonly(onlineCount),
    loading: readonly(loading),
    errorMessage: readonly(errorMessage),
    heartbeat,
  }
}

async function heartbeat(): Promise<void> {
  loading.value = true
  errorMessage.value = ""
  try {
    const summary = await presenceApi.heartbeat()
    onlineCount.value = summary.onlineCount
  } catch (error) {
    onlineCount.value = null
    errorMessage.value = error instanceof Error ? error.message : "在线人数不可用"
  } finally {
    loading.value = false
  }
}
