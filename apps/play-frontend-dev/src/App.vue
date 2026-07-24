<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import AtmosphereLayer from "./components/AtmosphereLayer.vue"
import CornerBrackets from "./components/CornerBrackets.vue"
import TsianLogo from "./components/TsianLogo.vue"
import BurningReveal from "./components/BurningReveal.vue"
import AppHeader from "./components/AppHeader.vue"
import AppNav from "./components/AppNav.vue"
import StatusBar from "./components/StatusBar.vue"
import StoryView from "./components/story/StoryView.vue"
import SetupWizard from "./components/setup/SetupWizard.vue"
import CharacterView from "./components/character/CharacterView.vue"
import TimelineView from "./components/timeline/TimelineView.vue"
import { useTsian } from "./composables/useTsian"
import { useStatusBarCollapsed } from "./composables/useStatusBarCollapsed"
import { SETUP_SUMMARY_PATH, isSetupSummary, safeJsonParse } from "./lib/source"

// App.vue 根组件。
// 开屏状态机（design §5 / prd D5-D6）：
// - idle：纸张幕布 + 中央活 Logo（转动），等待点击
// - burning：点击→并行（logo 动效 + BurningReveal 挂载即燃烧）→canvas shown 移除 idle 层→幕布烧穿透明露出向导
// - revealed：向导（wizard 模式）或主游玩态（play 模式）
//
// Step 6：revealed 后默认进向导（prd D5 "烧穿露出向导"）；向导 @enterPlay 切到主游玩态。
// useTsian 提供 bridge 响应式状态（ready/sessionId/turnCount/...）。
// nav 折叠偏好持久化（localStorage）。
const phase = ref<"idle" | "burning" | "revealed">("idle")
const curtainReplaced = ref(false)
const enterPlayPending = ref(false)
const mode = ref<"wizard" | "play">("wizard")

// nav 折叠状态（localStorage 持久化）
const NAV_COLLAPSED_KEY = "tsian.navCollapsed"
const navCollapsed = ref(localStorage.getItem(NAV_COLLAPSED_KEY) === "true")
// navCurrent 扩展为 story / character / settings（design §4.2 / §2.3）。
// - story：剧情流（StoryView，v-show 保留滚动 + stream 状态）。
// - character：角色卡全屏视图（CharacterView，v-if 卸载/重挂）。
// - settings：设置视图占位。
const navCurrent = ref<"story" | "character" | "timeline" | "settings">("story")
const statusDrawerOpen = ref(false)
const statusDrawerReturnFocus = ref<HTMLElement | null>(null)
const appHeader = ref<InstanceType<typeof AppHeader> | null>(null)
const desktopMedia = window.matchMedia("(min-width: 721px)")

function closeMobileStatusDrawer(event: MediaQueryListEvent): void {
  if (!event.matches) return
  statusDrawerReturnFocus.value = appHeader.value?.desktopStatusButton ?? null
  statusDrawerOpen.value = false
}

function openMobileStatusDrawer(): void {
  statusDrawerReturnFocus.value = appHeader.value?.mobileStatusButton ?? null
  statusDrawerOpen.value = true
}

watch(navCollapsed, (v) => {
  localStorage.setItem(NAV_COLLAPSED_KEY, String(v))
})

// 左侧状态栏折叠偏好（localStorage 持久化，模块级单例；design §4.4）。
// 不写入 workspace——纯前端 UI 偏好，同 navCollapsed 模式。
const { statusCollapsed, toggle: toggleStatusCollapsed } = useStatusBarCollapsed()

// bridge 状态（useTsian 单例共享）
const { ready, turnCount, tsian, loadOpeningNarrative } = useTsian()

async function hasEnteredPlayCheckpoint(): Promise<boolean> {
  const checkpoints = await tsian.checkpoints.list()
  return checkpoints.some((cp) => (
    cp.turn === 0
    && (
      cp.tags?.includes("opening-complete")
      || cp.metadata?.enteredPlay === true
      || cp.label === "开局设定"
    )
  ))
}

async function hasFormalTurns(): Promise<boolean> {
  const history = await tsian.history.get()
  return history.entries.some((entry) => entry.turn > 0)
}

async function shouldRestorePlayMode(): Promise<boolean> {
  const file = await tsian.workspace.read(SETUP_SUMMARY_PATH, "save-runtime")
  const summary = file?.content ? safeJsonParse(file.content) : null
  if (!isSetupSummary(summary) || summary.status !== "complete") return false
  if (summary.enteredPlay === true) return true
  return await hasEnteredPlayCheckpoint() || await hasFormalTurns()
}

async function restoreSavedMode(): Promise<void> {
  try {
    await tsian.waitForReady()
    if (await shouldRestorePlayMode()) {
      mode.value = "play"
      await loadOpeningNarrative()
    }
  } catch {
    // 没有激活存档或 workspace 未就绪时保持默认向导入口。
  }
}

async function markEnteredPlay(): Promise<void> {
  const file = await tsian.workspace.read(SETUP_SUMMARY_PATH, "save-runtime")
  const summary = file?.content ? safeJsonParse(file.content) : null
  if (!isSetupSummary(summary) || summary.status !== "complete") {
    throw new Error("setup-summary.json 尚未完成，无法标记进入故事。")
  }
  if (summary.enteredPlay === true) return
  await tsian.workspace.write(
    SETUP_SUMMARY_PATH,
    `${JSON.stringify({ ...summary, enteredPlay: true }, null, 2)}\n`,
    "save-runtime",
  )
}

onMounted(() => {
  desktopMedia.addEventListener("change", closeMobileStatusDrawer)
  void restoreSavedMode()
})

onBeforeUnmount(() => {
  desktopMedia.removeEventListener("change", closeMobileStatusDrawer)
})

function onLogoClick() {
  phase.value = "burning"
}

function onCurtainShown() {
  curtainReplaced.value = true
  // enterPlay 过渡：等 BurningReveal canvas 已经可见、盖住当前 Step 5 后，再切到底层 play，避免露帧/黑闪。
  if (enterPlayPending.value) {
    mode.value = "play"
  }
}

function onRevealed() {
  phase.value = "revealed"
  enterPlayPending.value = false
}

async function markEnteredPlayCheckpoint(): Promise<void> {
  const checkpoints = await tsian.checkpoints.list({ includeHidden: true })
  const initial = checkpoints
    .filter((cp) => cp.turn === 0)
    .sort((left, right) => left.createdAt - right.createdAt)[0]

  const options = {
    label: "开局设定",
    retention: "pinned" as const,
    source: "card" as const,
    tags: ["opening-complete"],
    metadata: { enteredPlay: true },
    reason: "manual",
  }

  if (initial) {
    await tsian.checkpoints.overwrite(initial.id, options)
    return
  }

  await tsian.checkpoints.create(options)
}

/** Step 5 "进入故事"：先加载开局叙事，标记开局向导已进入故事，再显式覆盖开局初始检查点，
 *  最后在 Step 5 画面上启动 scroll 烧蚀。等 BurningReveal @shown 后才切 mode=play，避免 canvas delay 期间露出下方 StoryView。
 *  检查点更新失败不阻塞进入游戏（console.error + 继续）。 */
async function onEnterPlay() {
  await loadOpeningNarrative()
  await markEnteredPlay()
  try {
    await markEnteredPlayCheckpoint()
  } catch (err) {
    console.error("[App] 更新开局设定检查点失败:", err)
  }
  enterPlayPending.value = true
  phase.value = "burning"
}

function onToggleNav() {
  navCollapsed.value = !navCollapsed.value
}

function onToggleStatus() {
  toggleStatusCollapsed()
}

/** 点击状态栏角色头像 → 切到角色卡全屏视图（design §4.2 / D3）。 */
function onOpenCharacter() {
  statusDrawerOpen.value = false
  navCurrent.value = "character"
}

function onNavigate(item: "story" | "character" | "timeline" | "settings") {
  statusDrawerOpen.value = false
  navCurrent.value = item
}
</script>

<template>
  <div class="app-root">
    <AtmosphereLayer :density="40" :parallax="10" ghost-text="STORY" />

    <!-- idle：纸张幕布 + 活 Logo。保留到 canvas shown（curtainReplaced），避免闪现占位 -->
    <div
      v-if="phase === 'idle' || (phase === 'burning' && !curtainReplaced)"
      class="paper-curtain"
    >
      <TsianLogo :animated="true" :size="320" @click="onLogoClick" />
    </div>

    <!-- burning + revealed play 模式：主游玩态壳。z:0 最底，burning 时被幕布遮，烧穿透明露出 -->
    <main
      v-if="(phase === 'burning' && mode === 'play') || (phase === 'revealed' && mode === 'play')"
      class="stage-play"
    >
      <AppHeader
        v-if="phase === 'revealed'"
        ref="appHeader"
        :ready="ready"
        :turn-count="Math.max(0, turnCount - 1)"
        :nav-collapsed="navCollapsed"
        :status-bar-collapsed="statusCollapsed"
        @toggle-nav="onToggleNav"
        @toggle-status-bar="onToggleStatus"
        @open-status="openMobileStatusDrawer"
      />
      <AppNav
        v-if="phase === 'revealed'"
        :current="navCurrent"
        :collapsed="navCollapsed"
        @navigate="onNavigate"
      />
      <StatusBar
        v-if="phase === 'revealed'"
        :collapsed="statusCollapsed"
        :mobile-open="statusDrawerOpen"
        :mobile-return-focus="statusDrawerReturnFocus"
        @update:mobile-open="statusDrawerOpen = $event"
        @toggle="onToggleStatus"
        @open-character="onOpenCharacter"
      />

      <!-- 视图路由：story / character / settings（Step 5 接入 CheckpointView）。
           StoryView 保持 v-show：切换视图不销毁 StoryView，保留滚动位置 + stream 状态。 -->
      <div class="view-stack">
        <Transition name="view-soft">
          <StoryView v-show="navCurrent === 'story'" class="view-layer" />
        </Transition>
        <!-- 角色卡视图：v-if 卸载/重挂——切换走时释放 useEntity/useScene 读取，
             回来时重新读 runtime/scene。主视图按侧栏展开状态平滑让位。 -->
        <Transition name="view-soft">
          <CharacterView v-if="navCurrent === 'character'" class="view-layer" />
        </Transition>
        <!-- 时间线视图：v-if 卸载/重挂——切走时释放 frontier 读取，回来时重新读 frontier.json。 -->
        <Transition name="view-soft">
          <TimelineView v-if="navCurrent === 'timeline'" class="view-layer timeline-view" />
        </Transition>
        <Transition name="view-soft">
          <div v-if="navCurrent === 'settings'" class="view-stage view-layer settings-placeholder">
            <CornerBrackets :size="15" :inset="25" />
            <p class="placeholder-kicker">设置</p>
            <p class="placeholder-text">此处暂未开放可调项目</p>
            <p class="placeholder-sub">当前版本没有需要玩家手动配置的内容；后续加入显示、叙事或辅助选项时会放在这里。</p>
          </div>
        </Transition>
      </div>
    </main>

    <!-- revealed wizard 模式：全屏向导（z:0，burning 时在幕布下） -->
    <SetupWizard
      v-if="(phase === 'burning' || phase === 'revealed') && mode === 'wizard'"
      @enter-play="onEnterPlay"
    />

    <!-- burning：WebGL 燃烧幕布。开屏用 paper（红橙火焰），enterPlay 翻转用 scroll（琥珀金火焰） -->
    <BurningReveal
      v-if="phase === 'burning'"
      :variant="enterPlayPending ? 'scroll' : 'paper'"
      :duration="5000"
      :delay="400"
      @shown="onCurtainShown"
      @revealed="onRevealed"
    />
  </div>
</template>

<style scoped>
.app-root {
  position: relative;
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  --play-header-height: 52px;
  --play-bottom-nav-height: 0px;
  --play-left-rail: 48px;
  --play-left-panel: 312px;
  --play-right-rail: 56px;
  --play-right-panel: 180px;
  --play-sidebar-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

/* 纸张幕布：暖白米黄古卷底 + 纸纹斑点，遮住氛围层，承载 idle logo */
.paper-curtain {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8d9b8;
  background-image:
    radial-gradient(rgba(120, 90, 50, 0.04) 15%, transparent 16%),
    radial-gradient(rgba(120, 90, 50, 0.03) 12%, transparent 13%);
  background-size: 80px 80px, 130px 130px;
  background-position: 0 0, 40px 60px;
}

/* 主游玩态层：z:0 最底，burning 时被幕布遮，烧穿透明露出 */
.stage-play {
  position: relative;
  z-index: 0;
  height: 100%;
  width: 100%;
}

.view-stack {
  position: relative;
  height: 100%;
  width: 100%;
}
.view-layer {
  position: absolute;
  inset: 0;
}
.view-soft-enter-active {
  transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.view-soft-leave-active {
  transition: opacity 140ms ease, transform 140ms ease;
}
.view-soft-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.view-soft-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 视图舞台：顶部留 header，左右按侧栏展开状态让位。 */
.view-stage {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  /* 顶部 header + 展开侧栏空间；折叠态由全局 :has() 规则切换到 rail。 */
  padding-top: var(--play-header-height);
  padding-right: var(--play-right-panel);
  padding-left: var(--play-left-panel);
  transition: padding-right 0.3s var(--play-sidebar-ease), padding-left 0.3s var(--play-sidebar-ease);
}
.placeholder-kicker {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ember);
  letter-spacing: 0.28em;
}

.placeholder-text {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--ember-bright);
  letter-spacing: 0.08em;
  text-shadow: 1px 1px 0 var(--ember), 2px 2px 0 #8a6428,
    3px 3px 0 #5e4319, 5px 5px 25px rgba(0, 0, 0, 0.95);
}

.placeholder-sub {
  max-width: 520px;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.9;
  color: var(--prose-dim);
  letter-spacing: 0.08em;
}

@media (max-width: 720px) {
  .app-root {
    --play-header-height: calc(46px + env(safe-area-inset-top));
    --play-bottom-nav-height: calc(62px + env(safe-area-inset-bottom));
  }

  .view-stage {
    height: calc(100% - var(--play-header-height) - var(--play-bottom-nav-height));
    margin-top: var(--play-header-height);
    padding: 16px 14px 22px;
    box-sizing: border-box;
    overflow-y: auto;
    transition: none;
  }

  .placeholder-text {
    font-size: clamp(1.8rem, 10vw, 2.5rem);
  }

  .placeholder-sub {
    max-width: 90vw;
    padding: 0 8px;
  }
}
</style>

<!-- 全局（非 scoped）样式：视图在侧栏展开/折叠时让位，padding 动画与侧栏宽度动画同步。 -->
<style>
.app-root:has(.status-bar.collapsed) .story-view,
.app-root:has(.status-bar.collapsed) .character-view,
.app-root:has(.status-bar.collapsed) .timeline-view,
.app-root:has(.status-bar.collapsed) .view-stage {
  padding-left: var(--play-left-rail);
}
.app-root:has(.app-nav.collapsed) .story-view,
.app-root:has(.app-nav.collapsed) .character-view,
.app-root:has(.app-nav.collapsed) .timeline-view,
.app-root:has(.app-nav.collapsed) .view-stage {
  padding-right: var(--play-right-rail);
}

@media (max-width: 720px) {
  .app-root .story-view,
  .app-root .character-view,
  .app-root .timeline-view,
  .app-root .view-stage,
  .app-root:has(.status-bar.collapsed) .story-view,
  .app-root:has(.status-bar.collapsed) .character-view,
  .app-root:has(.status-bar.collapsed) .timeline-view,
  .app-root:has(.status-bar.collapsed) .view-stage,
  .app-root:has(.app-nav.collapsed) .story-view,
  .app-root:has(.app-nav.collapsed) .character-view,
  .app-root:has(.app-nav.collapsed) .timeline-view,
  .app-root:has(.app-nav.collapsed) .view-stage {
    padding-left: 0;
    padding-right: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .view-soft-enter-active,
  .view-soft-leave-active {
    transition: none;
  }
}
</style>
