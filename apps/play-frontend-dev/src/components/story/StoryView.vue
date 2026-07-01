<script setup lang="ts">
import { computed, ref, watch } from "vue"
import UserMessage from "./UserMessage.vue"
import NarrativeMessage from "./NarrativeMessage.vue"
import type { ProcessNodeData } from "./ProcessNode.vue"
import RoundProcess from "./RoundProcess.vue"
import TurnMeta from "./TurnMeta.vue"
import StoryOptions from "./StoryOptions.vue"
import Composer from "./Composer.vue"
import CheckpointMark from "../checkpoints/CheckpointMark.vue"
import RestoreDialog from "../checkpoints/RestoreDialog.vue"
import BurningReveal from "../BurningReveal.vue"
import { useTsian, type StreamItem } from "../../composables/useTsian"
import { useTurnState } from "../../composables/useTurnState"

/**
 * StoryView — 对话流容器（核心游玩面）。
 *
 * prd 屏3：52em 列 + 垂直滚动。
 * 数据模型（镜像 legacy main.ts $story DOM 容器）：
 * - stream：单一有序流，所有元素（user/interim/thought/tool/assistant）按真实发生顺序交织，
 *   跨轮保留不清空。loadHistory 重建历史，send/订阅 push 实时。
 * - streamingText：流式期间的实时累积文本，单独渲染（onRoundEnd/onTurnEnd 落定后推入 stream）。
 * 渲染：遍历 stream 按 kind 分发组件，streaming 期间末尾追加流式 NarrativeMessage。
 */
const {
  ready,
  turnPhase,
  turnCount,
  stream,
  streamingText,
  turnOptions,
  checkpoints,
  send,
  stop,
  restore,
  loadHistory,
  loadCheckpoints,
} = useTsian()

const storyRef = ref<HTMLElement | null>(null)
const composerRef = ref<InstanceType<typeof Composer> | null>(null)
const streaming = computed(() => turnPhase.value === "streaming")

const { elapsedMs, beginTurnTimer, stopTurnTimer, maybeScrollDown } = useTurnState(
  storyRef,
  streaming,
)

// 流式文本/流长度变化时自动滚动。flush:'post' 确保 DOM 已更新后再读 scrollHeight，
// 否则滚动比内容滞后一帧、末行被 fixed Composer 遮住
watch(streamingText, () => maybeScrollDown(), { flush: "post" })
watch(() => stream.value.length, () => maybeScrollDown(), { flush: "post" })
// 选项在 onTurnEnd 中晚于 assistant 消息设置，需等其渲染后再滚到底，
// 否则选项被推到视口下方、被 fixed Composer 遮住
watch(turnOptions, () => maybeScrollDown(), { flush: "post" })

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
  const src = stream.value
  const cpMap = checkpointByTurn.value
  // initial 检查点（turn=0）在对话流最前面插入——它在任何 user 消息之前就存在
  const cp0 = cpMap.get(0)
  if (cp0) {
    result.push({ kind: "checkpoint", id: `cp-${cp0.turn}`, checkpointId: cp0.id, turn: cp0.turn, createdAt: cp0.createdAt })
  }
  let currentTurn = 0  // 追踪当前 turn 编号（user 出现时 +1）
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
        while (j < src.length && src[j]!.kind === "tool" && src[j]!.round === cur.round) {
          group.push(src[j] as Extract<StreamItem, { kind: "tool" }>)
          j += 1
        }
        if (group.length > 1) {
          nodes.push({ kind: "tool-group", id: `tg-${cur.round}-${i}`, round: cur.round, agentId: cur.agentId, tools: group })
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
    <div class="story-scroll" ref="storyRef">
      <div class="story-inner">
        <!-- 有序流：按真实发生顺序渲染，跨轮保留不清空 -->
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

        <!-- 轮次计时 meta（standby 时显示） -->
        <TurnMeta
          v-if="turnPhase === 'standby'"
          :elapsed-ms="elapsedMs"
          :tokens="currentTokens"
          :turn="Math.max(0, turnCount - 1)"
        />

        <!-- 剧情选项 -->
        <StoryOptions
          v-if="turnOptions.length > 0"
          :options="turnOptions"
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

    <!-- Composer：正常流布局，固定在滚动区下方（flex 列底部），与正文同宽 52em 居中 -->
    <Composer
      ref="composerRef"
      :ready="ready"
      :streaming="streaming"
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
  display: flex;
  flex-direction: column;
  margin-top: 52px;     /* 顶栏高度 */
  height: calc(100% - 52px);  /* 精确填满顶栏以下空间 */
  padding-right: 180px; /* 让出 nav 空间 */
  padding-left: 0;
  overflow: hidden;     /* flex 容器本身不滚动，滚动交给 .story-scroll */
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

/* 滚动区：flex:1 占满 Composer 以上的全部空间 */
.story-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;  /* flex 子元素 overflow 生效的关键 */
}

.story-inner {
  max-width: 52em;
  margin: 0 auto;
  padding: 40px 24px 24px;
}

.empty-state {
  text-align: center;
  padding: 120px 0;
}
.empty-title {
  font-family: var(--font-serif);
  font-size: 1.2rem;
  color: var(--prose-dim);
  margin: 0 0 8px;
}
.empty-hint {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--whisper);
  margin: 0;
  animation: hint-pulse 2.5s ease-in-out infinite;
}
@keyframes hint-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}
</style>
