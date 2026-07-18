<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import UserMessage from "./UserMessage.vue"
import NarrativeMessage from "./NarrativeMessage.vue"
import type { ProcessNodeData } from "./ProcessNode.vue"
import RoundProcess from "./RoundProcess.vue"
import TurnMeta from "./TurnMeta.vue"
import StoryOptions from "./StoryOptions.vue"
import SyncToast from "./SyncToast.vue"
import FrontierToast from "./FrontierToast.vue"
import Composer from "./Composer.vue"
import CheckpointMark from "../checkpoints/CheckpointMark.vue"
import RestoreDialog from "../checkpoints/RestoreDialog.vue"
import BurningReveal from "../BurningReveal.vue"
import { useTsian, type StreamItem } from "../../composables/useTsian"
import { useTurnState } from "../../composables/useTurnState"
import { useRuntime } from "../../composables/useRuntime"
import { useFrontierAdvance } from "../../composables/useFrontierAdvance"

/**
 * StoryView — 对话流容器（核心游玩面）。
 *
 * prd 屏3：52em 列 + 垂直滚动。
 * 数据模型（镜像 legacy main.ts $story DOM 容器）：
 * - stream：单一有序流，所有元素（user/interim/thought/tool/assistant）按真实发生顺序交织，
 *   跨轮保留不清空。loadHistory 重建完整内存历史，send/订阅 push 实时。
 * - StoryView 只把最近 turn 窗口聚合成 DOM；向上翻阅时渐进展开更早 turn，
 *   不裁剪 useTsian 保存的完整 stream。
 * - streamingText：流式期间的实时累积文本，单独渲染（onRoundEnd/onTurnEnd 落定后推入 stream）。
 * 渲染：遍历 visibleStream 按 kind 分发组件，streaming 期间末尾追加流式 NarrativeMessage。
 */
const {
  ready,
  turnPhase,
  turnCount,
  stream,
  streamingText,
  turnOptions,
  checkpoints,
  syncPhase,
  lastSendError,
  send,
  stop,
  restore,
  loadHistory,
  loadCheckpoints,
  retrySyncAfterTurn,
  resetSyncPhase,
} = useTsian()

// useFrontierAdvance 模块级单例：frontier 推进触发状态（非阻塞，不锁 Composer）。
const {
  phase: frontierPhase,
  retryFrontierAdvance,
  resetFrontierAdvancePhase,
} = useFrontierAdvance()

// useRuntime 模块级单例：在 setup 层调用以正确注册刷新触发（watch/onTurnEnd 等
// 需在组件 setup 期间注册）。refreshRuntime 供 checkpoint restore 后显式刷新（D4）。
const { refresh: refreshRuntime } = useRuntime()

const INITIAL_VISIBLE_TURNS = 40
const LOAD_OLDER_TURNS = 20
const TOP_LOAD_THRESHOLD = 120

const storyRef = ref<HTMLElement | null>(null)
const composerRef = ref<InstanceType<typeof Composer> | null>(null)
const streaming = computed(() => turnPhase.value === "streaming")

const {
  elapsedMs,
  userPinnedToBottom,
  handleScroll: handleTurnScroll,
  beginTurnTimer,
  stopTurnTimer,
  resetTurnTimer,
  maybeScrollDown,
} = useTurnState(
  storyRef,
  streaming,
)

// 轮次窗口：完整 stream 留在 useTsian 内存中，StoryView 只聚合当前可见 turn。
// turn 编号按 user 消息递增；过程节点/assistant 归属最近一次 user 所在 turn。
const visibleStartTurn = ref(1)
const loadingOlderTurns = ref(false)
// 点击“最近”会先收窄窗口再平滑滚到底；滚动动画起步阶段会经过顶部阈值，
// 需临时压住顶部自动加载，避免刚收窄又把旧历史展开回来。
const suppressTopAutoLoad = ref(false)

const renderedTurnCount = computed(() => Math.max(0, turnCount.value - (streaming.value ? 0 : 1)))
const latestVisibleStartTurn = computed(() => deriveLatestVisibleStartTurn(renderedTurnCount.value))
const earliestTurnVisible = computed(() => visibleStartTurn.value <= 1)
const hasOlderTurns = computed(() => visibleStartTurn.value > 1)
const turnOptionsForDisplay = computed<string[]>(() => [...turnOptions.value])

function deriveLatestVisibleStartTurn(totalTurns: number): number {
  return Math.max(1, Math.max(0, totalTurns) - INITIAL_VISIBLE_TURNS + 1)
}

const visibleStream = computed(() => {
  const src = stream.value
  const startTurn = visibleStartTurn.value
  if (startTurn <= 1) return src

  let currentTurn = 0
  let startIndex = src.length
  for (let i = 0; i < src.length; i += 1) {
    const item = src[i]!
    if (item.kind === "user") currentTurn += 1
    if (currentTurn >= startTurn && item.kind !== "assistant") {
      startIndex = i
      break
    }
  }
  return src.slice(startIndex)
})

function resetWindowToLatest() {
  visibleStartTurn.value = latestVisibleStartTurn.value
}

async function loadOlderTurns() {
  if (loadingOlderTurns.value || !hasOlderTurns.value) return
  const el = storyRef.value
  if (!el) return

  loadingOlderTurns.value = true
  const previousScrollHeight = el.scrollHeight
  visibleStartTurn.value = Math.max(1, visibleStartTurn.value - LOAD_OLDER_TURNS)
  await nextTick()
  const heightDelta = el.scrollHeight - previousScrollHeight
  el.scrollTop += heightDelta
  loadingOlderTurns.value = false
}

function onStoryScroll() {
  handleTurnScroll()
  const el = storyRef.value
  if (!el || suppressTopAutoLoad.value || el.scrollTop > TOP_LOAD_THRESHOLD) return
  void loadOlderTurns()
}

async function scrollToLatest() {
  suppressTopAutoLoad.value = true
  resetWindowToLatest()
  await nextTick()
  const el = storyRef.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  window.setTimeout(() => {
    suppressTopAutoLoad.value = false
    handleTurnScroll()
  }, 450)
}

// 流式文本/流长度变化时自动滚动。flush:'post' 确保 DOM 已更新后再读 scrollHeight，
// 否则滚动比内容滞后一帧、末行被 fixed Composer 遮住
watch(streamingText, () => maybeScrollDown(), { flush: "post" })
watch(() => stream.value.length, async () => {
  if (userPinnedToBottom.value) {
    resetWindowToLatest()
    await nextTick()
  }
  maybeScrollDown()
}, { flush: "post" })
// 选项在 onTurnEnd 中晚于 assistant 消息设置，需等其渲染后再滚到底，
// 否则选项被推到视口下方、被 fixed Composer 遮住
watch(turnOptions, () => maybeScrollDown(), { flush: "post" })
// 初次加载/正常底部游玩时，把可见窗口保持在最近 turn；用户上翻时不主动裁剪。
watch(latestVisibleStartTurn, (latest) => {
  if (userPinnedToBottom.value || visibleStartTurn.value > latest) {
    visibleStartTurn.value = latest
  }
}, { immediate: true })

// 轮次状态变化：streaming 开始计时，standby 停止 + 刷新检查点
// （新 turn 结束后 host 会自动创建 after-turn 检查点，需重新加载才能实时显示印记）
watch(turnPhase, (phase) => {
  if (phase === "streaming") beginTurnTimer()
  else if (phase === "standby") {
    stopTurnTimer()
    void loadCheckpoints()
  }
})

// ready 后加载历史 + 检查点（immediate：StoryView 挂载时 ready 可能已 true）。
// useTsian 内部有 historyLoaded 模块级标志，loadHistory 只首次执行，避免覆盖实时 stream。
watch(ready, (r) => {
  if (r) {
    void loadHistory()
    void loadCheckpoints()
  }
}, { immediate: true })

// ── 检查点恢复对话框 + 燃烧过渡 ──
const restoreTarget = ref<{ id: string; turn: number; turnsAfter: number } | null>(null)
const restoreOpen = ref(false)
const restoring = ref(false)  // 燃烧过渡进行中（挂载 BurningReveal scroll 变体）
const curtainReplaced = ref(false)  // canvas 已可见，暗色遮罩已移除

function onCheckpointClick(cp: { id: string; turn: number }) {
  // turnCount 是"下一个 turn 编号"（maxTurn + 1），已落盘的最后一轮是 turnCount - 1。
  // 此检查点之后会被抹除的轮次数 = 已落盘最后一轮 - 此检查点 turn
  const turnsAfter = Math.max(0, turnCount.value - 1 - cp.turn)
  restoreTarget.value = { id: cp.id, turn: cp.turn, turnsAfter }
  restoreOpen.value = true
}

async function onRestoreConfirm() {
  if (!restoreTarget.value) return
  const id = restoreTarget.value.id
  // 挂幕布 + 遮罩盖住屏幕，再关 Dialog
  curtainReplaced.value = false
  restoring.value = true
  restoreOpen.value = false
  restoreTarget.value = null
  // 后台执行 restore（host 裁剪 + reloadHistory + loadCheckpoints 重建）
  await restore(id)
  // checkpoint restore 无事件源（D4），显式调 refreshRuntime() 刷新 runtime 数据。
  // 仅这一行 + import + setup 层 destructure，不改 restore 流程逻辑。
  void refreshRuntime()
  resetWindowToLatest()
  await nextTick()
  if (storyRef.value) storyRef.value.scrollTop = storyRef.value.scrollHeight
  handleTurnScroll()
  // 重置计时器：丢弃上一轮残留的 elapsedMs，避免重建后的 TurnMeta 显示被抹除轮的耗时
  resetTurnTimer()
  // 重置同步状态：丢弃 syncing/synced/sync-failed 残留，避免重建后 Toast 错挂
  resetSyncPhase()
  // 重置 frontier 推进状态：丢弃 advancing/succeeded/failed 残留，避免重建后 Toast 错挂
  resetFrontierAdvancePhase()
  // restore 完成，对话流已重建在幕布下方——等燃烧烧穿后移除幕布
}

/** BurningReveal canvas 可见后移除暗色遮罩（类比开屏 onCurtainShown 移除 paper-curtain）。
 *  遮罩只在 canvas 初始化期间盖住旧内容，canvas 可见后必须移除——
 *  否则烧穿区露出的是遮罩而非重建的对话流。 */
function onCurtainShown() {
  curtainReplaced.value = true
}

function onRestoreRevealed() {
  restoring.value = false
  curtainReplaced.value = false
}

// 工具节点合并：同 round 连续 tool 合并成 tool-group（避免堆叠）
// 过程聚合：连续的过程节点（interim/thought/tool/tool-group）整体收进一个 round-process
// 大折叠，降低过程噪音。user/assistant 原样透出，保持"玩家之举 → 推演 → 正文"的叙事流。
// 检查点标记：在对应 turn 的 assistant 消息后插入 CheckpointMark。
type MergedItem =
  | Extract<StreamItem, { kind: "user" }>
  | Extract<StreamItem, { kind: "assistant" }>
  | { kind: "round-process"; id: string; round: number; nodes: ProcessNodeData[] }
  | { kind: "checkpoint"; id: string; checkpointId: string; turn: number; createdAt: number }

// checkpoint turn → 数据映射，供 mergedStream 快速查找
const checkpointByTurn = computed(() => {
  const map = new Map<number, { id: string; turn: number; createdAt: number }>()
  for (const cp of checkpoints.value) {
    map.set(cp.turn, cp)
  }
  return map
})

const mergedStream = computed(() => {
  const result: MergedItem[] = []
  const src = visibleStream.value
  const cpMap = checkpointByTurn.value
  // initial 检查点（turn=0）只在最早 turn 可见时插入，避免最近窗口顶部误接开局。
  const cp0 = cpMap.get(0)
  if (cp0 && earliestTurnVisible.value) {
    result.push({ kind: "checkpoint", id: `cp-${cp0.turn}`, checkpointId: cp0.id, turn: cp0.turn, createdAt: cp0.createdAt })
  }
  let currentTurn = visibleStartTurn.value - 1  // 追踪当前 turn 编号（user 出现时 +1）
  let i = 0
  while (i < src.length) {
    const item = src[i]!
    if (item.kind === "user") {
      currentTurn += 1
      result.push(item)
      i += 1
      continue
    }
    if (item.kind === "assistant") {
      result.push(item)
      // 在该 turn 的 assistant 后插入检查点标记（如果有）
      const cp = cpMap.get(currentTurn)
      if (cp) {
        result.push({ kind: "checkpoint", id: `cp-${cp.turn}`, checkpointId: cp.id, turn: cp.turn, createdAt: cp.createdAt })
      }
      i += 1
      continue
    }
    // 收集连续过程节点（interim/thought/tool），内部合并同 round 连续 tool 成 tool-group
    const nodes: ProcessNodeData[] = []
    let round = item.round ?? 0
    while (i < src.length) {
      const cur = src[i]!
      if (cur.kind === "user" || cur.kind === "assistant") break
      if (cur.kind === "tool") {
        const group: Extract<StreamItem, { kind: "tool" }>[] = [cur]
        let j = i + 1
        while (j < src.length) {
          const next = src[j]
          if (!next || next.kind !== "tool" || next.round !== cur.round) break
          group.push(next)
          j += 1
        }
        if (group.length > 1) {
          nodes.push({ kind: "tool-group", id: `tg-${cur.round}-${cur.id}`, round: cur.round, agentId: cur.agentId, tools: group })
        } else {
          nodes.push(cur)
        }
        i = j
      } else {
        // interim / thought
        nodes.push(cur)
        i += 1
      }
    }
    result.push({ kind: "round-process", id: `rp-${round}-${result.length}`, round, nodes })
  }
  return result
})

// 上下文注入阻断态 → 中文文案（design §D7 / implement.md Step 5）。
// send 阻断时 useTsian.send 会置 lastSendError，此 banner 显示原因；
// 下次 send 前置检查通过时清空 lastSendError（在 useTsian.send 内做），
// 用户未再发送前保留显示。样式复用 SyncToast sync-failed 错误配色（血珀）。
const lastSendErrorText = computed<string | null>(() => {
  const err = lastSendError.value
  if (!err) return null
  switch (err.reason) {
    case "runtime-not-ready":
      return "运行时上下文未就绪"
    case "scene-load-failed":
      return err.detail ? `场景数据加载失败（${err.detail}）` : "场景数据加载失败"
    case "protagonist-load-failed":
      return err.detail ? `主角数据加载失败（${err.detail}）` : "主角数据加载失败"
    default:
      return "上下文未就绪"
  }
})

async function onSend(text: string) {
  await send(text)
}

function onStop() {
  void stop()
}

function onSelectOption(opt: string) {
  void onSend(opt)
}

// 当前轮 tokens（从最后一条 assistant 的 tokens）
const currentTokens = computed(() => {
  const last = [...stream.value].reverse().find((n) => n.kind === "assistant")
  return last && last.kind === "assistant" ? last.tokens : undefined
})

// 最后一条用户消息 id：仅它可编辑（停止后"重新编辑"入口）。
// 非流式时才允许编辑——流式中用户不该操作。
const lastUserMsgId = computed(() => {
  if (streaming.value) return null
  for (let i = stream.value.length - 1; i >= 0; i--) {
    const item = stream.value[i]!
    if (item.kind === "user") return item.id
  }
  return null
})

function onEdit(content: string) {
  composerRef.value?.setText(content)
}
</script>

<template>
  <section class="story-view">
    <!-- 滚动区：flex:1 占满剩余空间，内部 52em 居中正文流 -->
    <div class="story-scroll" ref="storyRef" @scroll="onStoryScroll">
      <div class="story-inner">
        <div
          v-if="hasOlderTurns"
          class="history-loader"
          :class="{ loading: loadingOlderTurns }"
          aria-live="polite"
        >
          <span class="history-line" aria-hidden="true" />
          <span class="history-glyph" aria-hidden="true" />
          <span class="history-text">翻阅更早记忆…</span>
          <span class="history-line" aria-hidden="true" />
        </div>

        <!-- 有序流：按真实发生顺序渲染当前 turn 窗口，完整历史仍保留在内存中 -->
        <template v-for="(item, i) in mergedStream" :key="item.id">
          <UserMessage
            v-if="item.kind === 'user'"
            :content="item.content"
            :editable="item.id === lastUserMsgId"
            @edit="onEdit"
          />
          <NarrativeMessage v-else-if="item.kind === 'assistant'" :content="item.content" />
          <CheckpointMark
            v-else-if="item.kind === 'checkpoint'"
            :turn="item.turn"
            @restore="onCheckpointClick({ id: item.checkpointId, turn: item.turn })"
          />
          <RoundProcess v-else :nodes="item.nodes" :round="item.round" />
        </template>

        <!-- 流式叙述（streaming 期间的实时文本，落定前单独渲染） -->
        <NarrativeMessage
          v-if="streaming && streamingText"
          :content="streamingText"
          streaming
        />

        <!-- 轮次计时 meta（streaming + standby 均显示；idle 时隐藏） -->
        <TurnMeta
          v-if="turnPhase === 'streaming' || turnPhase === 'standby'"
          :elapsed-ms="elapsedMs"
          :tokens="currentTokens"
          :turn="Math.max(0, turnCount - 1)"
        />

        <!-- 剧情选项 -->
        <StoryOptions
          v-if="turnOptionsForDisplay.length > 0"
          :options="turnOptionsForDisplay"
          :disabled="streaming"
          @select="onSelectOption"
        />

        <!-- 空状态 -->
        <div v-if="stream.length === 0 && !streaming" class="empty-state">
          <p class="empty-title">故事尚未开始</p>
          <p class="empty-hint">在下方写下你的行动…</p>
        </div>
      </div>
    </div>

    <button
      v-if="!userPinnedToBottom"
      class="jump-latest"
      type="button"
      aria-label="回到最近内容"
      @click="scrollToLatest"
    >
      <span class="jump-glyph" aria-hidden="true">⌄</span>
    </button>

    <!-- 回合后同步 Toast：正文落定后浮起，朴素克制 + 卡片扫光签名。
         syncPhase 由 useSyncAfterTurn 驱动；idle 时不渲染。 -->
    <SyncToast
      v-if="syncPhase !== 'idle'"
      :phase="syncPhase"
      @retry="retrySyncAfterTurn"
    />

    <!-- frontier 推进 Toast：素材边界拓展状态（非阻塞，不锁 Composer）。
         frontierPhase 由 useFrontierAdvance 驱动；idle 时不渲染。
         与 SyncToast 独立——可同时显示（维护成功后 frontier 触发）。 -->
    <FrontierToast
      v-if="frontierPhase !== 'idle'"
      :phase="frontierPhase"
      @retry="retryFrontierAdvance"
    />

    <!-- 上下文注入阻断 banner：出现在 Composer 上方（输入区上方），复用 sync-failed 血珀配色。
         useTsian.send 阻断时置 lastSendError；下次 send 触发时清空，用户未操作前保留。 -->
    <div
      v-if="lastSendErrorText"
      class="send-error-banner"
      role="status"
      aria-live="polite"
    >
      <span class="mark" aria-hidden="true" />
      <span class="label">上下文未就绪：{{ lastSendErrorText }}</span>
    </div>

    <!-- Composer：正常流布局，固定在滚动区下方（flex 列底部），与正文同宽 52em 居中 -->
    <Composer
      ref="composerRef"
      :ready="ready"
      :streaming="streaming"
      :syncing="syncPhase === 'syncing' || syncPhase === 'sync-failed'"
      @send="onSend"
      @stop="onStop"
    />

    <!-- 检查点恢复确认弹窗 -->
    <RestoreDialog
      :open="restoreOpen"
      :turn="restoreTarget?.turn ?? 0"
      :turns-after="restoreTarget?.turnsAfter ?? 0"
      @update:open="(v) => (restoreOpen = v)"
      @confirm="onRestoreConfirm"
    />

    <!-- 恢复过渡：暗色遮罩在 canvas 可见前盖住旧内容（类比开屏 paper-curtain），
         BurningReveal @shown 后移除遮罩，烧穿区直接露出重建的对话流 -->
    <div v-if="restoring && !curtainReplaced" class="restore-curtain" aria-hidden="true" />
    <BurningReveal
      v-if="restoring"
      variant="scroll"
      :duration="4000"
      :delay="100"
      @shown="onCurtainShown"
      @revealed="onRestoreRevealed"
    />
  </section>
</template>

<style scoped>
/* flex 列布局：滚动区占满剩余空间，Composer 在底部正常流。
   两者物理不重叠，从根源消除 fixed Composer 遮挡正文/选项的问题。
   margin-top 留出顶栏高度，height 填满剩余空间——避免 padding-top 导致
   flex 容器总高度溢出父容器、Composer 底部被截断。 */
.story-view {
  position: relative;
  display: flex;
  flex-direction: column;
  margin-top: 52px;     /* 顶栏高度 */
  height: calc(100% - 52px);  /* 精确填满顶栏以下空间 */
  padding-right: var(--play-right-panel);  /* 展开右侧 nav 空间；折叠态由 App.vue :has 切换到 rail */
  padding-left: var(--play-left-panel);    /* 展开左侧状态栏空间；折叠态由 App.vue :has 切换到 rail */
  overflow: hidden;     /* flex 容器本身不滚动，滚动交给 .story-scroll */
  box-sizing: border-box;
  transition: padding-left 0.3s var(--play-sidebar-ease), padding-right 0.3s var(--play-sidebar-ease);
}

/* 恢复过渡 CSS 遮罩：立即盖住屏幕（不依赖 WebGL 初始化），
   BurningReveal canvas（z-index 50）可见后覆盖它，烧穿后随 v-if 移除 */
.restore-curtain {
  position: fixed;
  inset: 0;
  z-index: 49;
  background: var(--void);
  pointer-events: none;
}

/* 滚动区：flex:1 占满 Composer 以上的全部空间；隐藏滚动条（仍可滚动） */
.story-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;  /* flex 子元素 overflow 生效的关键 */
  scrollbar-width: none;  /* Firefox */
  -ms-overflow-style: none;  /* IE/Edge */
}
.story-scroll::-webkit-scrollbar {
  display: none;  /* Chrome/Safari */
}

.story-inner {
  max-width: 52em;
  margin: 0 auto;
  padding: 40px 24px 24px;
}

.history-loader {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0 24px;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--prose-faint);
  letter-spacing: 0.08em;
  opacity: 0.88;
}
.history-loader.loading {
  color: var(--ember);
}
.history-line {
  height: 1px;
  flex: 1;
  background: linear-gradient(90deg, transparent, var(--ember), transparent);
  opacity: 0.12;
}
.history-glyph {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border: 1px solid var(--ember);
  transform: rotate(45deg);
  box-shadow: 0 0 5px rgba(181, 137, 61, 0.12);
  opacity: 0.55;
}
.history-loader.loading .history-glyph {
  background: var(--ember);
  animation: history-glyph-breathe 1.6s ease-in-out infinite;
}
.history-text {
  white-space: nowrap;
}
@keyframes history-glyph-breathe {
  0%, 100% { opacity: 0.45; box-shadow: 0 0 4px rgba(181, 137, 61, 0.14); }
  50% { opacity: 0.9; box-shadow: 0 0 10px var(--ember-glow), 0 0 3px var(--ember); }
}

.jump-latest {
  position: absolute;
  left: calc(50% + 21.5em);
  bottom: 92px;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(181, 137, 61, 0.34);
  border-radius: 999px;
  background:
    radial-gradient(circle at 22% 22%, rgba(232, 169, 72, 0.15), transparent 38%),
    linear-gradient(135deg, rgba(181, 137, 61, 0.13), rgba(155, 58, 46, 0.07) 48%, rgba(6, 6, 8, 0.42)),
    rgba(10, 5, 6, 0.78);
  color: var(--prose-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.08),
    inset 0 -10px 22px rgba(0, 0, 0, 0.18),
    0 12px 28px rgba(0, 0, 0, 0.24),
    0 0 18px rgba(43, 4, 4, 0.30);
  transition: color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease, background 0.22s ease;
  animation: jump-latest-enter 220ms ease-out both;
}
.jump-latest::before {
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(181, 137, 61, 0.10);
  border-radius: inherit;
  pointer-events: none;
}
.jump-latest::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(112deg, transparent 0%, rgba(232, 169, 72, 0.16) 38%, transparent 62%);
  opacity: 0.22;
  transform: translateX(-24%);
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.jump-latest:hover,
.jump-latest:focus-visible {
  color: var(--ember-bright);
  border-color: rgba(232, 169, 72, 0.64);
  background:
    radial-gradient(circle at 22% 22%, rgba(232, 169, 72, 0.22), transparent 42%),
    linear-gradient(135deg, rgba(181, 137, 61, 0.18), rgba(155, 58, 46, 0.09) 48%, rgba(6, 6, 8, 0.38)),
    rgba(12, 6, 7, 0.88);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.12),
    inset 0 -10px 22px rgba(0, 0, 0, 0.20),
    0 14px 30px rgba(0, 0, 0, 0.28),
    0 0 22px rgba(181, 137, 61, 0.18);
  transform: translateY(-2px);
}
.jump-latest:hover::after,
.jump-latest:focus-visible::after {
  opacity: 0.42;
  transform: translateX(-6%);
}
.jump-latest:focus-visible {
  outline: 1px solid rgba(232, 169, 72, 0.62);
  outline-offset: 3px;
}
.jump-glyph {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: 1px solid rgba(232, 169, 72, 0.42);
  border-radius: 50%;
  color: transparent;
  background:
    radial-gradient(circle, rgba(232, 169, 72, 0.10), transparent 68%),
    rgba(6, 6, 8, 0.34);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 0 10px rgba(181, 137, 61, 0.14);
  transition: border-color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease;
}
.jump-glyph::before {
  content: "";
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(181, 137, 61, 0.26);
  border-radius: 50%;
}
.jump-glyph::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 47%;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid var(--ember-bright);
  border-bottom: 1.5px solid var(--ember-bright);
  transform: translate(-50%, -50%) rotate(45deg);
  box-shadow: 2px 2px 7px rgba(232, 169, 72, 0.28);
}
.jump-latest:hover .jump-glyph,
.jump-latest:focus-visible .jump-glyph {
  border-color: rgba(232, 169, 72, 0.76);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 14px rgba(181, 137, 61, 0.28);
  transform: rotate(-8deg) scale(1.04);
}
@keyframes jump-latest-enter {
  from { opacity: 0; transform: translateY(5px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .jump-latest {
    animation: none;
    transition-duration: 0.01ms;
  }
  .jump-latest::after,
  .jump-glyph {
    transition-duration: 0.01ms;
  }
}

@media (max-width: 920px) {
  .jump-latest {
    left: auto;
    right: 24px;
  }
}

.empty-state {
  text-align: center;
  padding: 120px 0;
}
.empty-title {
  font-family: var(--font-serif);
  font-size: 1.2rem;
  color: var(--prose-muted);
  margin: 0 0 8px;
}
.empty-hint {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--prose-faint);
  margin: 0;
  animation: hint-pulse 2.5s ease-in-out infinite;
}
@keyframes hint-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 0.95; }
}

/* 上下文注入阻断 banner：52em 居中、Composer 上方；复用 SyncToast sync-failed 血珀配色语言。 */
.send-error-banner {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 52em;
  width: fit-content;
  margin: 0 auto 8px;
  padding: 9px 16px;
  border: 1px solid var(--blood);
  border-radius: 6px;
  background: rgba(10, 5, 6, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--prose-muted);
  letter-spacing: 0.06em;
}
.send-error-banner .mark {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  position: relative;
}
.send-error-banner .mark::before,
.send-error-banner .mark::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 1.5px;
  background: var(--blood);
}
.send-error-banner .mark::before {
  transform: translate(-50%, -50%) rotate(45deg);
}
.send-error-banner .mark::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}
.send-error-banner .label {
  white-space: nowrap;
}
</style>
