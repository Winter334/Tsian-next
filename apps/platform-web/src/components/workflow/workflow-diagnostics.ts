import type {
  NodeInputDeclaration,
  NodeOutputDeclaration,
  WorkflowDefinition,
  WorkflowNode,
} from '@tsian/contracts'
import {
  resolveWorkflowInputSlots,
  resolveWorkflowOutputSlots,
} from './node-schema'

export interface WorkflowDiagnosticResourceOption {
  id: string
  name: string
}

export interface WorkflowEditorDiagnosticOptions {
  promptPresetOptions?: ReadonlyArray<WorkflowDiagnosticResourceOption>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nodeName(node: WorkflowNode): string {
  const label = text(node.label)
  return label ? `${label}（${node.id}）` : node.id
}

function hasTextConfig(node: WorkflowNode, key: string): boolean {
  return text(node.config?.[key]).length > 0
}

function addUnique(messages: string[], message: string): void {
  if (!messages.includes(message)) messages.push(message)
}

function validateNodeConfig(
  node: WorkflowNode,
  messages: string[],
  options: WorkflowEditorDiagnosticOptions,
): void {
  const name = nodeName(node)

  if (!isRecord(node.config)) {
    addUnique(messages, `${name} 的节点配置必须是对象。`)
    return
  }

  if (node.type === 'ai-call') {
    const presetId = text(node.config.presetId)
    if (!presetId) {
      addUnique(messages, `${name} 需要选择提示词预设。`)
      return
    }
    const presets = options.promptPresetOptions ?? []
    if (presets.length > 0 && !presets.some((preset) => preset.id === presetId)) {
      addUnique(messages, `${name} 引用了不存在的提示词预设：${presetId}`)
    }
    return
  }

  if (node.type === 'state-query') {
    if (node.config.source !== 'collection') {
      addUnique(messages, `${name} 的状态查询来源必须是集合。`)
    }
    if (!hasTextConfig(node, 'namespace')) {
      addUnique(messages, `${name} 需要填写命名空间。`)
    }
    if (!hasTextConfig(node, 'collection')) {
      addUnique(messages, `${name} 需要填写集合名。`)
    }
    return
  }

  if (node.type === 'template-compose') {
    if (!hasTextConfig(node, 'template')) {
      addUnique(messages, `${name} 需要填写模板内容。`)
    }
    return
  }

  if (node.type === 'compute') {
    if (!hasTextConfig(node, 'script')) {
      addUnique(messages, `${name} 需要填写脚本内容。`)
    }
    return
  }

  if (node.type === 'record-merge') {
    const inputVarNames = node.config.inputVarNames
    const names = Array.isArray(inputVarNames)
      ? inputVarNames.filter((item) => text(item).length > 0)
      : []
    if (names.length === 0) {
      addUnique(messages, `${name} 至少需要一个输入变量。`)
    }
    return
  }

  if (node.type === 'record-format') {
    if (!hasTextConfig(node, 'itemTemplate')) {
      addUnique(messages, `${name} 需要填写单条记录模板。`)
    }
    return
  }

  if (node.type === 'switch') {
    const cases = node.config.cases
    if (!Array.isArray(cases)) {
      addUnique(messages, `${name} 的分支列表必须是数组。`)
      return
    }
    for (const [index, item] of cases.entries()) {
      if (!isRecord(item) || !text(item.when) || !text(item.outputName)) {
        addUnique(messages, `${name} 的第 ${index + 1} 个分支需要填写匹配值和输出名。`)
      }
    }
  }
}

function validatePorts(node: WorkflowNode, messages: string[]): void {
  const name = nodeName(node)
  const seenInputs = new Set<string>()
  for (const input of node.inputs ?? []) {
    const portName = text((input as NodeInputDeclaration).name)
    if (!portName) {
      addUnique(messages, `${name} 有一个输入端口缺少名称。`)
      continue
    }
    if (seenInputs.has(portName)) {
      addUnique(messages, `${name} 的输入端口 "${portName}" 重复。`)
    }
    seenInputs.add(portName)
  }

  const seenOutputs = new Set<string>()
  for (const output of node.outputs ?? []) {
    const portName = text((output as NodeOutputDeclaration).name)
    if (!portName) {
      addUnique(messages, `${name} 有一个输出端口缺少名称。`)
      continue
    }
    if (seenOutputs.has(portName)) {
      addUnique(messages, `${name} 的输出端口 "${portName}" 重复。`)
    }
    seenOutputs.add(portName)
  }
}

function validateEdges(def: WorkflowDefinition, messages: string[]): void {
  const nodeById = new Map(def.nodes.map((node) => [node.id, node]))

  for (const edge of def.edges) {
    const source = nodeById.get(edge.from.nodeId)
    const target = nodeById.get(edge.to.nodeId)
    if (!source || !target) continue

    const sourceSlots = resolveWorkflowOutputSlots(
      source.type,
      source.config,
      source.outputs,
    )
    const sourcePortName = edge.from.outputName ?? 'raw'
    if (
      sourceSlots.length > 0 &&
      !sourceSlots.some((slot) => slot.name === sourcePortName)
    ) {
      addUnique(
        messages,
        `${nodeName(source)} 没有名为 "${sourcePortName}" 的输出端口。`,
      )
    }

    const targetSlots = resolveWorkflowInputSlots(
      target.type,
      target.config,
      target.inputs,
    )
    if (
      targetSlots.length > 0 &&
      !targetSlots.some((slot) => slot.name === edge.to.varName)
    ) {
      addUnique(
        messages,
        `${nodeName(target)} 没有名为 "${edge.to.varName}" 的输入变量。`,
      )
    }
  }
}

export function collectWorkflowEditorDiagnostics(
  def: WorkflowDefinition,
  options: WorkflowEditorDiagnosticOptions = {},
): string[] {
  const messages: string[] = []
  for (const node of def.nodes) {
    validateNodeConfig(node, messages, options)
    validatePorts(node, messages)
  }
  validateEdges(def, messages)
  return messages
}
