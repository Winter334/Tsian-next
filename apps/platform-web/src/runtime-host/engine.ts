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
import { generateAssistantReply } from "./ai"

export interface RuntimeMemoryContext {
  prompt?: string
}

export class LocalRuntimeEngine implements RuntimeEngine {
  private snapshot: RuntimeSnapshotShell = {
    version: "0.0.0",
    state: {
      turn: 0,
      messages: [],
      currentTime: new Date().toISOString(),
      globals: {},
    },
  }

  async getSnapshot(): Promise<RuntimeSnapshotShell> {
    return this.snapshot
  }

  async sendMessage(
    input: MessageInteractionRequest,
  ): Promise<MessageInteractionResult> {
    return this.sendMessageWithContext(input)
  }

  async sendMessageWithContext(
    input: MessageInteractionRequest,
    context: RuntimeMemoryContext = {},
  ): Promise<MessageInteractionResult> {
    const state = this.snapshot.state

    const nextTurn = state.turn + 1
    const nextMessages = [
      ...state.messages,
      { role: "user", content: input.content },
    ]

    let assistantContent = ""
    const aiMessages = [
      ...(context.prompt
        ? ([{ role: "system", content: context.prompt }] as Array<{
            role: "system"
            content: string
          }>)
        : []),
      ...(nextMessages as Array<{
        role: "user" | "assistant" | "system"
        content: string
      }>),
    ]

    try {
      assistantContent = await generateAssistantReply(aiMessages, {
        debugLabel: "main",
      })
    } catch (error) {
      assistantContent =
        error instanceof Error ? `[AI error] ${error.message}` : "[AI error]"
    }

    this.snapshot = {
      version: this.snapshot.version,
      state: {
        turn: nextTurn,
        messages: [
          ...nextMessages,
          {
            role: "assistant",
            content: assistantContent,
          },
        ],
        currentTime: state.currentTime,
        globals: state.globals,
      },
    }

    return {
      snapshot: await this.getSnapshot(),
    }
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
