// packages/play-bridge/src/tsian-api.ts
// @tsian/play-bridge — 领域 API 层
//
// 把裸 RPC（bridge.call("interaction.sendMessage", ...)）包装成面向游戏前端
// 开发者的领域语言（tsian.send / tsian.onMessage / ...）。协议层（postMessage
// 握手 / RPC id 匹配 / 消息路由）在 createBridge() 内部，本层只做语义映射。
//
// 详见 docs/sdk/play-frontend-api.md（API 文档）。

import type {
  AgentInvocationCommitMode,
  AgentInvocationEvent,
  AssistantTurnTimelineItem,
  CardRunActionResult,
  CheckpointSummary,
  CreateCheckpointOptions,
  DeepQueryResult,
  GameCardRuntimeEntrypoints,
  InjectionMessage,
  InvokeAgentCheckpointOption,
  InvokeAgentResult,
  JsonValue,
  ListCheckpointOptions,
  MessageInteractionResult,
  OverwriteCheckpointOptions,
  PlatformActionResult,
  RemotePlayBridgeEventName,
  RemotePlayBridgeEventPayload,
  RuntimeWorkspaceMutationEvent,
  SessionHistoryEntry,
  UiToolPresentation,
  UpdateCheckpointOptions,
  WorkspaceEntry,
  WorkspaceReadResult,
  WorkspaceSearchResult,
  WorkspaceWriteResult,
  WorkspaceScope,
} from "@tsian/contracts"
import { createBridge } from "./bridge"
import {
  abortedError,
  inputInvalidError,
  toFrontendActionError,
} from "./frontend-action-error"
import { validateStrictJson } from "./strict-json"
import { parseWorkspaceMutationEvent } from "./workspace-mutation"

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
  /** 调用方自定义 invocation id；用于调用完成前过滤 onAgentInvocation 事件。省略时 SDK 自动生成。 */
  invocationId?: string
  /** 调用目的标签（如 setup / post-turn-maintenance），透传到 started 事件。 */
  purpose?: string
  /** Workspace 提交成功后执行的 checkpoint 操作。 */
  checkpoint?: InvokeAgentCheckpointOption
  /** @deprecated Use `checkpoint` instead. `workspace-with-checkpoint` maps to current-turn-auto. */
  commitMode?: AgentInvocationCommitMode
  /** @deprecated Compatibility data for legacy workspace-with-checkpoint callers. */
  checkpointReason?: string
  injection?: InjectionMessage[]
  /** 上下文隔离 slot。不同 slot 读写不同 context-<slot>.json，防止上下文串。 */
  contextSlot?: string
  /** 是否持久化上下文。true = 读写 context-slot.json（跨调用持久化）；
   *  false/省略 = 不读不写（一次性调用）。默认 false。 */
  persist?: boolean
  /** Persist an append-only player-visible archive for this named context slot. */
  transcript?: { mode: "full"; audience: "player" }
}

export interface FrontendActionOptions {
  /** Cancels the invocation. A pre-aborted signal sends no run request. */
  signal?: AbortSignal
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
  /** 平台提交的正式玩家回合号。 */
  turn?: number
  /** 平台提交并持久化的投影后 assistant timeline item。 */
  assistant?: AssistantTurnTimelineItem
}

export interface ToolEvent {
  agentId: string
  round: number
  callId: string
  name: string
  /** Optional opaque player-facing label. Render `name` when absent. */
  displayName?: string
  status: "loading" | "running" | "success" | "failed"
  presentation?: UiToolPresentation
}

export interface AskRequest {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
}

function createInvocationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return `invoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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
  /** invokeAgent 过程事件订阅；用 invocationId 区分并发调用。 */
  onAgentInvocation(cb: (event: AgentInvocationEvent) => void): () => void
  /** Frontend Action durable workspace commits; payload contains paths only. */
  onWorkspaceMutation(cb: (event: RuntimeWorkspaceMutationEvent) => void): () => void

  // ── 回答 ask_user ──
  answer(requestId: string, text: string, cancelled?: boolean): Promise<void>

  // ── 中断当前 turn（流式输出/工具执行）──
  stop(): Promise<void>

  // ── 数据 ──
  readonly history: {
    get(): Promise<SessionHistory>
  }
  readonly checkpoints: {
    list(options?: ListCheckpointOptions): Promise<CheckpointSummary[]>
    restore(checkpointId: string): Promise<{ turn: number }>
    /** Create a checkpoint from the current active save state. */
    create(options?: string | CreateCheckpointOptions): Promise<CheckpointSummary>
    /** Update checkpoint metadata only; does not rebuild snapshot/manifest. */
    update(checkpointId: string, patch: UpdateCheckpointOptions): Promise<CheckpointSummary>
    /** Preserve checkpoint id while replacing its snapshot with current active save state. */
    overwrite(checkpointId: string, options?: OverwriteCheckpointOptions): Promise<CheckpointSummary>
    delete(checkpointId: string): Promise<void>
  }

  // ── workspace（前端自己维护状态）──
  readonly workspace: {
    read(path: string, scope?: WorkspaceScope): Promise<WorkspaceReadResult | null>
    list(path?: string, scope?: WorkspaceScope): Promise<WorkspaceEntry[]>
    search(query: string, options?: { scope?: WorkspaceScope; limit?: number; contextLines?: number; ignoreCase?: boolean }): Promise<WorkspaceSearchResult[]>
    write(path: string, content: string | Blob, scope?: WorkspaceScope): Promise<WorkspaceWriteResult>
  }

  // ── 卡配置 ──
  readonly card: {
    /** 当前卡 runtime 入口配置。前端用它决定调用哪个 agent（如回合后维护入口），不硬编码 agent 名。 */
    entrypoints(): Promise<GameCardRuntimeEntrypoints>
    /** Execute one fixed-directory Frontend Action with strict JSON I/O. */
    runAction(
      actionId: string,
      input: JsonValue,
      options?: FrontendActionOptions,
    ): Promise<JsonValue>
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

  // ── onTurnEnd 聚合：turn-completed 直接携带平台提交的 projected assistant item ──
  const turnEndCallbacks = new Set<(result: TurnEndResult) => void>()

  function handleEvent(event: RemotePlayBridgeEventName, payload: RemotePlayBridgeEventPayload): void {
    if (event === "turn-completed") {
      const result: TurnEndResult = {}
      if (payload && "turn" in payload && typeof payload.turn === "number") {
        result.turn = payload.turn
      }
      if (payload && "assistant" in payload) {
        result.assistant = payload.assistant as AssistantTurnTimelineItem | undefined
      }
      for (const cb of turnEndCallbacks) {
        try { cb(result) } catch (err) { console.error("[tsian] onTurnEnd callback threw", err) }
      }
      return
    }
  }

  // ── 事件分发：把平台事件路由到领域语义回调 ──
  const messageCallbacks = new Set<(msg: MessageDelta) => void>()
  const roundEndCallbacks = new Set<(round: RoundEnd) => void>()
  const toolCallbacks = new Set<(tool: ToolEvent) => void>()
  const askCallbacks = new Set<(ask: AskRequest) => void>()
  const agentInvocationCallbacks = new Set<(event: AgentInvocationEvent) => void>()
  const workspaceMutationCallbacks = new Set<
    (event: RuntimeWorkspaceMutationEvent) => void
  >()

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
        const displayName = (payload as { displayName?: unknown }).displayName
        const tool: ToolEvent = {
          agentId: (payload as { agentId?: string }).agentId ?? "",
          round: (payload as { round?: number }).round ?? 0,
          callId: (payload as { callId?: string }).callId ?? "",
          name: (payload as { name?: string }).name ?? "",
          ...(typeof displayName === "string" && displayName.trim().length > 0
            ? { displayName }
            : {}),
          status: (payload as { status?: ToolEvent["status"] }).status ?? "loading",
          ...(payload && "presentation" in payload
            ? { presentation: (payload as { presentation?: UiToolPresentation }).presentation }
            : {}),
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

      if (event === "agent-invocation" && payload && "type" in payload && "invocationId" in payload) {
        const invocationEvent = payload as AgentInvocationEvent
        for (const cb of agentInvocationCallbacks) {
          try { cb(invocationEvent) } catch (err) { console.error("[tsian] onAgentInvocation callback threw", err) }
        }
        return
      }

      if (event === "workspace-mutation") {
        const mutationEvent = parseWorkspaceMutationEvent(payload)
        if (!mutationEvent) return
        for (const cb of workspaceMutationCallbacks) {
          try { cb(mutationEvent) } catch (err) { console.error("[tsian] onWorkspaceMutation callback threw", err) }
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
      const invocationId = options?.invocationId?.trim() || createInvocationId()
      const purpose = options?.purpose?.trim()
      const params: Record<string, unknown> = { agentId, input, invocationId }
      if (purpose) {
        params.purpose = purpose
      }
      if (options?.checkpoint !== undefined) {
        params.checkpoint = options.checkpoint
      }
      if (options?.commitMode !== undefined) {
        params.commitMode = options.commitMode
      }
      if (options?.checkpointReason !== undefined) {
        params.checkpointReason = options.checkpointReason
      }
      if (options?.injection && options.injection.length > 0) {
        params.injection = options.injection
      }
      if (options?.contextSlot !== undefined) {
        params.contextSlot = options.contextSlot
      }
      if (options?.persist !== undefined) {
        params.persist = options.persist
      }
      if (options?.transcript !== undefined) {
        params.transcript = options.transcript
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

    onAgentInvocation(cb: (event: AgentInvocationEvent) => void): () => void {
      agentInvocationCallbacks.add(cb)
      return () => { agentInvocationCallbacks.delete(cb) }
    },

    onWorkspaceMutation(cb: (event: RuntimeWorkspaceMutationEvent) => void): () => void {
      workspaceMutationCallbacks.add(cb)
      return () => { workspaceMutationCallbacks.delete(cb) }
    },

    async answer(requestId: string, text: string, cancelled?: boolean): Promise<void> {
      await bridge.respondInteraction(requestId, text, cancelled)
    },

    async stop(): Promise<void> {
      await bridge.stopInteraction()
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
      async list(options?: ListCheckpointOptions): Promise<CheckpointSummary[]> {
        const result = await bridge.call<DeepQueryResult<CheckpointSummary>>(
          "query.query",
          { resource: "checkpoints", ...(options ? { params: options } : {}) },
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

      async create(options?: string | CreateCheckpointOptions): Promise<CheckpointSummary> {
        const params = typeof options === "string"
          ? { label: options }
          : options ?? {}
        const result = await bridge.call<PlatformActionResult<CheckpointSummary>>(
          "platform.runAction",
          { action: "create-checkpoint", params },
        )
        if (!result || !result.ok) {
          const err = result?.error
          const e = new Error(err?.message ?? "创建检查点失败。")
          if (err) (e as Error & { code?: string }).code = err.code
          throw e
        }
        return result.item as CheckpointSummary
      },

      async update(checkpointId: string, patch: UpdateCheckpointOptions): Promise<CheckpointSummary> {
        const result = await bridge.call<PlatformActionResult<CheckpointSummary>>(
          "platform.runAction",
          { action: "update-checkpoint", params: { checkpointId, ...patch } },
        )
        if (!result || !result.ok) {
          const err = result?.error
          const e = new Error(err?.message ?? "更新检查点失败。")
          if (err) (e as Error & { code?: string }).code = err.code
          throw e
        }
        return result.item as CheckpointSummary
      },

      async overwrite(checkpointId: string, options?: OverwriteCheckpointOptions): Promise<CheckpointSummary> {
        const result = await bridge.call<PlatformActionResult<CheckpointSummary>>(
          "platform.runAction",
          { action: "overwrite-checkpoint", params: { checkpointId, ...(options ?? {}) } },
        )
        if (!result || !result.ok) {
          const err = result?.error
          const e = new Error(err?.message ?? "覆盖检查点失败。")
          if (err) (e as Error & { code?: string }).code = err.code
          throw e
        }
        return result.item as CheckpointSummary
      },

      async delete(checkpointId: string): Promise<void> {
        const result = await bridge.call<PlatformActionResult<void>>(
          "platform.runAction",
          { action: "delete-checkpoint", params: { checkpointId } },
        )
        if (!result || !result.ok) {
          const err = result?.error
          const e = new Error(err?.message ?? "删除检查点失败。")
          if (err) (e as Error & { code?: string }).code = err.code
          throw e
        }
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

      async write(path: string, content: string | Blob, scope?: WorkspaceScope): Promise<WorkspaceWriteResult> {
        return bridge.call<WorkspaceWriteResult>("workspace.write", {
          path,
          content,
          ...(scope ? { scope } : {}),
        })
      },
    },

    card: {
      async entrypoints(): Promise<GameCardRuntimeEntrypoints> {
        return bridge.call<GameCardRuntimeEntrypoints>("card.getEntrypoints", {})
      },

      async runAction(
        actionId: string,
        input: JsonValue,
        options?: FrontendActionOptions,
      ): Promise<JsonValue> {
        if (!validateStrictJson(input).ok) {
          throw inputInvalidError()
        }

        const invocationId = createInvocationId()
        const signal = options?.signal
        if (signal?.aborted) {
          throw abortedError()
        }

        const sendAbort = () => {
          // Cancellation is best effort. The host response remains authoritative
          // for the durable commit-versus-late-abort race.
          void bridge.call<void>("card.abortAction", { invocationId }).catch(() => {})
        }

        try {
          const output = await bridge.call<CardRunActionResult>(
            "card.runAction",
            { invocationId, actionId, input },
            {
              ...(signal ? { signal } : {}),
              onAbort: sendAbort,
            },
          )
          const outputValidation = validateStrictJson(output)
          if (!outputValidation.ok) {
            throw {
              kind: "runtime",
              code: "FRONTEND_ACTION_OUTPUT_INVALID",
              message: "Frontend Action output did not satisfy the strict JSON transport limits.",
            }
          }
          return outputValidation.value
        } catch (error) {
          throw toFrontendActionError(error)
        }
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
