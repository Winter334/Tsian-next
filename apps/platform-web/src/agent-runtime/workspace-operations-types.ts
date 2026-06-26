import type {
  AgentContextEntry,
  WorkspaceDeleteResult,
  WorkspaceFile,
  WorkspaceOperationName,
  WorkspaceScope,
} from "@tsian/contracts"

export interface WorkspaceOperationError {
  code: string
  message: string
  details?: unknown
}

export interface WorkspaceOperationMutationAdapter {
  write(input: {
    scope: WorkspaceScope
    path: string
    content?: string
    data?: Blob
  }): WorkspaceFile | Promise<WorkspaceFile>
  delete(input: {
    scope: WorkspaceScope
    path: string
  }): WorkspaceDeleteResult | Promise<WorkspaceDeleteResult>
}

export interface WorkspaceOperationExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  actorLevel?: number
  exposedOperations?: Iterable<WorkspaceOperationName>
  mutations?: WorkspaceOperationMutationAdapter
  /** semantic_search 专用:owner id(save-runtime 下为 saveId),用于按 owner
   *  从向量库取/枚举该 owner 的语料. 其它 op 不用. */
  semanticSearchOwnerId?: string
}

export const WORKSPACE_OPERATION_NAMES = {
  list: "list",
  search: "search",
  read: "read",
  glob: "glob",
  diff: "diff",
  write: "write",
  edit: "edit",
  move: "move",
  delete: "delete",
  validate: "validate",
  semantic_search: "semantic_search",
} as const satisfies Record<WorkspaceOperationName, WorkspaceOperationName>

export const DEFAULT_RUNTIME_WORKSPACE_OPERATIONS: WorkspaceOperationName[] = [
  "list",
  "search",
  "read",
  "glob",
  "semantic_search",
]

export const AUTHORING_WORKSPACE_OPERATIONS: WorkspaceOperationName[] = [
  "list",
  "search",
  "read",
  "glob",
  "diff",
  "write",
  "edit",
  "move",
  "delete",
  "validate",
]
