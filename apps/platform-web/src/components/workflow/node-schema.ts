import type {
  NodeInputDeclaration,
  NodeOutputDeclaration,
  WorkflowNodeType,
} from '@tsian/contracts'
import {
  resolveDefinitionInputPorts,
  resolveDefinitionOutputPorts,
  type WorkflowPortDisplay,
} from './node-definitions'

export type { WorkflowPortDisplay }

export function resolveWorkflowInputSlots(
  nodeType: WorkflowNodeType,
  config: Record<string, unknown> | undefined,
  declarations: NodeInputDeclaration[] | undefined,
): WorkflowPortDisplay[] {
  return resolveDefinitionInputPorts(nodeType, config, declarations)
}

export function resolveWorkflowOutputSlots(
  nodeType: WorkflowNodeType,
  config: Record<string, unknown> | undefined,
  declarations: NodeOutputDeclaration[] | undefined,
): WorkflowPortDisplay[] {
  return resolveDefinitionOutputPorts(nodeType, config, declarations)
}
