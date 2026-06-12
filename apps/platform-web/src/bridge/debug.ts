import type { DebugBridge } from "@tsian/contracts"

import { subscribeTurnDebugReady } from "../debug-events"
import { getAiDebugRecords } from "../runtime-host/ai"

export function createDebugBridge(): DebugBridge {
  return {
    async getAiDebugRecords() {
      return getAiDebugRecords()
    },

    onTurnDebugReady(cb) {
      return subscribeTurnDebugReady(cb)
    },
  }
}
