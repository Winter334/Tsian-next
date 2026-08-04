import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue"

/** Keeps source-local controls reconciled with the actual media element. */
export function useSpatialMediaPlayback(element: Ref<HTMLMediaElement | null>) {
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(1)
  const muted = ref(false)
  const error = ref("")
  const fullscreen = ref(false)
  let cleanup: (() => void) | null = null

  const canSeek = computed(() => Number.isFinite(duration.value) && duration.value > 0)
  const timeLabel = computed(() => `${formatTime(currentTime.value)} / ${formatTime(duration.value)}`)

  function resetState(): void {
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    volume.value = 1
    muted.value = false
    fullscreen.value = false
  }

  function sync(): void {
    const media = element.value
    if (!media) {
      resetState()
      return
    }
    playing.value = !media.paused && !media.ended
    currentTime.value = Number.isFinite(media.currentTime) ? media.currentTime : 0
    duration.value = Number.isFinite(media.duration) ? media.duration : 0
    volume.value = media.volume
    muted.value = media.muted
    fullscreen.value = document.fullscreenElement === media
  }
  function attach(): void {
    cleanup?.()
    error.value = ""
    const media = element.value
    if (!media) {
      resetState()
      return
    }
    const events = ["loadedmetadata", "durationchange", "timeupdate", "progress", "play", "pause", "ended", "volumechange", "seeking", "seeked", "error"] as const
    const listener = () => { sync(); if (media.error) error.value = "媒体无法解码或播放。" }
    events.forEach((event) => media.addEventListener(event, listener))
    const fullscreenError = () => { error.value = "无法进入全屏。" }
    document.addEventListener("fullscreenchange", sync)
    document.addEventListener("fullscreenerror", fullscreenError)
    cleanup = () => {
      events.forEach((event) => media.removeEventListener(event, listener))
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener("fullscreenerror", fullscreenError)
      cleanup = null
    }
    sync()
  }
  async function togglePlay(): Promise<void> {
    const media = element.value; if (!media) return
    error.value = ""
    try { if (media.paused) await media.play(); else media.pause() } catch (cause) { error.value = cause instanceof Error ? cause.message : "播放被浏览器拒绝。" }
    sync()
  }
  function seek(value: number): void { const media = element.value; if (!media || !canSeek.value) return; media.currentTime = Math.max(0, Math.min(value, duration.value)); sync() }
  function setVolume(value: number): void { const media = element.value; if (!media) return; media.volume = Math.max(0, Math.min(value, 1)); if (media.volume > 0) media.muted = false; sync() }
  function toggleMuted(): void { const media = element.value; if (!media) return; media.muted = !media.muted; sync() }
  async function toggleFullscreen(): Promise<void> {
    const media = element.value as HTMLVideoElement | null
    if (!media || media.tagName.toLowerCase() !== "video") return
    error.value = ""
    try { if (document.fullscreenElement === media) await document.exitFullscreen(); else await media.requestFullscreen() } catch (cause) { error.value = cause instanceof Error ? cause.message : "浏览器拒绝全屏请求。" }
    sync()
  }
  watch(element, attach, { flush: "post" })
  onBeforeUnmount(() => cleanup?.())
  return { playing, currentTime, duration, volume, muted, error, fullscreen, canSeek, timeLabel, attach, sync, togglePlay, seek, setVolume, toggleMuted, toggleFullscreen }
}

function formatTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
}
