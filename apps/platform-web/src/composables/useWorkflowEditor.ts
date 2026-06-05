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
} from '@tsian/contracts'
import { resolveWorkflowInputSlots } from '../components/workflow/node-schema'

// ---------------------------------------------------------------------------
// ID 生成器（简单计数器）
// ---------------------------------------------------------------------------

let counter = 0

function generateNodeId(type: WorkflowNodeType): string {
  return `${type}-${++counter}`
}

function defaultNodeConfig(type: WorkflowNodeType): Record<string, unknown> {
  if (type === 'memory-query') return { source: 'collection', queryVarName: 'query' }
  if (type === 'memory-write') return { operationsVarName: 'operations', pushCheckpointReason: 'none' }
  if (type === 'template-compose') return { template: '{{data}}', outputName: 'text' }
  if (type === 'record-filter') return { inputVarName: 'records', outputName: 'records', match: 'all', predicates: [] }
  if (type === 'record-merge') return { inputVarNames: ['records'], keyPath: 'id', outputName: 'records' }
  if (type === 'record-format') return { inputVarName: 'records', itemTemplate: '{{item.data.content}}', separator: '\n', outputName: 'text' }
  if (type === 'apply-patch') return { patchVarName: 'patch' }
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

// ---------------------------------------------------------------------------
// 类型映射：Tsian 契约 ↔ Vue Flow
// ---------------------------------------------------------------------------

/** 契约节点 → Vue Flow 节点 */
function toVfNode(node: WorkflowNode): Node {
  return {
    id: node.id,
    type: 'workflow-node',
    position: node.position ?? { x: 0, y: 0 },
    data: {
      nodeType: node.type,
      label: node.label,
      config: node.config,
      inputs: normalizeInputs(node.inputs),
      outputs: normalizeOutputs(node.outputs),
      retry: node.retry,
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
    type: 'neon-edge',
    data: {
      varName: edge.to.varName,
      condition: edge.condition,
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
  const selectedNodeId: Ref<string | null> = ref(null)

  // === 核心方法 ===

  /** 从契约类型加载到画布 */
  function loadWorkflowDefinition(def: WorkflowDefinition, options?: { autoLayout?: () => void }): void {
    const vfNodes = def.nodes.map(toVfNode)
    const nodeById = new Map(def.nodes.map((node) => [node.id, node]))
    nodes.value = vfNodes
    edges.value = def.edges.map((edge) => toVfEdge(edge, nodeById))
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
  }

  /** @deprecated 使用 loadWorkflowDefinition。 */
  const fromWorkflowDefinition = loadWorkflowDefinition

  /** 从画布导出为契约类型 */
  function toWorkflowDefinition(): WorkflowDefinition {
    return {
      nodes: nodes.value.map(fromVfNode),
      edges: edges.value.map(fromVfEdge),
    }
  }

  /** 添加节点（拖拽到画布时调用），返回新节点 ID */
  function addNode(type: WorkflowNodeType, position: { x: number; y: number }): string {
    const id = generateNodeId(type)
    const node: Node = {
      id,
      type: 'workflow-node',
      position,
      data: {
        nodeType: type,
        config: defaultNodeConfig(type),
        inputs: [],
        outputs: [],
        retry: undefined,
      },
    }
    nodes.value = [...nodes.value, node]
    return id
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
    selectedNodeId,
    fromWorkflowDefinition,
    loadWorkflowDefinition,
    toWorkflowDefinition,
    addNode,
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
