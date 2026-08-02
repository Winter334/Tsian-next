import type {
  AssistantTurnTimelineItem,
  ConversationMessageRecord,
  PlayFrontendBridge,
  TurnStats,
  TurnTimelineItem,
} from "@tsian/contracts"
import { createGameRuntimeEnvironment, runAgentRuntimeTurn } from "../agent-runtime"
import { resolveTokenBudget } from "../agent-runtime/context-lifecycle"
import { enqueueStaleEmbeddings } from "../agent-runtime/semantic-index/staleness"
import {
  createRuntimeTraceCollector,
  errorToTraceDataWithStack,
} from "../agent-runtime/trace"
import {
  DEFAULT_BROWSER_AI_STREAMING,
  DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
  getBrowserAiConfig,
  resolveEmbeddingConfig,
} from "../config/ai"
import { emitTurnDebugReady } from "../debug-events"
import { emitInteractionRequest, rejectAllInteractionRequests } from "../interaction-events"
import {
  generateAssistantReply,
  generateAssistantReplyNative,
  streamAssistantReplyNative,
  streamAssistantReplyText,
  type RuntimeChatMessage,
} from "../runtime-host/ai"
import { createAiTraceOperationContext } from "../runtime-host/ai/trace-context"
import { emitTurnDelta, emitTurnRoundEnd, emitTurnStats, emitTurnTool } from "../streaming-events"
import {
  commitSuccessfulRuntimeTurnForSave,
  createRuntimeWorkspaceTransaction,
  getHistoryForSave,
  type RuntimeWorkspaceTransaction,
} from "../storage"
import { createBrowserScriptRunners } from "./browser-skill-script-executor"
import { scheduleAutoBackupForSave } from "./cloud-backups"
import { ensureActiveSave } from "./game-cards"
import {
  getMaxTurnFromTurnFiles,
  readAgentContextFromWorkspace,
  stageAgentContextFile,
  stageRawAirpHistoryTurnFile,
} from "./history-turns"
import {
  buildAgentProviderPresetMap,
  listEffectiveWorkspaceFilesForActiveSave,
  normalizeMessageContent,
  resolveAgentModelConfig,
} from "./internal"
import { resolvePlayerTurnAgentIdForSave } from "./runtime-entrypoints"
import { finishReasonToKind } from "./runtime-events"
import { createTurnTimelineCollector } from "./turn-timeline-collector"
import { projectAssistantReply } from "./reply-projection"

type SendMessageInput = Parameters<PlayFrontendBridge["interaction"]["sendMessage"]>[0]
type SendMessageResult = Awaited<ReturnType<PlayFrontendBridge["interaction"]["sendMessage"]>>

let previousTurnController: AbortController | null = null

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const content = normalizeMessageContent(input.content)
  if (!content) {
    throw new Error("interaction.sendMessage requires non-empty content.")
  }

  const activeSaveId = await ensureActiveSave()
  const playerTurnAgentId = await resolvePlayerTurnAgentIdForSave(activeSaveId)
  const workspaceFilesBefore = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
  const maxTurn = getMaxTurnFromTurnFiles(workspaceFilesBefore)
  const historyBefore = await getHistoryForSave(activeSaveId)
  const nextTurn = maxTurn + 1
  const traceContext = createAiTraceOperationContext()
  const trace = createRuntimeTraceCollector(nextTurn)
  trace.emit({
    type: "turn_started",
    ok: true,
    data: {
      userInputLength: content.length,
      historyCount: historyBefore.length,
    },
  })
  let workspaceTransaction: RuntimeWorkspaceTransaction | null = null

  if (previousTurnController) {
    previousTurnController.abort("new-turn-started")
    // Reject any pending ask_user requests from the previous turn.
    rejectAllInteractionRequests(new DOMException("Agent Runtime turn aborted.", "AbortError"))
  }
  const currentController = new AbortController()
  previousTurnController = currentController

  try {
    workspaceTransaction = createRuntimeWorkspaceTransaction(
      await listEffectiveWorkspaceFilesForActiveSave(activeSaveId),
    )
    const activeWorkspaceTransaction = workspaceTransaction
    const providerPresetMap = buildAgentProviderPresetMap(
      activeWorkspaceTransaction.workspaceFiles,
    )
    // 读玩家回合入口 agent 会话上下文快照注入（无则由 runtime 层兜底初始化）。
    const agentContext = readAgentContextFromWorkspace(
      activeWorkspaceTransaction.workspaceFiles,
      activeSaveId,
      playerTurnAgentId,
    )
    // 按玩家回合入口 agent 的模型配置解析上下文 token 预算。
    const playerTurnConfig = resolveAgentModelConfig(playerTurnAgentId, providerPresetMap)
    const contextTokenBudget = resolveTokenBudget(
      playerTurnConfig?.parameters.common.contextWindow ?? null,
    )
    // 过程节点累积器:从事件流累积 thought/tool/interim,turn 收尾写入 turn 文件.
    // 与前端 turnProcessLog 用同一份事件数据,节点带 agentId 区分 delegated agent.
    const timelineCollector = createTurnTimelineCollector()
    const browserScriptRunners = createBrowserScriptRunners({
      workspaceTransaction: activeWorkspaceTransaction,
      signal: currentController.signal,
      emitTrace: trace.emit,
    })
    const result = await runAgentRuntimeTurn(
      {
        agentId: playerTurnAgentId,
        userInput: content,
        injection: input.injection,
        recentHistory: historyBefore,
        turn: maxTurn,
        signal: currentController.signal,
        traceContext,
      },
      createGameRuntimeEnvironment({
        model: {
        callText(messages, options) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          // Text-protocol streaming: stream when the caller wants deltas
          // AND the model opted into streaming. Falls back to one-shot
          // generateAssistantReply otherwise. Mirrors the native gate in
          // callModelNative below.
          const streamingEnabled = agentConfig
            ? agentConfig.streaming
            : getBrowserAiConfig()?.streaming ?? DEFAULT_BROWSER_AI_STREAMING
          if (!options.onDelta || !streamingEnabled) {
            return generateAssistantReply(messages, {
              debugLabel: options.debugLabel,
              signal: options.signal,
              traceContext: options.traceContext,
              ...(agentConfig ? { config: agentConfig } : {}),
            })
          }
          return streamAssistantReplyText(messages, {
            debugLabel: options.debugLabel,
            signal: options.signal,
            traceContext: options.traceContext,
            round: options.round,
            ...(agentConfig ? { config: agentConfig } : {}),
            onDelta: options.onDelta
              ? (delta, round, kind) => options.onDelta!(options.agentId ?? playerTurnAgentId, delta, round, kind)
              : undefined,
          })
        },
        async callNative(messages, options, tools) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          // Stream only when the caller wants deltas AND the model opted into
          // streaming. Both native and text modes support streaming; falls
          // back to the global config's flag when this agent has no preset.
          const streamingEnabled = agentConfig
            ? agentConfig.streaming
            : getBrowserAiConfig()?.streaming ?? DEFAULT_BROWSER_AI_STREAMING
          if (!options.onDelta || !streamingEnabled) {
            return generateAssistantReplyNative(messages as RuntimeChatMessage[], {
              debugLabel: options.debugLabel,
              signal: options.signal,
              traceContext: options.traceContext,
              tools,
              ...(agentConfig ? { config: agentConfig } : {}),
            })
          }
          return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
            debugLabel: options.debugLabel,
            signal: options.signal,
            traceContext: options.traceContext,
            tools,
            // ai.ts onDelta is (delta, round, kind); adapt the runtime's
            // (agentId, delta, round, kind) signature by binding options.agentId
            // (the current entry agent id or a delegated target id).
            onDelta: options.onDelta
              ? (delta, round, kind) => options.onDelta!(options.agentId ?? playerTurnAgentId, delta, round, kind)
              : undefined,
            round: options.round,
            ...(agentConfig ? { config: agentConfig } : {}),
          })
        },
        toolCallMode: playerTurnConfig?.toolCallMode
          ?? getBrowserAiConfig()?.toolCallMode
          ?? DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
        },
        controlledTools: {
          browserScript: browserScriptRunners.runBrowserScript,
          testSkillScript: browserScriptRunners.runTestSkillScript,
        },
        workspace: {
        files: workspaceTransaction.workspaceFiles,
        semanticSearchOwnerId: activeSaveId,
        mutations: {
          write: (writeInput) => {
            if (writeInput.scope === "platform-meta") {
              return activeWorkspaceTransaction.writePlatformFile({
                path: writeInput.path,
                content: writeInput.content,
                ...(writeInput.data ? { data: writeInput.data } : {}),
              })
            }
            if (writeInput.scope !== "save-runtime") {
              throw new Error("Runtime Agent turns can only stage save-runtime workspace writes.")
            }
            return activeWorkspaceTransaction.write({
              path: writeInput.path,
              content: writeInput.content,
              ...(writeInput.data ? { data: writeInput.data } : {}),
            })
          },
          delete: (deleteInput) => {
            if (deleteInput.scope !== "save-runtime") {
              throw new Error("Runtime Agent turns can only stage save-runtime workspace deletes.")
            }
            return {
              scope: deleteInput.scope,
              ...activeWorkspaceTransaction.delete(deleteInput.path),
            }
          },
        },
        },
        context: {
          snapshot: agentContext ?? undefined,
          compressionMode: "narrative",
          contextCapacityTokens: contextTokenBudget,
          requestInputBudgetTokens: Math.floor(contextTokenBudget * 0.85),
          observationCharBudget: 32 * 1024,
        },
        events: {
          onDelta: (agentId, delta, round, kind) => {
            emitTurnDelta(agentId, delta, nextTurn, round, kind)
            timelineCollector.onDelta(agentId, delta, round, kind)
          },
          onRoundEnd: (agentId, round, finishReason) => {
            emitTurnRoundEnd(agentId, nextTurn, round, finishReasonToKind(finishReason))
            timelineCollector.onRoundEnd(agentId, round, finishReason)
          },
          onTool: (agentId, round, callId, name, status, presentation, displayName) => {
            emitTurnTool(agentId, nextTurn, round, callId, name, status, presentation, displayName)
            timelineCollector.onTool(agentId, round, callId, name, status, presentation, displayName)
          },
          onAskUser: (requestId, request) =>
            emitInteractionRequest(requestId, request.question, request.options, request.allowCustom),
        },
        audit: trace.emit,
      }),
    )

    if (currentController.signal.aborted) {
      throw new DOMException("Agent Runtime turn was aborted.", "AbortError")
    }

    const replyText = result.replyText

    // 本轮 token usage（来自 runtime 最后一轮 model call）。
    // 耗时由前端自己计时（setInterval），不在此处记录。
    const usage = result.usage
    const turnStats: TurnStats | undefined = usage
      ? {
          ...(usage.input !== undefined ? { inputTokens: usage.input } : {}),
          ...(usage.output !== undefined ? { outputTokens: usage.output } : {}),
          ...(usage.total !== undefined ? { totalTokens: usage.total } : {}),
        }
      : undefined

    const projectedReply = projectAssistantReply(
      replyText,
      activeWorkspaceTransaction.workspaceFiles,
    )
    for (const diagnostic of projectedReply.diagnostics) {
      trace.emit({
        type: diagnostic.scope === "config"
          ? "reply_projection_config_failed"
          : "reply_projection_rule_failed",
        ok: false,
        data: {
          code: diagnostic.code,
          message: diagnostic.message,
          path: diagnostic.path ?? "",
          ruleId: diagnostic.ruleId ?? "",
          ruleIndex: diagnostic.ruleIndex ?? -1,
        },
      })
    }
    trace.emit({
      type: "reply_projection_completed",
      ok: true,
      data: {
        configPresent: projectedReply.configPresent,
        ruleCount: projectedReply.ruleCount,
        appliedRuleCount: projectedReply.appliedRuleCount,
        diagnosticCount: projectedReply.diagnostics.length,
        rawContentLength: replyText.length,
        contentLength: projectedReply.content.length,
        displayContentLength: projectedReply.displayContent?.length ?? null,
        projectionKeys: Object.keys(projectedReply.projections ?? {}).sort(),
      },
    })
    const assistantItem: AssistantTurnTimelineItem = {
      kind: "assistant",
      content: projectedReply.content,
      ...(projectedReply.displayContent !== undefined ? { displayContent: projectedReply.displayContent } : {}),
      ...(projectedReply.projections ? { projections: projectedReply.projections } : {}),
      ...(turnStats ? { stats: turnStats } : {}),
    }

    const nextHistory: ConversationMessageRecord[] = [
      ...historyBefore,
      { role: "user", content },
      { role: "assistant", content: assistantItem.content },
    ]

    // 拼 turn 完整 timeline: user → process items(interim/thought/tool) → projected assistant(带 stats)。
    // 单一有序数组,顺序即发生顺序,替代旧的 messages + processNodes + stats 分裂结构。
    // 投影规则由工作区 config/reply-projection.json 声明；platform-host 只保存通用
    // content/displayContent/projections，不理解玩法语义（如 choices）。
    const turnTimeline: TurnTimelineItem[] = [
      { kind: "user", content },
      ...timelineCollector.getTimelineItems(),
      assistantItem,
    ]

    stageRawAirpHistoryTurnFile(workspaceTransaction, {
      turn: nextTurn,
      entryAgentId: playerTurnAgentId,
      timeline: turnTimeline,
    })
    // 通知前端 token 消耗（耗时由前端自己计时，不在此 emit）。
    if (turnStats) emitTurnStats(nextTurn, turnStats)
    // R4:写回玩家回合入口 agent 会话上下文快照（本轮正文追加 + 压缩结果落盘）。
    const contextUpdate = result.contextUpdate
    if (contextUpdate) {
      const stagedContext = stageAgentContextFile(workspaceTransaction, {
        saveId: activeSaveId,
        turn: contextUpdate.turn,
        user: contextUpdate.user,
        assistant: assistantItem.content,
        compressedContext: contextUpdate.compressedContext,
        agentId: playerTurnAgentId,
      })
      trace.emit({
        type: "agent_context_staged",
        ok: true,
        data: {
          turn: contextUpdate.turn,
          path: stagedContext.path,
          summaryPresent: !!contextUpdate.compressedContext?.summary,
        },
      })
    }

    trace.emit({
      type: "turn_completed",
      ok: true,
      data: {
        replyLength: assistantItem.content.length,
        historyCount: nextHistory.length,
      },
    })
    await commitSuccessfulRuntimeTurnForSave(activeSaveId, {
      history: nextHistory,
      workspaceFiles: workspaceTransaction.finalWorkspaceFiles(),
      reason: "after-turn",
    })

    scheduleAutoBackupForSave(activeSaveId)

    // Proactive embed enqueue:turn commit 是 play-time 真实写瓶颈(raw turn +
    // maintenance 都 staged → 经此 commit),落库后对当轮 save-runtime 文件做
    // staleness 检查 + 异步入队,让索引每轮后自动追新,不等下次搜索才补.
    // fire-and-forget:turn 已落盘完成,enqueue 失败不阻塞,staleness 兜底兜得住.
    if (resolveEmbeddingConfig()) {
      const saveRuntimeFiles = workspaceTransaction
        .finalWorkspaceFiles()
        .filter((file) => file.path.startsWith("save/"))
      void enqueueStaleEmbeddings(activeSaveId, saveRuntimeFiles)
    }

    emitTurnDebugReady(nextTurn)
    return { turn: nextTurn, assistant: assistantItem }
  } catch (error) {
    workspaceTransaction?.discard()
    // Reject any pending ask_user requests when the turn fails.
    rejectAllInteractionRequests(error)
    trace.emit({
      type: "turn_failed",
      ok: false,
      data: errorToTraceDataWithStack(error),
    })
    throw error
  } finally {
    if (previousTurnController === currentController) {
      previousTurnController = null
    }
  }
}

export async function stopRuntimeTurn(): Promise<void> {
  if (previousTurnController) {
    previousTurnController.abort("user-stopped")
    rejectAllInteractionRequests(new DOMException("Agent Runtime turn aborted by user.", "AbortError"))
  }
}
