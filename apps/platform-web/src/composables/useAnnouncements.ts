import { computed, onBeforeUnmount, onMounted, readonly, ref } from "vue"
import type { Announcement } from "@tsian/contracts"
import { announcementsApi } from "@/platform-host/api-client"
import { toast } from "@/composables/useToast"

const READ_KEY = "tsian:announcements:read:v1"
const POLL_INTERVAL_MS = 60_000

const announcements = ref<Announcement[]>([])
const readIds = ref<Set<string>>(loadReadIds())
const loading = ref(false)
const errorMessage = ref("")
let pollTimer: number | null = null
let mountedConsumers = 0

const unreadCount = computed(() => announcements.value.filter((item) => !readIds.value.has(item.id)).length)

export function useAnnouncements() {
  onMounted(() => {
    mountedConsumers += 1
    if (mountedConsumers === 1) {
      void refreshAnnouncements({ notifyNew: false })
      pollTimer = window.setInterval(() => {
        void refreshAnnouncements({ notifyNew: true })
      }, POLL_INTERVAL_MS)
    }
  })

  onBeforeUnmount(() => {
    mountedConsumers = Math.max(0, mountedConsumers - 1)
    if (mountedConsumers === 0 && pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
  })

  return {
    announcements: readonly(announcements),
    unreadCount,
    loading: readonly(loading),
    errorMessage: readonly(errorMessage),
    refreshAnnouncements,
    markRead,
    isRead,
  }
}

async function refreshAnnouncements(options: { notifyNew?: boolean } = {}): Promise<void> {
  loading.value = true
  errorMessage.value = ""
  const previousIds = new Set(announcements.value.map((item) => item.id))
  try {
    const next = await announcementsApi.list()
    announcements.value = next
    if (options.notifyNew) {
      const firstNew = next.find((item) => !previousIds.has(item.id) && !readIds.value.has(item.id))
      if (firstNew) {
        toast.info(`新公告：${firstNew.title}`)
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "公告加载失败"
  } finally {
    loading.value = false
  }
}

function markRead(id: string): void {
  if (!id || readIds.value.has(id)) {
    return
  }
  const next = new Set(readIds.value)
  next.add(id)
  readIds.value = next
  saveReadIds(next)
}

function isRead(id: string): boolean {
  return readIds.value.has(id)
}

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (!raw) {
      return new Set()
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return new Set()
    }
    return new Set(parsed.filter((value): value is string => typeof value === "string"))
  } catch {
    return new Set()
  }
}

function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
  } catch {
    // localStorage can be unavailable in private/sandboxed contexts.
  }
}
