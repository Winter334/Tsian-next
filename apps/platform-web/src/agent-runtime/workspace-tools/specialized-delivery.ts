import { isRecord } from "./shared"

const MAX_INSPECT_DOM_SUMMARY_CHARS = 8_000
const MAX_INSPECT_RENDERED_TEXT_CHARS = 4_000
const MAX_INSPECT_COMPUTED_STYLES = 20
const MAX_INSPECT_DIAGNOSTIC_ERRORS = 10
const MAX_INSPECT_CONSOLE_ENTRIES = 20
const MAX_INSPECT_RESOURCE_FAILURES = 20
const MAX_INSPECT_INTERACTABLES = 40
const MAX_INSPECT_ACTIONS = 20
const MAX_INSPECT_ACTIVITY = 50
const MAX_INSPECT_ACTION_SNAPSHOTS = 5
const MAX_INSPECT_SOURCE_HINTS = 20
const MAX_INSPECT_FILE_MAPS = 20
const MAX_INSPECT_DIFF_PATHS = 20
const MAX_INSPECT_PATH_CHARS = 1_000
const MAX_INSPECT_LABEL_CHARS = 500
const COMPACT_INSPECT_DIAGNOSTIC_ENTRIES = 3
const COMPACT_INSPECT_INTERACTABLES = 5
const INSPECT_AGGREGATE_TARGET_CHARS = 28 * 1024

function boundedText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : ""
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function boundedRecord(value: unknown, maxEntries = 20): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .slice(0, maxEntries)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, child]) => [key.slice(0, MAX_INSPECT_LABEL_CHARS), child.slice(0, 500)]))
}

function boundedDiagnostics(value: unknown, compact = false): Record<string, unknown> {
  const diagnostics = isRecord(value) ? value : {}
  const errors = Array.isArray(diagnostics.errors) ? diagnostics.errors : []
  const consoleEntries = Array.isArray(diagnostics.console) ? diagnostics.console : []
  const resourceFailures = Array.isArray(diagnostics.resourceFailures)
    ? diagnostics.resourceFailures
    : []
  const errorLimit = compact ? COMPACT_INSPECT_DIAGNOSTIC_ENTRIES : MAX_INSPECT_DIAGNOSTIC_ERRORS
  const consoleLimit = compact ? COMPACT_INSPECT_DIAGNOSTIC_ENTRIES : MAX_INSPECT_CONSOLE_ENTRIES
  const resourceLimit = compact ? COMPACT_INSPECT_DIAGNOSTIC_ENTRIES : MAX_INSPECT_RESOURCE_FAILURES
  const textLimit = compact ? 500 : 1_000
  const argLimit = compact ? 2 : 5
  const argChars = compact ? 300 : 500
  return {
    errors: errors.slice(0, errorLimit).flatMap((entry) => {
      if (!isRecord(entry)) return []
      return [{
        ...(typeof entry.message === "string" ? { message: entry.message.slice(0, textLimit) } : {}),
        ...(!compact && typeof entry.stack === "string"
          ? { stack: entry.stack.slice(0, 2_000) }
          : {}),
        ...(typeof entry.source === "string"
          ? { source: entry.source.slice(0, compact ? 500 : 1_000) }
          : {}),
        ...(finiteNumber(entry.line) !== undefined ? { line: finiteNumber(entry.line) } : {}),
        ...(finiteNumber(entry.col) !== undefined ? { col: finiteNumber(entry.col) } : {}),
      }]
    }),
    console: consoleEntries.slice(0, consoleLimit).flatMap((entry) => {
      if (!isRecord(entry)) return []
      return [{
        ...(typeof entry.level === "string" ? { level: entry.level.slice(0, 20) } : {}),
        args: (Array.isArray(entry.args) ? entry.args : [])
          .slice(0, argLimit)
          .flatMap((arg) => typeof arg === "string" ? [arg.slice(0, argChars)] : []),
      }]
    }),
    resourceFailures: resourceFailures.slice(0, resourceLimit).flatMap((entry) => {
      if (!isRecord(entry)) return []
      return [{
        ...(typeof entry.url === "string"
          ? { url: entry.url.slice(0, compact ? 500 : 1_000) }
          : {}),
        ...(finiteNumber(entry.status) !== undefined ? { status: finiteNumber(entry.status) } : {}),
        ...(typeof entry.reason === "string" ? { reason: entry.reason.slice(0, textLimit) } : {}),
      }]
    }),
    ...(typeof diagnostics.bridgeHandshake === "string"
      ? { bridgeHandshake: diagnostics.bridgeHandshake.slice(0, 50) }
      : {}),
  }
}

function boundedStructure(value: unknown, compact = false): Record<string, unknown> {
  const structure = isRecord(value) ? value : {}
  const computedStyles = Array.isArray(structure.computedStyles) ? structure.computedStyles : []
  return {
    ...(typeof structure.domSummary === "string"
      ? { domSummary: structure.domSummary.slice(0, compact ? 4_000 : MAX_INSPECT_DOM_SUMMARY_CHARS) }
      : {}),
    ...(typeof structure.renderedText === "string"
      ? { renderedText: structure.renderedText.slice(0, compact ? 2_000 : MAX_INSPECT_RENDERED_TEXT_CHARS) }
      : {}),
    computedStyles: computedStyles
      .slice(0, compact ? 5 : MAX_INSPECT_COMPUTED_STYLES)
      .map((entry) => boundedRecord(entry)),
    ...(typeof structure.bridgeState === "string"
      ? { bridgeState: structure.bridgeState.slice(0, 50) }
      : {}),
  }
}

function boundedAction(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return {
    ...(typeof value.type === "string" ? { type: value.type.slice(0, 50) } : {}),
    ...(typeof value.selector === "string"
      ? { selector: value.selector.slice(0, MAX_INSPECT_PATH_CHARS) }
      : {}),
    ...(typeof value.text === "string" ? { text: value.text.slice(0, 1_000) } : {}),
    ...(typeof value.key === "string" ? { key: value.key.slice(0, 100) } : {}),
    ...(typeof value.to === "string" ? { to: value.to.slice(0, 20) } : {}),
    ...(typeof value.value === "string" ? { value: value.value.slice(0, MAX_INSPECT_LABEL_CHARS) } : {}),
    ...(typeof value.label === "string" ? { label: value.label.slice(0, MAX_INSPECT_LABEL_CHARS) } : {}),
    ...(typeof value.checked === "boolean" ? { checked: value.checked } : {}),
  }
}

function boundedInteractables(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, limit).flatMap((entry) => {
    if (!isRecord(entry)) return []
    return [{
      ...(typeof entry.ref === "string" ? { ref: entry.ref.slice(0, MAX_INSPECT_LABEL_CHARS) } : {}),
      ...(typeof entry.kind === "string" ? { kind: entry.kind.slice(0, 50) } : {}),
      ...(typeof entry.name === "string" ? { name: entry.name.slice(0, MAX_INSPECT_LABEL_CHARS) } : {}),
      ...(typeof entry.selector === "string"
        ? { selector: entry.selector.slice(0, MAX_INSPECT_PATH_CHARS) }
        : {}),
      ...(typeof entry.visible === "boolean" ? { visible: entry.visible } : {}),
      ...(typeof entry.disabled === "boolean" ? { disabled: entry.disabled } : {}),
      ...(typeof entry.readonly === "boolean" ? { readonly: entry.readonly } : {}),
      ...(typeof entry.checked === "boolean" ? { checked: entry.checked } : {}),
      ...(typeof entry.selected === "boolean" ? { selected: entry.selected } : {}),
      ...(typeof entry.expanded === "boolean" ? { expanded: entry.expanded } : {}),
    }]
  })
}

function boundedActions(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_INSPECT_ACTIONS).flatMap((entry) => {
    if (!isRecord(entry)) return []
    const target = isRecord(entry.target) ? entry.target : undefined
    const effect = isRecord(entry.effect) ? entry.effect : undefined
    const error = isRecord(entry.error) ? entry.error : undefined
    return [{
      ...(finiteNumber(entry.step) !== undefined ? { step: finiteNumber(entry.step) } : {}),
      action: boundedAction(entry.action),
      ...(typeof entry.ok === "boolean" ? { ok: entry.ok } : {}),
      ...(finiteNumber(entry.matchedCount) !== undefined
        ? { matchedCount: finiteNumber(entry.matchedCount) }
        : {}),
      ...(target
        ? {
            target: {
              ...(typeof target.tag === "string" ? { tag: target.tag.slice(0, 100) } : {}),
              ...(typeof target.role === "string" ? { role: target.role.slice(0, 100) } : {}),
              ...(typeof target.name === "string"
                ? { name: target.name.slice(0, MAX_INSPECT_LABEL_CHARS) }
                : {}),
              ...(typeof target.selector === "string"
                ? { selector: target.selector.slice(0, MAX_INSPECT_PATH_CHARS) }
                : {}),
              ...(typeof target.visible === "boolean" ? { visible: target.visible } : {}),
              ...(typeof target.disabled === "boolean" ? { disabled: target.disabled } : {}),
              ...(typeof target.readonly === "boolean" ? { readonly: target.readonly } : {}),
            },
          }
        : {}),
      ...(effect
        ? {
            effect: {
              ...(typeof effect.domChanged === "boolean" ? { domChanged: effect.domChanged } : {}),
              ...(typeof effect.bridgeTriggered === "boolean"
                ? { bridgeTriggered: effect.bridgeTriggered }
                : {}),
            },
          }
        : {}),
      ...(error
        ? {
            error: {
              ...(typeof error.code === "string" ? { code: error.code.slice(0, 100) } : {}),
              ...(typeof error.message === "string" ? { message: error.message.slice(0, 1_000) } : {}),
            },
          }
        : {}),
    }]
  })
}

function boundedWait(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return {
    ...(typeof value.mode === "string" ? { mode: value.mode.slice(0, 50) } : {}),
    ...(typeof value.status === "string" ? { status: value.status.slice(0, 50) } : {}),
    ...(finiteNumber(value.waitedMs) !== undefined ? { waitedMs: finiteNumber(value.waitedMs) } : {}),
    ...(finiteNumber(value.activityBefore) !== undefined
      ? { activityBefore: finiteNumber(value.activityBefore) }
      : {}),
    ...(finiteNumber(value.activityAfter) !== undefined
      ? { activityAfter: finiteNumber(value.activityAfter) }
      : {}),
    ...(finiteNumber(value.triggerTimeoutMs) !== undefined
      ? { triggerTimeoutMs: finiteNumber(value.triggerTimeoutMs) }
      : {}),
    ...(finiteNumber(value.settleTimeoutMs) !== undefined
      ? { settleTimeoutMs: finiteNumber(value.settleTimeoutMs) }
      : {}),
    ...(typeof value.triggered === "boolean" ? { triggered: value.triggered } : {}),
    ...(typeof value.settled === "boolean" ? { settled: value.settled } : {}),
  }
}

function boundedDebugSession(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return {
    ...(typeof value.active === "boolean" ? { active: value.active } : {}),
    ...(typeof value.saveId === "string" ? { saveId: value.saveId.slice(0, MAX_INSPECT_LABEL_CHARS) } : {}),
    ...(typeof value.baselineCheckpointId === "string"
      ? { baselineCheckpointId: value.baselineCheckpointId.slice(0, MAX_INSPECT_LABEL_CHARS) }
      : {}),
    ...(finiteNumber(value.baselineTurn) !== undefined
      ? { baselineTurn: finiteNumber(value.baselineTurn) }
      : {}),
    ...(finiteNumber(value.startedAt) !== undefined ? { startedAt: finiteNumber(value.startedAt) } : {}),
    ...(typeof value.rollbackScope === "string"
      ? { rollbackScope: value.rollbackScope.slice(0, 50) }
      : {}),
  }
}

function boundedDiagnosticsSummary(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return {
    ...(finiteNumber(value.errors) !== undefined ? { errors: finiteNumber(value.errors) } : {}),
    ...(finiteNumber(value.consoleErrors) !== undefined
      ? { consoleErrors: finiteNumber(value.consoleErrors) }
      : {}),
    ...(finiteNumber(value.consoleWarnings) !== undefined
      ? { consoleWarnings: finiteNumber(value.consoleWarnings) }
      : {}),
    ...(finiteNumber(value.resourceFailures) !== undefined
      ? { resourceFailures: finiteNumber(value.resourceFailures) }
      : {}),
    ...(finiteNumber(value.resourceTimingAnomalies) !== undefined
      ? { resourceTimingAnomalies: finiteNumber(value.resourceTimingAnomalies) }
      : {}),
    ...(typeof value.resourceTimingAnomaliesCollapsed === "boolean"
      ? { resourceTimingAnomaliesCollapsed: value.resourceTimingAnomaliesCollapsed }
      : {}),
  }
}

function boundedFrontendBuild(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const error = isRecord(value.error) ? value.error : undefined
  return {
    ...(typeof value.status === "string" ? { status: value.status.slice(0, 50) } : {}),
    ...(value.lastBuiltAt === null
      ? { lastBuiltAt: null }
      : typeof value.lastBuiltAt === "string"
        ? { lastBuiltAt: value.lastBuiltAt.slice(0, 100) }
        : {}),
    ...(error
      ? {
          error: {
            ...(typeof error.message === "string" ? { message: error.message.slice(0, 1_000) } : {}),
            ...(typeof error.file === "string"
              ? { file: error.file.slice(0, MAX_INSPECT_PATH_CHARS) }
              : {}),
            ...(finiteNumber(error.line) !== undefined ? { line: finiteNumber(error.line) } : {}),
          },
        }
      : {}),
  }
}

function boundedSourceHints(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_INSPECT_SOURCE_HINTS).flatMap((entry) => {
    if (!isRecord(entry)) return []
    return [{
      ...(typeof entry.kind === "string" ? { kind: entry.kind.slice(0, 50) } : {}),
      ...(typeof entry.path === "string" ? { path: entry.path.slice(0, MAX_INSPECT_PATH_CHARS) } : {}),
      ...(finiteNumber(entry.line) !== undefined ? { line: finiteNumber(entry.line) } : {}),
      ...(typeof entry.confidence === "string" ? { confidence: entry.confidence.slice(0, 20) } : {}),
      ...(typeof entry.message === "string" ? { message: entry.message.slice(0, 1_000) } : {}),
    }]
  })
}

function boundedActivity(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_INSPECT_ACTIVITY).flatMap((entry) => {
    if (!isRecord(entry)) return []
    const error = isRecord(entry.error) ? entry.error : undefined
    return [{
      ...(finiteNumber(entry.sequence) !== undefined ? { sequence: finiteNumber(entry.sequence) } : {}),
      ...(typeof entry.requestId === "string"
        ? { requestId: entry.requestId.slice(0, MAX_INSPECT_LABEL_CHARS) }
        : {}),
      ...(typeof entry.method === "string" ? { method: entry.method.slice(0, 200) } : {}),
      ...(typeof entry.phase === "string" ? { phase: entry.phase.slice(0, 50) } : {}),
      ...(finiteNumber(entry.relativeMs) !== undefined
        ? { relativeMs: finiteNumber(entry.relativeMs) }
        : {}),
      ...(error
        ? {
            error: {
              ...(typeof error.code === "string" ? { code: error.code.slice(0, 100) } : {}),
              ...(typeof error.message === "string" ? { message: error.message.slice(0, 1_000) } : {}),
            },
          }
        : {}),
    }]
  })
}

function boundedRuntime(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return {
    ...(typeof value.status === "string" ? { status: value.status.slice(0, 50) } : {}),
    ...(finiteNumber(value.sendCount) !== undefined ? { sendCount: finiteNumber(value.sendCount) } : {}),
    ...(finiteNumber(value.inFlight) !== undefined ? { inFlight: finiteNumber(value.inFlight) } : {}),
    ...(finiteNumber(value.quietMs) !== undefined ? { quietMs: finiteNumber(value.quietMs) } : {}),
  }
}

function boundedRestored(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return {
    ...(typeof value.restored === "boolean" ? { restored: value.restored } : {}),
    ...(finiteNumber(value.restoredTurn) !== undefined
      ? { restoredTurn: finiteNumber(value.restoredTurn) }
      : {}),
    ...(typeof value.reloadReady === "boolean" ? { reloadReady: value.reloadReady } : {}),
  }
}

function boundedActionSnapshots(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_INSPECT_ACTION_SNAPSHOTS).flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.after)) return []
    return [{
      ...(finiteNumber(entry.step) !== undefined ? { step: finiteNumber(entry.step) } : {}),
      action: boundedAction(entry.action),
      after: {
        ...(typeof entry.after.domSummary === "string"
          ? { domSummary: entry.after.domSummary.slice(0, 1_000) }
          : {}),
        ...(typeof entry.after.bridgeState === "string"
          ? { bridgeState: entry.after.bridgeState.slice(0, 50) }
          : {}),
      },
    }]
  })
}

function boundedFileLineMap(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(Object.entries(value).slice(0, MAX_INSPECT_FILE_MAPS).map(([path, lines]) => [
    path.slice(0, MAX_INSPECT_PATH_CHARS),
    (Array.isArray(lines) ? lines : []).slice(0, 10).flatMap((entry) => {
      if (!isRecord(entry)) return []
      return [{
        ...(typeof entry.source === "string" ? { source: entry.source.slice(0, 500) } : {}),
        ...(finiteNumber(entry.line) !== undefined ? { line: finiteNumber(entry.line) } : {}),
      }]
    }),
  ]))
}

function boundedDiff(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  return {
    added: (Array.isArray(value.added) ? value.added : [])
      .slice(0, MAX_INSPECT_DIFF_PATHS)
      .flatMap((path) => typeof path === "string" ? [path.slice(0, MAX_INSPECT_PATH_CHARS)] : []),
    removed: (Array.isArray(value.removed) ? value.removed : [])
      .slice(0, MAX_INSPECT_DIFF_PATHS)
      .flatMap((path) => typeof path === "string" ? [path.slice(0, MAX_INSPECT_PATH_CHARS)] : []),
    changed: (Array.isArray(value.changed) ? value.changed : [])
      .slice(0, MAX_INSPECT_DIFF_PATHS)
      .flatMap((entry) => isRecord(entry)
        ? [{
            ...(typeof entry.path === "string"
              ? { path: entry.path.slice(0, MAX_INSPECT_PATH_CHARS) }
              : {}),
            ...(typeof entry.from === "string" ? { from: entry.from.slice(0, 500) } : {}),
            ...(typeof entry.to === "string" ? { to: entry.to.slice(0, 500) } : {}),
          }]
        : []),
  }
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Producer-owned aggregate bounds for inspect_frontend Agent delivery. */
export function deliverInspectFrontendResultToAgent(result: unknown): unknown {
  if (!isRecord(result)) return result
  const structure = isRecord(result.structure) ? result.structure : {}
  const interactables = Array.isArray(result.interactables) ? result.interactables : []
  const actions = Array.isArray(result.actions) ? result.actions : []
  const activity = Array.isArray(result.activity) ? result.activity : []
  const snapshots = Array.isArray(result.actionSnapshots) ? result.actionSnapshots : []
  const sourceHints = Array.isArray(result.sourceHints) ? result.sourceHints : []
  const diagnostics = isRecord(result.diagnostics) ? result.diagnostics : {}
  const diagnosticErrors = Array.isArray(diagnostics.errors) ? diagnostics.errors : []
  const diagnosticConsole = Array.isArray(diagnostics.console) ? diagnostics.console : []
  const resourceFailures = Array.isArray(diagnostics.resourceFailures)
    ? diagnostics.resourceFailures
    : []
  const omitted = {
    interactables: Math.max(0, interactables.length - MAX_INSPECT_INTERACTABLES),
    actions: Math.max(0, actions.length - MAX_INSPECT_ACTIONS),
    activity: Math.max(0, activity.length - MAX_INSPECT_ACTIVITY),
    actionSnapshots: Math.max(0, snapshots.length - MAX_INSPECT_ACTION_SNAPSHOTS),
    sourceHints: Math.max(0, sourceHints.length - MAX_INSPECT_SOURCE_HINTS),
    diagnosticErrors: Math.max(0, diagnosticErrors.length - MAX_INSPECT_DIAGNOSTIC_ERRORS),
    consoleEntries: Math.max(0, diagnosticConsole.length - MAX_INSPECT_CONSOLE_ENTRIES),
    resourceFailures: Math.max(0, resourceFailures.length - MAX_INSPECT_RESOURCE_FAILURES),
  }
  const wasTruncated = Object.values(omitted).some((count) => count > 0)
    || (typeof structure.domSummary === "string"
      && structure.domSummary.length > MAX_INSPECT_DOM_SUMMARY_CHARS)
    || (typeof structure.renderedText === "string"
      && structure.renderedText.length > MAX_INSPECT_RENDERED_TEXT_CHARS)

  const debugSession = boundedDebugSession(result.debugSession)
  const wait = boundedWait(result.wait)
  const boundedInteractableItems = boundedInteractables(result.interactables, MAX_INSPECT_INTERACTABLES)
  const boundedActionItems = boundedActions(result.actions)
  const diagnosticsSummary = boundedDiagnosticsSummary(result.diagnosticsSummary)
  const frontendBuild = boundedFrontendBuild(result.frontendBuild)
  const boundedSourceHintItems = boundedSourceHints(result.sourceHints)
  const boundedActivityItems = boundedActivity(result.activity)
  const runtime = boundedRuntime(result.runtime)
  const restored = boundedRestored(result.restored)
  const boundedSnapshotItems = boundedActionSnapshots(result.actionSnapshots)
  const fileLineMap = boundedFileLineMap(result.fileLineMap)
  const diff = boundedDiff(result.diff)
  const error = isRecord(result.error) ? result.error : undefined

  const delivered: Record<string, unknown> = {
    ...(typeof result.ok === "boolean" ? { ok: result.ok } : {}),
    ...(typeof result.operation === "string" ? { operation: result.operation.slice(0, 50) } : {}),
    ...(typeof result.cardId === "string" ? { cardId: result.cardId.slice(0, MAX_INSPECT_LABEL_CHARS) } : {}),
    ...(typeof result.entry === "string" ? { entry: result.entry.slice(0, MAX_INSPECT_PATH_CHARS) } : {}),
    ...(finiteNumber(result.frameGeneration) !== undefined
      ? { frameGeneration: finiteNumber(result.frameGeneration) }
      : {}),
    ...(debugSession ? { debugSession } : {}),
    structure: boundedStructure(result.structure),
    diagnostics: boundedDiagnostics(result.diagnostics),
    ...(wait ? { wait } : {}),
    ...(boundedInteractableItems.length ? { interactables: boundedInteractableItems } : {}),
    ...(boundedActionItems.length ? { actions: boundedActionItems } : {}),
    ...(diagnosticsSummary ? { diagnosticsSummary } : {}),
    ...(frontendBuild ? { frontendBuild } : {}),
    ...(boundedSourceHintItems.length ? { sourceHints: boundedSourceHintItems } : {}),
    ...(boundedActivityItems.length ? { activity: boundedActivityItems } : {}),
    ...(runtime ? { runtime } : {}),
    ...(restored ? { restored } : {}),
    ...(boundedSnapshotItems.length ? { actionSnapshots: boundedSnapshotItems } : {}),
    ...(fileLineMap ? { fileLineMap } : {}),
    ...(diff ? { diff } : {}),
    truncated: result.truncated === true || wasTruncated,
    ...(error
      ? {
          error: {
            ...(typeof error.code === "string" ? { code: error.code.slice(0, 100) } : {}),
            ...(typeof error.message === "string" ? { message: error.message.slice(0, 1_000) } : {}),
          },
        }
      : {}),
    delivery: {
      omitted,
      continuation: "Call inspect_frontend again after narrowing actions or resolving the reported diagnostics.",
    },
  }

  if (serializedLength(delivered) <= INSPECT_AGGREGATE_TARGET_CHARS) return delivered

  const compactInteractables = boundedInteractables(result.interactables, COMPACT_INSPECT_INTERACTABLES)
  return {
    ...(typeof result.ok === "boolean" ? { ok: result.ok } : {}),
    ...(typeof result.operation === "string" ? { operation: result.operation.slice(0, 50) } : {}),
    ...(typeof result.cardId === "string" ? { cardId: result.cardId.slice(0, MAX_INSPECT_LABEL_CHARS) } : {}),
    ...(typeof result.entry === "string" ? { entry: result.entry.slice(0, MAX_INSPECT_PATH_CHARS) } : {}),
    structure: boundedStructure(result.structure, true),
    diagnostics: boundedDiagnostics(result.diagnostics, true),
    ...(wait ? { wait } : {}),
    ...(diagnosticsSummary ? { diagnosticsSummary } : {}),
    ...(frontendBuild ? { frontendBuild } : {}),
    ...(runtime ? { runtime } : {}),
    ...(restored ? { restored } : {}),
    ...(compactInteractables.length ? { interactables: compactInteractables } : {}),
    truncated: true,
    delivery: {
      aggregateReduced: true,
      omitted: {
        interactables: Math.max(0, interactables.length - compactInteractables.length),
        actions: actions.length,
        activity: activity.length,
        actionSnapshots: snapshots.length,
        sourceHints: sourceHints.length,
        diagnosticErrors: Math.max(0, diagnosticErrors.length - COMPACT_INSPECT_DIAGNOSTIC_ENTRIES),
        consoleEntries: Math.max(0, diagnosticConsole.length - COMPACT_INSPECT_DIAGNOSTIC_ENTRIES),
        resourceFailures: Math.max(0, resourceFailures.length - COMPACT_INSPECT_DIAGNOSTIC_ENTRIES),
      },
      continuation: "The aggregate inspection exceeded its delivery budget. Inspect again with fewer actions or after narrowing the failing surface.",
    },
  }
}
