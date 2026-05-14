import type {
  DeepQueryRequest,
  DeepQueryResult,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformContextShell,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import type { RuntimeEngine } from "@tsian/runtime-core"
import { getCurrentNarrativeTime } from "../narrative-time"

export class LocalRuntimeEngine implements RuntimeEngine {
  private snapshot: RuntimeSnapshotShell = {
    version: "0.0.0",
    state: {
      turn: 0,
      messages: [],
      currentTime: getCurrentNarrativeTime(),
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
      "LocalRuntimeEngine.sendMessage is deprecated; platform-host runs the workflow path directly via interaction.sendMessage",
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

  /**
   * H8: 把一条 user 消息推入当前 snapshot.state.messages（不递增 turn）。
   *
   * design §13.6：turn++ 是平台壳职责；本方法仅追加消息。
   * 与旧 `sendMessageWithContext` 不同：不调 AI、不动 currentTime/globals。
   */
  appendUserMessage(content: string): void {
    const state = this.snapshot.state
    this.snapshot = {
      ...this.snapshot,
      state: {
        ...state,
        messages: [...state.messages, { role: "user", content }],
      },
    }
  }

  /**
   * H8: 把一条 assistant 消息推入当前 snapshot.state.messages（不递增 turn）。
   *
   * 由 platform-host 在工作流跑完后用 result 节点的 reply 字符串调用。
   */
  appendAssistantMessage(content: string): void {
    const state = this.snapshot.state
    this.snapshot = {
      ...this.snapshot,
      state: {
        ...state,
        messages: [...state.messages, { role: "assistant", content }],
      },
    }
  }

  applyRuntimeStatePatch(input: {
    currentTime?: string
    globals?: RuntimeGlobalsMap
  }): void {
    const state = this.snapshot.state
    const nextGlobals = input.globals
      ? {
          ...(state.globals ?? {}),
          ...input.globals,
        }
      : state.globals

    // 维护链只改运行时状态，不碰正文消息主线。
    this.snapshot = {
      ...this.snapshot,
      state: {
        ...state,
        currentTime: input.currentTime ?? state.currentTime,
        globals: nextGlobals,
      },
    }
  }
}
