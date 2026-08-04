export const SOURCE_TEXTURE_ANIMATION_MAX_MS = 900
export const SOURCE_TEXTURE_ANIMATION_SETTLE_MAX_MS = 300

interface SourceTextureAnimationState {
  activeTransitions: number
  expiresAt: number
}

export interface SourceTextureAnimationFrame {
  readonly activeSourceIds: readonly string[]
  readonly expiredSourceIds: readonly string[]
}

export function shouldQueueNextSourceTexturePaint(
  record: Pick<{ dirty: boolean; released: boolean }, "dirty" | "released">,
): boolean {
  return !record.released && !record.dirty
}

export type SourceTextureAnimationSettlementAction =
  | "wait"
  | "request-final"
  | "complete"
  | "drop"

export function sourceTextureAnimationSettlementAction(
  record: Pick<{ dirty: boolean; released: boolean }, "dirty" | "released">,
  finalRequested: boolean,
): SourceTextureAnimationSettlementAction {
  if (record.released) return "drop"
  if (record.dirty) return "wait"
  return finalRequested ? "complete" : "request-final"
}

/**
 * Tracks opt-in CSS transitions whose computed intermediate frames must be
 * recaptured by HTML-in-Canvas. Transition events are the normal completion
 * path; the deadline is a liveness guard for canceled/omitted end events.
 */
export class SourceTextureAnimationTracker {
  private readonly stateBySourceId = new Map<string, SourceTextureAnimationState>()

  constructor(private readonly maxDurationMs = SOURCE_TEXTURE_ANIMATION_MAX_MS) {}

  begin(sourceId: string, timestamp: number): void {
    const current = this.stateBySourceId.get(sourceId)
    this.stateBySourceId.set(sourceId, {
      activeTransitions: (current?.activeTransitions ?? 0) + 1,
      // The deadline bounds one continuously-active Source animation batch.
      // Additional properties may join that batch, but they must not keep
      // extending it indefinitely through repeated transitionrun events.
      expiresAt: current?.expiresAt ?? timestamp + this.maxDurationMs,
    })
  }

  end(sourceId: string): boolean {
    const current = this.stateBySourceId.get(sourceId)
    if (!current) return false
    if (current.activeTransitions > 1) {
      current.activeTransitions -= 1
      return true
    }
    this.stateBySourceId.delete(sourceId)
    return false
  }

  has(sourceId: string): boolean {
    return this.stateBySourceId.has(sourceId)
  }

  hasAny(): boolean {
    return this.stateBySourceId.size > 0
  }

  settle(sourceId: string): boolean {
    return this.stateBySourceId.delete(sourceId)
  }

  frame(timestamp: number): SourceTextureAnimationFrame {
    const activeSourceIds: string[] = []
    const expiredSourceIds: string[] = []
    for (const [sourceId, state] of this.stateBySourceId) {
      if (timestamp >= state.expiresAt) {
        this.stateBySourceId.delete(sourceId)
        expiredSourceIds.push(sourceId)
      } else {
        activeSourceIds.push(sourceId)
      }
    }
    return { activeSourceIds, expiredSourceIds }
  }

  settleAll(): readonly string[] {
    const sourceIds = [...this.stateBySourceId.keys()]
    this.stateBySourceId.clear()
    return sourceIds
  }

  retain(sourceIds: ReadonlySet<string>): void {
    for (const sourceId of this.stateBySourceId.keys()) {
      if (!sourceIds.has(sourceId)) this.stateBySourceId.delete(sourceId)
    }
  }
}
