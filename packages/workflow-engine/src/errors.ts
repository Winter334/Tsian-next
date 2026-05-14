/**
 * 工作流引擎错误类型
 *
 * 设计原则（CLAUDE.md §7）：fail loud > fail silent。
 * - 加载期校验失败 → WorkflowValidationError（含 code 便于上层分类）
 * - 用户主动 abort → WorkflowAbortError
 * - 节点最终失败（重试用尽 / 不可重试错） → WorkflowNodeError（含 nodeId / attempts / cause）
 */

export type WorkflowValidationCode =
  | "DUPLICATE_NODE_ID"
  | "CYCLE_DETECTED"
  | "DANGLING_EDGE"
  | "APPLY_PATCH_INPUT_INCOMPLETE"
  | "MISSING_RESULT_NODE"
  | "MOD_REGISTERED_APPLY_PATCH"
  | "DUPLICATE_RESULT_NAME"
  | "UNKNOWN_NODE_TYPE"

export class WorkflowValidationError extends Error {
  public readonly code: WorkflowValidationCode

  constructor(code: WorkflowValidationCode, message: string) {
    super(message)
    this.name = "WorkflowValidationError"
    this.code = code
  }
}

export class WorkflowAbortError extends Error {
  constructor(message: string = "workflow aborted") {
    super(message)
    this.name = "WorkflowAbortError"
  }
}

export class WorkflowNodeError extends Error {
  public readonly nodeId: string
  public readonly attempts: number
  public readonly cause: unknown
  /** 便于上层 switch 分类的错误码 */
  public readonly code: string

  constructor(nodeId: string, attempts: number, cause: unknown, code = "NODE_RETRY_EXHAUSTED") {
    const causeMsg = cause instanceof Error ? cause.message : String(cause)
    super(`node "${nodeId}" failed after ${attempts} attempt(s): ${causeMsg}`)
    this.name = "WorkflowNodeError"
    this.nodeId = nodeId
    this.attempts = attempts
    this.cause = cause
    this.code = code
  }
}
