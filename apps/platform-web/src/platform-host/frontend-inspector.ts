import type {
  InspectFrontendActivityEntry,
  InspectFrontendInput,
  InspectFrontendResult,
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
  type FrontendDiagnosticsCollector,
} from "./frontend-inspector-diagnostics"

const MAX_ACTIVITY_ENTRIES = 200
const MAX_ACTION_SNAPSHOTS = 50
const RUNTIME_QUIET_MS = 2_000
const RUNTIME_TRIGGER_TIMEOUT_MS = 1_000
const DEFAULT_RUNTIME_TIMEOUT_MS = 300_000
const FINISH_RELOAD_TIMEOUT_MS = 10_000

interface RuntimeChainState {
  active: boolean
  startSequence: number
  sendCount: number
  failed: boolean
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
  activity: InspectFrontendActivityEntry[]
  diff?: InspectFrontendResult["diff"]
  fileLineMap?: InspectFrontendResult["fileLineMap"]
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
  let session: LiveFrameSession | null = null
  let debugRecord: FrontendDebugSessionRecord | null = null
  try {
    const existing = await loadOptionalStoredDebugSession()
    debugRecord = existing?.record ?? null
    if (existing) {
      await assertDebugSessionActiveSave(existing)
    }
    target = await requireReadyPackagedTarget()
    session = getOrCreateFrameSession(target)
    debugRecord = await ensureDebugSession(target, session, existing)

    const activityCursor = target.mount.activitySequence
    let actionSnapshots: InspectFrontendResult["actionSnapshots"]
    if (input.actions?.length) {
      const doc = requireFrameDocument(target)
      actionSnapshots = await runInspectDomActions(doc, input.actions, {
        autoWait: input.autoWait !== false,
        observeBetween: input.observeBetween === true,
        bridgeState: () => bridgeStateFor(target!),
      })
      await inspectMicroTick()
    }

    let runtime = runtimeSummary(session, session.chain?.active ? "active" : "not-requested")
    if (input.wait === "runtime-settled") {
      if (input.actions?.length) {
        const triggered = await waitForSendAfter(session, activityCursor)
        if (!triggered) {
          throw new InspectorFailure(
            "INSPECT_RUNTIME_NOT_TRIGGERED",
            "The actions did not trigger interaction.sendMessage in the current Play iframe.",
          )
        }
      } else if (!session.chain?.active) {
        throw new InspectorFailure(
          "INSPECT_RUNTIME_NOT_ACTIVE",
          "The current Play iframe has no active send chain to continue waiting for.",
        )
      }
      runtime = await waitForRuntimeSettled(
        session,
        input.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS,
      )
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
      activity: captured.activity,
      runtime,
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

    target = await requireReadyPackagedTarget()
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

async function requireReadyPackagedTarget(): Promise<PlayFrontendTarget> {
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
    )
  }
  if (!target) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_UNAVAILABLE",
      "No Play iframe is mounted. Open the intended save in Play and wait for it to finish loading.",
    )
  }
  if (target.kind !== "packaged") {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_REMOTE_UNSUPPORTED",
      "inspect_frontend only supports the same-origin packaged frontend mounted in Play.",
    )
  }
  if (target.gameCardId !== activeCard.id) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_BUSY",
      "The active card and mounted Play frontend are changing. Retry after Play settles.",
    )
  }
  if (target.mount.status !== "ready") {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_NOT_READY",
      `The mounted Play iframe is ${target.mount.status}. Retry after its bridge is ready.`,
      { status: target.mount.status },
    )
  }
  if (!target.mount.iframe.isConnected) {
    throw new InspectorFailure(
      "INSPECT_FRONTEND_TARGET_UNAVAILABLE",
      "The registered Play iframe is no longer connected.",
    )
  }
  requireFrameDocument(target)
  return target
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
      }
    } else {
      session.chain.sendCount += 1
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
  const checkpoints = await listCheckpointsForSave(save.id)
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
  const reasons = currentTurn > 0
    ? ["post-turn-maintenance", "after-turn"]
    : ["manual", "initial"]
  for (const reason of reasons) {
    const checkpoint = sameTurn.find((item) => item.reason === reason)
    if (checkpoint) return checkpoint
  }
  return null
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
  const checkpoint = (await listCheckpointsForSave(record.saveId))
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

async function waitForSendAfter(
  session: LiveFrameSession,
  afterSequence: number,
): Promise<boolean> {
  const deadline = Date.now() + RUNTIME_TRIGGER_TIMEOUT_MS
  while (Date.now() < deadline) {
    assertCurrentTarget(session)
    if (session.lastSendStartedSequence > afterSequence) return true
    await inspectMicroTick(25)
  }
  return session.lastSendStartedSequence > afterSequence
}

async function waitForRuntimeSettled(
  session: LiveFrameSession,
  timeoutMs: number,
): Promise<NonNullable<InspectFrontendResult["runtime"]>> {
  const deadline = Date.now() + timeoutMs
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
      return runtimeSummary(session, status)
    }
    await inspectMicroTick(50)
  }
  return runtimeSummary(session, "timeout")
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
  const structure = collectInspectStructure(
    session.target.mount.iframe.contentDocument,
    bridgeStateFor(session.target),
  )
  const diagnostics = session.collector.snapshot(bridgeHandshakeFor(session.target))
  const currentSnapshot: InspectSnapshot = {
    structure,
    errors: diagnostics.errors,
  }
  const diff = computeInspectDiff(session.previousSnapshot, currentSnapshot)
  session.previousSnapshot = currentSnapshot
  const fileLineMap = diagnostics.errors.length
    ? await buildFileLineMap(session.target.gameCardId, diagnostics.errors)
    : undefined
  return {
    structure,
    diagnostics,
    activity: session.activity.slice(),
    ...(diff ? { diff } : {}),
    ...(fileLineMap ? { fileLineMap } : {}),
    truncated: session.activityTruncated || session.collector.truncated,
  }
}

async function buildFileLineMap(
  cardId: string,
  errors: InspectFrontendResult["diagnostics"]["errors"],
): Promise<InspectFrontendResult["fileLineMap"] | undefined> {
  const files = await listLocalGameCardFrontendFiles(cardId)
  const nameToSource = new Map<string, string>()
  for (const file of files) {
    nameToSource.set(file.path.split("/").pop() ?? file.path, file.path)
  }
  const map: NonNullable<InspectFrontendResult["fileLineMap"]> = {}
  for (const error of errors) {
    const fileName = error.source?.split("/").pop()
    const source = fileName ? nameToSource.get(fileName) : undefined
    if (!fileName || !source || typeof error.line !== "number") continue
    ;(map[fileName] ??= []).push({ source, line: error.line })
  }
  return Object.keys(map).length ? map : undefined
}

async function buildFailureResult(
  operation: "inspect" | "finish",
  error: unknown,
  target: PlayFrontendTarget | null,
  session: LiveFrameSession | null,
  debugRecord: FrontendDebugSessionRecord | null,
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
  return {
    ok: false,
    operation,
    cardId: target?.gameCardId ?? debugRecord?.gameCardId ?? "",
    entry: target?.entry ?? "",
    ...(target ? { frameGeneration: target.generation } : {}),
    ...(debugRecord ? { debugSession: toDebugSessionView(debugRecord, true) } : {}),
    structure: captured?.structure ?? emptyInspectStructure(),
    diagnostics: captured?.diagnostics ?? emptyInspectDiagnostics(),
    ...(captured ? { activity: captured.activity } : {}),
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
