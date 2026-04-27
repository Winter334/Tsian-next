import type {
  DeepQueryRequest,
  DeepQueryResult,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformContextShell,
  RuntimeSnapshotShell,
} from "@tsian/contracts"

export interface RuntimeEngine {
  getSnapshot(): Promise<RuntimeSnapshotShell>
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
  query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>
  getPlatformContext(): Promise<PlatformContextShell>
}
