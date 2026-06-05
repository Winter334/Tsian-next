/**
 * @tsian/workflow-engine 公共导出
 *
 * 仅导出调度器、校验器与错误类型。
 * 节点 executor 的具体实现由 apps/platform-web/src/workflow-host/* 在 H4 注册。
 */

export {
  executeWorkflow,
  type NodeExecutor,
  type NodeExecuteArgs,
  type NodeExecuteResult,
  type WorkflowExecutionContext,
  type WorkflowResult,
  type ExecuteWorkflowOptions,
} from "./scheduler"

export {
  validateWorkflowDefinition,
  validateUniqueNodeIds,
  validateAcyclic,
  validateNoDanglingEdges,
  validateHasResultNode,
  validateUniqueResultNames,
  validateKnownNodeTypes,
} from "./validator"

export {
  WorkflowValidationError,
  WorkflowAbortError,
  WorkflowNodeError,
  type WorkflowValidationCode,
} from "./errors"

export type { OutputsStoreWriter } from "./types"
