// packages/play-bridge/src/tsian-api.ts
// @tsian/play-bridge — 领域 API 层
//
// 把裸 RPC（bridge.call("interaction.sendMessage", ...)）包装成面向游戏前端
// 开发者的领域语言（tsian.send / tsian.onMessage / ...）。协议层（postMessage
// 握手 / RPC id 匹配 / 消息路由）在 createBridge() 内部，本层只做语义映射。
//
// 详见 docs/sdk/play-frontend-api.md（API 文档）。

import type {
  CheckpointSummary,
  DeepQueryResult,
  InjectionMessage,
  InvokeAgentResult,
  MessageInteractionResult,
  PlatformActionResult,
  RemotePlayBridgeEventName,
  RemotePlayBridgeEventPayload,
  SessionHistoryEntry,
  TurnStats,
  TurnToolOutput,
  WorkspaceEntry,
  WorkspaceReadResult,
  WorkspaceSearchResult,
  WorkspaceWriteResult,
  WorkspaceScope,
} from "@tsian/contracts"
import { createBridge, type Bridge } from "./bridge"

// ════════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════════

export interface SendOptions {
  /** 前端注入的上下文消息（本轮有效，不落盘）。 */
  injection?: InjectionMessage[]
  /** 附件（预留，当前由表现层自行处理）。 */
  attachments?: unknown[]
}

export interface InvokeAgentOptions {
  injection?: InjectionMessage[]
}

export interface MessageDelta {
  /** "reasoning" = 思维链（可折叠）；"content" = 可见文本。 */
  kind: "reasoning" | "content"
  delta: string
  agentId: string
  round: number
}

export interface RoundEnd {
  /** "thought" = 中间轮/工具轮（这轮的 content 是 interim）；"final" = 最终轮（content 是最终正文）。 */
  kind: "thought" | "final"
  round: number
  agentId: string
}

export interface TurnEndResult {
  /** 剧情选项（若有）。 */
  options?: string[]
  /** token 消耗统计（若有）。 */
  stats?: TurnStats
}

export interface ToolEvent {
  agentId: string
  round: number
  callId: string
  name: string
  status: "loading" | "running" | "success" | "failed"
  output?: TurnToolOutput
}

export interface AskRequest {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
}

export interface SessionHistory {
  entries: SessionHistoryEntry[]
  turn: number
}

export interface TsianApi {
  // ── 生命周期 ──
  /** 桥握手是否完成。 */
  readonly ready: boolean
  /** 等握手完成（resolve 后可通信）。 */
  waitForReady(): Promise<void>
  /** 当前会话 id（握手后可用）。 */
  readonly sessionId: string | null

  // ── 发送 ──
  send(text: string, options?: SendOptions): Promise<void>
  invokeAgent(agentId: string, input: string, options?: InvokeAgentOptions): Promise<InvokeAgentResult>

  // ── 订阅（每个返回 unsubscribe 函数）──
  onMessage(cb: (msg: MessageDelta) => void): () => void
  onRoundEnd(cb: (round: RoundEnd) => void): () => void
  onTurnEnd(cb: (result: TurnEndResult) => void): () => void
  onTool(cb: (tool: ToolEvent) => void): () => void
  onAsk(cb: (ask: AskRequest) => void): () => void

  // ── 回答 ask_user ──
  answer(requestId: string, text: string, cancelled?: boolean): Promise<void>

  // ── 数据 ──
  readonly history: {
    get(): Promise<SessionHistory>
  }
  readonly checkpoints: {
    list(): Promise<CheckpointSummary[]>
    restore(checkpointId: string): Promise<{ turn: number }>
  }

  // ── workspace（前端自己维护状态）──
  readonly workspace: {
    read(path: string, scope?: WorkspaceScope): Promise<WorkspaceReadResult | null>
    list(path?: string, scope?: WorkspaceScope): Promise<WorkspaceEntry[]>
    search(query: string, options?: { scope?: WorkspaceScope; limit?: number; contextLines?: number; ignoreCase?: boolean }): Promise<WorkspaceSearchResult[]>
    write(path: string, content: string, scope?: WorkspaceScope): Promise<WorkspaceWriteResult>
  }

  // ── 通用入口（覆盖冷门/未来新增能力，不暴露 RPC）──
  query(resource: string, params?: Record<string, unknown>): Promise<unknown>
  runAction(action: string, params?: Record<string, unknown>): Promise<unknown>
}

// ════════════════════════════════════════════════════════════════
// 实现
// ════════════════════════════════════════════════════════════════

/**
 * 创建 Tsian 领域 API 实例。表现层唯一的能力出口。
 * 内部自动完成桥握手，通过 tsian.* 方法与平台交互。
 */
export function createTsian(): TsianApi {
  const bridge = createBridge()

  // ── onTurnEnd 聚合：缓存 turn-options + turn-stats，turn-completed 时合并触发 ──
  let pendingOptions: string[] | undefined
  let pendingStats: TurnStats | undefined
  const turnEndCallbacks = new Set<(result: TurnEndResult) => void>()

  function handleEvent(event: RemotePlayBridgeEventName, payload: RemotePlayBridgeEventPayload): void {
    if (event === "turn-options" && payload && "options" in payload && Array.isArray(payload.options)) {
      pendingOptions = payload.options as string[]
      return
    }
    if (event === "turn-stats" && payload && "stats" in payload) {
      pendingStats = payload.stats as TurnStats
      return
    }
    if (event === "turn-completed") {
      const result: TurnEndResult = {}
      if (pendingOptions && pendingOptions.length > 0) {
        result.options = pendingOptions
      }
      if (pendingStats) {
        result.stats = pendingStats
      }
      pendingOptions = undefined
      pendingStats = undefined
      for (const cb of turnEndCallbacks) {
        try { cb(result) } catch (err) { console.error("[tsian] onTurnEnd callback threw", err) }
      }
      return
    }
  }

  // ── 事件分发：把 8 个平台事件路由到 5 个语义回调 ──
  const messageCallbacks = new Set<(msg: MessageDelta) => void>()
  const roundEndCallbacks = new Set<(round: RoundEnd) => void>()
  const toolCallbacks = new Set<(tool: ToolEvent) => void>()
  const askCallbacks = new Set<(ask: AskRequest) => void>()

  bridge.on({
    onEvent(event, payload) {
      // onTurnEnd 聚合逻辑先处理
      handleEvent(event, payload)

      if (event === "turn-delta" && payload && "kind" in payload && "delta" in payload) {
        const msg: MessageDelta = {
          kind: payload.kind as "reasoning" | "content",
          delta: payload.delta as string,
          agentId: (payload as { agentId?: string }).agentId ?? "",
          round: (payload as { round?: number }).round ?? 0,
        }
        for (const cb of messageCallbacks) {
          try { cb(msg) } catch (err) { console.error("[tsian] onMessage callback threw", err) }
        }
        return
      }

      if (event === "turn-round-end" && payload && "kind" in payload && "round" in payload) {
        const round: RoundEnd = {
          kind: payload.kind as "thought" | "final",
          round: (payload as { round?: number }).round ?? 0,
          agentId: (payload as { agentId?: string }).agentId ?? "",
        }
        for (const cb of roundEndCallbacks) {
          try { cb(round) } catch (err) { console.error("[tsian] onRoundEnd callback threw", err) }
        }
        return
      }

      if (event === "turn-tool" && payload && "callId" in payload && "name" in payload) {
        const tool: ToolEvent = {
          agentId: (payload as { agentId?: string }).agentId ?? "",
          round: (payload as { round?: number }).round ?? 0,
          callId: (payload as { callId?: string }).callId ?? "",
          name: (payload as { name?: string }).name ?? "",
          status: (payload as { status?: ToolEvent["status"] }).status ?? "loading",
          ...(payload && "output" in payload ? { output: (payload as { output?: TurnToolOutput }).output } : {}),
        }
        for (const cb of toolCallbacks) {
          try { cb(tool) } catch (err) { console.error("[tsian] onTool callback threw", err) }
        }
        return
      }

      if (event === "interaction-request" && payload && "requestId" in payload && "question" in payload) {
        const ask: AskRequest = {
          requestId: (payload as { requestId?: string }).requestId ?? "",
          question: (payload as { question?: string }).question ?? "",
          ...(payload && "options" in payload && Array.isArray(payload.options)
            ? { options: payload.options as string[] }
            : {}),
          ...(payload && "allowCustom" in payload
            ? { allowCustom: (payload as { allowCustom?: boolean }).allowCustom }
            : {}),
        }
        for (const cb of askCallbacks) {
          try { cb(ask) } catch (err) { console.error("[tsian] onAsk callback threw", err) }
        }
        return
      }
    },
  })

  // ── ready() Promise 封装 ──
  let readyPromise: Promise<void> | null = null
  function ensureReadyPromise(): Promise<void> {
    if (!readyPromise) {
      readyPromise = new Promise<void>((resolve) => {
        if (bridge.ready) {
          resolve()
          return
        }
        const check = setInterval(() => {
          if (bridge.ready) {
            clearInterval(check)
            resolve()
          }
        }, 50)
      })
    }
    return readyPromise
  }

  return {
    get ready() { return bridge.ready },
    waitForReady: ensureReadyPromise,
    get sessionId() { return bridge.sessionId },

    async send(text: string, options?: SendOptions): Promise<void> {
      const params: Record<string, unknown> = { content: text }
      if (options?.injection && options.injection.length > 0) {
        params.injection = options.injection
      }
      await bridge.call<MessageInteractionResult>("interaction.sendMessage", params as never)
    },

    async invokeAgent(agentId: string, input: string, options?: InvokeAgentOptions): Promise<InvokeAgentResult> {
      const params: Record<string, unknown> = { agentId, input }
      if (options?.injection && options.injection.length > 0) {
        params.injection = options.injection
      }
      return bridge.call<InvokeAgentResult>("interaction.invokeAgent", params as never)
    },

    onMessage(cb: (msg: MessageDelta) => void): () => void {
      messageCallbacks.add(cb)
      return () => { messageCallbacks.delete(cb) }
    },

    onRoundEnd(cb: (round: RoundEnd) => void): () => void {
      roundEndCallbacks.add(cb)
      return () => { roundEndCallbacks.delete(cb) }
    },

    onTurnEnd(cb: (result: TurnEndResult) => void): () => void {
      turnEndCallbacks.add(cb)
      return () => { turnEndCallbacks.delete(cb) }
    },

    onTool(cb: (tool: ToolEvent) => void): () => void {
      toolCallbacks.add(cb)
      return () => { toolCallbacks.delete(cb) }
    },

    onAsk(cb: (ask: AskRequest) => void): () => void {
      askCallbacks.add(cb)
      return () => { askCallbacks.delete(cb) }
    },

    async answer(requestId: string, text: string, cancelled?: boolean): Promise<void> {
      await bridge.respondInteraction(requestId, text, cancelled)
    },

    history: {
      async get(): Promise<SessionHistory> {
        const result = await bridge.call<DeepQueryResult<SessionHistoryEntry>>(
          "query.query",
          { resource: "session-history" },
        )
        const entries = result?.items ?? []
        const maxTurn = entries.reduce((max, entry) => Math.max(max, entry.turn), 0)
        return { entries, turn: maxTurn + 1 }
      },
    },

    checkpoints: {
      async list(): Promise<CheckpointSummary[]> {
        const result = await bridge.call<DeepQueryResult<CheckpointSummary>>(
          "query.query",
          { resource: "checkpoints" },
        )
        return result?.items ?? []
      },

      async restore(checkpointId: string): Promise<{ turn: number }> {
        const result = await bridge.call<PlatformActionResult<{ turn: number }>>(
          "platform.runAction",
          { action: "restore-checkpoint", params: { checkpointId } },
        )
        if (!result || !result.ok) {
          const err = result?.error
          const e = new Error(err?.message ?? "恢复检查点失败。")
          if (err) (e as Error & { code?: string }).code = err.code
          throw e
        }
        return result.item as { turn: number }
      },
    },

    workspace: {
      async read(path: string, scope?: WorkspaceScope): Promise<WorkspaceReadResult | null> {
        return bridge.call<WorkspaceReadResult | null>("workspace.read", {
          path,
          ...(scope ? { scope } : {}),
        })
      },

      async list(path?: string, scope?: WorkspaceScope): Promise<WorkspaceEntry[]> {
        return bridge.call<WorkspaceEntry[]>("workspace.list", {
          ...(path !== undefined ? { path } : {}),
          ...(scope ? { scope } : {}),
        })
      },

      async search(query: string, options?: {
        scope?: WorkspaceScope
        limit?: number
        contextLines?: number
        ignoreCase?: boolean
      }): Promise<WorkspaceSearchResult[]> {
        return bridge.call<WorkspaceSearchResult[]>("workspace.search", {
          query,
          ...(options?.scope ? { scope: options.scope } : {}),
          ...(options?.limit !== undefined ? { limit: options.limit } : {}),
          ...(options?.contextLines !== undefined ? { contextLines: options.contextLines } : {}),
          ...(options?.ignoreCase !== undefined ? { ignoreCase: options.ignoreCase } : {}),
        })
      },

      async write(path: string, content: string, scope?: WorkspaceScope): Promise<WorkspaceWriteResult> {
        return bridge.call<WorkspaceWriteResult>("workspace.write", {
          path,
          content,
          ...(scope ? { scope } : {}),
        })
      },
    },

    async query(resource: string, params?: Record<string, unknown>): Promise<unknown> {
      return bridge.call("query.query", { resource, ...(params ? { params } : {}) })
    },

    async runAction(action: string, params?: Record<string, unknown>): Promise<unknown> {
      return bridge.call("platform.runAction", { action, ...(params ? { params } : {}) })
    },
  }
}
