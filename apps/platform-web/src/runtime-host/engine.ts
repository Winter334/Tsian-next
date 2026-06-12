import type {
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformContextShell,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import type { RuntimeEngine } from "@tsian/runtime-core"

export class LocalRuntimeEngine implements RuntimeEngine {
  private snapshot: RuntimeSnapshotShell = {
    version: "0.0.0",
    state: {
      turn: 0,
      messages: [],
      globals: {},
    },
  }

  async getSnapshot(): Promise<RuntimeSnapshotShell> {
    return this.snapshot
  }

  async sendMessage(
    _input: MessageInteractionRequest,
  ): Promise<MessageInteractionResult> {
    throw new Error(
      "LocalRuntimeEngine.sendMessage is not the active turn path; platform-host runs Agent Runtime turns.",
    )
  }

  async query<T = unknown>(
    _request: DeepQueryRequest,
  ): Promise<DeepQueryResult<T>> {
    return {
      items: [],
    }
  }

  async getPlatformContext(): Promise<PlatformContextShell> {
    return {
      version: "0.0.0",
    }
  }

  loadSnapshot(snapshot: RuntimeSnapshotShell): void {
    this.snapshot = snapshot
  }

  replaceMessages(messages: ConversationMessageRecord[]): void {
    const state = this.snapshot.state
    this.snapshot = {
      ...this.snapshot,
      state: {
        ...state,
        messages: [...messages],
      },
    }
  }

  applyRuntimeStatePatch(input: {
    globals?: RuntimeGlobalsMap
  }): void {
    const state = this.snapshot.state
    const nextGlobals = input.globals
      ? {
          ...(state.globals ?? {}),
          ...input.globals,
        }
      : state.globals

    this.snapshot = {
      ...this.snapshot,
      state: {
        ...state,
        globals: nextGlobals,
      },
    }
  }

}
