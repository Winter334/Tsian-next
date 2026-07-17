import { nextTick, ref, type Ref } from "vue"
import { saveScrollTop } from "@/storage"

export function useAssistantScroll(activeSessionId: Ref<string | null>) {
  const messageListRef = ref<HTMLElement | null>(null)
  const showJumpToBottom = ref(false)
  const userPinnedToBottom = ref(true)
  let scrollPersistScheduled = false

  function handleScroll(event: Event) {
    const el = event.target as HTMLElement
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userPinnedToBottom.value = distanceFromBottom < 80
    showJumpToBottom.value = distanceFromBottom > 120
    // rAF 节流持久化 scrollTop 到会话存储(每帧最多一次,避免高频 scroll 写库).
    if (!scrollPersistScheduled) {
      scrollPersistScheduled = true
      requestAnimationFrame(() => {
        scrollPersistScheduled = false
        const sid = activeSessionId.value
        const node = messageListRef.value
        if (sid && node) {
          void saveScrollTop(sid, node.scrollTop)
        }
      })
    }
  }

  async function scrollToBottom(force = false) {
    await nextTick()
    const el = messageListRef.value
    if (!el) {
      return
    }
    if (force) {
      showJumpToBottom.value = false
      userPinnedToBottom.value = true
    }
    el.scrollTop = el.scrollHeight
    // 过程节点折叠/展开会改变列表高度;补一帧再对齐底部,避免 scrollToBottom
    // 赶在布局变化前执行而停在过程节点区域,让落点回到回复正文.
    requestAnimationFrame(() => {
      if (messageListRef.value) {
        messageListRef.value.scrollTop = messageListRef.value.scrollHeight
      }
    })
  }

  // Auto-scroll during streaming only when the user is already near the bottom;
  // never yank the view away from someone scrolling up through history.
  function maybeScrollToBottom() {
    if (userPinnedToBottom.value) {
      void scrollToBottom()
    }
  }

  /**
   * 从会话存储恢复滚动位置.窗口改用 CSS 隐藏(非 DOM 移除)后,切焦窗口的
   * scrollTop 天然保留,正常情况无需恢复;此函数仅作单次兜底——若极端情况下
   * scrollTop 被重置为 0 且目标值>0,补回目标值.
   *
   * 用户主动滚到顶时 handleScroll 已把 0 写入存储,loadScrollTop 返回 0,
   * target===0 时直接跳过,不会误恢复.
   */
  function restoreScrollTop(target: number) {
    if (target <= 0) {
      return
    }
    nextTick(() => {
      const el = messageListRef.value
      if (el && el.scrollTop === 0 && el.scrollHeight > el.clientHeight) {
        el.scrollTop = target
      }
    })
  }

  return {
    messageListRef,
    showJumpToBottom,
    handleScroll,
    scrollToBottom,
    maybeScrollToBottom,
    restoreScrollTop,
  }
}
