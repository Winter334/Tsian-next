import type { DebugBridge } from "@tsian/contracts"

import { subscribeTurnDebugReady } from "../debug-events"

export function createDebugBridge(): DebugBridge {
  return {
    onTurnDebugReady(cb) {
      return subscribeTurnDebugReady(cb)
    },
  }
}
