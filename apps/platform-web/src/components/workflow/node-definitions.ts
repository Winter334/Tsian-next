import type {
  NodeInputDeclaration,
  NodeOutputDeclaration,
  WorkflowNodeType,
  WorkflowPortValueType,
} from '@tsian/contracts'

export interface WorkflowPortDisplay {
  name: string
  label?: string
  description?: string
  valueType?: WorkflowPortValueType
  required?: boolean
}

export interface NodeTypeInfo {
  /** 类型标识 */
  type: WorkflowNodeType
  /** 显示标签 */
  label: string
  /** 一句话描述 */
  description: string
  /** lucide 图标名称（字符串，组件侧按名称渲染） */
  icon: string
  /** 主题颜色（hex） */
  color: string
  /** Tailwind 颜色类（用于 border/bg） */
  colorClass: string
}

export type WorkflowNodeEditorKey =
  | 'ai-call'
  | 'result'
  | 'switch'
  | 'compute'
  | 'state-query'
  | 'state-write'
  | 'template-compose'
  | 'record-filter'
  | 'record-merge'
  | 'record-format'

export interface WorkflowConfigFieldDefinition {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'json' | 'string-list'
  required?: boolean
  default?: unknown
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  description?: string
}

export interface WorkflowNodeDefinition {
  type: WorkflowNodeType
  label: string
  description: string
  icon: string
  color: string
  colorClass: string
  category: string
  executorId: string
  editor: WorkflowNodeEditorKey
  defaultConfig: Record<string, unknown>
  configFields?: WorkflowConfigFieldDefinition[]
  allowCustomInputs?: boolean
  allowCustomOutputs?: boolean
  resolveInputs?: (
    config: Record<string, unknown> | undefined,
    declarations: NodeInputDeclaration[] | undefined,
  ) => WorkflowPortDisplay[]
  resolveOutputs?: (
    config: Record<string, unknown> | undefined,
    declarations: NodeOutputDeclaration[] | undefined,
  ) => WorkflowPortDisplay[]
}

function portFromDeclaration(
  declaration: NodeInputDeclaration | NodeOutputDeclaration,
): WorkflowPortDisplay | null {
  const name = declaration.name.trim()
  if (!name) return null
  return {
    name,
    label: declaration.label,
    description: declaration.description,
    valueType: declaration.valueType,
    required: 'required' in declaration ? declaration.required : undefined,
  }
}

function portsFromDeclarations(
  declarations: NodeInputDeclaration[] | NodeOutputDeclaration[] | undefined,
): WorkflowPortDisplay[] {
  return (declarations ?? [])
    .map(portFromDeclaration)
    .filter((port): port is WorkflowPortDisplay => port !== null)
}

function dedupePorts(ports: WorkflowPortDisplay[]): WorkflowPortDisplay[] {
  const byName = new Map<string, WorkflowPortDisplay>()
  for (const port of ports) {
    if (!port.name) continue
    byName.set(port.name, port)
  }
  return Array.from(byName.values())
}

function readStringConfig(
  config: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const raw = config?.[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
}

function switchOutputPorts(config: Record<string, unknown> | undefined): WorkflowPortDisplay[] {
  const cases = Array.isArray(config?.cases) ? config.cases : []
  const names = new Set<string>()
  for (const item of cases) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { outputName?: unknown }).outputName === 'string'
    ) {
      const name = (item as { outputName: string }).outputName.trim()
      if (name) names.add(name)
    }
  }

  const defaultOutputName = config?.defaultOutputName
  if (typeof defaultOutputName === 'string' && defaultOutputName.trim()) {
    names.add(defaultOutputName.trim())
  }

  return Array.from(names).map((name) => ({
    name,
    label: name,
    valueType: 'unknown',
  }))
}

function explicitOr(
  declarations: NodeInputDeclaration[] | undefined,
  fallback: () => WorkflowPortDisplay[],
): WorkflowPortDisplay[] {
  const explicit = portsFromDeclarations(declarations)
  return explicit.length > 0 ? explicit : fallback()
}

export const workflowNodeDefinitions: WorkflowNodeDefinition[] = [
  {
    type: 'ai-call',
    label: 'AI 调用',
    description: '调用 AI 模型生成文本',
    icon: 'Brain',
    color: '#00F0FF',
    colorClass: 'neon',
    category: 'ai',
    executorId: 'ai-call',
    editor: 'ai-call',
    defaultConfig: {},
    allowCustomInputs: true,
    allowCustomOutputs: true,
    resolveInputs: (_config, declarations) => portsFromDeclarations(declarations),
    resolveOutputs: (_config, declarations) =>
      dedupePorts([
        {
          name: 'raw',
          label: '原始文本',
          valueType: 'string',
        },
        ...portsFromDeclarations(declarations as NodeOutputDeclaration[] | undefined),
      ]),
  },
  {
    type: 'result',
    label: '结果',
    description: '工作流输出结果节点',
    icon: 'Flag',
    color: '#00FF88',
    colorClass: '[#00FF88]',
    category: 'flow',
    executorId: 'result',
    editor: 'result',
    defaultConfig: { name: 'result' },
    resolveInputs: (_config, declarations) =>
      explicitOr(declarations, () => [{
        name: 'value',
        label: '结果值',
        valueType: 'unknown',
        required: true,
      }]),
    resolveOutputs: () => [],
  },
  {
    type: 'switch',
    label: '条件分支',
    description: '按条件路由到不同输出',
    icon: 'GitBranch',
    color: '#FF8C00',
    colorClass: 'warning',
    category: 'flow',
    executorId: 'switch',
    editor: 'switch',
    defaultConfig: { cases: [], defaultOutputName: 'default' },
    resolveInputs: (_config, declarations) =>
      explicitOr(declarations, () => [{
        name: 'value',
        label: '分支值',
        valueType: 'unknown',
        required: true,
      }]),
    resolveOutputs: (config) => switchOutputPorts(config),
  },
  {
    type: 'compute',
    label: '计算',
    description: '执行自定义脚本计算',
    icon: 'Code',
    color: '#FFD600',
    colorClass: '[#FFD600]',
    category: 'logic',
    executorId: 'compute',
    editor: 'compute',
    defaultConfig: { script: 'return { value: inputs.value }', timeout: 5000 },
    allowCustomInputs: true,
    allowCustomOutputs: true,
    resolveInputs: (_config, declarations) => portsFromDeclarations(declarations),
    resolveOutputs: (_config, declarations) => portsFromDeclarations(declarations),
  },
  {
    type: 'state-query',
    label: '状态查询',
    description: '查询 save-scoped 持久状态集合',
    icon: 'Database',
    color: '#4FD1C5',
    colorClass: '[#4FD1C5]',
    category: 'state',
    executorId: 'state-query',
    editor: 'state-query',
    defaultConfig: { source: 'collection', queryVarName: 'query' },
    resolveInputs: (config, declarations) =>
      explicitOr(declarations, () => [{
        name: readStringConfig(config, 'queryVarName', 'query'),
        label: '查询文本',
        valueType: 'string',
        required: false,
      }]),
    resolveOutputs: () => [
      { name: 'records', label: '状态记录', valueType: 'array' },
      { name: 'count', label: '记录数量', valueType: 'number' },
    ],
  },
  {
    type: 'state-write',
    label: '状态写入',
    description: '写入 save-scoped 持久状态集合',
    icon: 'Save',
    color: '#F472B6',
    colorClass: '[#F472B6]',
    category: 'state',
    executorId: 'state-write',
    editor: 'state-write',
    defaultConfig: { operationsVarName: 'operations', pushCheckpointReason: 'none' },
    resolveInputs: (config, declarations) =>
      explicitOr(declarations, () => [{
        name: readStringConfig(config, 'operationsVarName', 'operations'),
        label: '状态操作',
        valueType: 'object',
        required: true,
      }]),
    resolveOutputs: () => [
      { name: 'upsertedIds', label: '写入 ID', valueType: 'array' },
      { name: 'deletedIds', label: '删除 ID', valueType: 'array' },
      { name: 'clearedCollections', label: '清空集合', valueType: 'array' },
    ],
  },
  {
    type: 'template-compose',
    label: '模板组合',
    description: '将输入变量组合为文本或 JSON',
    icon: 'FileText',
    color: '#A3E635',
    colorClass: '[#A3E635]',
    category: 'text',
    executorId: 'template-compose',
    editor: 'template-compose',
    defaultConfig: { template: '{{data}}', outputName: 'text' },
    resolveInputs: (_config, declarations) =>
      explicitOr(declarations, () => [{
        name: 'data',
        label: '模板数据',
        valueType: 'unknown',
        required: false,
      }]),
    resolveOutputs: (config) => [{
      name: readStringConfig(config, 'outputName', 'text'),
      label: readStringConfig(config, 'outputName', 'text'),
      valueType: config?.parse === 'json' ? 'object' : 'string',
    }],
  },
  {
    type: 'record-filter',
    label: '记录筛选',
    description: '按字段或标签筛选记录数组',
    icon: 'Filter',
    color: '#38BDF8',
    colorClass: '[#38BDF8]',
    category: 'record',
    executorId: 'record-filter',
    editor: 'record-filter',
    defaultConfig: { inputVarName: 'records', outputName: 'records', match: 'all', predicates: [] },
    resolveInputs: (config, declarations) =>
      explicitOr(declarations, () => [{
        name: readStringConfig(config, 'inputVarName', 'records'),
        label: '记录',
        valueType: 'array',
        required: true,
      }]),
    resolveOutputs: (config) => [
      { name: readStringConfig(config, 'outputName', 'records'), label: '记录', valueType: 'array' },
      { name: 'count', label: '记录数量', valueType: 'number' },
    ],
  },
  {
    type: 'record-merge',
    label: '记录合并',
    description: '合并并去重多组记录',
    icon: 'Combine',
    color: '#FB7185',
    colorClass: '[#FB7185]',
    category: 'record',
    executorId: 'record-merge',
    editor: 'record-merge',
    defaultConfig: { inputVarNames: ['records'], keyPath: 'id', outputName: 'records' },
    resolveInputs: (config, declarations) =>
      explicitOr(declarations, () => {
        const rawInputVarNames = config?.inputVarNames
        const names = Array.isArray(rawInputVarNames)
          ? rawInputVarNames
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
          : ['records']
        return dedupePorts(names.map((name, index) => ({
          name,
          label: index === 0 ? '记录' : `记录 ${index + 1}`,
          valueType: 'array',
          required: index === 0,
        })))
      }),
    resolveOutputs: (config) => [
      { name: readStringConfig(config, 'outputName', 'records'), label: '记录', valueType: 'array' },
      { name: 'count', label: '记录数量', valueType: 'number' },
    ],
  },
  {
    type: 'record-format',
    label: '记录格式化',
    description: '将记录数组格式化为文本',
    icon: 'Rows3',
    color: '#FACC15',
    colorClass: '[#FACC15]',
    category: 'record',
    executorId: 'record-format',
    editor: 'record-format',
    defaultConfig: {
      inputVarName: 'records',
      itemTemplate: '{{item.data.content}}',
      separator: '\n',
      outputName: 'text',
    },
    resolveInputs: (config, declarations) =>
      explicitOr(declarations, () => [{
        name: readStringConfig(config, 'inputVarName', 'records'),
        label: '记录',
        valueType: 'array',
        required: true,
      }]),
    resolveOutputs: (config) => [
      { name: readStringConfig(config, 'outputName', 'text'), label: readStringConfig(config, 'outputName', 'text'), valueType: 'string' },
      { name: 'count', label: '记录数量', valueType: 'number' },
    ],
  },
]

export const workflowNodeDefinitionMap = new Map<WorkflowNodeType, WorkflowNodeDefinition>(
  workflowNodeDefinitions.map((definition) => [definition.type, definition]),
)

export function getWorkflowNodeDefinition(type: WorkflowNodeType): WorkflowNodeDefinition | undefined {
  return workflowNodeDefinitionMap.get(type)
}

export function defaultWorkflowNodeConfig(type: WorkflowNodeType): Record<string, unknown> {
  return { ...(workflowNodeDefinitionMap.get(type)?.defaultConfig ?? {}) }
}

export function resolveDefinitionInputPorts(
  nodeType: WorkflowNodeType,
  config: Record<string, unknown> | undefined,
  declarations: NodeInputDeclaration[] | undefined,
): WorkflowPortDisplay[] {
  return workflowNodeDefinitionMap.get(nodeType)?.resolveInputs?.(config, declarations) ?? []
}

export function resolveDefinitionOutputPorts(
  nodeType: WorkflowNodeType,
  config: Record<string, unknown> | undefined,
  declarations: NodeOutputDeclaration[] | undefined,
): WorkflowPortDisplay[] {
  return workflowNodeDefinitionMap.get(nodeType)?.resolveOutputs?.(config, declarations) ?? []
}

export const nodeTypeRegistry: NodeTypeInfo[] = workflowNodeDefinitions.map((definition) => ({
  type: definition.type,
  label: definition.label,
  description: definition.description,
  icon: definition.icon,
  color: definition.color,
  colorClass: definition.colorClass,
}))

export const nodeTypeMap = new Map<WorkflowNodeType, NodeTypeInfo>(
  nodeTypeRegistry.map((info) => [info.type, info]),
)
