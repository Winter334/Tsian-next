import type {
  DeepQueryRequest,
  DeepQueryResult,
  InvokeAgentRequest,
  InvokeAgentResult,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformContextShell,
  RuntimeSnapshotShell,
} from "@tsian/contracts"

export interface RuntimeEngine {
  getSnapshot(): Promise<RuntimeSnapshotShell>
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
  invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult>
  query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>
  getPlatformContext(): Promise<PlatformContextShell>
}
