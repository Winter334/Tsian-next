import type {
  AgentContextSnapshot,
  ConversationMessageRecord,
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
  deleteLocalAssistantFile,
  isAssistantDirectWritePath,
  isLocalAssistantPath,
  loadLocalAssistantFiles,
  saveLocalAssistantFiles,
  LOCAL_ASSISTANT_AGENT_ID,
} from "../storage"
import {
  createRuntimeWorkspaceTransaction,
  replaceWorkspaceFilesForSave,
  writeLocalGameCardContentFile,
  type RuntimeWorkspaceTransaction,
} from "../storage"
import {
  generateAssistantReply,
  generateAssistantReplyNative,
  streamAssistantReplyNative,
  type RuntimeChatMessage,
} from "../runtime-host/ai"
import { getBrowserAiConfig } from "../config/ai"
import { createBrowserSkillScriptRunner } from "./browser-skill-script-executor"
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
} from "../storage"

// ── 助手会话 context 读写（B 类 helper，只被 runAssistantChat 调用，随接缝一起迁） ──

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
  // 追加本轮正文(保持最近 K 轮),saveId 用 sessionId(语义复用)
  const updated = appendTurnToContext(
    { ...base, saveId: input.sessionId },
    input.turn,
    input.user,
    input.assistant,
  )
  const file: WorkspaceFile = {
    path: assistantContextPath(input.sessionId),
    content: serializeAgentContext(updated),
    mediaType: "application/json",
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
    output?: string,
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
  const assistantModelConfig = resolveAgentModelConfig(agentId, providerPresetMap)
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

  try {
    const result = await runAgentRuntimeTurn(
      {
        agentId,
        userInput: content,
        recentHistory: history,
        // 修正 turn 号:从快照推算,使 currentRuntimeTurnNumber 返回 nextAssistantTurn
        // (之前恒传 turn:0 → 每轮 turn=1,破坏 lastCompressedTurn 去重).
        snapshot: {
          version: "tsian.runtime.snapshot.v1",
          state: { turn: nextAssistantTurn - 1, messages: [] },
        },
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
      },
      {
        callModel(messages, options) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          return generateAssistantReply(messages, {
            debugLabel: options.debugLabel,
            signal: options.signal,
            ...(agentConfig ? { config: agentConfig } : {}),
          })
        },
        async callModelNative(messages, options, tools) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          // Stream only when the caller wants deltas AND the model opted into
          // streaming (text-protocol models force false). Falls back to the
          // global config's flag when this agent has no preset mapping.
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
        runBrowserScript: createBrowserSkillScriptRunner({
          workspaceTransaction: activeWorkspaceTransaction,
          signal: controller.signal,
          emitTrace: () => {},
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
                content: writeInput.content,
                mediaType: writeInput.mediaType ?? "text/plain",
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
                mediaType: writeInput.mediaType,
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
                mediaType: writeInput.mediaType,
              })
            }
            if (writeInput.scope === "save-runtime") {
              return activeWorkspaceTransaction.write({
                path: writeInput.path,
                content: writeInput.content,
                mediaType: writeInput.mediaType,
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
            throw new Error(`Assistant workspace delete scope not supported: ${deleteInput.scope}`)
          },
        },
        emitTrace: () => {},
      },
    )

    // 写回会话 context 快照(虚拟文件):本轮正文追加 + 压缩结果落盘.
    // 直接落本地篮子(saveLocalAssistantFiles),不进 save 事务——.tsian/local/
    // 是平台本地数据,不随存档 checkpoint/distribute.对称 master 的 stageAgentContextFile
    // (master 走 save 事务因 agents/master/context.json 属 save/).turn 失败走 catch
    // discard(事务),且不调本函数 → context 不写回.
    const assistantContextUpdate = result.contextUpdate
    if (assistantContextUpdate) {
      await stageAssistantContextFile({
        sessionId: input.sessionId,
        turn: assistantContextUpdate.turn,
        user: assistantContextUpdate.user,
        assistant: assistantContextUpdate.assistant,
        compressedContext: assistantContextUpdate.compressedContext,
        fallbackContext: assistantContext,
      })
    }

    // Commit workspace changes (no checkpoint, no turn increment).
    const finalFiles = activeWorkspaceTransaction.finalWorkspaceFiles()
    await commitAssistantWorkspaceFiles(activeSaveId, finalFiles)

    return { replyText: result.replyText }
  } catch (error) {
    activeWorkspaceTransaction.discard()
    // Distinguish task-timeout abort from user abort / other errors: the runtime
    // tool loop throws AbortError on composite-signal abort; re-surface timeout
    // as TaskTimeoutError so AssistantView can show a gentle prompt (design §2.6).
    if (timeoutController.signal.aborted && !(error instanceof TaskTimeoutError)) {
      throw new TaskTimeoutError(taskTimeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timeoutTimer)
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
      mediaType: file.mediaType,
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
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    })
  }
}
