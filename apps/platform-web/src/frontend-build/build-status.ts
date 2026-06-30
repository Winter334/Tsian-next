/**
 * Frontend build status tracking. Consumed by the `frontend-build-status`
 * query resource (Phase 4) so the assistant can read build errors and retry.
 *
 * Status is module-level (per cardId) — last build wins. No persistence:
 * a reload resets to idle. Sufficient for the online-edit loop where the
 * assistant reads status right after writing source.
 */
export interface FrontendBuildStatus {
  cardId: string
  status: "idle" | "building" | "ok" | "failed"
  lastBuiltAt: string | null
  error?: {
    message: string
    file?: string
    line?: number
  }
}

const buildStatusByCard = new Map<string, FrontendBuildStatus>()

function statusFor(cardId: string): FrontendBuildStatus {
  const existing = buildStatusByCard.get(cardId)
  if (existing) {
    return existing
  }
  const fresh: FrontendBuildStatus = {
    cardId,
    status: "idle",
    lastBuiltAt: null,
  }
  buildStatusByCard.set(cardId, fresh)
  return fresh
}

export function getFrontendBuildStatus(cardId: string): FrontendBuildStatus {
  return { ...statusFor(cardId) }
}

export function setFrontendBuildBuilding(cardId: string): void {
  const status = statusFor(cardId)
  status.status = "building"
  delete status.error
}

export function setFrontendBuildOk(cardId: string): void {
  const status = statusFor(cardId)
  status.status = "ok"
  status.lastBuiltAt = new Date().toISOString()
  delete status.error
}

export function setFrontendBuildFailed(
  cardId: string,
  error: { message: string; file?: string; line?: number },
): void {
  const status = statusFor(cardId)
  status.status = "failed"
  status.lastBuiltAt = new Date().toISOString()
  status.error = error
}
