import type {
  AiDebugRecord,
  RetrievalDebugRecord,
  WorkflowOutputsSnapshot,
} from "./debug"
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
  /** 应用维护 patch（平台兼容写入口，走共享 applier）。 */
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

/**
 * 调试桥（B3 / D5）。
 *
 * 性质：**只读观测**，含流式 / 瞬时数据。与旧的 `query("ai-debug" | "retrieval-debug" |
 * "workflow-debug")` 字符串路由并行存在（D12）；旧路径保留不删，next major 才下线。
 *
 * 设计要点：
 *   - 回调风格 `subscribe(cb): unsubscribe`，**不暴露 Vue ref**（D9，框架无关）
 *   - 实现方负责把内部 reactive 源（如 shallowRef / EventTarget）转成回调
 */
export interface DebugBridge {
  /** 订阅当前轮工作流输出变更（节点 stream），返回 unsubscribe 函数。 */
  subscribeWorkflow(cb: (snapshot: WorkflowOutputsSnapshot) => void): () => void
  /** 读最新一轮的检索调试记录（无则 null）。 */
  getRetrievalDebug(): Promise<RetrievalDebugRecord | null>
  /** 读 AI 调试环形缓冲快照（最近 N 条，跨轮混排）。 */
  getAiDebugRecords(): Promise<AiDebugRecord[]>
  /** 每轮结束（应用 patch 之后）触发一次，参数为 turn 编号；返回 unsubscribe 函数。 */
  onTurnDebugReady(cb: (turn: number) => void): () => void
}

export interface PlayFrontendBridge {
  runtime: RuntimeBridge
  interaction: InteractionBridge
  query: QueryBridge
  platform: PlatformBridge
  /**
   * B3：调试命名空间。原型期标记为可选以兼容只实现核心桥的旧前端；
   * platform-host 注入时必填，调用方可在订阅前做存在性判断。
   */
  debug?: DebugBridge
}
