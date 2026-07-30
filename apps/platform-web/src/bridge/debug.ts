import type { DebugBridge } from "@tsian/contracts"

import { subscribeTurnDebugReady } from "../debug-events"
import { exportDiagnosticBundle } from "../platform-host/diagnostic-bundle"
import {
  getDiagnosticFacets,
  getDiagnosticOverview,
  queryDiagnosticSummaries,
  readDiagnosticRecord,
  readDiagnosticStoreHealth,
  subscribeDiagnosticChanges,
} from "../platform-host/diagnostics"

export function createDebugBridge(): DebugBridge {
  return {
    onTurnDebugReady(cb) {
      return subscribeTurnDebugReady(cb)
    },
    queryDiagnosticSummaries,
    getDiagnosticRecord: readDiagnosticRecord,
    getDiagnosticFacets,
    getDiagnosticOverview,
    async getDiagnosticStoreHealth() {
      return readDiagnosticStoreHealth()
    },
    exportDiagnosticBundle,
    onDiagnosticRecordsChanged: subscribeDiagnosticChanges,
  }
}
