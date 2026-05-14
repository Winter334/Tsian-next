import type {
  ApplyPatchOutput,
  DeepQueryRequest,
  DeepQueryResult,
  MaintenancePatchDocument,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformActionRequest,
  PlatformActionResult,
  PlatformContextShell,
  RuntimeSnapshotShell,
} from "./runtime"

export interface RuntimeBridge {
  getRuntimeSnapshot(): Promise<RuntimeSnapshotShell>
  /** 标记某个 archive 为玩家自身。命中评分时 rarity 强制 1.0。可重复调用，幂等。 */
  markArchiveAsPlayer(archiveId: string): Promise<void>
  /** 取消玩家身份（剧情切主控角色 / 误标修正）。archive 不存在或本来就不是玩家时静默成功。 */
  unmarkArchiveAsPlayer(archiveId: string): Promise<void>
  /** 查询当前所有玩家身份 archive id（调试 / UI 显示用） */
  listPlayerArchiveIds(): Promise<string[]>
  /** 应用维护 patch（与 apply-patch 节点共用 applier，HC-14） */
  applyPatch(patch: MaintenancePatchDocument): Promise<ApplyPatchOutput>
  /** 便捷写单个 globals 字段；path 为 dot-path 语法（如 "inventory.gold"） */
  updateGlobals(path: string, value: unknown): Promise<void>
  /** 在 messages 数组追加一条 user 消息，不递增 turn（§13.6） */
  appendUserMessage(content: string): Promise<void>
  /** 在 messages 数组追加一条 assistant 消息，不递增 turn（§13.6） */
  appendAssistantMessage(content: string): Promise<void>
}

export interface InteractionBridge {
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
}

export interface QueryBridge {
  query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>
}

export interface PlatformBridge {
  getPlatformContext(): Promise<PlatformContextShell>
  runAction(request: PlatformActionRequest): Promise<PlatformActionResult>
}

export interface PlayFrontendBridge {
  runtime: RuntimeBridge
  interaction: InteractionBridge
  query: QueryBridge
  platform: PlatformBridge
}
