import type {
  InvokeAgentRequest,
  InvokeAgentResult,
  JsonValue,
  PlatformActionError,
  WorkspaceFile,
} from "@tsian/contracts"
import { runAgentRuntimeTurn } from "../agent-runtime"
import { assembleAgentContext } from "../agent-runtime/context"
import {
  DEFAULT_TASK_INACTIVITY_TIMEOUT_MS,
  resolveTokenBudget,
} from "../agent-runtime/context-lifecycle"
import {
  createRuntimeTraceCollector,
  errorToTraceDataWithStack,
} from "../agent-runtime/trace"
import {
  DEFAULT_BROWSER_AI_STREAMING,
  DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
  getBrowserAiConfig,
} from "../config/ai"
import { emitInteractionRequest, rejectAllInteractionRequests } from "../interaction-events"
import {
  generateAssistantReply,
  generateAssistantReplyNative,
  streamAssistantReplyNative,
  streamAssistantReplyText,
  type RuntimeChatMessage,
} from "../runtime-host/ai"
import { createAiTraceOperationContext } from "../runtime-host/ai/trace-context"
import { emitAgentInvocation } from "../streaming-events"
import {
  commitWorkspaceChangesForSave,
  commitWorkspaceChangesWithOptionalCheckpointForSave,
  createRuntimeWorkspaceTransaction,
  getHistoryForSave,
  type RuntimeWorkspaceTransaction,
  type WorkspaceCommitCheckpointOption,
} from "../storage"
import { createBrowserScriptRunners } from "./browser-skill-script-executor"
import { ensureActiveSave } from "./game-cards"
import {
  getMaxTurnFromTurnFiles,
  readAgentContextFromWorkspace,
  stageAgentContextFile,
} from "./history-turns"
import {
  buildAgentProviderPresetMap,
  isRecord,
  listEffectiveWorkspaceFilesForActiveSave,
  resolveAgentModelConfig,
} from "./internal"
import { finishReasonToKind } from "./runtime-events"
import { cleanupScenesInTransaction } from "./scene-cleanup"
import { projectAssistantReply } from "./reply-projection"

/** 旁路调用排队锁：同一 agentId + slot 串行执行，避免 context.json 读写竞争。
 *  key = `${agentId}:${slot ?? "default"}`，value = 当前正在执行的 Promise。
 *  不同 agent 或不同 slot 可真并行。条目在执行完成后自动清理。 */
const invokeAgentQueue = new Map<string, Promise<unknown>>()

function createInvocationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return `invoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (isRecord(value)) return Object.values(value).every(isJsonValue)
  return false
}

function platformErrorFromUnknown(error: unknown, fallbackCode = "AGENT_INVOCATION_FAILED"): PlatformActionError {
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    const details = isRecord(error.details)
      ? Object.fromEntries(
          Object.entries(error.details).filter((entry): entry is [string, JsonValue] =>
            isJsonValue(entry[1]),
          ),
        )
      : undefined
    return {
      code: error.code,
      message: error.message,
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    }
  }

  return {
    code: error instanceof DOMException ? error.name : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  }
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  const normalized = Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)))
  return normalized.length > 0 ? normalized : undefined
}

function normalizeInvokeAgentCheckpointOption(input: InvokeAgentRequest): WorkspaceCommitCheckpointOption {
  const legacyCheckpointRequested = input.commitMode === "workspace-with-checkpoint"
  const hasExplicitCheckpoint = input.checkpoint !== undefined

  if (input.commitMode !== undefined && input.commitMode !== "workspace" && input.commitMode !== "workspace-with-checkpoint") {
    throw new Error('interaction.invokeAgent commitMode must be "workspace" or "workspace-with-checkpoint" when provided.')
  }

  if (input.commitMode === "workspace" && input.checkpointReason !== undefined) {
    throw new Error("interaction.invokeAgent checkpointReason requires commitMode workspace-with-checkpoint or checkpoint option.")
  }

  if (hasExplicitCheckpoint && legacyCheckpointRequested) {
    throw new Error("interaction.invokeAgent cannot combine checkpoint with legacy commitMode workspace-with-checkpoint.")
  }

  if (!hasExplicitCheckpoint) {
    if (!legacyCheckpointRequested) {
      return false
    }
    if (
      input.checkpointReason !== undefined
      && input.checkpointReason !== "post-turn-maintenance"
    ) {
      throw new Error(
        'interaction.invokeAgent checkpointReason must be "post-turn-maintenance" for legacy workspace-with-checkpoint.',
      )
    }
    return { mode: "current-turn-auto" }
  }

  const checkpoint = input.checkpoint
  if (checkpoint === false) {
    if (input.checkpointReason !== undefined) {
      throw new Error("interaction.invokeAgent checkpointReason is not valid when checkpoint is false.")
    }
    return false
  }
  if (checkpoint === true) {
    if (input.checkpointReason !== undefined) {
      throw new Error("interaction.invokeAgent checkpointReason is not valid when checkpoint is true.")
    }
    return { mode: "create" }
  }
  if (typeof checkpoint !== "object" || checkpoint === null || Array.isArray(checkpoint)) {
    throw new Error("interaction.invokeAgent checkpoint must be a boolean or object when provided.")
  }

  if (checkpoint.mode === "overwrite") {
    if (typeof checkpoint.checkpointId !== "string" || !checkpoint.checkpointId.trim()) {
      throw new Error("interaction.invokeAgent checkpoint overwrite requires checkpointId.")
    }
    return {
      ...checkpoint,
      mode: "overwrite",
      checkpointId: checkpoint.checkpointId.trim(),
      ...(checkpoint.tags ? { tags: normalizeTags(checkpoint.tags) } : {}),
    }
  }

  if (checkpoint.mode === "current-turn-auto") {
    return {
      mode: "current-turn-auto",
      ...(checkpoint.label?.trim() ? { label: checkpoint.label.trim() } : {}),
      ...(checkpoint.tags ? { tags: normalizeTags(checkpoint.tags) } : {}),
      ...(checkpoint.metadata ? { metadata: checkpoint.metadata } : {}),
    }
  }

  if (checkpoint.mode === undefined || checkpoint.mode === "create") {
    return {
      ...checkpoint,
      mode: "create",
      ...(checkpoint.label?.trim() ? { label: checkpoint.label.trim() } : {}),
      ...(checkpoint.tags ? { tags: normalizeTags(checkpoint.tags) } : {}),
    }
  }

  throw new Error('interaction.invokeAgent checkpoint.mode must be "create", "overwrite", or "current-turn-auto".')
}

export async function invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult> {
  const agentId = input.agentId.trim()
  if (!agentId) {
    throw new Error("interaction.invokeAgent requires a non-empty agentId.")
  }
  const userInput = input.input
  if (!userInput) {
    throw new Error("interaction.invokeAgent requires non-empty input.")
  }
  const invocationId = input.invocationId?.trim() || createInvocationId()
  const purpose = input.purpose?.trim() || undefined
  const checkpointOption = normalizeInvokeAgentCheckpointOption(input)

  const slot = input.contextSlot
  const shouldPersist = input.persist === true
  const queueKey = `${agentId}:${slot ?? "default"}`

  // 同 slot 串行排队：前一个完成（成功/失败）后后一个才开始执行，
  // 确保 context.json 读写不竞争。不同 slot 或不同 agent 可真并行。
  const previous = invokeAgentQueue.get(queueKey) ?? Promise.resolve()
  const currentPromise = previous
    .catch(() => {})
    .then(() => executeInvokeAgentBody())
  invokeAgentQueue.set(queueKey, currentPromise)
  currentPromise.finally(() => {
    if (invokeAgentQueue.get(queueKey) === currentPromise) {
      invokeAgentQueue.delete(queueKey)
    }
  })
  return currentPromise as Promise<InvokeAgentResult>

  // ── 旁路调用实际执行体（闭包，捕获上方所有变量）──
  // invokeAgent 是旁路调用:不推进 turn、不写历史.
  // 结果直接返回调用方(游戏前端自行处理 NPC 视角/UI 修正等).
  async function executeInvokeAgentBody(): Promise<InvokeAgentResult> {
    const invokeController = new AbortController()
    const traceContext = createAiTraceOperationContext()
    // 旁路调用 trace collector：独立路径落盘，不与主 turn trace 混淆。
    // 让系统监视器(DebugView)也能看到旁路调用的 runtime 事件。
    let trace = createRuntimeTraceCollector(0)
    let workspaceTransaction: RuntimeWorkspaceTransaction | null = null
    emitAgentInvocation({
      type: "started",
      invocationId,
      agentId,
      ...(purpose ? { purpose } : {}),
    })
    try {
      const currentActiveSaveId = await ensureActiveSave()
      const invokeWorkspaceFilesBefore = await listEffectiveWorkspaceFilesForActiveSave(currentActiveSaveId)
      const invokeMaxTurn = getMaxTurnFromTurnFiles(invokeWorkspaceFilesBefore)
      const historyBefore = await getHistoryForSave(currentActiveSaveId)
      trace = createRuntimeTraceCollector(invokeMaxTurn)
      trace.emit({
        type: "turn_started",
        ok: true,
        data: { agentId, inputLength: input.input.length, historyCount: historyBefore.length },
      })
      workspaceTransaction = createRuntimeWorkspaceTransaction(
        await listEffectiveWorkspaceFilesForActiveSave(currentActiveSaveId),
      )
      const workspaceFiles = workspaceTransaction!.workspaceFiles
      const providerPresetMap = buildAgentProviderPresetMap(workspaceFiles)

      // 装配目标 agent context,检查 agent 存在.
      const targetContext = assembleAgentContext(workspaceFiles, {
        agentId,
        workspaceTrustBoundary: "runtime-game-agent",
      })
      if (!targetContext) {
        throw new Error(
          `Agent "${agentId}" was not found. Restore agents/${agentId}/AGENT.md or recreate the agent.`,
        )
      }

      // 持久化由 persist 参数控制(默认 false,不读 entryMode)。
      // persist:true → 读写 context-<slot>.json;persist:false → 不读不写,调完即弃。
      const agentContext = shouldPersist
        ? readAgentContextFromWorkspace(workspaceFiles, currentActiveSaveId, agentId, slot)
        : null

      // resolve target agent 上下文 token 预算.
      const targetConfig = resolveAgentModelConfig(agentId, providerPresetMap)
      const contextTokenBudget = resolveTokenBudget(
        targetConfig?.parameters.common.contextWindow ?? null,
      )

      const result = await runAgentRuntimeTurn(
        {
          agentId,
          userInput,
          injection: input.injection,
          recentHistory: historyBefore,
          turn: invokeMaxTurn,
          workspaceFiles,
          workspaceTrustBoundary: "runtime-game-agent",
          signal: invokeController.signal,
          agentContext: agentContext ?? undefined,
          contextTokenBudget,
          // 旁路调用用 task 模式压缩(工具交互段压缩,不压剧情正文).
          compressionMode: "task",
          traceContext,
          ...(shouldPersist
            ? {
                timeoutMs: DEFAULT_TASK_INACTIVITY_TIMEOUT_MS,
              }
            : {}),
          // 旁路调用绑 onAskUser 以防目标 agent 需要 ask_user
          // (复用进程内 interaction-events 总线).
          // 旁路 agent 活动信号通过独立的 invocation 事件通道 emit。
          onDelta: (emittingAgentId, delta, round, kind) => {
            emitAgentInvocation({
              type: "delta",
              invocationId,
              agentId: emittingAgentId,
              round,
              kind,
              delta,
            })
          },
          onRoundEnd: (emittingAgentId, round, finishReason) => {
            emitAgentInvocation({
              type: "round-end",
              invocationId,
              agentId: emittingAgentId,
              round,
              kind: finishReasonToKind(finishReason),
            })
          },
          onTool: (emittingAgentId, round, callId, name, status, output, displayName) => {
            emitAgentInvocation({
              type: "tool",
              invocationId,
              agentId: emittingAgentId,
              round,
              callId,
              name,
              status,
              ...(output !== undefined ? { output } : {}),
              ...(displayName !== undefined ? { displayName } : {}),
            })
          },
          onAskUser: (requestId, request) =>
            emitInteractionRequest(requestId, request.question, request.options, request.allowCustom),
        },
        {
          callModel(messages, options) {
            const modelConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
            const streamingEnabled = modelConfig
              ? modelConfig.streaming
              : getBrowserAiConfig()?.streaming ?? DEFAULT_BROWSER_AI_STREAMING
            if (!options.onDelta || !streamingEnabled) {
              return generateAssistantReply(messages, {
                debugLabel: options.debugLabel,
                signal: options.signal,
                traceContext: options.traceContext,
                ...(modelConfig ? { config: modelConfig } : {}),
              })
            }
            return streamAssistantReplyText(messages, {
              debugLabel: options.debugLabel,
              signal: options.signal,
              traceContext: options.traceContext,
              round: options.round,
              ...(modelConfig ? { config: modelConfig } : {}),
              onDelta: options.onDelta
                ? (delta, round, kind) => options.onDelta!(options.agentId ?? agentId, delta, round, kind)
                : undefined,
            })
          },
          async callModelNative(messages, options, tools) {
            const modelConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
            const streamingEnabled = modelConfig
              ? modelConfig.streaming
              : getBrowserAiConfig()?.streaming ?? DEFAULT_BROWSER_AI_STREAMING
            if (!options.onDelta || !streamingEnabled) {
              return generateAssistantReplyNative(messages as RuntimeChatMessage[], {
                debugLabel: options.debugLabel,
                signal: options.signal,
                traceContext: options.traceContext,
                tools,
                ...(modelConfig ? { config: modelConfig } : {}),
              })
            }
            return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
              debugLabel: options.debugLabel,
              signal: options.signal,
              traceContext: options.traceContext,
              tools,
              onDelta: options.onDelta
                ? (delta, round, kind) => options.onDelta!(options.agentId ?? agentId, delta, round, kind)
                : undefined,
              round: options.round,
              ...(modelConfig ? { config: modelConfig } : {}),
            })
          },
          emitTrace: trace.emit,
          toolCallMode: targetConfig?.toolCallMode
            ?? getBrowserAiConfig()?.toolCallMode
            ?? DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
          ...createBrowserScriptRunners({
            workspaceTransaction: workspaceTransaction!,
            signal: invokeController.signal,
          }),
          actionExecutorPolicy: undefined,
          // 旁路调用也接入 workspace mutation 适配器——agent 的 skill 脚本
          // (如 commit_opening_understanding)和 workspace_write 工具都需要写入能力。
          // 事务已在上方创建(同一 workspaceTransaction)，写入会随事务一起 commit。
          workspaceMutations: {
            write: (writeInput) => {
              if (writeInput.scope === "platform-meta") {
                return workspaceTransaction!.writePlatformFile({
                  path: writeInput.path,
                  content: writeInput.content,
                  ...(writeInput.data ? { data: writeInput.data } : {}),
                })
              }
              if (writeInput.scope !== "save-runtime") {
                throw new Error("Runtime Agent turns can only stage save-runtime workspace writes.")
              }
              return workspaceTransaction!.write({
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
                ...workspaceTransaction!.delete(deleteInput.path),
              }
            },
          },
          exposedWorkspaceOperations: undefined,
          collaborationPolicy: undefined,
          semanticSearchOwnerId: currentActiveSaveId,
        },
      )

      // persist:true → 写回 context-<slot>.json(不推进 turn、不写历史、不更新 snapshot).
      // persist:false → 不写 context,调完即弃.工作区写入(若有)用同一事务提交.
      if (shouldPersist && result.contextUpdate) {
        const projectedReply = projectAssistantReply(
          result.replyText,
          workspaceTransaction!.workspaceFiles,
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
            rawContentLength: result.replyText.length,
            contentLength: projectedReply.content.length,
            displayContentLength: projectedReply.displayContent?.length ?? null,
            projectionKeys: Object.keys(projectedReply.projections ?? {}).sort(),
          },
        })
        stageAgentContextFile(workspaceTransaction!, {
          saveId: currentActiveSaveId,
          turn: result.contextUpdate.turn,
          user: result.contextUpdate.user,
          assistant: projectedReply.content,
          compressedContext: result.contextUpdate.compressedContext,
          agentId,
          slot,
        })
      }
      // 旁路 trace 落盘（独立路径，不与主 turn trace 混淆）
      trace.emit({
        type: "turn_completed",
        ok: true,
        data: { agentId, replyLength: result.replyText.length },
      })
      if (checkpointOption !== false) {
        cleanupScenesInTransaction(workspaceTransaction!)
      }
      const workspaceChanges = workspaceTransaction!.finalWorkspaceChanges()
      await (checkpointOption !== false
        ? commitWorkspaceChangesWithOptionalCheckpointForSave(
            currentActiveSaveId,
            workspaceChanges,
            { turn: invokeMaxTurn, checkpoint: checkpointOption },
          )
        : commitWorkspaceChangesForSave(
            currentActiveSaveId,
            workspaceChanges,
          ))
      emitAgentInvocation({ type: "completed", invocationId, agentId })

      return { invocationId, response: result.replyText }
    } catch (error) {
      workspaceTransaction?.discard()
      emitAgentInvocation({
        type: "failed",
        invocationId,
        agentId,
        error: platformErrorFromUnknown(error),
      })
      rejectAllInteractionRequests(error)
      // 旁路 trace 失败落盘（事务已 discard，直接写文件系统）
      trace.emit({
        type: "turn_failed",
        ok: false,
        data: errorToTraceDataWithStack(error),
      })
      throw error
    }
  }
}
