import type {
  AgentContextSnapshot,
  AgentContextToolCall,
  AttachmentRef,
  ContentPart,
  ConversationMessageRecord,
  TurnToolOutput,
  TurnTimelineItem,
  WorkspaceFile,
} from "@tsian/contracts"
import { runAgentRuntimeTurn } from "../agent-runtime"
import {
  ASSISTANT_CONTEXT_AGENT_ID,
  ASSISTANT_CONTEXT_SCHEMA,
  createEmptyAgentContext,
  createInitialAgentContext,
  DEFAULT_TASK_TIMEOUT_MS,
  resolveTokenBudget,
  TaskTimeoutError,
} from "../agent-runtime/context-lifecycle"
import {
  assistantContextPath,
  assistantTracePath,
  deleteLocalAssistantFile,
  getAssistantAttachmentBase64,
  isAssistantDirectWritePath,
  isLocalAssistantPath,
  listAttachmentsBySession,
  loadLocalAssistantFiles,
  readTextAttachment,
  saveLocalAssistantFiles,
  LOCAL_ASSISTANT_AGENT_ID,
} from "../storage"
import {
  createRuntimeWorkspaceTransaction,
  replaceWorkspaceFilesForSave,
  writeLocalGameCardContentFile,
  type RuntimeWorkspaceTransaction,
} from "../storage"
import { executeWorkspaceMutation } from "./workspace-volumes"
import {
  createRuntimeTraceCollector,
  serializeRuntimeTraceEvents,
  errorToTraceDataWithStack,
} from "../agent-runtime/trace"
import {
  generateAssistantReply,
  generateAssistantReplyNative,
  streamAssistantReplyNative,
  streamAssistantReplyText,
  type RuntimeChatMessage,
} from "../runtime-host/ai"
import { getBrowserAiConfig } from "../config/ai"
import { resolveBrowserAiConfigForModel } from "../config/ai"
import { binaryPlaceholderText } from "@/lib/media-type"
import { createBrowserSkillScriptRunner } from "./browser-skill-script-executor"
import { createFrontendInspector } from "./frontend-inspector"
import { emitInteractionRequest, rejectAllInteractionRequests } from "../interaction-events"
import {
  getPlatformActiveGameCard,
  listEffectiveWorkspaceFilesForActiveSave,
  normalizeMessageContent,
  buildAgentProviderPresetMap,
  resolveAgentModelConfig,
  writeCardContentFileForActiveCard,
  deleteCardContentPathForActiveCard,
  cardContentFilesToWorkspaceFiles,
} from "./internal"
import { waitForPlatformHostReady } from "./host-state"
import {
  parseAgentContext,
  appendTurnToContext,
  serializeAgentContext,
} from "../agent-runtime/context-lifecycle"
import {
  getActiveSaveId,
  getLocalGameCard,
  saveAssistantSessionMessages,
} from "../storage"

// ── 助手会话 context 读写（B 类 helper，只被 runAssistantChat 调用，随接缝一起迁） ──

/** Upsert a temp-scope file into the runtime staged snapshot so same-turn
 *  read/edit sees it. temp write lands in Dexie via executeWorkspaceMutation
 *  but bypasses the save transaction, which otherwise leaves stagedFiles
 *  stale. Mirrors index.ts:syncWorkspaceFileWrite but kept local — the two
 *  helpers serve different call sites and a shared export would couple the
 *  files for three lines of logic. */
function syncTempFileIntoStaged(stagedFiles: WorkspaceFile[], file: WorkspaceFile): void {
  const existingIndex = stagedFiles.findIndex((f) => f.path === file.path)
  if (existingIndex >= 0) {
    stagedFiles[existingIndex] = file
  } else {
    stagedFiles.push(file)
    stagedFiles.sort((left, right) => left.path.localeCompare(right.path))
  }
}

/** Remove deleted temp paths from the runtime staged snapshot. Same rationale
 *  as syncTempFileIntoStaged: temp delete hits Dexie but bypasses the
 *  transaction, so stagedFiles must be pruned explicitly. `deletedPaths` may
 *  be a prefix match (temp delete can remove a subtree), so filter by prefix. */
function removeTempPathsFromStaged(stagedFiles: WorkspaceFile[], deletedPaths: string[]): void {
  if (deletedPaths.length === 0) return
  for (let i = stagedFiles.length - 1; i >= 0; i -= 1) {
    const path = stagedFiles[i].path
    if (deletedPaths.some((prefix) => path === prefix || path.startsWith(prefix + "/"))) {
      stagedFiles.splice(i, 1)
    }
  }
}

function readAssistantContextFromFiles(
  files: WorkspaceFile[],
  sessionId: string,
): AgentContextSnapshot | null {
  const path = assistantContextPath(sessionId)
  const file = files.find((f) => f.path === path)
  if (!file) return null
  return parseAgentContext(file.content, sessionId, {
    schema: ASSISTANT_CONTEXT_SCHEMA,
    agentId: ASSISTANT_CONTEXT_AGENT_ID,
  })
}

/**
 * 从 context 快照推算下一 turn 号(修复助手 fake snapshot turn 恒为 1 的缺陷).
 * 取 recentTurns 与 lastCompressedTurn 的最大值 +1,使 turn 号单调递增,
 * compressContext 的 lastCompressedTurn 去重正确工作.
 */
function nextAssistantTurnNumber(snapshot: AgentContextSnapshot): number {
  const maxRecent = snapshot.recentTurns.reduce((max, e) => Math.max(max, e.turn), 0)
  const maxCompressed = snapshot.lastCompressedTurn ?? 0
  return Math.max(maxRecent, maxCompressed) + 1
}

/**
 * turn 收尾:把本轮正文追加进助手会话 context,直接落盘到本地篮子(saveLocalAssistantFiles).
 * 对称 master 的 stageAgentContextFile,但路径是虚拟文件 sessions/<id>/context.json,
 * 属 .tsian/local/(平台本地数据,不进 save 事务/checkpoint/distribute).
 * 与 workspaceMutations.write 的 isLocalAssistantPath bypass 同通道:不碰
 * RuntimeWorkspaceTransaction(它对 .tsian/local/ 无入口),直接 Dexie 合并落盘.
 * turn 失败时 catch 不调本函数 → context 不写回(磁盘快照停留 turn 开头状态).
 */
async function stageAssistantContextFile(
  input: {
    sessionId: string
    turn: number
    user: string
    assistant: string
    compressedContext?: AgentContextSnapshot
    fallbackContext: AgentContextSnapshot
    /** 本轮工具调用(agent 层:跟正文同寿命压缩,最近 K 轮原文、早期进 summary). */
    toolCalls?: AgentContextToolCall[]
  },
): Promise<void> {
  // 基础快照:本轮压缩了→用压缩结果;否则用 turn 开头读出的快照;无则空快照
  const base =
    input.compressedContext
    ?? input.fallbackContext
    ?? createEmptyAgentContext(input.sessionId, {
        schema: ASSISTANT_CONTEXT_SCHEMA,
        agentId: ASSISTANT_CONTEXT_AGENT_ID,
      })
  // 追加本轮正文(保持最近 K 轮)+ 工具调用(挂在 assistant entry 上),saveId 用 sessionId(语义复用)
  const updated = appendTurnToContext(
    { ...base, saveId: input.sessionId },
    input.turn,
    input.user,
    input.assistant,
    input.toolCalls,
  )
  const file: WorkspaceFile = {
    path: assistantContextPath(input.sessionId),
    content: serializeAgentContext(updated),
    createdAt: 0,
    updatedAt: Date.now(),
  }
  // saveLocalAssistantFiles 合并落盘:只收 .tsian/local/assistant/ 前缀,与已存 map
  // 合并(不丢其他身份文件).零额外事务 IO,直接写 Dexie.
  await saveLocalAssistantFiles([file])
}

// ── Assistant 聊天编排 ──

export interface AssistantChatInput {
  message: string
  /** 附件引用列表. 图片附件编码为 image ContentPart 放入首轮 user 消息;
   *  文本附件内容提取后拼入消息文本. */
  attachments?: AttachmentRef[]
  history?: ConversationMessageRecord[]
  /**
   * 当前助手会话 id.host 据此读写该会话的 agent 上下文快照
   * (虚拟文件 .tsian/local/assistant/sessions/<sessionId>/context.json).
   * 多会话隔离:每会话独立 context,切换不串.
   */
  sessionId: string
  /**
   * Streaming text-delta sink. Invoked for every streamed text chunk across
   * all tool-loop rounds (thought-round text included). `agentId` identifies the
   * emitting agent (the desktop assistant is single-agent, so this is always
   * the local assistant id; the parameter is kept for signature uniformity with
   * the game-frontend streaming channel). `round` is the tool-loop round index
   * (0-based), lets the view bucket deltas by round to separate thought vs
   * final text. `undefined` disables streaming. Native-mode only — text-protocol
   * turns do not emit deltas.
   */
  onDelta?: (agentId: string, delta: string, round: number, kind: "reasoning" | "content") => void
  /**
   * Per-round end notification. `finishReason` "tool_calls" = this round was a
   * thought round (its streamed text is reasoning); "stop" = final reply round.
   * Lets the view classify each round's buffered text as thought vs final.
   * `undefined` disables round classification. Native-mode only.
   */
  onRoundEnd?: (agentId: string, round: number, finishReason: "stop" | "tool_calls") => void
  /**
   * Tool process sink (子2b R2). Invoked before/after each workspace tool
   * executes, for the desktop AssistantView to render a status line. `round` is
   * the tool-loop round the tool was called in (lets the view group tool calls
   * under their originating thought round). `agentId` is kept for signature
   * uniformity (single-agent here). `undefined` disables tool lines. Native-mode
   * only — text-protocol turns do not emit tool events.
   */
  onTool?: (
    agentId: string,
    round: number,
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: TurnToolOutput,
  ) => void
  /**
   * Optional external abort signal (e.g. a "stop generating" button). Aborting
   * it aborts the turn's model calls and tool loop.
   */
  signal?: AbortSignal
  /**
   * Optional task-mode timeout quota in ms (design 06-20-agent-task-compression).
   * The assistant runs in task compression mode (multi-compress + timeout fallback).
   * When elapsed, a TaskTimeoutError is thrown (soft halt, surfaced as a gentle
   * prompt in AssistantView). Defaults to DEFAULT_TASK_TIMEOUT_MS (300s).
   */
  timeoutMs?: number
}

export interface AssistantChatResult {
  replyText: string
  /**
   * 最后一轮 provider 返回的 token usage(input = 当前上下文大小).
   * 供桌面助手 ContextRing 显示上下文窗口占用.native 模式有值;
   * text 模式不带(undefined).不持久化,仅当前会话展示.
   */
  usage?: { input?: number; output?: number; total?: number }
}


/**
 * Runs a desktop Assistant chat turn against the currently loaded Game Card.
 * Unlike the AIRP play turn, this does not increment the turn counter,
 * create checkpoints, or stage AIRP history. It runs a single agent runtime
 * turn for Q&A and workspace assistance.
 */
export async function runAssistantChat(
  input: AssistantChatInput,
): Promise<AssistantChatResult> {
  await waitForPlatformHostReady()

  const content = normalizeMessageContent(input.message)
  if (!content) {
    throw new Error("Assistant chat requires non-empty message.")
  }

  // 处理附件:文本附件内容拼入消息文本;图片附件编码为 ContentPart[] 传给 runtime.
  let messageText = content
  let userInputAttachments: ContentPart[] | undefined
  if (input.attachments && input.attachments.length > 0) {
    const imageParts: ContentPart[] = []
    for (const attachment of input.attachments) {
      if (attachment.kind === "image") {
        const base64 = await getAssistantAttachmentBase64(attachment.path)
        if (base64) {
          imageParts.push({ type: "image", mimeType: base64.mimeType, data: base64.data })
        }
      } else {
        // 文本附件:读取内容拼入消息文本
        const text = await readTextAttachment(attachment.path)
        if (text) {
          messageText += `\n\n[文件: ${attachment.name}]\n${text}`
        }
      }
    }
    if (imageParts.length > 0) {
      userInputAttachments = imageParts
    }
  }

  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。请在我的应用中选择一张游戏卡。")
  }

  const history = input.history ?? []
  const agentId = LOCAL_ASSISTANT_AGENT_ID

  // Build effective workspace files from card content (+ save if active).
  const activeSaveId = await getActiveSaveId()
  let workspaceFiles: WorkspaceFile[]
  if (activeSaveId) {
    workspaceFiles = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
  } else {
    // No active save: use card content only.
    workspaceFiles = await cardContentFilesToWorkspaceFiles(activeCard)
  }

  // Merge local assistant files (identity, SOUL, notes, skills) into the
  // workspace. These are platform-local and persist across card switches.
  const localAssistantFiles = await loadLocalAssistantFiles()
  const localPaths = new Set(localAssistantFiles.map((file) => file.path))
  workspaceFiles = [
    ...workspaceFiles.filter((file) => !localPaths.has(file.path)),
    ...localAssistantFiles,
  ]

  // Merge temp attachments (current session's pasted/dropped files) into the
  // workspace at temp/<sessionId>/<name> paths. Images carry binary + imageMimeType;
  // text files carry empty content (agent uses workspace_read to fetch content).
  const sessionAttachments = await listAttachmentsBySession(input.sessionId)
  const tempPaths = new Set(sessionAttachments.map((r) => r.path))
  workspaceFiles = [
    ...workspaceFiles.filter((file) => !tempPaths.has(file.path)),
    ...sessionAttachments.map((record) => {
      const isImage = record.kind === "image"
      const file: WorkspaceFile = {
        path: record.path,
        content: isImage ? binaryPlaceholderText(record.data, record.path) : "",
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
      }
      if (isImage) {
        file.binary = record.data
        file.imageMimeType = record.mimeType
      }
      return file
    }),
  ].sort((left, right) => left.path.localeCompare(right.path))

  const controller = new AbortController()
  // Merge an external abort signal (e.g. "stop generating" button) into the
  // turn's controller so aborting it cancels model calls and the tool loop.
  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort(input.signal.reason)
    } else {
      input.signal.addEventListener("abort", () => controller.abort(input.signal!.reason), {
        once: true,
      })
    }
  }
  // Task-mode timeout fallback (design 06-20-agent-task-compression §2.6):
  // independent timeoutController + setTimeout, merged with the user-abort
  // controller into a composite signal. On timeout, throws TaskTimeoutError
  // (soft halt) so AssistantView can show a gentle prompt.
  const taskTimeoutMs = input.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(() => timeoutController.abort("task-timeout"), taskTimeoutMs)
  const compositeSignal = AbortSignal.any([controller.signal, timeoutController.signal])
  const workspaceTransaction = createRuntimeWorkspaceTransaction(workspaceFiles)
  const activeWorkspaceTransaction = workspaceTransaction
  const providerPresetMap = buildAgentProviderPresetMap(
    activeWorkspaceTransaction.workspaceFiles,
  )
  // 桌面助手专属:读 agent.json 的 modelId(用户从 header 二级下拉选的具体模型).
  // 有则用 resolveBrowserAiConfigForModel 覆盖 primary(不走预设策略);
  // 无则 fallback 到 resolveAgentModelConfig(预设策略,第一个 enabled).
  // runtime agent 不碰 modelId,继续走 resolveAgentModelConfig.
  const assistantAgentConfigFile = localAssistantFiles.find(
    (file) => file.path === ".tsian/local/assistant/agent.json",
  )
  let assistantModelId: string | undefined
  if (assistantAgentConfigFile) {
    try {
      const parsed = JSON.parse(assistantAgentConfigFile.content) as unknown
      if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).modelId === "string") {
        assistantModelId = (parsed as Record<string, unknown>).modelId as string
      }
    } catch {
      // 损坏的 agent.json 忽略 modelId,fallback 策略.
    }
  }
  const presetId = providerPresetMap.get(agentId)
  const assistantModelConfig = presetId && assistantModelId
    ? resolveBrowserAiConfigForModel(presetId, assistantModelId)
    : resolveAgentModelConfig(agentId, providerPresetMap)
  const localAssistantToolCallMode =
    assistantModelConfig?.toolCallMode
    ?? getBrowserAiConfig()?.toolCallMode
    ?? "text"

  // 读会话 agent 上下文快照(虚拟文件 sessions/<sessionId>/context.json,已在
  // localAssistantFiles 里加载,零额外 IO).无则从 history 兜底初始化(旧会话迁移).
  // 对称 master 的 readAgentContextFromWorkspace + createInitialAgentContext 兜底.
  const persistedAssistantContext = readAssistantContextFromFiles(
    localAssistantFiles,
    input.sessionId,
  )
  const assistantContext =
    persistedAssistantContext
    ?? createInitialAgentContext(input.sessionId, history, 1, {
        schema: ASSISTANT_CONTEXT_SCHEMA,
        agentId: ASSISTANT_CONTEXT_AGENT_ID,
      })
  // 从快照推算下一 turn 号(修复 fake snapshot turn 恒为 1 的缺陷),使
  // compressContext 的 lastCompressedTurn 去重正确工作.
  const nextAssistantTurn = nextAssistantTurnNumber(assistantContext)
  // resolve 助手 model contextWindow 预算(对称 master 的 contextTokenBudget 注入).
  const assistantContextTokenBudget = resolveTokenBudget(
    assistantModelConfig?.parameters.contextWindow ?? null,
  )

  // Trace collector:收集本轮 runtime 过程事件(turn/model/tool/context 等),
  // turn 结束序列化落盘到 .tsian/local/assistant/traces/(与 context.json 同通道,
  // 不进 save 事务).之前 emitTrace 是空函数,过程细节无处可查;现在有了持久出口,
  // 刷新/切换会话后仍可在 traces/ 回看,且不污染聊天历史(过程与结论分离).
  const traceCollector = createRuntimeTraceCollector(nextAssistantTurn)

  try {
    const result = await runAgentRuntimeTurn(
      {
        agentId,
        userInput: messageText,
        userInputAttachments,
        recentHistory: history,
        // 修正 turn 号:传 nextAssistantTurn - 1,使 currentRuntimeTurnNumber 返回 nextAssistantTurn
        // (之前恒传 turn:0 → 每轮 turn=1,破坏 lastCompressedTurn 去重).
        turn: nextAssistantTurn - 1,
        workspaceFiles: workspaceTransaction.workspaceFiles,
        signal: compositeSignal,
        // 注入持久化快照(任务摘要 + 最近 K 轮)+ token 预算(之前都不传,runtime
        // 兜底初始化且 contextUpdate 被丢弃 → 无跨 turn 持久化).对称 master 路径.
        agentContext: assistantContext,
        contextTokenBudget: assistantContextTokenBudget,
        // Assistant is a task-type agent (design §0): task compression mode
        // (multi-compress tool interactions + timeout fallback + stall early-exit),
        // distinct from master's narrative compression.
        compressionMode: "task",
        timeoutMs: taskTimeoutMs,
        onDelta: input.onDelta,
        // Desktop Assistant chat is in-process (not bridged), so round-end and
        // tool process events go straight to the view. The view uses round +
        // finishReason to classify thought vs final, and round to group tool
        // calls under their originating thought round. agentId is passed through
        // for signature uniformity (single-agent here).
        onRoundEnd: input.onRoundEnd,
        onTool: input.onTool
          ? (agentId, round, callId, name, status, output) => input.onTool!(agentId, round, callId, name, status, output)
          : undefined,
        // ask_user 工具回调：复用进程内 interaction-events 总线（与游戏 host 同源），
        // AssistantView 订阅 subscribeInteractionRequest 渲染 ask 卡片并回填答案。
        onAskUser: (requestId, request) =>
          emitInteractionRequest(requestId, request.question, request.options, request.allowCustom),
      },
      {
        callModel(messages, options) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          // Text-protocol streaming gate (mirrors callModelNative below).
          const streamingEnabled = agentConfig
            ? agentConfig.streaming
            : getBrowserAiConfig()?.streaming ?? false
          if (!options.onDelta || !streamingEnabled) {
            return generateAssistantReply(messages, {
              debugLabel: options.debugLabel,
              signal: options.signal,
              ...(agentConfig ? { config: agentConfig } : {}),
            })
          }
          return streamAssistantReplyText(messages, {
            debugLabel: options.debugLabel,
            signal: options.signal,
            round: options.round,
            ...(agentConfig ? { config: agentConfig } : {}),
            onDelta: options.onDelta
              ? (delta, round, kind) => options.onDelta!(options.agentId ?? "assistant", delta, round, kind)
              : undefined,
          })
        },
        async callModelNative(messages, options, tools) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          // Stream only when the caller wants deltas AND the model opted into
          // streaming. Both native and text modes support streaming; falls
          // back to the global config's flag when this agent has no preset.
          const streamingEnabled = agentConfig
            ? agentConfig.streaming
            : getBrowserAiConfig()?.streaming ?? false
          if (!options.onDelta || !streamingEnabled) {
            return generateAssistantReplyNative(messages as RuntimeChatMessage[], {
              debugLabel: options.debugLabel,
              signal: options.signal,
              tools,
              ...(agentConfig ? { config: agentConfig } : {}),
            })
          }
          return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
            debugLabel: options.debugLabel,
            signal: options.signal,
            tools,
            // ai.ts onDelta is (delta, round, kind); adapt the runtime's
            // (agentId, delta, round, kind) signature by binding this assistant's id.
            onDelta: options.onDelta
              ? (delta, round, kind) => options.onDelta!(agentId, delta, round, kind)
              : undefined,
            round: options.round,
            ...(agentConfig ? { config: agentConfig } : {}),
          })
        },
        toolCallMode: localAssistantToolCallMode,
        runInspectFrontend: createFrontendInspector(),
        runBrowserScript: createBrowserSkillScriptRunner({
          workspaceTransaction: activeWorkspaceTransaction,
          signal: controller.signal,
          emitTrace: traceCollector.emit,
        }),
        workspaceMutations: {
          write: (writeInput) => {
            // .tsian/local/assistant/* 是平台本地数据(不进存档/checkpoint/distribute),
            // 写入 bypass save 事务,直接落 Dexie(saveLocalAssistantFiles 合并模式).
            // 与资源管理器 executeLocalWorkspaceOperation 的 local 写入路径一致.
            // 不能用 writePlatformFile:assertPlatformSaveRuntimeMutationPath 经
            // isSaveRuntimePersistencePath 把 .tsian/local/ 排除( local-only 不进
            // save 持久化),会抛 WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED.
            // 权限层(level 4 ≥ editLevel 4)已放行,这里只补正确的落盘通道.
            if (writeInput.scope === "platform-meta" && isLocalAssistantPath(writeInput.path)) {
              const written: WorkspaceFile = {
                path: writeInput.path,
                content: typeof writeInput.content === "string" ? writeInput.content : "",
                ...(writeInput.data ? { binary: writeInput.data } : {}),
                createdAt: 0,
                updatedAt: Date.now(),
              }
              // saveLocalAssistantFiles 是 async 合并落盘,签名支持 Promise<WorkspaceFile>.
              return saveLocalAssistantFiles([written]).then(() => written)
            }
            if (writeInput.scope === "platform-meta") {
              return activeWorkspaceTransaction.writePlatformFile({
                path: writeInput.path,
                content: writeInput.content,
                ...(writeInput.data ? { data: writeInput.data } : {}),
              })
            }
            if (writeInput.scope === "card-content") {
              // Card content is not part of the save transaction (checkpoints
              // snapshot save-runtime only). The desktop assistant (level 4,
              // resolved via agentContext) has passed assertEditAccess already;
              // route the write straight to the per-file content table, bypassing
              // the save transaction which only accepts save/ paths. Runtime game
              // agents (default level 1) are blocked by assertEditAccess before
              // reaching here, so this branch is assistant-only in practice.
              return writeCardContentFileForActiveCard({
                path: writeInput.path,
                content: writeInput.content,
                ...(writeInput.data ? { data: writeInput.data } : {}),
              })
            }
            if (writeInput.scope === "save-runtime") {
              return activeWorkspaceTransaction.write({
                path: writeInput.path,
                content: writeInput.content,
                ...(writeInput.data ? { data: writeInput.data } : {}),
              })
            }
            if (writeInput.scope === "temp") {
              // temp write 落 Dexie(附件表)但绕过 save 事务,不会自动更新
              // transaction 的 stagedFiles 快照。回填返回的文件进 stagedFiles,
              // 让同回合后续 read/edit 立刻可见(save-runtime write 走 transaction.write
              // 会自动改 stagedFiles,temp 走 executeWorkspaceMutation 不会,这里补齐)。
              return (executeWorkspaceMutation({
                scope: "temp",
                path: writeInput.path,
                ...(typeof writeInput.content === "string" ? { content: writeInput.content } : {}),
                ...(writeInput.data ? { data: writeInput.data } : {}),
                ownerContext: { saveId: activeSaveId ?? undefined, cardId: activeCard.id, sessionId: input.sessionId },
                operation: "write",
              }) as Promise<WorkspaceFile>).then((file) => {
                syncTempFileIntoStaged(activeWorkspaceTransaction.workspaceFiles, file)
                return file
              })
            }
            throw new Error(`Assistant workspace write scope not supported: ${writeInput.scope}`)
          },
          delete: (deleteInput) => {
            // 同 write:.tsian/local/assistant/* 的删除 bypass 事务,直接 deleteLocalAssistantFile.
            if (deleteInput.scope === "platform-meta" && isLocalAssistantPath(deleteInput.path)) {
              return deleteLocalAssistantFile(deleteInput.path).then(() => ({
                scope: deleteInput.scope,
                deletedPaths: [deleteInput.path],
              }))
            }
            if (deleteInput.scope === "card-content") {
              // Same rationale as write: card content deletes bypass the save
              // transaction and go straight to the per-file content table.
              return deleteCardContentPathForActiveCard(deleteInput.path)
            }
            if (deleteInput.scope === "save-runtime") {
              return {
                scope: deleteInput.scope,
                ...activeWorkspaceTransaction.delete(deleteInput.path),
              }
            }
            if (deleteInput.scope === "temp") {
              // 同 write:temp delete 落 Dexie 但绕过事务,补一步从 stagedFiles
              // 移除已删条目,让同回合后续 read/edit 不再看到它们。
              return executeWorkspaceMutation({
                scope: "temp",
                path: deleteInput.path,
                ownerContext: { saveId: activeSaveId ?? undefined, cardId: activeCard.id, sessionId: input.sessionId },
                operation: "delete",
              }).then((paths) => {
                removeTempPathsFromStaged(activeWorkspaceTransaction.workspaceFiles, paths as string[])
                return {
                  scope: deleteInput.scope,
                  deletedPaths: paths as string[],
                }
              })
            }
            throw new Error(`Assistant workspace delete scope not supported: ${deleteInput.scope}`)
          },
        },
        emitTrace: traceCollector.emit,
      },
    )

    // ── 消息 + context 同步写(原子性保证)──
    // 顺序:先写会话消息,再写 agent context.消息写失败 → 抛错走 catch,
    // context 不写(避免"消息没存但 context 存了"的不一致).两者同在 try 尾部,
    // 替代之前前端 persistCurrentSession + host stageAssistantContextFile 两次
    // 独立 IO 的竞态风险.前端正常 turn 结束不再调 persistCurrentSession.
    //
    // 组装完整消息列表:history(不含本轮)+ 本轮 user(带 attachments)+ 本轮 assistant.
    // assistant 条带 toolCalls(UI 层:不压缩完整保留,挂消息上不占条数名额,随消息截到 200 条).
    const inputAttachments = input.attachments
    const turnToolCalls = result.contextUpdate?.toolCalls
    const turnTimelineItems = result.contextUpdate?.timelineItems
    const fullMessages: ConversationMessageRecord[] = [
      ...history,
      {
        role: "user",
        content,
        ...(inputAttachments && inputAttachments.length > 0 ? { attachments: inputAttachments } : {}),
      },
      {
        role: "assistant",
        content: result.replyText,
        ...(turnToolCalls && turnToolCalls.length > 0 ? { toolCalls: turnToolCalls } : {}),
        ...(turnTimelineItems && turnTimelineItems.length > 0 ? { timeline: turnTimelineItems } : {}),
      },
    ]
    await saveAssistantSessionMessages("local", input.sessionId, fullMessages, { touch: true })

    // 写回会话 context 快照(虚拟文件):本轮正文追加 + 压缩结果落盘.
    // 直接落本地篮子(saveLocalAssistantFiles),不进 save 事务——.tsian/local/
    // 是平台本地数据,不随存档 checkpoint/distribute.对称 master 的 stageAgentContextFile
    // (master 走 save 事务因 agents/master/context.json 属 save/).turn 失败走 catch
    // discard(事务),且不调本函数 → context 不写回.
    // toolCalls 写入 agent 层 context.json(recentTurns assistant entry,跟正文同寿命压缩).
    const assistantContextUpdate = result.contextUpdate
    if (assistantContextUpdate) {
      await stageAssistantContextFile({
        sessionId: input.sessionId,
        turn: assistantContextUpdate.turn,
        user: assistantContextUpdate.user,
        assistant: assistantContextUpdate.assistant,
        compressedContext: assistantContextUpdate.compressedContext,
        fallbackContext: assistantContext,
        ...(turnToolCalls && turnToolCalls.length > 0 ? { toolCalls: turnToolCalls } : {}),
      })
    }

    // Commit workspace changes (no checkpoint, no turn increment).
    const finalFiles = activeWorkspaceTransaction.finalWorkspaceFiles()
    await commitAssistantWorkspaceFiles(activeSaveId, finalFiles)

    return {
      replyText: result.replyText,
      ...(result.usage ? { usage: result.usage } : {}),
    }
  } catch (error) {
    activeWorkspaceTransaction.discard()
    // 清理 ask_user 等待表：turn 失败/abort/timeout 时若有挂起的 interaction-request，
    // 必须 reject 防止 Promise 悬空（镜像游戏 host index.ts 的 rejectAllInteractionRequests）。
    rejectAllInteractionRequests(error)
    // 记录失败 trace 事件(若 runtime 未自己发 turn_failed),让 traces/ 里能看到失败原因.
    traceCollector.emit({
      type: "turn_failed",
      ok: false,
      debugLabel: "entry-agent",
      data: errorToTraceDataWithStack(error),
    })
    // Distinguish task-timeout abort from user abort / other errors: the runtime
    // tool loop throws AbortError on composite-signal abort; re-surface timeout
    // as TaskTimeoutError so AssistantView can show a gentle prompt (design §2.6).
    if (timeoutController.signal.aborted && !(error instanceof TaskTimeoutError)) {
      throw new TaskTimeoutError(taskTimeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timeoutTimer)
    // 落盘 trace:成功/失败都写,失败路径含 turn_failed 事件.
    // 走 saveLocalAssistantFiles 直写 Dexie(与 context.json 同通道,不进 save 事务).
    // 失败时文件名带 -failed-<ts> 后缀(assistantTracePath 对称 master 的 formatRuntimeTracePath).
    const tracePath = assistantTracePath(nextAssistantTurn)
    try {
      await saveLocalAssistantFiles([{
        path: tracePath,
        content: serializeRuntimeTraceEvents(traceCollector.events),
        createdAt: 0,
        updatedAt: Date.now(),
      }])
    } catch {
      // trace 落盘失败不影响主流程(诊断数据,非关键路径).
    }
  }
}

async function commitAssistantWorkspaceFiles(
  saveId: string | null,
  files: WorkspaceFile[],
): Promise<void> {
  // Persist local assistant files (.tsian/local/assistant/*) to the Dexie
  // meta store so they survive card switches independent of save state.
  // 排除"直写管辖"的助手运行时文件(会话 context 快照):
  // 它由 stageAssistantContextFile 绕过事务直写 Dexie,事务 baseline 里仍是 turn
  // 开头的旧版本,若在此回写会覆盖直写的新版本(clobber:每轮 context.json 被还原成
  // turn 开头值 → 跨轮失忆).
  const localAssistantFiles = files.filter(
    (file) => isLocalAssistantPath(file.path) && !isAssistantDirectWritePath(file.path),
  )
  if (localAssistantFiles.length > 0) {
    await saveLocalAssistantFiles(localAssistantFiles)
  }

  // Filter out local assistant files from save/card persistence.
  const nonLocalFiles = files.filter((file) => !isLocalAssistantPath(file.path))

  if (!saveId) {
    // No active save: persist card-content changes back to the card.
    const activeCard = await getPlatformActiveGameCard()
    if (!activeCard) {
      return
    }
    const cardFiles = nonLocalFiles.filter(
      (file) => !file.path.startsWith("save/") && !file.path.startsWith(".tsian/"),
    )
    await updateCardContentFilesForCard(activeCard.id, cardFiles)
    return
  }

  // Active save: persist save-runtime and platform-meta files (excluding local assistant).
  const saveRuntimeFiles = nonLocalFiles
    .filter((file) => file.path.startsWith("save/") || file.path.startsWith(".tsian/"))
    .map((file) => ({
      path: file.path,
      content: file.content,
      ...(file.binary ? { data: file.binary } : {}),
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }))
  if (saveRuntimeFiles.length > 0) {
    await replaceWorkspaceFilesForSave(saveId, saveRuntimeFiles)
  }

  // Also persist card-content changes (from knowledge mount writes).
  const cardFiles = nonLocalFiles.filter(
    (file) => !file.path.startsWith("save/") && !file.path.startsWith(".tsian/"),
  )
  if (cardFiles.length > 0) {
    const activeCard = await getPlatformActiveGameCard()
    if (activeCard) {
      await updateCardContentFilesForCard(activeCard.id, cardFiles)
    }
  }
}

async function updateCardContentFilesForCard(
  cardId: string,
  files: WorkspaceFile[],
): Promise<void> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    return
  }
  // Merge semantics: per-file upsert only the files this turn touched.
  // Files not in `files` are left untouched (preserves the prior merge behavior
  // where the caller passes only the changed non-save/non-.tsian files).
  // Each write bumps the card's updatedAt internally.
  for (const file of files) {
    await writeLocalGameCardContentFile(cardId, {
      path: file.path,
      content: file.content,
      ...(file.binary ? { data: file.binary } : {}),
    })
  }
}
