import { buildFrontend } from "./engine"
import {
  getFrontendBuildStatus,
  setFrontendBuildBuilding,
  setFrontendBuildFailed,
  setFrontendBuildOk,
} from "./build-status"
import { emitFrontendReload, emitFrontendRebuildSettled, emitFrontendRebuilding } from "../lib/platform-events"

/**
 * Frontend rebuild trigger — the "assistant online-edit loop" (R6).
 *
 * When the assistant writes `frontend/src/**` via workspace.write, the
 * platform-host write path calls `triggerFrontendRebuild(cardId, path)`.
 * Writes are debounced per card (consecutive writes collapse into one
 * rebuild) so a multi-file edit doesn't fire N builds. After a successful
 * build, `emitFrontendReload()` notifies PlayView to remount the iframe.
 *
 * Build status is tracked per card (build-status.ts) so the assistant can
 * read `frontend-build-status` query resource to see ok/failed + error.
 * On failure the old dist is kept (engine throws before write-back), and
 * the error is recorded for the assistant to read and fix the source.
 *
 * Design ref: task 06-30 §7 (R6), §8 (build status).
 */

const SOURCE_PREFIX = "frontend/src/"
const DEBOUNCE_MS = 800

/** Per-card debounce timers. */
const rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** In-flight build promises so we don't start a second build while one runs. */
const inflightBuilds = new Map<string, Promise<void>>()

/** Is this path under frontend/src/ (a source write that should trigger a build)? */
export function isFrontendSourcePath(path: string): boolean {
  return path.startsWith(SOURCE_PREFIX)
}

/**
 * Fire-and-forget: schedule a debounced rebuild for a card after a source
 * write. Safe to call rapidly; consecutive calls within DEBOUNCE_MS collapse.
 * Caller must NOT await — this returns void and runs in the background.
 */
export function triggerFrontendRebuild(cardId: string, writtenPath: string): void {
  if (!cardId || !isFrontendSourcePath(writtenPath)) return

  const existing = rebuildTimers.get(cardId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    rebuildTimers.delete(cardId)
    void runRebuild(cardId)
  }, DEBOUNCE_MS)
  rebuildTimers.set(cardId, timer)
}

/** Run one rebuild, guarding against concurrent builds for the same card. */
async function runRebuild(cardId: string): Promise<void> {
  // If a build is already running for this card, wait for it then rebuild again.
  const inflight = inflightBuilds.get(cardId)
  if (inflight) {
    await inflight.catch(() => {})
    // After the prior build, re-schedule rather than build immediately so a
    // burst of writes during a build still collapses.
    void runRebuild(cardId)
    return
  }

  const promise = (async () => {
    setFrontendBuildBuilding(cardId)
    // Notify PlayView a rebuild is in flight so it can show a "rebuilding"
    // overlay — the player sees the old dist still mounted, with a hint that a
    // reload is coming. Cleared by emitFrontendReload (success) below or
    // emitFrontendRebuildSettled (failure).
    emitFrontendRebuilding()
    try {
      await buildFrontend(cardId)
      setFrontendBuildOk(cardId)
      emitFrontendReload()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setFrontendBuildFailed(cardId, { message })
      // Do NOT emit frontend-reload on failure — keep the old dist mounted.
      // But DO settle the rebuilding overlay so PlayView hides it.
      emitFrontendRebuildSettled()
    }
  })()

  inflightBuilds.set(cardId, promise)
  try {
    await promise
  } finally {
    inflightBuilds.delete(cardId)
  }
}

/** Synchronous status read for the query resource. */
export function readFrontendBuildStatus(cardId: string) {
  return getFrontendBuildStatus(cardId)
}
