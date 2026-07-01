<script setup lang="ts">
import { computed, ref, watch } from "vue"
import UserMessage from "./UserMessage.vue"
import NarrativeMessage from "./NarrativeMessage.vue"
import type { ProcessNodeData } from "./ProcessNode.vue"
import RoundProcess from "./RoundProcess.vue"
import TurnMeta from "./TurnMeta.vue"
import StoryOptions from "./StoryOptions.vue"
import Composer from "./Composer.vue"
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
  send,
  stop,
  loadHistory,
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

// 轮次状态变化：streaming 开始计时，standby 停止
watch(turnPhase, (phase) => {
  if (phase === "streaming") beginTurnTimer()
  else if (phase === "standby") stopTurnTimer()
})

// ready 后加载历史（immediate：StoryView 挂载时 ready 可能已 true）。
// useTsian 内部有 historyLoaded 模块级标志，loadHistory 只首次执行，避免覆盖实时 stream。
watch(ready, (r) => {
  if (r) void loadHistory()
}, { immediate: true })

// 工具节点合并：同 round 连续 tool 合并成 tool-group（避免堆叠）
// 过程聚合：连续的过程节点（interim/thought/tool/tool-group）整体收进一个 round-process
// 大折叠，降低过程噪音。user/assistant 原样透出，保持"玩家之举 → 推演 → 正文"的叙事流。
type MergedItem =
  | Extract<StreamItem, { kind: "user" }>
  | Extract<StreamItem, { kind: "assistant" }>
  | { kind: "round-process"; id: string; round: number; nodes: ProcessNodeData[] }

const mergedStream = computed(() => {
  const result: MergedItem[] = []
  const src = stream.value
  let i = 0
  while (i < src.length) {
    const item = src[i]!
    if (item.kind === "user" || item.kind === "assistant") {
      result.push(item)
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
          :turn="turnCount"
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
