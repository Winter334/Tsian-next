import type {
  AgentContextEntry,
  WorkspaceDeleteResult,
  WorkspaceFile,
  WorkspaceListResult,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspaceReadResult,
  WorkspaceScope,
  WorkspaceSearchResult,
  WorkspaceVolumeOwnerContext,
} from "@tsian/contracts"

/** Reserved virtual namespaces stay immutable even when no read adapter is mounted. */
export const BUILT_IN_READ_ONLY_VIRTUAL_WORKSPACE_PREFIXES = [
  ".tsian/local/diagnostics",
] as const

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
    /**
     * Volume dispatch 的 owner 解析上下文。runtime 层不填（不知 cardId/saveId），
     * 由 host adapter 闭包按 input.scope 填充（card-scope→cardId，save-scope→saveId）。
     */
    ownerContext: WorkspaceVolumeOwnerContext
  }): WorkspaceFile | Promise<WorkspaceFile>
  delete(input: {
    scope: WorkspaceScope
    path: string
    ownerContext: WorkspaceVolumeOwnerContext
  }): WorkspaceDeleteResult | Promise<WorkspaceDeleteResult>
}

/**
 * On-demand files that are intentionally absent from the eager WorkspaceFile
 * snapshot. Returning undefined means the adapter does not own the requested
 * path/query. Read-only prefixes reject mutation targets and source-mutating
 * operations; copy may read a virtual source and write an ordinary target.
 */
export interface WorkspaceOperationVirtualReadAdapter {
  readonlyPathPrefixes?: readonly string[]
  list(input: {
    scope: WorkspaceScope
    path: string
    actorLevel: number
  }): WorkspaceListResult | undefined
    | Promise<WorkspaceListResult | undefined>
  read(input: {
    scope: WorkspaceScope
    path: string
    actorLevel: number
    offset?: number
    limit?: number
    charOffset?: number
    charLimit?: number
  }): WorkspaceReadResult | undefined | Promise<WorkspaceReadResult | undefined>
  search(input: {
    scope: WorkspaceScope
    request: WorkspaceOperationRequest
    actorLevel: number
  }): WorkspaceSearchResult[] | undefined | Promise<WorkspaceSearchResult[] | undefined>
}

export interface WorkspaceOperationExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  actorLevel?: number
  exposedOperations?: Iterable<WorkspaceOperationName>
  /** Host-level visibility predicate for callers such as runtime game Agents. */
  fileFilter?: (file: WorkspaceFile) => boolean
  mutations?: WorkspaceOperationMutationAdapter
  virtualReads?: WorkspaceOperationVirtualReadAdapter
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
  copy: "copy",
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
  "copy",
  "move",
  "delete",
  "validate",
]
