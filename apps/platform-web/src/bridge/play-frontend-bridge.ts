import type { PlayFrontendBridge } from "@tsian/contracts"
import type { RuntimeEngine } from "@tsian/runtime-core"

export function createPlayFrontendBridge(
  engine: RuntimeEngine,
): PlayFrontendBridge {
  return {
    runtime: {
      getRuntimeSnapshot() {
        return engine.getSnapshot()
      },
    },
    interaction: {
      sendMessage(input) {
        return engine.sendMessage(input)
      },
    },
    query: {
      query(request) {
        return engine.query(request)
      },
    },
    platform: {
      getPlatformContext() {
        return engine.getPlatformContext()
      },
    },
  }
}
