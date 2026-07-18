import type {
  InspectFrontendActionResult,
  InspectFrontendActivityEntry,
  InspectFrontendBuildSummary,
  InspectFrontendInput,
  InspectFrontendResult,
  InspectFrontendSourceHint,
  InspectFrontendWaitSummary,
} from "../agent-runtime/workspace-tools"
import {
  getPlayFrontendTarget,
  waitForNextReadyPlayFrontendTarget,
  type PlayFrontendTarget,
} from "../bridge/play-frontend-target"
import type { RemoteBridgeActivityEntry } from "../bridge/remote-iframe-bridge"
import { emitTurnDebugReady } from "../debug-events"
import { getFrontendBuildStatus } from "../frontend-build/build-status"
import { emitFrontendReload } from "../lib/platform-events"
import {
  listCheckpointsForSave,
  restoreCheckpointForSave,
  type LocalCheckpointSummary,
} from "../storage/checkpoints"
import {
  clearFrontendDebugSession,
  getFrontendDebugSession,
  setFrontendDebugSession,
  type FrontendDebugSessionRecord,
} from "../storage/frontend-debug-session"
import {
  getLocalGameCard,
  listLocalGameCardFrontendFiles,
} from "../storage/game-cards"
import {
  getActiveSaveId,
  listLocalSaves,
} from "../storage/saves"
import { listEffectiveWorkspaceFilesForSave } from "../storage/workspace"
import type { LocalSaveRecord } from "../storage/db"
import { getMaxTurnFromTurnFiles } from "./history-turns"
import { getPlatformActiveGameCard } from "./internal"
import {
  collectInspectInteractables,
  collectInspectStructure,
  computeInspectDiff,
  emptyInspectStructure,
  inspectMicroTick,
  InspectDomActionError,
  runInspectDomActions,
  type InspectSnapshot,
} from "./frontend-inspector-dom"
import {
  createFrontendDiagnosticsCollector,
  emptyInspectDiagnostics,
  emptyInspectDiagnosticsSummary,
  type FrontendDiagnosticsCollector,
} from "./frontend-inspector-diagnostics"

const MAX_ACTIVITY_ENTRIES = 200
const MAX_ACTION_SNAPSHOTS = 50
const RUNTIME_QUIET_MS = 2_000
const RUNTIME_TRIGGER_TIMEOUT_MS = 5_000
const DEFAULT_RUNTIME_TIMEOUT_MS = 300_000
const DOM_STABLE_TIMEOUT_MS = 2_000
const DOM_STABLE_QUIET_MS = 150
const FINISH_RELOAD_TIMEOUT_MS = 10_000

interface ReadyPackagedTargetResult {
  target: PlayFrontendTarget
  activeCardId: string
}

interface RuntimeChainState {
  active: boolean
  startSequence: number
  sendCount: number
  failed: boolean
  trigger: "bridge" | "send"
}

interface LiveFrameSession {
  target: PlayFrontendTarget
  collector: FrontendDiagnosticsCollector
  startedAt: number
  activity: InspectFrontendActivityEntry[]
  activityTruncated: boolean
  lastSendStartedSequence: number
  chain: RuntimeChainState | null
  previousSnapshot: InspectSnapshot | null
  unsubscribeActivity: () => void
  unsubscribeStatus: () => void
}

interface ValidDebugSession {
  record: FrontendDebugSessionRecord
  save: LocalSaveRecord
  checkpoint: LocalCheckpointSummary
}

interface CapturedFrame {
  structure: InspectFrontendResult["structure"]
  diagnostics: InspectFrontendResult["diagnostics"]
  diagnosticsSummary: NonNullable<InspectFrontendResult["diagnosticsSummary"]>
  interactables: NonNullable<InspectFrontendResult["interactables"]>
  activity: InspectFrontendActivityEntry[]
  diff?: InspectFrontendResult["diff"]
  fileLineMap?: InspectFrontendResult["fileLineMap"]
  frontendBuild?: InspectFrontendBuildSummary
  sourceHints?: InspectFrontendSourceHint[]
  truncated: boolean
}

class InspectorFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = "InspectorFailure"
  }
}

let currentFrameSession: LiveFrameSession | null = null

export function createFrontendInspector(): (
  input: InspectFrontendInput,
) => Promise<InspectFrontendResult> {
  return runInspectFrontend
}

async function runInspectFrontend(
  input: InspectFrontendInput,
): Promise<InspectFrontendResult> {
  const operation = input.operation ?? "inspect"
  return operation === "finish"
    ? runFinishFrontendInspection()
    : runLiveFrontendInspection(input)
}

async function runLiveFrontendInspection(
  input: InspectFrontendInput,
): Promise<InspectFrontendResult> {
  let target: PlayFrontendTarget | null = null
  let cardIdHint = ""
  let session: LiveFrameSession | null = null
  let debugRecord: FrontendDebugSessionRecord | null = null
  let actionResults: InspectFrontendActionResult[] | undefined
  let wait: InspectFrontendWaitSummary | undefined
  try {
    const existing = await loadOptionalStoredDebugSession()
    debugRecord = existing?.record ?? null
    if (existing) {
      await assertDebugSessionActiveSave(existing)
      cardIdHint = existing.record.gameCardId
    }
    const readyTarget = await requireReadyPackagedTarget()
    target = readyTarget.target
    cardIdHint = readyTarget.activeCardId
    session = getOrCreateFrameSession(target)
    debugRecord = await ensureDebugSession(target, session, existing)

    const activityCursor = target.mount.activitySequence
    let actionSnapshots: InspectFrontendResult["actionSnapshots"]
    if (input.actions?.length) {
      const doc = requireFrameDocument(target)
      const execution = await runInspectDomActions(doc, input.actions, {
        autoWait: input.autoWait !== false,
        observeBetween: input.observeBetween === true,
        bridgeState: () => bridgeStateFor(target!),
        activitySequence: () => target!.mount.activitySequence,
      })
      actionSnapshots = execution.snapshots
      actionResults = execution.actions
      await inspectMicroTick()
    }

    let runtime = runtimeSummary(session, session.chain?.active ? "active" : "not-requested")
    wait = notRequestedWaitSummary(session)
    if (input.wait === "runtime-settled") {
      if (input.actions?.length) {
        wait = await waitForRuntimeTriggered(session, activityCursor)
        if (wait.status === "not-triggered") {
          runtime = runtimeSummary(session, session.chain?.active ? "active" : "not-requested")
        } else {
          const settled = await waitForRuntimeSettled(
            session,
            input.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS,
            wait,
          )
          runtime = settled.runtime
          wait = settled.wait
        }
      } else if (!session.chain?.active) {
        wait = {
          mode: "runtime-settled",
          status: "not-active",
          waitedMs: 0,
          activityBefore: activityCursor,
          activityAfter: session.target.mount.activitySequence,
          triggered: false,
          settled: false,
        }
        throw new InspectorFailure(
          "INSPECT_RUNTIME_NOT_ACTIVE",
          "The current Play iframe has no active bridge chain to continue waiting for.",
          wait,
        )
      } else {
        const settled = await waitForRuntimeSettled(
          session,
          input.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS,
          {
            mode: "runtime-settled",
            status: "triggered",
            waitedMs: 0,
            activityBefore: activityCursor,
            activityAfter: session.target.mount.activitySequence,
            triggered: true,
          },
        )
        runtime = settled.runtime
        wait = settled.wait
      }
    } else if (input.wait === "dom-stable") {
      wait = await waitForDomStable(target)
      runtime = runtimeSummary(session, session.chain?.active ? "active" : "not-requested")
    }

    const captured = await captureFrame(session)
    const snapshots = actionSnapshots?.slice(0, MAX_ACTION_SNAPSHOTS)
    return {
      ok: true,
      operation: "inspect",
      cardId: target.gameCardId,
      entry: target.entry ?? "",
      frameGeneration: target.generation,
      debugSession: toDebugSessionView(debugRecord, true),
      structure: captured.structure,
      diagnostics: captured.diagnostics,
      wait,
      interactables: captured.interactables,
      diagnosticsSummary: captured.diagnosticsSummary,
      ...(captured.frontendBuild ? { frontendBuild: captured.frontendBuild } : {}),
      ...(captured.sourceHints?.length ? { sourceHints: captured.sourceHints } : {}),
      activity: captured.activity,
      runtime,
      ...(actionResults?.length ? { actions: actionResults } : {}),
      ...(snapshots?.length ? { actionSnapshots: snapshots } : {}),
      ...(captured.fileLineMap ? { fileLineMap: captured.fileLineMap } : {}),
      ...(captured.diff ? { diff: captured.diff } : {}),
      ...(captured.truncated || (actionSnapshots?.length ?? 0) > MAX_ACTION_SNAPSHOTS
        ? { truncated: true }
        : {}),
    }
  } catch (error) {
    return buildFailureResult(
      "inspect",
      error,
      target,
      session,
      debugRecord,
      {
        actions: actionResults ?? (error instanceof InspectDomActionError ? error.actionResults : undefined),
        wait,
        cardIdHint,
      },
    )
  }
}

async function runFinishFrontendInspection(): Promise<InspectFrontendResult> {
  let target: PlayFrontendTarget | null = null
  let session: LiveFrameSession | null = null
  let debugRecord: FrontendDebugSessionRecord | null = null
  try {
    const existing = await requireStoredDebugSession()
    debugRecord = existing.record
    const activeSaveId = await getActiveSaveId()
    if (activeSaveId !== existing.record.saveId) {
      throw new InspectorFailure(
        "INSPECT_FRONTEND_SAVE_MISMATCH",
        "Switch Play back to the save that owns the active frontend debug session before finishing.",
        {
          activeSaveId,
          debugSaveId: existing.record.saveId,
        },
      )
    }

    const readyTarget = await requireReadyPackagedTarget()
    target = readyTarget.target
    if (target.gameCardId !== existing.record.gameCardId) {
      throw new InspectorFailure(
        "INSPECT_FRONTEND_SAVE_MISMATCH",
        "The mounted Play frontend does not match the active frontend debug session.",
        {
          mountedGameCardId: target.gameCardId,
          debugGameCardId: existing.record.gameCardId,
        },
      )
    }
    session = getOrCreateFrameSession(target)
    if (!isMountQuiet(target)) {
      throw new InspectorFailure(
        "DEBUG_SESSION_BUSY",
        "The current Play bridge is still active or has not been quiet for 2 seconds.",
        runtimeSummary(session, "active"),
      )
    }

    const oldGeneration = target.generation
    const oldEntry = target.entry ?? ""
    disposeCurrentFrameSession()
    session = null

    const restored = await restoreCheckpointForSave(
      existing.record.saveId,
      existing.record.checkpointId,
      { deleteSameTurnAfterCreatedAt: existing.checkpoint.createdAt },
    )
    if (!restored) {
      await clearFrontendDebugSession()
      debugRecord = null
      throw new InspectorFailure(
        "INSPECT_FRONTEND_DEBUG_SESSION_INVALID",
        "The debug baseline checkpoint no longer exists. The invalid session marker was cleared.",
      )
    }

    try {
      await clearFrontendDebugSession()
      debugRecord = null
    } catch (error) {
      return {
        ok: false,
        operation: "finish",
        cardId: existing.record.gameCardId,
        entry: oldEntry,
        structure: emptyInspectStructure(),
        diagnostics: emptyInspectDiagnostics(),
        interactables: [],
        diagnosticsSummary: emptyInspectDiagnosticsSummary(),
        ...(buildFrontendBuildSummary(existing.record.gameCardId) ? { frontendBuild: buildFrontendBuildSummary(existing.record.gameCardId) } : {}),
        debugSession: toDebugSessionView(existing.record, true),
        restored: {
          restored: true,
          restoredTurn: restored.turn,
          reloadReady: false,
        },
        error: {
          code: "DEBUG_SESSION_CLEAR_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }

    emitTurnDebugReady(restored.turn)
    emitFrontendReload()
    const reloadedTarget = await waitForNextReadyPlayFrontendTarget(
      oldGeneration,
      FINISH_RELOAD_TIMEOUT_MS,
    )
    if (
      !reloadedTarget
      || reloadedTarget.kind !== "packaged"
      || reloadedTarget.gameCardId !== existing.record.gameCardId
    ) {
      return {
        ok: true,
        operation: "finish",
        cardId: existing.record.gameCardId,
        entry: oldEntry,
        structure: emptyInspectStructure(),
        diagnostics: emptyInspectDiagnostics(),
        interactables: [],
        diagnosticsSummary: emptyInspectDiagnosticsSummary(),
        ...(buildFrontendBuildSummary(existing.record.gameCardId) ? { frontendBuild: buildFrontendBuildSummary(existing.record.gameCardId) } : {}),
        debugSession: toDebugSessionView(existing.record, false),
        restored: {
          restored: true,
          restoredTurn: restored.turn,
          reloadReady: false,
        },
        error: {
          code: "INSPECT_FRONTEND_RELOAD_TIMEOUT",
          message: "The save runtime was restored, but the replacement Play iframe was not ready within 10 seconds.",
        },
      }
    }

    const oneShotSession = getOrCreateFrameSession(reloadedTarget)
    await inspectMicroTick()
    const captured = await captureFrame(oneShotSession)
    disposeCurrentFrameSession()
    return {
      ok: true,
      operation: "finish",
      cardId: reloadedTarget.gameCardId,
      entry: reloadedTarget.entry ?? oldEntry,
      frameGeneration: reloadedTarget.generation,
      debugSession: toDebugSessionView(existing.record, false),
      structure: captured.structure,
      diagnostics: captured.diagnostics,
      interactables: captured.interactables,
      diagnosticsSummary: captured.diagnosticsSummary,
      ...(captured.frontendBuild ? { frontendBuild: captured.frontendBuild } : {}),
      ...(captured.sourceHints?.length ? { sourceHints: captured.sourceHints } : {}),
      activity: captured.activity,
      restored: {
        restored: true,
        restoredTurn: restored.turn,
        reloadReady: true,
      },
      ...(captured.fileLineMap ? { fileLineMap: captured.fileLineMap } : {}),
      ...(captured.truncated ? { truncated: true } : {}),
    }
  } catch (error) {
    return buildFailureResult(
      "finish",
      error,
      target,
      session,
      debugRecord,
    )
  }
}

async function requireReadyPackagedTarget(): Promise<ReadyPackagedTargetResult> {
  const activeCard = await getPlatformActiveGameCard()
  const target = getPlayFrontendTarget()
  syncFrameSession(target)

  if (!activeCard) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_UNAVAILABLE",
      "No active local game card is mounted in Play.",
    )
  }
  if (getFrontendBuildStatus(activeCard.id).status === "building") {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_BUSY",
      "The active frontend is rebuilding. Retry after the current Play iframe has been replaced.",
      { cardId: activeCard.id },
    )
  }
  if (!target) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_UNAVAILABLE",
      "No Play iframe is mounted. Open the intended save in Play and wait for it to finish loading.",
      { cardId: activeCard.id },
    )
  }
  if (target.kind !== "packaged") {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_REMOTE_UNSUPPORTED",
      "inspect_frontend only supports the same-origin packaged frontend mounted in Play.",
      { cardId: activeCard.id },
    )
  }
  if (target.gameCardId !== activeCard.id) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_BUSY",
      "The active card and mounted Play frontend are changing. Retry after Play settles.",
      { cardId: activeCard.id },
    )
  }
  if (target.mount.status !== "ready") {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_NOT_READY",
      `The mounted Play iframe is ${target.mount.status}. Retry after its bridge is ready.`,
      { status: target.mount.status, cardId: activeCard.id },
    )
  }
  if (!target.mount.iframe.isConnected) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_UNAVAILABLE",
      "The registered Play iframe is no longer connected.",
      { cardId: activeCard.id },
    )
  }
  requireFrameDocument(target)
  return { target, activeCardId: activeCard.id }
}

function requireFrameDocument(target: PlayFrontendTarget): Document {
  try {
    const doc = target.mount.iframe.contentDocument
    if (!doc?.defaultView || !doc.body) {
      throw new Error("document is not ready")
    }
    return doc
  } catch {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_NOT_READY",
      "The mounted Play iframe document is not readable.",
    )
  }
}

function getOrCreateFrameSession(target: PlayFrontendTarget): LiveFrameSession {
  if (currentFrameSession?.target.generation === target.generation) {
    return currentFrameSession
  }
  disposeCurrentFrameSession()
  requireFrameDocument(target)
  const session: LiveFrameSession = {
    target,
    collector: createFrontendDiagnosticsCollector(target.mount.iframe),
    startedAt: Date.now(),
    activity: [],
    activityTruncated: false,
    lastSendStartedSequence: 0,
    chain: null,
    previousSnapshot: null,
    unsubscribeActivity: () => undefined,
    unsubscribeStatus: () => undefined,
  }
  session.unsubscribeActivity = target.mount.subscribeActivity((entry) => {
    recordActivity(session, entry)
  })
  session.unsubscribeStatus = target.mount.subscribeStatus((status) => {
    if (status === "disposed" && currentFrameSession === session) {
      disposeCurrentFrameSession()
    }
  })
  currentFrameSession = session
  return session
}

function recordActivity(
  session: LiveFrameSession,
  entry: RemoteBridgeActivityEntry,
): void {
  const activity: InspectFrontendActivityEntry = {
    sequence: entry.sequence,
    requestId: entry.requestId,
    method: entry.method,
    phase: entry.phase,
    relativeMs: Math.max(0, entry.at - session.startedAt),
    ...(entry.error ? { error: entry.error } : {}),
  }
  if (session.activity.length >= MAX_ACTIVITY_ENTRIES) {
    session.activity.shift()
    session.activityTruncated = true
  }
  session.activity.push(activity)

  if (entry.method === "interaction.sendMessage" && entry.phase === "started") {
    session.lastSendStartedSequence = entry.sequence
    if (!session.chain?.active) {
      session.chain = {
        active: true,
        startSequence: entry.sequence,
        sendCount: 1,
        failed: false,
        trigger: "send",
      }
    } else {
      session.chain.sendCount += 1
      session.chain.trigger = "send"
    }
  }
  if (session.chain?.active && entry.phase === "failed") {
    session.chain.failed = true
  }
}

function syncFrameSession(target: PlayFrontendTarget | null): void {
  if (
    currentFrameSession
    && currentFrameSession.target.generation !== target?.generation
  ) {
    disposeCurrentFrameSession()
  }
}

function disposeCurrentFrameSession(): void {
  const session = currentFrameSession
  if (!session) return
  currentFrameSession = null
  session.unsubscribeActivity()
  session.unsubscribeStatus()
  session.collector.dispose()
}

async function ensureDebugSession(
  target: PlayFrontendTarget,
  session: LiveFrameSession,
  existing: ValidDebugSession | null,
): Promise<FrontendDebugSessionRecord> {
  if (existing) {
    await assertDebugSessionMatchesCurrentPlay(existing, target)
    return existing.record
  }

  const activeSaveId = await getActiveSaveId()
  const saves = await listLocalSaves()
  const save = saves.find((item) => item.id === activeSaveId)
  if (!activeSaveId || !save) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_ACTIVE_SAVE_REQUIRED",
      "Open the intended save in Play before starting frontend inspection.",
    )
  }
  if (save.gameCardId !== target.gameCardId) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_SAVE_MISMATCH",
      "The active save does not belong to the packaged frontend mounted in Play.",
    )
  }
  if (!isMountQuiet(target)) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_RUNTIME_BUSY",
      "Wait for the current Play bridge to become quiet before starting a debug session.",
      runtimeSummary(session, "active"),
    )
  }

  const card = await getLocalGameCard(target.gameCardId)
  if (!card) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_DEBUG_SESSION_INVALID",
      "The mounted game card no longer exists.",
    )
  }
  const activitySequence = target.mount.activitySequence
  const workspaceFiles = await listEffectiveWorkspaceFilesForSave(save.id, card)
  const currentTurn = getMaxTurnFromTurnFiles(workspaceFiles)
  const checkpoints = await listCheckpointsForSave(save.id, { includeHidden: true })
  const checkpoint = selectCanonicalBaseline(checkpoints, currentTurn)
  if (!checkpoint) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_BASELINE_UNAVAILABLE",
      `No canonical checkpoint exists for current turn ${currentTurn}.`,
      { currentTurn },
    )
  }
  assertCurrentTarget(session)
  if (
    target.mount.activitySequence !== activitySequence
    || !isMountQuiet(target)
  ) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_RUNTIME_BUSY",
      "Play bridge activity changed while the debug baseline was being established. Retry after it settles.",
    )
  }

  const record = await setFrontendDebugSession({
    saveId: save.id,
    gameCardId: target.gameCardId,
    checkpointId: checkpoint.id,
    baselineTurn: checkpoint.turn,
    startedAt: Date.now(),
  })
  if (
    target.mount.activitySequence !== activitySequence
    || !isMountQuiet(target)
  ) {
    await clearFrontendDebugSession()
    throw new InspectorFailure(
      "INSPECT_FRONTEND_RUNTIME_BUSY",
      "Play bridge activity resumed while the debug baseline was being saved. Retry after it settles.",
    )
  }
  return record
}

function selectCanonicalBaseline(
  checkpoints: LocalCheckpointSummary[],
  currentTurn: number,
): LocalCheckpointSummary | null {
  const sameTurn = checkpoints
    .filter((checkpoint) => checkpoint.turn === currentTurn)
    .sort((left, right) => right.createdAt - left.createdAt)
  const preferred = sameTurn.find((checkpoint) => (
    checkpoint.retention === "auto"
    && (checkpoint.source === "platform" || checkpoint.source === "agent")
  ))
  if (preferred) return preferred
  const pinnedBaseline = sameTurn.find((checkpoint) => checkpoint.retention === "pinned")
  return pinnedBaseline ?? sameTurn[0] ?? null
}

async function requireStoredDebugSession(): Promise<ValidDebugSession> {
  const existing = await loadOptionalStoredDebugSession()
  if (!existing) {
    throw new InspectorFailure(
      "DEBUG_SESSION_NOT_ACTIVE",
      "There is no active frontend debug session to finish.",
    )
  }
  return existing
}

async function loadOptionalStoredDebugSession(): Promise<ValidDebugSession | null> {
  const state = await getFrontendDebugSession()
  if (state.status === "absent") {
    return null
  }
  if (state.status === "invalid") {
    await clearFrontendDebugSession()
    throw new InspectorFailure(
      "INSPECT_FRONTEND_DEBUG_SESSION_INVALID",
      "The persisted frontend debug session was invalid and has been cleared.",
    )
  }
  return validateStoredDebugSession(state.record)
}

async function validateStoredDebugSession(
  record: FrontendDebugSessionRecord,
): Promise<ValidDebugSession> {
  const save = (await listLocalSaves()).find((item) => item.id === record.saveId)
  const card = await getLocalGameCard(record.gameCardId)
  const checkpoint = (await listCheckpointsForSave(record.saveId, { includeHidden: true }))
    .find((item) => item.id === record.checkpointId)
  if (
    !save
    || !card
    || save.gameCardId !== record.gameCardId
    || !checkpoint
    || checkpoint.turn !== record.baselineTurn
  ) {
    await clearFrontendDebugSession()
    throw new InspectorFailure(
      "INSPECT_FRONTEND_DEBUG_SESSION_INVALID",
      "The save, card, or checkpoint for the frontend debug session no longer exists. The marker was cleared.",
    )
  }
  return { record, save, checkpoint }
}

async function assertDebugSessionMatchesCurrentPlay(
  existing: ValidDebugSession,
  target: PlayFrontendTarget,
): Promise<void> {
  await assertDebugSessionActiveSave(existing)
  if (target.gameCardId !== existing.record.gameCardId) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_SAVE_MISMATCH",
      "Switch Play back to the save that owns the active frontend debug session.",
      {
        debugSaveId: existing.record.saveId,
        mountedGameCardId: target.gameCardId,
        debugGameCardId: existing.record.gameCardId,
      },
    )
  }
}

async function assertDebugSessionActiveSave(
  existing: ValidDebugSession,
): Promise<void> {
  const activeSaveId = await getActiveSaveId()
  if (activeSaveId !== existing.record.saveId) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_SAVE_MISMATCH",
      "Switch Play back to the save that owns the active frontend debug session.",
      {
        activeSaveId,
        debugSaveId: existing.record.saveId,
      },
    )
  }
}

function ensureBridgeChainAfter(
  session: LiveFrameSession,
  afterSequence: number,
): void {
  if (session.chain?.active) return
  const firstStarted = session.activity.find((entry) => (
    entry.sequence > afterSequence
    && entry.phase === "started"
  ))
  if (!firstStarted) return
  session.chain = {
    active: true,
    startSequence: firstStarted.sequence,
    sendCount: 0,
    failed: session.activity.some((entry) => (
      entry.sequence > afterSequence
      && entry.phase === "failed"
    )),
    trigger: "bridge",
  }
}

function hasBridgeStartAfter(
  session: LiveFrameSession,
  afterSequence: number,
): boolean {
  return session.activity.some((entry) => (
    entry.sequence > afterSequence
    && entry.phase === "started"
  ))
}

async function waitForRuntimeTriggered(
  session: LiveFrameSession,
  afterSequence: number,
): Promise<InspectFrontendWaitSummary> {
  const startedAt = Date.now()
  const deadline = startedAt + RUNTIME_TRIGGER_TIMEOUT_MS
  while (Date.now() < deadline) {
    assertCurrentTarget(session)
    if (hasBridgeStartAfter(session, afterSequence)) {
      ensureBridgeChainAfter(session, afterSequence)
      return {
        mode: "runtime-settled",
        status: "triggered",
        waitedMs: Date.now() - startedAt,
        activityBefore: afterSequence,
        activityAfter: session.target.mount.activitySequence,
        triggerTimeoutMs: RUNTIME_TRIGGER_TIMEOUT_MS,
        triggered: Boolean(session.chain?.active),
      }
    }
    await inspectMicroTick(25)
  }
  if (session.target.mount.activitySequence > afterSequence) {
    ensureBridgeChainAfter(session, afterSequence)
    return {
      mode: "runtime-settled",
      status: "triggered",
      waitedMs: Date.now() - startedAt,
      activityBefore: afterSequence,
      activityAfter: session.target.mount.activitySequence,
      triggerTimeoutMs: RUNTIME_TRIGGER_TIMEOUT_MS,
      triggered: Boolean(session.chain?.active),
    }
  }
  return {
    mode: "runtime-settled",
    status: "not-triggered",
    waitedMs: Date.now() - startedAt,
    activityBefore: afterSequence,
    activityAfter: session.target.mount.activitySequence,
    triggerTimeoutMs: RUNTIME_TRIGGER_TIMEOUT_MS,
    triggered: false,
    settled: false,
  }
}

async function waitForRuntimeSettled(
  session: LiveFrameSession,
  timeoutMs: number,
  triggerWait: InspectFrontendWaitSummary,
): Promise<{
  runtime: NonNullable<InspectFrontendResult["runtime"]>
  wait: InspectFrontendWaitSummary
}> {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  while (Date.now() < deadline) {
    assertCurrentTarget(session)
    if (
      session.chain?.active
      && session.target.mount.inFlightRequestCount === 0
      && quietMsFor(session.target) >= RUNTIME_QUIET_MS
    ) {
      const status = session.chain.failed
        ? "settled-with-failures"
        : "settled"
      session.chain.active = false
      return {
        runtime: runtimeSummary(session, status),
        wait: {
          ...triggerWait,
          status,
          waitedMs: triggerWait.waitedMs + Date.now() - startedAt,
          activityAfter: session.target.mount.activitySequence,
          settleTimeoutMs: timeoutMs,
          triggered: true,
          settled: true,
        },
      }
    }
    await inspectMicroTick(50)
  }
  return {
    runtime: runtimeSummary(session, "timeout"),
    wait: {
      ...triggerWait,
      status: "timeout",
      waitedMs: triggerWait.waitedMs + Date.now() - startedAt,
      activityAfter: session.target.mount.activitySequence,
      settleTimeoutMs: timeoutMs,
      triggered: triggerWait.triggered ?? true,
      settled: false,
    },
  }
}

async function waitForDomStable(
  target: PlayFrontendTarget,
): Promise<InspectFrontendWaitSummary> {
  const startedAt = Date.now()
  const activityBefore = target.mount.activitySequence
  let lastSignature = targetDomSignature(target)
  let stableSince = Date.now()
  await inspectMicroTick(25)
  while (Date.now() - startedAt < DOM_STABLE_TIMEOUT_MS) {
    assertCurrentTargetGeneration(target)
    const nextSignature = targetDomSignature(target)
    const now = Date.now()
    if (nextSignature !== lastSignature) {
      lastSignature = nextSignature
      stableSince = now
    } else if (now - stableSince >= DOM_STABLE_QUIET_MS) {
      return {
        mode: "dom-stable",
        status: "settled",
        waitedMs: now - startedAt,
        activityBefore,
        activityAfter: target.mount.activitySequence,
        settled: true,
      }
    }
    await inspectMicroTick(25)
  }
  return {
    mode: "dom-stable",
    status: "timeout",
    waitedMs: Date.now() - startedAt,
    activityBefore,
    activityAfter: target.mount.activitySequence,
    settleTimeoutMs: DOM_STABLE_TIMEOUT_MS,
    settled: false,
  }
}

function notRequestedWaitSummary(session: LiveFrameSession): InspectFrontendWaitSummary {
  return {
    mode: "none",
    status: "not-requested",
    waitedMs: 0,
    activityBefore: session.target.mount.activitySequence,
    activityAfter: session.target.mount.activitySequence,
  }
}

function targetDomSignature(target: PlayFrontendTarget): string {
  const doc = target.mount.iframe.contentDocument
  if (!doc?.body) return ""
  const controls = Array.from(doc.querySelectorAll("input, textarea, select"))
    .slice(0, 200)
    .map((element, index) => {
      const tag = element.tagName.toLowerCase()
      if (tag === "select") {
        const select = element as HTMLSelectElement
        const selected = Array.from(select.selectedOptions).map((option) => option.value).join(",")
        return `${index}:select:${select.value.slice(0, 200)}:${selected.slice(0, 200)}`
      }
      if (tag === "textarea") {
        return `${index}:textarea:${(element as HTMLTextAreaElement).value.slice(0, 200)}`
      }
      const input = element as HTMLInputElement
      const type = input.type.toLowerCase()
      if (type === "checkbox" || type === "radio") {
        return `${index}:input:${type}:checked=${input.checked}`
      }
      return `${index}:input:${type}:${input.value.slice(0, 200)}`
    })
    .join("\n")
  return `${doc.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 2_000) ?? ""}\n${doc.body.childElementCount}\n${controls}`
}

function assertCurrentTarget(session: LiveFrameSession): void {
  const current = getPlayFrontendTarget()
  if (
    !current
    || current.generation !== session.target.generation
    || current.mount.status !== "ready"
  ) {
    disposeCurrentFrameSession()
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_CHANGED",
      "The Play iframe was replaced or closed during inspection. Retry against the current frame.",
    )
  }
}

function assertCurrentTargetGeneration(target: PlayFrontendTarget): void {
  const current = getPlayFrontendTarget()
  if (
    !current
    || current.generation !== target.generation
    || current.mount.status !== "ready"
  ) {
    disposeCurrentFrameSession()
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_CHANGED",
      "The Play iframe was replaced or closed during inspection. Retry against the current frame.",
    )
  }
}

function isMountQuiet(target: PlayFrontendTarget): boolean {
  return (
    target.mount.inFlightRequestCount === 0
    && quietMsFor(target) >= RUNTIME_QUIET_MS
  )
}

function quietMsFor(target: PlayFrontendTarget): number {
  return target.mount.lastActivityAt === null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Date.now() - target.mount.lastActivityAt)
}

function runtimeSummary(
  session: LiveFrameSession,
  status: NonNullable<InspectFrontendResult["runtime"]>["status"],
): NonNullable<InspectFrontendResult["runtime"]> {
  return {
    status,
    sendCount: session.chain?.sendCount ?? 0,
    inFlight: session.target.mount.inFlightRequestCount,
    quietMs: session.target.mount.lastActivityAt === null
      ? 0
      : quietMsFor(session.target),
  }
}

function bridgeStateFor(
  target: PlayFrontendTarget,
): InspectFrontendResult["structure"]["bridgeState"] {
  if (target.mount.status === "error" || target.mount.status === "disposed") {
    return "error"
  }
  if (target.mount.inFlightRequestCount > 0) return "turn-active"
  return target.mount.status === "ready" ? "ready" : "loading"
}

function bridgeHandshakeFor(
  target: PlayFrontendTarget,
): InspectFrontendResult["diagnostics"]["bridgeHandshake"] {
  if (target.mount.status === "ready") return "ready"
  if (target.mount.status === "loading") return "pending"
  return "timeout"
}

async function captureFrame(session: LiveFrameSession): Promise<CapturedFrame> {
  const doc = session.target.mount.iframe.contentDocument
  const structure = collectInspectStructure(
    doc,
    bridgeStateFor(session.target),
  )
  const interactables = collectInspectInteractables(doc)
  const diagnostics = session.collector.snapshot(bridgeHandshakeFor(session.target))
  const diagnosticsSummary = session.collector.summary()
  const currentSnapshot: InspectSnapshot = {
    structure,
    errors: diagnostics.errors,
  }
  const diff = computeInspectDiff(session.previousSnapshot, currentSnapshot)
  session.previousSnapshot = currentSnapshot
  const fileLineMap = diagnostics.errors.length
    ? await buildFileLineMap(session.target.gameCardId, diagnostics.errors)
    : undefined
  const frontendBuild = buildFrontendBuildSummary(session.target.gameCardId)
  const sourceHints = buildSourceHints(fileLineMap, frontendBuild)
  return {
    structure,
    diagnostics,
    diagnosticsSummary,
    interactables,
    activity: session.activity.slice(),
    ...(diff ? { diff } : {}),
    ...(fileLineMap ? { fileLineMap } : {}),
    ...(frontendBuild ? { frontendBuild } : {}),
    ...(sourceHints.length ? { sourceHints } : {}),
    truncated: session.activityTruncated || session.collector.truncated,
  }
}

async function buildFileLineMap(
  cardId: string,
  errors: InspectFrontendResult["diagnostics"]["errors"],
): Promise<InspectFrontendResult["fileLineMap"] | undefined> {
  const files = await listLocalGameCardFrontendFiles(cardId)
  const nameToSources = new Map<string, string[]>()
  for (const file of files) {
    if (!file.path.startsWith("frontend/src/")) continue
    const fileName = file.path.split("/").pop()
    if (!fileName) continue
    const entries = nameToSources.get(fileName) ?? []
    entries.push(file.path)
    nameToSources.set(fileName, entries)
  }
  const map: NonNullable<InspectFrontendResult["fileLineMap"]> = {}
  for (const error of errors) {
    const fileName = error.source?.split("/").pop()
    const sources = fileName ? nameToSources.get(fileName) : undefined
    if (!fileName || !sources || sources.length !== 1 || typeof error.line !== "number") continue
    ;(map[fileName] ??= []).push({ source: sources[0]!, line: error.line })
  }
  return Object.keys(map).length ? map : undefined
}

function buildFrontendBuildSummary(cardId: string): InspectFrontendBuildSummary | undefined {
  if (!cardId) return undefined
  const status = getFrontendBuildStatus(cardId)
  return {
    status: status.status,
    lastBuiltAt: status.lastBuiltAt,
    ...(status.error ? { error: { ...status.error } } : {}),
  }
}

function normalizeFrontendSourcePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "")
  if (normalized.startsWith("frontend/src/")) return normalized
  const sourceIndex = normalized.indexOf("/frontend/src/")
  if (sourceIndex >= 0) return normalized.slice(sourceIndex + 1)
  const srcIndex = normalized.indexOf("src/")
  if (srcIndex >= 0) return `frontend/${normalized.slice(srcIndex)}`
  return null
}

function buildSourceHints(
  fileLineMap: InspectFrontendResult["fileLineMap"] | undefined,
  frontendBuild: InspectFrontendBuildSummary | undefined,
): InspectFrontendSourceHint[] {
  const hints: InspectFrontendSourceHint[] = []
  if (fileLineMap) {
    for (const entries of Object.values(fileLineMap)) {
      for (const entry of entries) {
        hints.push({
          kind: "runtime-error",
          path: entry.source,
          line: entry.line,
          confidence: "high",
        })
      }
    }
  }
  const buildErrorPath = frontendBuild?.error?.file
    ? normalizeFrontendSourcePath(frontendBuild.error.file)
    : null
  if (frontendBuild?.status === "failed" && buildErrorPath) {
    hints.push({
      kind: "build-error",
      path: buildErrorPath,
      ...(typeof frontendBuild.error?.line === "number" ? { line: frontendBuild.error.line } : {}),
      confidence: "high",
      message: frontendBuild.error?.message,
    })
  }
  return hints
}

function cardIdFromFailure(failure: InspectorFailure): string | undefined {
  const details = failure.details
  if (!details || typeof details !== "object") return undefined
  const cardId = (details as { cardId?: unknown }).cardId
  return typeof cardId === "string" && cardId ? cardId : undefined
}

async function buildFailureResult(
  operation: "inspect" | "finish",
  error: unknown,
  target: PlayFrontendTarget | null,
  session: LiveFrameSession | null,
  debugRecord: FrontendDebugSessionRecord | null,
  evidence: {
    actions?: InspectFrontendActionResult[]
    wait?: InspectFrontendWaitSummary
    cardIdHint?: string
  } = {},
): Promise<InspectFrontendResult> {
  const failure = normalizeFailure(error)
  let captured: CapturedFrame | null = null
  if (
    session
    && currentFrameSession === session
    && session.target.mount.iframe.isConnected
  ) {
    try {
      captured = await captureFrame(session)
    } catch {
      captured = null
    }
  }
  const fallbackCardId = target?.gameCardId ?? debugRecord?.gameCardId ?? evidence.cardIdHint ?? cardIdFromFailure(failure) ?? ""
  const fallbackFrontendBuild = captured?.frontendBuild
    ?? buildFrontendBuildSummary(fallbackCardId)
  const fallbackSourceHints = captured?.sourceHints
    ?? buildSourceHints(captured?.fileLineMap, fallbackFrontendBuild)
  return {
    ok: false,
    operation,
    cardId: fallbackCardId,
    entry: target?.entry ?? "",
    ...(target ? { frameGeneration: target.generation } : {}),
    ...(debugRecord ? { debugSession: toDebugSessionView(debugRecord, true) } : {}),
    structure: captured?.structure ?? emptyInspectStructure(),
    diagnostics: captured?.diagnostics ?? emptyInspectDiagnostics(),
    ...(evidence.wait ? { wait: evidence.wait } : session ? { wait: notRequestedWaitSummary(session) } : {}),
    interactables: captured?.interactables ?? [],
    diagnosticsSummary: captured?.diagnosticsSummary ?? emptyInspectDiagnosticsSummary(),
    ...(fallbackFrontendBuild ? { frontendBuild: fallbackFrontendBuild } : {}),
    ...(fallbackSourceHints.length ? { sourceHints: fallbackSourceHints } : {}),
    ...(captured ? { activity: captured.activity } : {}),
    ...(evidence.actions?.length ? { actions: evidence.actions } : {}),
    ...(session ? {
      runtime: runtimeSummary(
        session,
        session.chain?.active ? "active" : "not-requested",
      ),
    } : {}),
    ...(captured?.fileLineMap ? { fileLineMap: captured.fileLineMap } : {}),
    ...(captured?.diff ? { diff: captured.diff } : {}),
    ...(captured?.truncated ? { truncated: true } : {}),
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.details !== undefined ? { details: failure.details } : {}),
    },
  }
}

function normalizeFailure(error: unknown): InspectorFailure {
  if (error instanceof InspectorFailure) return error
  if (error instanceof InspectDomActionError) {
    return new InspectorFailure(error.code, error.message, error.details)
  }
  return new InspectorFailure(
    "INSPECT_FRONTEND_FAILED",
    error instanceof Error ? error.message : String(error),
  )
}

function toDebugSessionView(
  record: FrontendDebugSessionRecord,
  active: boolean,
): NonNullable<InspectFrontendResult["debugSession"]> {
  return {
    active,
    saveId: record.saveId,
    baselineCheckpointId: record.checkpointId,
    baselineTurn: record.baselineTurn,
    startedAt: record.startedAt,
    rollbackScope: "save-runtime",
  }
}
