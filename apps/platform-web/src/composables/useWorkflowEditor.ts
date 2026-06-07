import { ref } from 'vue'
import type { Ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge as TsianEdge,
  WorkflowNodeType,
  NodeInputDeclaration,
  NodeOutputDeclaration,
  NodeOutputExtractRule,
  WorkflowPortValueType,
  WorkflowStateModel,
  WorkflowStateModelAnchor,
  WorkflowStateModelAnchorPort,
  WorkflowStateModelLink,
  WorkflowStateModelLinkKind,
} from '@tsian/contracts'
import { resolveWorkflowInputSlots } from '../components/workflow/node-schema'

export const WORKFLOW_NODE_VUE_TYPE = 'workflow-node'
export const STATE_DATABASE_NODE_VUE_TYPE = 'state-database-node'
export const WORKFLOW_EDGE_VUE_TYPE = 'neon-edge'
export const STATE_LINK_EDGE_VUE_TYPE = 'state-link-edge'
export const STATE_ANCHOR_NODE_ID_PREFIX = 'state-anchor:'
export const STATE_READ_HANDLE_PREFIX = 'state-read:'
export const STATE_WRITE_HANDLE_PREFIX = 'state-write:'

export function toStateAnchorVueNodeId(anchorId: string): string {
  return `${STATE_ANCHOR_NODE_ID_PREFIX}${anchorId}`
}

export function fromStateAnchorVueNodeId(nodeId: string): string {
  return nodeId.startsWith(STATE_ANCHOR_NODE_ID_PREFIX)
    ? nodeId.slice(STATE_ANCHOR_NODE_ID_PREFIX.length)
    : nodeId
}

export function toStateReadHandleId(portId: string): string {
  return `${STATE_READ_HANDLE_PREFIX}${portId}`
}

export function toStateWriteHandleId(portId: string): string {
  return `${STATE_WRITE_HANDLE_PREFIX}${portId}`
}

export function readStatePortIdFromHandle(
  handle: string | null | undefined,
): string | undefined {
  if (!handle) return undefined
  if (handle.startsWith(STATE_READ_HANDLE_PREFIX)) {
    return handle.slice(STATE_READ_HANDLE_PREFIX.length)
  }
  if (handle.startsWith(STATE_WRITE_HANDLE_PREFIX)) {
    return handle.slice(STATE_WRITE_HANDLE_PREFIX.length)
  }
  return undefined
}

// ---------------------------------------------------------------------------
// ID 生成器（简单计数器）
// ---------------------------------------------------------------------------

let counter = 0
let stateAnchorCounter = 0

function generateNodeId(type: WorkflowNodeType): string {
  return `${type}-${++counter}`
}

function generateStateAnchorId(): string {
  return `state-db-${++stateAnchorCounter}`
}

function defaultNodeConfig(type: WorkflowNodeType): Record<string, unknown> {
  if (type === 'state-query') return { source: 'collection', queryVarName: 'query' }
  if (type === 'state-write') return { operationsVarName: 'operations', pushCheckpointReason: 'none' }
  if (type === 'template-compose') return { template: '{{data}}', outputName: 'text' }
  if (type === 'record-filter') return { inputVarName: 'records', outputName: 'records', match: 'all', predicates: [] }
  if (type === 'record-merge') return { inputVarNames: ['records'], keyPath: 'id', outputName: 'records' }
  if (type === 'record-format') return { inputVarName: 'records', itemTemplate: '{{item.data.content}}', separator: '\n', outputName: 'text' }
  if (type === 'result') return { name: 'result' }
  if (type === 'switch') return { cases: [], defaultOutputName: 'default' }
  if (type === 'compute') return { script: 'return { value: inputs.value }', timeout: 5000 }
  return {}
}

const DEFAULT_OUTPUT_HANDLE = 'raw'
const TARGET_INPUT_HANDLE = 'input'

function normalizeSourceHandle(outputName?: string): string {
  return outputName || DEFAULT_OUTPUT_HANDLE
}

function denormalizeSourceHandle(handle?: string | null): string | undefined {
  return handle && handle !== DEFAULT_OUTPUT_HANDLE ? handle : undefined
}

function createEdgeId(edge: TsianEdge): string {
  return `${edge.from.nodeId}:${normalizeSourceHandle(edge.from.outputName)}->${edge.to.nodeId}:${edge.to.varName}`
}

function hasMissingOrStackedPositions(vfNodes: Node[]): boolean {
  if (vfNodes.length <= 1) return false
  const positions = vfNodes.map((node) => `${node.position.x},${node.position.y}`)
  return positions.length !== new Set(positions).size
}

function normalizeParse(value: unknown): NodeOutputExtractRule['parse'] {
  return value === 'json' || value === 'number' ? value : undefined
}

const VALUE_TYPES: ReadonlySet<WorkflowPortValueType> = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'unknown',
])

function normalizeValueType(value: unknown): WorkflowPortValueType | undefined {
  return typeof value === 'string' && VALUE_TYPES.has(value as WorkflowPortValueType)
    ? value as WorkflowPortValueType
    : undefined
}

function normalizePortMetadata(port: {
  label?: unknown
  description?: unknown
  valueType?: unknown
  semanticSlot?: unknown
}) {
  const label = typeof port.label === 'string' ? port.label.trim() : ''
  const description = typeof port.description === 'string' ? port.description.trim() : ''
  const semanticSlot = typeof port.semanticSlot === 'string' ? port.semanticSlot.trim() : ''
  return {
    label: label || undefined,
    description: description || undefined,
    valueType: normalizeValueType(port.valueType),
    semanticSlot: semanticSlot || undefined,
  }
}

function normalizeExtractRule(rule: unknown): NodeOutputExtractRule {
  if (typeof rule !== 'object' || rule === null) return { type: 'raw' }
  const candidate = rule as Partial<NodeOutputExtractRule>

  if (candidate.type === 'tag') {
    return {
      type: 'tag',
      tag: typeof candidate.tag === 'string' ? candidate.tag : '',
      parse: normalizeParse(candidate.parse),
    }
  }

  if (candidate.type === 'regex') {
    return {
      type: 'regex',
      pattern: typeof candidate.pattern === 'string' ? candidate.pattern : '',
      flags: typeof candidate.flags === 'string' ? candidate.flags : undefined,
      group: typeof candidate.group === 'number' ? candidate.group : undefined,
      parse: normalizeParse(candidate.parse),
    }
  }

  return {
    type: 'raw',
    parse: normalizeParse(candidate.parse),
  }
}

function normalizeInputs(inputs: unknown): NodeInputDeclaration[] {
  if (!Array.isArray(inputs)) return []
  return inputs
    .filter((input): input is Partial<NodeInputDeclaration> =>
      typeof input === 'object' && input !== null,
    )
    .map((input) => ({
      name: typeof input.name === 'string' ? input.name.trim() : '',
      ...normalizePortMetadata(input),
      required: typeof input.required === 'boolean' ? input.required : undefined,
    }))
}

function normalizeOutputs(outputs: unknown): NodeOutputDeclaration[] {
  if (!Array.isArray(outputs)) return []
  return outputs
    .filter((output): output is Partial<NodeOutputDeclaration> =>
      typeof output === 'object' && output !== null,
    )
    .map((output) => ({
      name: typeof output.name === 'string' ? output.name : '',
      extract: normalizeExtractRule(output.extract),
      ...normalizePortMetadata(output),
    }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeStateAnchorPort(
  port: unknown,
  index: number,
): WorkflowStateModelAnchorPort {
  const record = isRecord(port) ? port : {}
  const collection = optionalText(record.collection)
  return {
    id: optionalText(record.id) ?? collection ?? `port-${index + 1}`,
    collection,
    label: optionalText(record.label),
  }
}

function normalizeStateAnchor(anchor: unknown, index: number): WorkflowStateModelAnchor {
  const record = isRecord(anchor) ? anchor : {}
  const rawPosition = isRecord(record.position) ? record.position : undefined
  const ports = Array.isArray(record.ports)
    ? record.ports.map(normalizeStateAnchorPort)
    : []
  return {
    id: optionalText(record.id) ?? `state-db-${index + 1}`,
    kind: record.kind === 'database' ? 'database' : 'database',
    label: optionalText(record.label),
    position: rawPosition &&
      typeof rawPosition.x === 'number' &&
      typeof rawPosition.y === 'number'
      ? { x: rawPosition.x, y: rawPosition.y }
      : undefined,
    ports,
  }
}

function normalizeStateModel(value: unknown): WorkflowStateModel | undefined {
  if (!isRecord(value)) return undefined
  const anchors = Array.isArray(value.anchors)
    ? value.anchors.map(normalizeStateAnchor)
    : undefined
  const links = Array.isArray(value.links)
    ? value.links
      .filter((link): link is Partial<WorkflowStateModelLink> => isRecord(link))
      .map((link, index): WorkflowStateModelLink => {
        const kind: WorkflowStateModelLinkKind = link.kind === 'write' ? 'write' : 'read'
        return {
          id: optionalText(link.id) ?? `state-link-${index + 1}`,
          kind,
          anchorId: optionalText(link.anchorId) ?? '',
          portId: optionalText(link.portId) ?? '',
          nodeId: optionalText(link.nodeId) ?? '',
        }
      })
    : undefined
  const next: WorkflowStateModel = {
    schema: isRecord(value.schema)
      ? value.schema as unknown as WorkflowStateModel['schema']
      : undefined,
    globalsCollection: optionalText(value.globalsCollection),
    anchors,
    links,
  }
  return next.schema || next.globalsCollection || anchors?.length || links?.length
    ? next
    : undefined
}

function isStateAnchorNode(vfNode: Node): boolean {
  return vfNode.type === STATE_DATABASE_NODE_VUE_TYPE ||
    vfNode.data?.editorKind === 'state-anchor'
}

function isStateLinkEdge(vfEdge: Edge): boolean {
  return vfEdge.type === STATE_LINK_EDGE_VUE_TYPE ||
    vfEdge.data?.edgeKind === 'state-link'
}

// ---------------------------------------------------------------------------
// 类型映射：Tsian 契约 ↔ Vue Flow
// ---------------------------------------------------------------------------

/** 契约节点 → Vue Flow 节点 */
function toVfNode(
  node: WorkflowNode,
  stateModel: WorkflowStateModel | undefined,
): Node {
  return {
    id: node.id,
    type: WORKFLOW_NODE_VUE_TYPE,
    position: node.position ?? { x: 0, y: 0 },
    data: {
      editorKind: 'workflow',
      nodeType: node.type,
      label: node.label,
      config: node.config,
      inputs: normalizeInputs(node.inputs),
      outputs: normalizeOutputs(node.outputs),
      retry: node.retry,
      stateModel,
    },
  }
}

function toVfStateAnchor(
  anchor: WorkflowStateModelAnchor,
  stateModel: WorkflowStateModel | undefined,
): Node {
  return {
    id: toStateAnchorVueNodeId(anchor.id),
    type: STATE_DATABASE_NODE_VUE_TYPE,
    position: anchor.position ?? { x: 0, y: 0 },
    data: {
      editorKind: 'state-anchor',
      anchorKind: anchor.kind,
      label: anchor.label,
      ports: anchor.ports.map((port) => ({ ...port })),
      schema: stateModel?.schema,
      globalsCollection: stateModel?.globalsCollection,
    },
  }
}

/** Vue Flow 节点 → 契约节点 */
function fromVfNode(vfNode: Node): WorkflowNode {
  const inputs = normalizeInputs(vfNode.data.inputs)
  const outputs = normalizeOutputs(vfNode.data.outputs)
  return {
    id: vfNode.id,
    type: vfNode.data.nodeType as WorkflowNodeType,
    label: vfNode.data.label || undefined,
    config: vfNode.data.config as Record<string, unknown>,
    position: { x: vfNode.position.x, y: vfNode.position.y },
    inputs: inputs.length ? inputs : undefined,
    outputs: outputs.length ? outputs : undefined,
    retry: vfNode.data.retry,
  }
}

function fromVfStateAnchor(vfNode: Node): WorkflowStateModelAnchor {
  const rawPorts = Array.isArray(vfNode.data?.ports) ? vfNode.data.ports : []
  return {
    id: fromStateAnchorVueNodeId(vfNode.id),
    kind: 'database',
    label: optionalText(vfNode.data?.label),
    position: { x: vfNode.position.x, y: vfNode.position.y },
    ports: rawPorts.map(normalizeStateAnchorPort),
  }
}

function stateAnchorsFromNodes(vfNodes: Node[]): WorkflowStateModelAnchor[] {
  return vfNodes
    .filter(isStateAnchorNode)
    .map(fromVfStateAnchor)
}

function hasStateModelContent(model: WorkflowStateModel | undefined): boolean {
  return !!(
    model?.schema ||
    model?.globalsCollection ||
    model?.anchors?.length ||
    model?.links?.length
  )
}

/** 契约边 → Vue Flow 边 */
function toVfEdge(
  edge: TsianEdge,
  nodeById?: ReadonlyMap<string, WorkflowNode>,
): Edge {
  const targetNode = nodeById?.get(edge.to.nodeId)
  const targetSlots = targetNode
    ? resolveWorkflowInputSlots(targetNode.type, targetNode.config, targetNode.inputs)
    : []
  const targetHandle = targetSlots.some((slot) => slot.name === edge.to.varName)
    ? edge.to.varName
    : TARGET_INPUT_HANDLE

  return {
    id: createEdgeId(edge),
    source: edge.from.nodeId,
    sourceHandle: normalizeSourceHandle(edge.from.outputName),
    target: edge.to.nodeId,
    targetHandle,
    type: WORKFLOW_EDGE_VUE_TYPE,
    data: {
      edgeKind: 'workflow',
      varName: edge.to.varName,
      condition: edge.condition,
    },
  }
}

function createStateLinkId(link: Omit<WorkflowStateModelLink, 'id'>): string {
  return `state:${link.kind}:${link.anchorId}:${link.portId}->${link.nodeId}`
}

function toVfStateLink(link: WorkflowStateModelLink): Edge {
  const anchorNodeId = toStateAnchorVueNodeId(link.anchorId)
  const isRead = link.kind === 'read'
  return {
    id: link.id || createStateLinkId(link),
    source: isRead ? anchorNodeId : link.nodeId,
    sourceHandle: isRead ? toStateReadHandleId(link.portId) : undefined,
    target: isRead ? link.nodeId : anchorNodeId,
    targetHandle: isRead ? undefined : toStateWriteHandleId(link.portId),
    type: STATE_LINK_EDGE_VUE_TYPE,
    data: {
      edgeKind: 'state-link',
      stateLinkKind: link.kind,
      anchorId: link.anchorId,
      portId: link.portId,
      nodeId: link.nodeId,
    },
  }
}

/** Vue Flow 边 → 契约边 */
function fromVfEdge(vfEdge: Edge): TsianEdge {
  const targetHandleVarName = vfEdge.targetHandle && vfEdge.targetHandle !== TARGET_INPUT_HANDLE
    ? vfEdge.targetHandle
    : undefined
  const varName = typeof vfEdge.data?.varName === 'string' && vfEdge.data.varName.trim()
    ? vfEdge.data.varName.trim()
    : targetHandleVarName ?? 'value'

  return {
    from: {
      nodeId: vfEdge.source,
      outputName: denormalizeSourceHandle(vfEdge.sourceHandle),
    },
    to: {
      nodeId: vfEdge.target,
      varName,
    },
    condition: typeof vfEdge.data?.condition === 'string' && vfEdge.data.condition.trim()
      ? vfEdge.data.condition.trim()
      : undefined,
  }
}

function fromVfStateLink(vfEdge: Edge): WorkflowStateModelLink | null {
  const rawKind = vfEdge.data?.stateLinkKind
  const kind: WorkflowStateModelLinkKind = rawKind === 'write' ? 'write' : 'read'
  const anchorNodeId = kind === 'read' ? vfEdge.source : vfEdge.target
  const workflowNodeId = kind === 'read' ? vfEdge.target : vfEdge.source
  const handle = kind === 'read' ? vfEdge.sourceHandle : vfEdge.targetHandle
  const anchorId = optionalText(vfEdge.data?.anchorId) ?? fromStateAnchorVueNodeId(anchorNodeId)
  const portId = optionalText(vfEdge.data?.portId) ?? readStatePortIdFromHandle(handle)
  const nodeId = optionalText(vfEdge.data?.nodeId) ?? workflowNodeId
  if (!anchorId || !portId || !nodeId) return null
  const link = {
    id: vfEdge.id || createStateLinkId({ kind, anchorId, portId, nodeId }),
    kind,
    anchorId,
    portId,
    nodeId,
  }
  return link
}

function resolveTargetHandleFromVfNode(
  targetNode: Node | undefined,
  varName: string,
): string {
  if (!targetNode) return TARGET_INPUT_HANDLE
  const targetSlots = resolveWorkflowInputSlots(
    targetNode.data.nodeType as WorkflowNodeType,
    targetNode.data.config as Record<string, unknown>,
    normalizeInputs(targetNode.data.inputs),
  )
  return targetSlots.some((slot) => slot.name === varName)
    ? varName
    : TARGET_INPUT_HANDLE
}

// ---------------------------------------------------------------------------
// Composable 主体
// ---------------------------------------------------------------------------

export function useWorkflowEditor() {
  // === 响应式状态 ===
  const nodes: Ref<Node[]> = ref([])
  const edges: Ref<Edge[]> = ref([])
  const stateModel: Ref<WorkflowStateModel | undefined> = ref(undefined)
  const selectedNodeId: Ref<string | null> = ref(null)

  // === 核心方法 ===

  /** 从契约类型加载到画布 */
  function loadWorkflowDefinition(def: WorkflowDefinition, options?: { autoLayout?: () => void }): void {
    const normalizedStateModel = normalizeStateModel(def.stateModel)
    stateModel.value = normalizedStateModel
    const stateAnchors = normalizedStateModel?.anchors ?? []
    const vfNodes = [
      ...def.nodes.map((node) => toVfNode(node, normalizedStateModel)),
      ...stateAnchors.map((anchor) => toVfStateAnchor(anchor, normalizedStateModel)),
    ]
    const nodeById = new Map(def.nodes.map((node) => [node.id, node]))
    nodes.value = vfNodes
    edges.value = [
      ...def.edges.map((edge) => toVfEdge(edge, nodeById)),
      ...(normalizedStateModel?.links ?? []).map(toVfStateLink),
    ]
    selectedNodeId.value = null

    if (hasMissingOrStackedPositions(vfNodes) && options?.autoLayout) {
      options.autoLayout()
    }

    // 重置计数器，避免与已有节点 ID 冲突
    let maxId = 0
    for (const n of def.nodes) {
      const match = n.id.match(/-(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxId) maxId = num
      }
    }
    counter = maxId
    let maxStateAnchorId = 0
    for (const anchor of stateAnchors) {
      const match = anchor.id.match(/state-db-(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxStateAnchorId) maxStateAnchorId = num
      }
    }
    stateAnchorCounter = maxStateAnchorId
  }

  /** @deprecated 使用 loadWorkflowDefinition。 */
  const fromWorkflowDefinition = loadWorkflowDefinition

  /** 从画布导出为契约类型 */
  function toWorkflowDefinition(): WorkflowDefinition {
    const workflowNodes = nodes.value
      .filter((node) => !isStateAnchorNode(node))
      .map(fromVfNode)
    const workflowEdges = edges.value
      .filter((edge) => !isStateLinkEdge(edge))
      .map(fromVfEdge)
    const stateAnchors = nodes.value
      .filter(isStateAnchorNode)
      .map(fromVfStateAnchor)
    const stateLinks = edges.value
      .filter(isStateLinkEdge)
      .map(fromVfStateLink)
      .filter((link): link is WorkflowStateModelLink => link !== null)
    const nextStateModel: WorkflowStateModel | undefined =
      stateModel.value?.schema ||
      stateModel.value?.globalsCollection ||
      stateAnchors.length ||
      stateLinks.length
        ? {
          schema: stateModel.value?.schema,
          globalsCollection: stateModel.value?.globalsCollection,
          anchors: stateAnchors.length ? stateAnchors : undefined,
          links: stateLinks.length ? stateLinks : undefined,
        }
        : undefined

    const def: WorkflowDefinition = {
      nodes: workflowNodes,
      edges: workflowEdges,
    }
    if (nextStateModel) def.stateModel = nextStateModel
    return def
  }

  /** 添加节点（拖拽到画布时调用），返回新节点 ID */
  function addNode(type: WorkflowNodeType, position: { x: number; y: number }): string {
    const id = generateNodeId(type)
    const node: Node = {
      id,
      type: WORKFLOW_NODE_VUE_TYPE,
      position,
      data: {
        editorKind: 'workflow',
        nodeType: type,
        config: defaultNodeConfig(type),
        inputs: [],
        outputs: [],
        retry: undefined,
        stateModel: toWorkflowDefinition().stateModel,
      },
    }
    nodes.value = [...nodes.value, node]
    return id
  }

  function addStateDatabaseAnchor(position: { x: number; y: number }): string {
    const anchorId = generateStateAnchorId()
    const firstCollection = Object.keys(stateModel.value?.schema?.collections ?? {})[0]
    const anchor: WorkflowStateModelAnchor = {
      id: anchorId,
      kind: 'database',
      label: '状态数据库',
      position,
      ports: [
        {
          id: firstCollection ?? 'port-1',
          collection: firstCollection,
          label: firstCollection,
        },
      ],
    }
    const currentModel = stateModel.value ?? {}
    stateModel.value = {
      ...currentModel,
      anchors: [...(currentModel.anchors ?? []), anchor],
    }
    const node = toVfStateAnchor(anchor, stateModel.value)
    nodes.value = [...nodes.value, node]
    return node.id
  }

  function addStateModelLink(
    kind: WorkflowStateModelLinkKind,
    anchorNodeId: string,
    portId: string,
    workflowNodeId: string,
  ): string {
    const link: WorkflowStateModelLink = {
      id: createStateLinkId({
        kind,
        anchorId: fromStateAnchorVueNodeId(anchorNodeId),
        portId,
        nodeId: workflowNodeId,
      }),
      kind,
      anchorId: fromStateAnchorVueNodeId(anchorNodeId),
      portId,
      nodeId: workflowNodeId,
    }
    edges.value = [
      ...edges.value.filter((edge) => edge.id !== link.id),
      toVfStateLink(link),
    ]
    refreshStateModelNodeMetadata()
    return link.id
  }

  function syncStateModelNodeMetadata(nextModel: WorkflowStateModel | undefined): void {
    nodes.value = nodes.value.map((node) => {
      if (!isStateAnchorNode(node)) {
        return {
          ...node,
          data: {
            ...node.data,
            stateModel: nextModel,
          },
        }
      }
      return {
        ...node,
        data: {
          ...node.data,
          schema: nextModel?.schema,
          globalsCollection: nextModel?.globalsCollection,
        },
      }
    })
  }

  function setStateModel(nextModel: WorkflowStateModel | undefined): void {
    stateModel.value = hasStateModelContent(nextModel) ? nextModel : undefined
    syncStateModelNodeMetadata(stateModel.value)
  }

  function refreshStateModelNodeMetadata(): void {
    syncStateModelNodeMetadata(toWorkflowDefinition().stateModel)
  }

  function updateStateModelSchema(
    schema: WorkflowStateModel['schema'] | undefined,
    globalsCollection: string | undefined,
  ): void {
    const anchors = stateAnchorsFromNodes(nodes.value)
    const links = edges.value
      .filter(isStateLinkEdge)
      .map(fromVfStateLink)
      .filter((link): link is WorkflowStateModelLink => link !== null)
    setStateModel({
      ...(stateModel.value ?? {}),
      schema,
      globalsCollection,
      anchors: anchors.length ? anchors : undefined,
      links: links.length ? links : undefined,
    })
  }

  function updateStateDatabaseAnchor(
    anchorNodeId: string,
    patch: {
      label?: string
      ports?: WorkflowStateModelAnchorPort[]
    },
  ): void {
    const nextPortIds = new Set((patch.ports ?? []).map((port) => port.id))
    const shouldPrunePortLinks = patch.ports !== undefined

    nodes.value = nodes.value.map((node) => {
      if (node.id !== anchorNodeId || !isStateAnchorNode(node)) return node
      return {
        ...node,
        data: {
          ...node.data,
          label: patch.label !== undefined ? patch.label : node.data.label,
          ports: patch.ports
            ? patch.ports.map((port, index) => normalizeStateAnchorPort(port, index))
            : node.data.ports,
        },
      }
    })

    if (shouldPrunePortLinks) {
      const anchorId = fromStateAnchorVueNodeId(anchorNodeId)
      edges.value = edges.value.filter((edge) => {
        if (!isStateLinkEdge(edge)) return true
        const link = fromVfStateLink(edge)
        return !link ||
          link.anchorId !== anchorId ||
          nextPortIds.has(link.portId)
      })
    }

    setStateModel({
      ...(stateModel.value ?? {}),
      anchors: stateAnchorsFromNodes(nodes.value),
    })
  }

  function renameStateModelCollectionReference(previousName: string, nextName: string): void {
    const previous = previousName.trim()
    const next = nextName.trim()
    if (!previous || !next || previous === next) return

    nodes.value = nodes.value.map((node) => {
      if (!isStateAnchorNode(node)) return node
      const rawPorts: unknown[] = Array.isArray(node.data?.ports) ? node.data.ports : []
      return {
        ...node,
        data: {
          ...node.data,
          ports: rawPorts.map((port, index) => {
            const normalized = normalizeStateAnchorPort(port, index)
            if (normalized.collection !== previous) return normalized
            return {
              ...normalized,
              collection: next,
              label: normalized.label === previous ? next : normalized.label,
            }
          }),
        },
      }
    })

    setStateModel({
      ...(stateModel.value ?? {}),
      anchors: stateAnchorsFromNodes(nodes.value),
    })
  }

  function removeStateModelCollectionReference(collectionName: string): void {
    const collection = collectionName.trim()
    if (!collection) return

    nodes.value = nodes.value.map((node) => {
      if (!isStateAnchorNode(node)) return node
      const rawPorts: unknown[] = Array.isArray(node.data?.ports) ? node.data.ports : []
      return {
        ...node,
        data: {
          ...node.data,
          ports: rawPorts.map((port, index) => {
            const normalized = normalizeStateAnchorPort(port, index)
            if (normalized.collection !== collection) return normalized
            return {
              ...normalized,
              collection: undefined,
              label: normalized.label === collection ? undefined : normalized.label,
            }
          }),
        },
      }
    })

    setStateModel({
      ...(stateModel.value ?? {}),
      anchors: stateAnchorsFromNodes(nodes.value),
      globalsCollection: stateModel.value?.globalsCollection === collection
        ? undefined
        : stateModel.value?.globalsCollection,
    })
  }

  function clearStateModel(): void {
    stateModel.value = undefined
  }

  /** 删除选中的节点及其关联边 */
  function removeSelected(): void {
    if (!selectedNodeId.value) return
    const idToRemove = selectedNodeId.value
    nodes.value = nodes.value.filter((n) => n.id !== idToRemove)
    edges.value = edges.value.filter(
      (e) => e.source !== idToRemove && e.target !== idToRemove,
    )
    selectedNodeId.value = null
  }

  /** 更新节点配置 */
  function updateNodeConfig(nodeId: string, config: Record<string, unknown>): void {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    node.data = { ...node.data, config }
  }

  /** 更新节点自定义名称 */
  function updateNodeLabel(nodeId: string, label: string): void {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    node.data = { ...node.data, label: label || undefined }
  }

  /** 更新节点输出声明 */
  function updateNodeOutputs(nodeId: string, outputs: NodeOutputDeclaration[]): void {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    node.data = { ...node.data, outputs: normalizeOutputs(outputs) }
  }

  /** 更新节点输入声明 */
  function updateNodeInputs(nodeId: string, inputs: NodeInputDeclaration[]): void {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    node.data = { ...node.data, inputs: normalizeInputs(inputs) }
  }

  /** 更新边上的运行时入参名与条件 */
  function updateEdgeData(edgeId: string, data: { varName?: string; condition?: string }): void {
    edges.value = edges.value.map((edge) => {
      if (edge.id !== edgeId) return edge
      const currentVarName =
        typeof edge.data?.varName === 'string' && edge.data.varName.trim()
          ? edge.data.varName.trim()
          : 'value'
      const nextVarName = data.varName !== undefined
        ? data.varName.trim() || 'value'
        : currentVarName
      const nextData = {
        ...edge.data,
        varName: nextVarName,
        condition: data.condition || undefined,
      }
      const targetNode = nodes.value.find((node) => node.id === edge.target)
      const nextEdge = { ...edge, data: nextData }
      const contractEdge = fromVfEdge(nextEdge)
      return {
        ...nextEdge,
        targetHandle: resolveTargetHandleFromVfNode(targetNode, nextVarName),
        id: createEdgeId(contractEdge),
      }
    })
  }

  /** 更新节点重试配置 */
  function updateNodeRetry(nodeId: string, retry: { maxRetries: number } | undefined): void {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return
    node.data = { ...node.data, retry }
  }

  /** 导出工作流为 JSON 文件并触发下载 */
  function exportToJson(): void {
    const def = toWorkflowDefinition()
    const json = JSON.stringify(def, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** 从 JSON 文件导入工作流（弹出文件选择器） */
  function importFromJson(): Promise<string[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) { resolve([]); return }
        try {
          const text = await file.text()
          const def = JSON.parse(text)
          // 简单结构校验
          if (!def.nodes || !Array.isArray(def.nodes) || !def.edges || !Array.isArray(def.edges)) {
            resolve(['无效的工作流定义：缺少 nodes 或 edges 数组'])
            return
          }
          loadWorkflowDefinition(def)
          resolve([])
        } catch (e: any) {
          resolve([`导入失败: ${e.message ?? String(e)}`])
        }
      }
      input.click()
    })
  }

  return {
    nodes,
    edges,
    stateModel,
    selectedNodeId,
    fromWorkflowDefinition,
    loadWorkflowDefinition,
    toWorkflowDefinition,
    addNode,
    addStateDatabaseAnchor,
    addStateModelLink,
    updateStateModelSchema,
    updateStateDatabaseAnchor,
    renameStateModelCollectionReference,
    removeStateModelCollectionReference,
    clearStateModel,
    refreshStateModelNodeMetadata,
    removeSelected,
    updateNodeConfig,
    updateNodeLabel,
    updateNodeInputs,
    updateNodeOutputs,
    updateEdgeData,
    updateNodeRetry,
    exportToJson,
    importFromJson,
  }
}
