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
      async markArchiveAsPlayer() {
        throw new Error("markArchiveAsPlayer is not available in base runtime bridge.")
      },
      async unmarkArchiveAsPlayer() {
        throw new Error("unmarkArchiveAsPlayer is not available in base runtime bridge.")
      },
      async listPlayerArchiveIds() {
        return []
      },
      async applyPatch() {
        throw new Error("applyPatch is not available in base runtime bridge.")
      },
      async updateGlobals() {
        throw new Error("updateGlobals is not available in base runtime bridge.")
      },
      async appendUserMessage() {
        throw new Error("appendUserMessage is not available in base runtime bridge.")
      },
      async appendAssistantMessage() {
        throw new Error("appendAssistantMessage is not available in base runtime bridge.")
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
      async runAction() {
        return {
          ok: false,
          error: {
            code: "PLATFORM_ACTION_UNAVAILABLE",
            message: "Platform action is not available in base runtime bridge.",
          },
        }
      },
    },
  }
}
