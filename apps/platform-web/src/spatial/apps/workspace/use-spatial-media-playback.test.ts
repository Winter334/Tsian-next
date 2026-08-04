// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onBeforeUnmount: vi.fn() }
})

import { onBeforeUnmount, ref } from "vue"
import { useSpatialMediaPlayback } from "./use-spatial-media-playback"

function createMediaState() {
  const media = document.createElement("video")
  const state = {
    paused: true,
    ended: false,
    currentTime: 12,
    duration: 120,
    volume: 0.75,
    muted: false,
  }
  Object.defineProperties(media, {
    paused: { configurable: true, get: () => state.paused },
    ended: { configurable: true, get: () => state.ended },
    currentTime: {
      configurable: true,
      get: () => state.currentTime,
      set: (value: number) => { state.currentTime = value },
    },
    duration: { configurable: true, get: () => state.duration },
    volume: {
      configurable: true,
      get: () => state.volume,
      set: (value: number) => { state.volume = value },
    },
    muted: {
      configurable: true,
      get: () => state.muted,
      set: (value: boolean) => { state.muted = value },
    },
  })
  Object.defineProperty(media, "play", {
    configurable: true,
    value: vi.fn(async () => { state.paused = false }),
  })
  Object.defineProperty(media, "pause", {
    configurable: true,
    value: vi.fn(() => { state.paused = true }),
  })
  Object.defineProperty(media, "requestFullscreen", {
    configurable: true,
    value: vi.fn(async () => undefined),
  })
  return { media, state }
}

function runUnmountCleanup(): void {
  const calls = vi.mocked(onBeforeUnmount).mock.calls
  calls[calls.length - 1]?.[0]?.()
}

describe("useSpatialMediaPlayback", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it("reflects the real media state and cleans up the exact listeners it installed", async () => {
    const { media, state } = createMediaState()
    const removeMediaListener = vi.spyOn(media, "removeEventListener")
    const addDocumentListener = vi.spyOn(document, "addEventListener")
    const removeDocumentListener = vi.spyOn(document, "removeEventListener")
    const playback = useSpatialMediaPlayback(ref<HTMLMediaElement | null>(media))

    playback.attach()
    expect(playback.currentTime.value).toBe(12)
    expect(playback.duration.value).toBe(120)
    expect(playback.timeLabel.value).toBe("00:12 / 02:00")
    expect(playback.canSeek.value).toBe(true)

    playback.seek(200)
    expect(state.currentTime).toBe(120)
    playback.setVolume(0.25)
    expect(state.volume).toBe(0.25)
    expect(state.muted).toBe(false)
    playback.toggleMuted()
    expect(state.muted).toBe(true)
    await playback.togglePlay()
    expect(playback.playing.value).toBe(true)
    await playback.toggleFullscreen()
    expect(media.requestFullscreen).toHaveBeenCalledOnce()

    const fullscreenChangeListener = addDocumentListener.mock.calls
      .find(([event]) => event === "fullscreenchange")?.[1]
    runUnmountCleanup()

    expect(removeMediaListener).toHaveBeenCalledWith("timeupdate", expect.any(Function))
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "fullscreenchange",
      fullscreenChangeListener,
    )
  })

  it("resets stale playback and error state when the media element is removed", () => {
    const { media } = createMediaState()
    const element = ref<HTMLMediaElement | null>(media)
    const playback = useSpatialMediaPlayback(element)
    playback.attach()
    playback.error.value = "旧文件错误"

    element.value = null
    playback.attach()

    expect(playback.error.value).toBe("")
    expect(playback.playing.value).toBe(false)
    expect(playback.currentTime.value).toBe(0)
    expect(playback.duration.value).toBe(0)
    runUnmountCleanup()
  })
})
