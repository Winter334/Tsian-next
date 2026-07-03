<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"

const emit = defineEmits<{
  exit: []
}>()

type Phase = "gate" | "boot" | "bsod" | "entering" | "idle" | "exiting"

type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  mozRequestFullScreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

interface StarItem {
  id: number
  top: number
  left: number
  speed: number
  frame: number
}

const CAT_SRC = "/nyan/technyancolor.gif"
const MUSIC_SRC = "/nyan/technyancolor.mp3"
const CAT_WIDTH = 250
const RAINBOW_ANCHOR = 0
const MUSIC_VOLUME = 0.5
const SEGMENTS = 70

const phase = ref<Phase>("gate")
const bootProgress = ref(0)
const bsodProgress = ref(0)
const showHint = ref(false)
const audioRef = ref<HTMLAudioElement>()
const stars = ref<StarItem[]>([])

const logoLetters = ["T", "S", "I", "A", "N"]

let starId = 0
let placeStarTimer: ReturnType<typeof setInterval> | null = null
let animateStarsTimer: ReturnType<typeof setInterval> | null = null
let bootProgressTimer: ReturnType<typeof setInterval> | null = null
let bootCrashTimer: ReturnType<typeof setTimeout> | null = null
let bsodProgressTimer: ReturnType<typeof setInterval> | null = null
let enteringTimer: ReturnType<typeof setTimeout> | null = null
let hintTimer: ReturnType<typeof setTimeout> | null = null
let exitTimer: ReturnType<typeof setTimeout> | null = null
let musicFadeDelayTimer: ReturnType<typeof setTimeout> | null = null
let musicFadeTimer: ReturnType<typeof setInterval> | null = null

const nyanActive = computed(() => (
  phase.value === "entering" || phase.value === "idle" || phase.value === "exiting"
))
const isInteractive = computed(() => (
  phase.value === "gate" || phase.value === "bsod" || phase.value === "idle"
))
const cssVars = computed(() => ({
  "--entering-duration": "2200ms",
  "--exiting-duration": "1600ms",
  "--cat-width": `${CAT_WIDTH}px`,
  "--rainbow-anchor": `${RAINBOW_ANCHOR}px`,
}))

function placeStar() {
  if (stars.value.length >= 40) return

  const id = starId++
  stars.value.push({
    id,
    top: Math.random() * 100,
    left: Math.random() * 100,
    speed: Math.floor(Math.random() * 4) + 1,
    frame: 1,
  })
}

function animateStars() {
  stars.value = stars.value.filter((star) => {
    star.left -= star.speed * 0.5
    if (star.left < -5) return false
    star.frame++
    if (star.frame > 6) star.frame = 1
    return true
  })
}

function clearBootTimers() {
  if (bootProgressTimer) clearInterval(bootProgressTimer)
  if (bootCrashTimer) clearTimeout(bootCrashTimer)
  bootProgressTimer = null
  bootCrashTimer = null
}

function clearBsodTimer() {
  if (bsodProgressTimer) clearInterval(bsodProgressTimer)
  bsodProgressTimer = null
}

function clearNyanTimers() {
  if (enteringTimer) clearTimeout(enteringTimer)
  if (hintTimer) clearTimeout(hintTimer)
  if (exitTimer) clearTimeout(exitTimer)
  enteringTimer = null
  hintTimer = null
  exitTimer = null
}

function clearMusicFadeDelayTimer() {
  if (musicFadeDelayTimer) clearTimeout(musicFadeDelayTimer)
  musicFadeDelayTimer = null
}

function clearMusicFadeTimer() {
  if (musicFadeTimer) clearInterval(musicFadeTimer)
  musicFadeTimer = null
}

function requestFullscreenFromGesture() {
  const root = document.documentElement as FullscreenRoot
  const request = root.requestFullscreen
    ?? root.webkitRequestFullscreen
    ?? root.mozRequestFullScreen
    ?? root.msRequestFullscreen

  if (!request || document.fullscreenElement) return

  try {
    void Promise.resolve(request.call(root)).catch(() => {})
  } catch {
    // Fullscreen can be rejected outside browser-supported contexts.
  }
}

function startBootSequence() {
  phase.value = "boot"
  bootProgress.value = 0
  clearBootTimers()

  bootProgressTimer = setInterval(() => {
    bootProgress.value = Math.min(
      99,
      bootProgress.value + Math.floor(Math.random() * 9) + 5,
    )

    if (bootProgress.value >= 99) {
      clearBootTimers()
      bootCrashTimer = setTimeout(() => {
        if (phase.value !== "boot") return
        phase.value = "bsod"
        startBsodProgress()
      }, 520)
    }
  }, 140)
}

function startBsodProgress() {
  bsodProgress.value = 0
  clearBsodTimer()

  bsodProgressTimer = setInterval(() => {
    if (phase.value !== "bsod") {
      clearBsodTimer()
      return
    }

    bsodProgress.value = Math.min(
      99,
      bsodProgress.value + Math.floor(Math.random() * 4) + 1,
    )

    if (bsodProgress.value >= 99) clearBsodTimer()
  }, 620)
}

function fadeInMusic() {
  const audio = audioRef.value
  if (!audio) return

  clearMusicFadeTimer()
  audio.volume = 0

  const step = MUSIC_VOLUME / 24
  musicFadeTimer = setInterval(() => {
    const currentAudio = audioRef.value
    if (!currentAudio) {
      clearMusicFadeTimer()
      return
    }

    currentAudio.volume = Math.min(MUSIC_VOLUME, currentAudio.volume + step)
    if (currentAudio.volume >= MUSIC_VOLUME) clearMusicFadeTimer()
  }, 40)
}

function primeMusicForNyan() {
  const audio = audioRef.value
  if (!audio) return

  audio.muted = false
  audio.volume = 0
  try {
    audio.currentTime = 0
  } catch {
    // Some media states may reject seeking before enough data is available.
  }

  audio.play().catch(() => {
    // Playback failure should not block the visual boot flow.
  })

  clearMusicFadeDelayTimer()
  musicFadeDelayTimer = setTimeout(() => {
    musicFadeDelayTimer = null
    fadeInMusic()
  }, 120)
}

function fadeOutMusic() {
  clearMusicFadeTimer()

  const audio = audioRef.value
  if (!audio) return

  if (audio.volume <= 0) {
    audio.pause()
    return
  }

  const step = audio.volume / 30
  musicFadeTimer = setInterval(() => {
    const currentAudio = audioRef.value
    if (!currentAudio) {
      clearMusicFadeTimer()
      return
    }

    currentAudio.volume = Math.max(0, currentAudio.volume - step)
    if (currentAudio.volume <= 0) {
      currentAudio.pause()
      clearMusicFadeTimer()
    }
  }, 40)
}

function scheduleIdlePhase() {
  clearNyanTimers()
  enteringTimer = setTimeout(() => {
    if (phase.value !== "entering") return

    phase.value = "idle"
    hintTimer = setTimeout(() => {
      if (phase.value === "idle") showHint.value = true
    }, 600)
  }, 2200)
}

function launchBootFromGate() {
  if (phase.value !== "gate") return

  requestFullscreenFromGesture()
  startBootSequence()
}

function launchNyanFromBsod() {
  if (phase.value !== "bsod") return

  clearBsodTimer()
  requestFullscreenFromGesture()
  primeMusicForNyan()
  showHint.value = false
  phase.value = "entering"
  scheduleIdlePhase()
}

function exitSplash() {
  if (phase.value !== "idle") return

  phase.value = "exiting"
  showHint.value = false
  fadeOutMusic()

  exitTimer = setTimeout(() => {
    exitTimer = null
    emit("exit")
  }, 1600)
}

function handlePointerDown() {
  if (phase.value === "gate") {
    launchBootFromGate()
    return
  }

  if (phase.value === "bsod") {
    launchNyanFromBsod()
    return
  }

  if (phase.value === "idle") {
    exitSplash()
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") return

  if (phase.value === "gate") {
    launchBootFromGate()
    return
  }

  if (phase.value === "bsod") {
    launchNyanFromBsod()
    return
  }

  if (phase.value === "idle") {
    exitSplash()
  }
}

onMounted(() => {
  placeStarTimer = setInterval(placeStar, 60)
  animateStarsTimer = setInterval(animateStars, 150)
  document.addEventListener("keydown", handleKeydown)
})

onUnmounted(() => {
  clearBootTimers()
  clearBsodTimer()
  clearNyanTimers()
  clearMusicFadeDelayTimer()
  clearMusicFadeTimer()
  if (placeStarTimer) clearInterval(placeStarTimer)
  if (animateStarsTimer) clearInterval(animateStarsTimer)
  if (audioRef.value) audioRef.value.pause()
  document.removeEventListener("keydown", handleKeydown)
})
</script>

<template>
  <div
    class="nyan-splash"
    :class="[`phase-${phase}`, { 'is-interactive': isInteractive }]"
    :style="cssVars"
    @pointerdown="handlePointerDown"
  >
    <div class="stars-layer" aria-hidden="true">
      <div
        v-for="star in stars"
        :key="star.id"
        class="star"
        :class="[`speed-${star.speed}`, `frame-${star.frame}`]"
        :style="{ top: star.top + '%', left: star.left + '%' }"
      >
        <div class="wrapper">
          <div class="dot dot-1" />
          <div class="dot dot-2" />
          <div class="dot dot-3" />
          <div class="dot dot-4" />
          <div class="dot dot-5" />
          <div class="dot dot-6" />
          <div class="dot dot-7" />
          <div class="dot dot-8" />
          <div class="dot dot-9" />
        </div>
      </div>
    </div>

    <Transition name="gate-fade">
      <section v-if="phase === 'gate'" class="gate-screen" aria-label="Tsian splash start">
        <div class="pointer-events-none fixed inset-0 crt-scanlines opacity-30" aria-hidden="true" />
        <div class="pointer-events-none fixed inset-0 bg-noise opacity-20" aria-hidden="true" />

        <div class="gate-grid" aria-hidden="true" />
        <div class="gate-core">
          <div class="gate-logo-stack">
            <img class="gate-logo gate-logo-main" src="/tsian.svg" alt="Tsian" draggable="false">
            <img class="gate-logo gate-logo-ghost gate-logo-ghost-a" src="/tsian.svg" alt="" draggable="false">
            <img class="gate-logo gate-logo-ghost gate-logo-ghost-b" src="/tsian.svg" alt="" draggable="false">
          </div>

          <div class="gate-wordmark" aria-label="TSIAN">
            <span
              v-for="(letter, index) in logoLetters"
              :key="letter"
              :style="{ '--letter-index': index }"
            >{{ letter }}</span>
          </div>

          <div class="gate-subtitle">
            <span>RUNTIME WORKSPACE</span>
            <span>BOOT SEQUENCE ARMED</span>
          </div>
          <div class="gate-prompt">[ 点击任意位置启动 TSIAN ]</div>
        </div>
      </section>
    </Transition>

    <Transition name="boot-fade">
      <section v-if="phase === 'boot'" class="boot-screen" aria-label="Tsian boot loading screen">
        <div class="pointer-events-none fixed inset-0 crt-scanlines opacity-25" aria-hidden="true" />
        <div class="pointer-events-none fixed inset-0 bg-noise opacity-20" aria-hidden="true" />

        <div class="boot-panel">
          <div class="boot-kicker">TSIAN RETROOS // WORKSPACE BOOT</div>
          <h1>Restoring platform context</h1>
          <ul class="boot-lines" aria-hidden="true">
            <li>mount runtime workspace volume</li>
            <li>preheat platform configuration cache</li>
            <li>align operator shell geometry</li>
            <li>arm rainbow overflow detector</li>
          </ul>
          <div class="boot-bar" aria-hidden="true">
            <div class="boot-bar-fill" :style="{ width: bootProgress + '%' }" />
          </div>
          <div class="boot-meta">
            <span>{{ bootProgress }}%</span>
            <span>loading platform resources</span>
          </div>
        </div>
      </section>
    </Transition>

    <Transition name="bsod-cut">
      <section v-if="phase === 'bsod'" class="bsod-screen" aria-label="Blue screen parody">
        <div class="bsod-face">:(</div>
        <p class="bsod-message">
          Your platform ran into a rainbow problem and needs to restart.
          We're just collecting some pop-tart crumbs, and then we'll nyan for you.
          (<span>{{ bsodProgress }}</span>% complete)
        </p>
        <p class="bsod-bottom">
          If you'd like to know more, you can search online later for this error:
          <br>
          NYAN_CAT_OVERFLOW
          <br>
          What failed: technyancolor.sys
        </p>
      </section>
    </Transition>

    <template v-if="nyanActive">
      <div class="rainbow-stage" :class="'rs-' + phase">
        <div class="rainbows">
          <div class="rainbow-group">
            <div
              v-for="i in SEGMENTS"
              :key="'a-' + i"
              class="rainbow"
              :class="i % 2 === 1 ? 'frame-1' : 'frame-2'"
            >
              <div class="wave wave-1" />
              <div class="wave wave-2" />
              <div class="wave wave-3" />
              <div class="wave wave-4" />
              <div class="wave wave-5" />
              <div class="wave wave-6" />
            </div>
          </div>
          <div class="rainbow-group">
            <div
              v-for="i in SEGMENTS"
              :key="'b-' + i"
              class="rainbow"
              :class="i % 2 === 1 ? 'frame-1' : 'frame-2'"
            >
              <div class="wave wave-1" />
              <div class="wave wave-2" />
              <div class="wave wave-3" />
              <div class="wave wave-4" />
              <div class="wave wave-5" />
              <div class="wave wave-6" />
            </div>
          </div>
        </div>
      </div>

      <div class="cat-container" :class="'cat-' + phase">
        <img class="nyan-cat" :src="CAT_SRC" alt="Nyan Cat" draggable="false">
      </div>

      <Transition name="hint-fade">
        <div v-if="showHint" class="click-hint">
          <span>Click anywhere to enter</span>
        </div>
      </Transition>
    </template>

    <audio ref="audioRef" :src="MUSIC_SRC" loop preload="auto" playsinline />
  </div>
</template>

<style scoped>
.nyan-splash {
  position: fixed;
  inset: 0;
  overflow: hidden;
  cursor: default;
  user-select: none;
  z-index: 9999;
  background: var(--color-void);
  color: var(--color-text-main);
  font-family: var(--font-mono);
}

.nyan-splash.is-interactive {
  cursor: pointer;
}

.nyan-splash.phase-entering,
.nyan-splash.phase-idle,
.nyan-splash.phase-exiting {
  background: #0c0c0c;
}

/* ═══════════════════════════════════════════════════════════════
   Logo gate — Tsian mark assembly
   ═══════════════════════════════════════════════════════════════ */
.gate-screen {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 42%, rgba(243, 197, 109, 0.18), transparent 24%),
    radial-gradient(circle at 50% 58%, rgba(99, 102, 241, 0.14), transparent 30%),
    linear-gradient(135deg, rgba(246, 236, 215, 0.06) 0 1px, transparent 1px 24px),
    var(--color-void);
}

.gate-grid {
  position: absolute;
  inset: 12%;
  border: 1px solid rgba(243, 197, 109, 0.16);
  background:
    linear-gradient(rgba(243, 197, 109, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(243, 197, 109, 0.08) 1px, transparent 1px);
  background-size: 44px 44px;
  opacity: 0.38;
  transform: perspective(800px) rotateX(58deg) translateY(22%);
  transform-origin: center bottom;
  animation: gate-grid-breathe 3.2s ease-in-out infinite;
}

.gate-core {
  position: relative;
  z-index: 2;
  display: grid;
  justify-items: center;
  gap: 1.1rem;
  width: min(640px, 86vw);
  text-align: center;
}

.gate-logo-stack {
  position: relative;
  width: clamp(138px, 18vw, 220px);
  aspect-ratio: 1;
  filter: drop-shadow(0 0 18px rgba(243, 197, 109, 0.22));
}

.gate-logo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.gate-logo-main {
  animation: logo-assemble 1.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.gate-logo-ghost {
  opacity: 0.42;
  mix-blend-mode: screen;
  animation: logo-scan-split 1.8s steps(2, end) infinite;
}

.gate-logo-ghost-a {
  clip-path: inset(0 0 52% 0);
  transform: translate(-7px, -3px);
  filter: hue-rotate(22deg) saturate(1.35);
}

.gate-logo-ghost-b {
  clip-path: inset(48% 0 0 0);
  transform: translate(8px, 3px);
  filter: hue-rotate(-24deg) saturate(1.35);
  animation-delay: 0.12s;
}

.gate-wordmark {
  display: inline-flex;
  gap: clamp(0.3rem, 1.1vw, 0.8rem);
  color: var(--color-neon);
  font-size: clamp(42px, 8vw, 92px);
  font-weight: 800;
  letter-spacing: 0.16em;
  line-height: 1;
  text-shadow:
    0 0 6px rgba(243, 197, 109, 0.44),
    0 0 22px rgba(243, 197, 109, 0.18);
}

.gate-wordmark span {
  display: inline-block;
  animation: letter-lock 1.2s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--letter-index) * 90ms + 180ms);
}

.gate-subtitle {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem 1.2rem;
  color: rgba(246, 236, 215, 0.68);
  font-size: clamp(11px, 1.5vw, 14px);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.gate-prompt {
  margin-top: 0.4rem;
  color: rgba(243, 197, 109, 0.52);
  font-size: 12px;
  letter-spacing: 0.22em;
  animation: prompt-pulse 1.7s ease-in-out infinite;
}

@keyframes logo-assemble {
  0% { opacity: 0; transform: scale(0.82) rotate(-24deg); filter: blur(8px); }
  42% { opacity: 1; transform: scale(1.08) rotate(5deg); filter: blur(0); }
  100% { opacity: 1; transform: scale(1) rotate(0deg); }
}

@keyframes logo-scan-split {
  0%, 88%, 100% { opacity: 0; transform: translate(0, 0); }
  90% { opacity: 0.55; transform: translate(-10px, 2px); }
  94% { opacity: 0.35; transform: translate(8px, -2px); }
}

@keyframes letter-lock {
  0% { opacity: 0; transform: translateY(18px) skewX(-18deg); filter: blur(7px); }
  65% { opacity: 1; transform: translateY(-2px) skewX(4deg); filter: blur(0); }
  100% { opacity: 1; transform: translateY(0) skewX(0); }
}

@keyframes gate-grid-breathe {
  0%, 100% { opacity: 0.22; }
  50% { opacity: 0.42; }
}

@keyframes prompt-pulse {
  0%, 100% { opacity: 0.34; }
  50% { opacity: 0.9; }
}

.gate-fade-leave-active { transition: opacity 0.18s linear; }
.gate-fade-leave-to { opacity: 0; }

/* ═══════════════════════════════════════════════════════════════
   Tsian boot loader
   ═══════════════════════════════════════════════════════════════ */
.boot-screen {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 72% 24%, rgba(243, 197, 109, 0.18), transparent 24%),
    radial-gradient(circle at 22% 78%, rgba(92, 119, 91, 0.32), transparent 28%),
    linear-gradient(135deg, rgba(246, 236, 215, 0.08) 0 1px, transparent 1px 22px),
    #203832;
}

.boot-panel {
  position: relative;
  z-index: 2;
  width: min(680px, 82vw);
  border: 1px solid rgba(243, 197, 109, 0.42);
  background: rgba(44, 42, 36, 0.72);
  padding: clamp(24px, 4vw, 42px);
  box-shadow:
    0 0 32px rgba(0, 0, 0, 0.3),
    inset 0 0 18px rgba(243, 197, 109, 0.08);
}

.boot-kicker {
  margin-bottom: 1rem;
  color: rgba(243, 197, 109, 0.72);
  font-size: 12px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

.boot-panel h1 {
  margin: 0 0 1.4rem;
  color: var(--color-text-main);
  font-size: clamp(28px, 4.2vw, 48px);
  font-weight: 600;
  letter-spacing: -0.05em;
}

.boot-lines {
  display: grid;
  gap: 0.45rem;
  margin: 0 0 1.8rem;
  padding: 0;
  list-style: none;
  color: rgba(246, 236, 215, 0.62);
  font-size: clamp(12px, 1.55vw, 15px);
}

.boot-lines li::before {
  content: "> ";
  color: var(--color-neon);
}

.boot-bar {
  height: 20px;
  padding: 3px;
  border: 1px solid rgba(243, 197, 109, 0.58);
  background: rgba(0, 0, 0, 0.26);
}

.boot-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-neon-deep), var(--color-neon), #fff2c8);
  box-shadow: 0 0 14px rgba(243, 197, 109, 0.36);
  transition: width 0.12s linear;
}

.boot-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.75rem;
  color: rgba(246, 236, 215, 0.72);
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.boot-fade-enter-active,
.boot-fade-leave-active { transition: opacity 0.16s linear; }
.boot-fade-enter-from,
.boot-fade-leave-to { opacity: 0; }

/* ═══════════════════════════════════════════════════════════════
   BSOD — visually faithful, textually fake
   ═══════════════════════════════════════════════════════════════ */
.bsod-screen {
  position: absolute;
  inset: 0;
  z-index: 7;
  padding: 5.2vh 10vw;
  background: #2067b2;
  color: #ffffff;
  font-family: "Segoe UI", "Open Sans", sans-serif;
  font-weight: 300;
}

.bsod-face {
  margin-left: -0.06em;
  font-size: clamp(108px, 12vw, 168px);
  line-height: 1.28;
  font-weight: 300;
}

.bsod-message {
  max-width: 890px;
  margin: 0;
  font-size: clamp(24px, 2.05vw, 34px);
  line-height: 1.52;
}

.bsod-bottom {
  max-width: 890px;
  margin: 44px 0 0;
  font-size: clamp(13px, 1.05vw, 17px);
  line-height: 1.55;
}

.bsod-cut-enter-active { transition: opacity 0.04s linear; }
.bsod-cut-enter-from { opacity: 0; }

/* ═══════════════════════════════════════════════════════════════
   Stars — full screen, 6-frame cross-burst
   ═══════════════════════════════════════════════════════════════ */
.stars-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
}

.star {
  position: absolute;
  font-size: 5px;
}

.star .wrapper {
  position: absolute;
  height: 10px;
  width: 10px;
}

.star .dot {
  background: #ffffff;
  height: 1em;
  width: 1em;
  position: absolute;
  display: none;
  top: 50%;
  left: 50%;
  margin: 0;
  padding: 0;
}

.star.frame-1 .dot-1 { margin-top: 0em; margin-left: 0em; display: block; }

.star.frame-2 .dot-2, .star.frame-3 .dot-2 { margin-top: 1em;  margin-left: 0em;  display: block; }
.star.frame-2 .dot-3, .star.frame-3 .dot-3 { margin-top: -1em; margin-left: 0em;  display: block; }
.star.frame-2 .dot-4, .star.frame-3 .dot-4 { margin-top: 0em;  margin-left: 1em;  display: block; }
.star.frame-2 .dot-5, .star.frame-3 .dot-5 { margin-top: 0em;  margin-left: -1em; display: block; }

.star.frame-3 .dot-6, .star.frame-4 .dot-6 { margin-top: 2em;  margin-left: 0em;  display: block; }
.star.frame-3 .dot-7, .star.frame-4 .dot-7 { margin-top: -2em; margin-left: 0em;  display: block; }
.star.frame-3 .dot-8, .star.frame-4 .dot-8 { margin-top: 0em;  margin-left: 2em;  display: block; }
.star.frame-3 .dot-9, .star.frame-4 .dot-9 { margin-top: 0em;  margin-left: -2em; display: block; }

.star.frame-4 .dot-1, .star.frame-5 .dot-1, .star.frame-6 .dot-1 { margin-top: 3em;  margin-left: 0em;  display: block; }
.star.frame-4 .dot-2, .star.frame-5 .dot-2, .star.frame-6 .dot-2 { margin-top: -3em; margin-left: 0em; display: block; }
.star.frame-4 .dot-3, .star.frame-5 .dot-3, .star.frame-6 .dot-3 { margin-top: 0em;  margin-left: 3em; display: block; }
.star.frame-4 .dot-4, .star.frame-5 .dot-4, .star.frame-6 .dot-4 { margin-top: 0em;  margin-left: -3em; display: block; }

.star.frame-5 .dot-5 { margin-top: 2em;  margin-left: 2em;  display: block; }
.star.frame-5 .dot-6 { margin-top: 2em;  margin-left: -2em; display: block; }
.star.frame-5 .dot-7 { margin-top: -2em; margin-left: 2em;  display: block; }
.star.frame-5 .dot-8 { margin-top: -2em; margin-left: -2em; display: block; }

.star.frame-6 .dot { opacity: 0.3; }

/* ═══════════════════════════════════════════════════════════════
   Rainbow — runs from screen left into the cat body
   ═══════════════════════════════════════════════════════════════ */
.rainbow-stage {
  position: absolute;
  left: 0;
  top: calc(50% + 2px);
  transform: translateY(-50%);
  height: 96px;
  overflow: hidden;
  opacity: 0.95;
  z-index: 2;
}

.rs-entering {
  width: calc(50% - var(--rainbow-anchor));
  animation: rs-enter var(--entering-duration) cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes rs-enter {
  0%   { transform: translate(-110vw, -50%); }
  100% { transform: translate(0, -50%); }
}

.rs-idle {
  width: calc(50% - var(--rainbow-anchor));
}

.rs-exiting {
  animation: rs-grow-exit var(--exiting-duration) cubic-bezier(0.55, 0, 1, 0.45) forwards;
}

@keyframes rs-grow-exit {
  0%   { width: calc(50% - var(--rainbow-anchor)); }
  100% { width: calc(50% + 110vw - var(--rainbow-anchor)); }
}

.rainbows {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  display: flex;
  align-items: flex-start;
  animation: rainbow-scroll 6s linear infinite;
  width: max-content;
}

@keyframes rainbow-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.rainbow-group {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
}

.rainbow {
  flex-shrink: 0;
}

.wave {
  height: 16px;
  width: 50px;
}

.rainbow.frame-1 { margin-top: 4px; }
.rainbow.frame-2 { margin-top: 0; }

.wave-1 { background: #ff0000; }
.wave-2 { background: #ff9900; }
.wave-3 { background: #ffff00; }
.wave-4 { background: #33ff00; }
.wave-5 { background: #0099ff; }
.wave-6 { background: #6633ff; }

/* ═══════════════════════════════════════════════════════════════
   Cat
   ═══════════════════════════════════════════════════════════════ */
.cat-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 3;
  pointer-events: none;
}

.nyan-cat {
  width: var(--cat-width);
  height: auto;
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  will-change: transform;
}

.cat-entering .nyan-cat {
  animation: cat-enter var(--entering-duration) cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes cat-enter {
  0%   { transform: translateX(-110vw); }
  100% { transform: translateX(0); }
}

.cat-idle .nyan-cat {
  animation: cat-bounce 1.7s ease-in-out infinite;
}

@keyframes cat-bounce {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(20px); }
}

.cat-exiting .nyan-cat {
  animation: cat-exit var(--exiting-duration) cubic-bezier(0.55, 0, 1, 0.45) forwards;
}

@keyframes cat-exit {
  0%   { transform: translateX(0); }
  100% { transform: translateX(110vw); }
}

.click-hint {
  position: absolute;
  bottom: 12%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  color: rgba(255, 255, 255, 0.72);
  font-size: 15px;
  letter-spacing: 2px;
  pointer-events: none;
  animation: hint-pulse 2s ease-in-out infinite;
}

@keyframes hint-pulse {
  0%, 100% { opacity: 0.3; }
  50%      { opacity: 1; }
}

.hint-fade-enter-active,
.hint-fade-leave-active { transition: opacity 0.5s; }
.hint-fade-enter-from,
.hint-fade-leave-to { opacity: 0; }

@media (max-width: 768px) {
  .gate-core { width: min(460px, 84vw); }
  .gate-wordmark { letter-spacing: 0.1em; }
  .gate-subtitle { flex-direction: column; gap: 0.35rem; }
  .boot-panel { width: min(520px, 86vw); }
  .boot-meta { flex-direction: column; gap: 0.35rem; }
  .bsod-screen { padding: 5vh 9vw; }
  .bsod-face { font-size: 96px; }
  .bsod-message { font-size: 22px; }
  .nyan-cat { width: 220px; }
  .wave { width: 44px; height: 15px; }
  .rainbow-stage { height: 90px; }
  .rainbow.frame-1 { margin-top: 4px; }
  .click-hint { font-size: 13px; }
}
</style>
