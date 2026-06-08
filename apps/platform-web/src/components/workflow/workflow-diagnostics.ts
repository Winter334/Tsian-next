import type {
  NodeInputDeclaration,
  NodeOutputDeclaration,
  WorkflowDefinition,
  WorkflowStateModelLink,
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

function stateLinksForNode(
  def: WorkflowDefinition,
  nodeId: string,
  kind: WorkflowStateModelLink['kind'],
): WorkflowStateModelLink[] {
  return (def.stateModel?.links ?? []).filter((link) =>
    link.nodeId === nodeId && link.kind === kind,
  )
}

function hasTextConfig(node: WorkflowNode, key: string): boolean {
  return text(node.config?.[key]).length > 0
}

function addUnique(messages: string[], message: string): void {
  if (!messages.includes(message)) messages.push(message)
}

function validateNodeConfig(
  def: WorkflowDefinition,
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
    const readLinks = stateLinksForNode(def, node.id, 'read')
    if (node.config.source !== 'collection') {
      addUnique(messages, `${name} 的状态查询来源必须是集合。`)
    }
    if (readLinks.length === 0 && !hasTextConfig(node, 'namespace')) {
      addUnique(messages, `${name} 需要填写命名空间。`)
    }
    if (readLinks.length === 0 && !hasTextConfig(node, 'collection')) {
      addUnique(messages, `${name} 需要填写集合名。`)
    }
    return
  }

  if (node.type === 'state-write') {
    const writeLinks = stateLinksForNode(def, node.id, 'write')
    if (
      writeLinks.length === 0 &&
      !hasTextConfig(node, 'namespace') &&
      !hasTextConfig(node, 'collection') &&
      !isRecord(node.config.schema)
    ) {
      addUnique(messages, `${name} 需要连接状态数据库 collection，或在高级配置中填写写入目标。`)
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

function validateStateModel(def: WorkflowDefinition, messages: string[]): void {
  const stateModel = def.stateModel
  if (!stateModel) return

  const nodesById = new Map(def.nodes.map((node) => [node.id, node]))
  const collectionNames = new Set(Object.keys(stateModel.schema?.collections ?? {}))
  const anchorsById = new Map<string, NonNullable<typeof stateModel.anchors>[number]>()
  const linkKindsByAnchorId = new Map<string, Set<WorkflowStateModelLink['kind']>>()

  for (const anchor of stateModel.anchors ?? []) {
    if (!text(anchor.id)) {
      addUnique(messages, '状态数据库节点缺少锚点 ID。')
      continue
    }
    if (anchorsById.has(anchor.id)) {
      addUnique(messages, `状态数据库节点 ID "${anchor.id}" 重复。`)
    }
    anchorsById.set(anchor.id, anchor)

    const portIds = new Set<string>()
    for (const port of anchor.ports ?? []) {
      if (!text(port.id)) {
        addUnique(messages, `状态数据库节点 "${anchor.id}" 有一个端口缺少 ID。`)
        continue
      }
      if (portIds.has(port.id)) {
        addUnique(messages, `状态数据库节点 "${anchor.id}" 的端口 "${port.id}" 重复。`)
      }
      portIds.add(port.id)
      if (text(port.collection) && collectionNames.size > 0 && !collectionNames.has(port.collection!)) {
        addUnique(messages, `状态数据库端口 "${anchor.id}/${port.id}" 引用了不存在的 collection：${port.collection}`)
      }
    }
  }

  const readLinkCounts = new Map<string, number>()
  for (const link of stateModel.links ?? []) {
    const anchor = anchorsById.get(link.anchorId)
    const port = anchor?.ports.find((item) => item.id === link.portId)
    const targetNode = nodesById.get(link.nodeId)

    if (!anchor) {
      addUnique(messages, `状态模型连线 "${link.id}" 引用了不存在的数据库节点：${link.anchorId}`)
      continue
    }
    if (!port) {
      addUnique(messages, `状态模型连线 "${link.id}" 引用了不存在的数据库端口：${link.portId}`)
      continue
    }
    if (!text(port.collection)) {
      addUnique(messages, `状态模型连线 "${link.id}" 的数据库端口未绑定 collection。`)
      continue
    }
    if (!targetNode) {
      addUnique(messages, `状态模型连线 "${link.id}" 引用了不存在的工作流节点：${link.nodeId}`)
      continue
    }
    if (link.kind === 'read') {
      if (targetNode.type !== 'state-query') {
        addUnique(messages, `状态模型读取连线 "${link.id}" 只能连接到状态查询节点。`)
      }
      const kinds = linkKindsByAnchorId.get(link.anchorId) ?? new Set()
      kinds.add('read')
      linkKindsByAnchorId.set(link.anchorId, kinds)
      readLinkCounts.set(link.nodeId, (readLinkCounts.get(link.nodeId) ?? 0) + 1)
      continue
    }
    if (link.kind === 'write') {
      if (targetNode.type !== 'state-write') {
        addUnique(messages, `状态模型写入连线 "${link.id}" 只能从状态写入节点连接。`)
      }
      const kinds = linkKindsByAnchorId.get(link.anchorId) ?? new Set()
      kinds.add('write')
      linkKindsByAnchorId.set(link.anchorId, kinds)
      continue
    }
    addUnique(messages, `状态模型连线 "${link.id}" 的类型无效。`)
  }

  for (const [anchorId, kinds] of linkKindsByAnchorId) {
    if (!kinds.has('read') || !kinds.has('write')) continue
    const anchor = anchorsById.get(anchorId)
    const label = text(anchor?.label)
    addUnique(
      messages,
      `状态数据库节点 "${label || anchorId}" 同时读出和写回。请放置另一个状态数据库节点作为写入目标，避免画布形成闭环。`,
    )
  }

  for (const [nodeId, count] of readLinkCounts) {
    if (count > 1) {
      addUnique(messages, `状态查询节点 "${nodeId}" 在 MVP 中只能连接一个数据库 collection。`)
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
      !targetSlots.some((slot) => slot.name === edge.to.inputName)
    ) {
      addUnique(
        messages,
        `${nodeName(target)} 没有名为 "${edge.to.inputName}" 的输入端口。`,
      )
    }
  }
}

export function collectWorkflowEditorDiagnostics(
  def: WorkflowDefinition,
  options: WorkflowEditorDiagnosticOptions = {},
): string[] {
  const messages: string[] = []
  validateStateModel(def, messages)
  for (const node of def.nodes) {
    validateNodeConfig(def, node, messages, options)
    validatePorts(node, messages)
  }
  validateEdges(def, messages)
  return messages
}
