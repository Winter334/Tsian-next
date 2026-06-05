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
  semanticSlot?: string
  required?: boolean
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
    semanticSlot: declaration.semanticSlot,
    required: 'required' in declaration ? declaration.required : undefined,
  }
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

function switchOutputSlots(config: Record<string, unknown> | undefined): WorkflowPortDisplay[] {
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
    semanticSlot: `switch.${name}`,
  }))
}

export function resolveWorkflowInputSlots(
  nodeType: WorkflowNodeType,
  config: Record<string, unknown> | undefined,
  declarations: NodeInputDeclaration[] | undefined,
): WorkflowPortDisplay[] {
  const explicit = (declarations ?? [])
    .map(portFromDeclaration)
    .filter((port): port is WorkflowPortDisplay => port !== null)
  if (explicit.length > 0) return explicit

  if (nodeType === 'result') {
    return [{
      name: 'value',
      label: '结果值',
      valueType: 'unknown',
      semanticSlot: 'result.value',
      required: true,
    }]
  }

  if (nodeType === 'switch') {
    return [{
      name: 'value',
      label: '分支值',
      valueType: 'unknown',
      semanticSlot: 'switch.value',
      required: true,
    }]
  }

  if (nodeType === 'memory-query') {
    const name = readStringConfig(config, 'queryVarName', 'query')
    return [{
      name,
      label: '查询文本',
      valueType: 'string',
      semanticSlot: 'memory.query',
      required: false,
    }]
  }

  if (nodeType === 'state-write') {
    const name = readStringConfig(config, 'operationsVarName', 'operations')
    return [{
      name,
      label: '状态操作',
      valueType: 'object',
      semanticSlot: 'state.operations',
      required: true,
    }]
  }

  if (nodeType === 'template-compose') {
    return [{
      name: 'data',
      label: '模板数据',
      valueType: 'unknown',
      semanticSlot: 'template.data',
      required: false,
    }]
  }

  if (nodeType === 'record-filter') {
    const name = readStringConfig(config, 'inputVarName', 'records')
    return [{
      name,
      label: '记录',
      valueType: 'array',
      semanticSlot: 'record.input',
      required: true,
    }]
  }

  if (nodeType === 'record-merge') {
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
      semanticSlot: 'record.input',
      required: index === 0,
    })))
  }

  if (nodeType === 'record-format') {
    const name = readStringConfig(config, 'inputVarName', 'records')
    return [{
      name,
      label: '记录',
      valueType: 'array',
      semanticSlot: 'record.input',
      required: true,
    }]
  }

  return []
}

export function resolveWorkflowOutputSlots(
  nodeType: WorkflowNodeType,
  config: Record<string, unknown> | undefined,
  declarations: NodeOutputDeclaration[] | undefined,
): WorkflowPortDisplay[] {
  const explicit = (declarations ?? [])
    .map(portFromDeclaration)
    .filter((port): port is WorkflowPortDisplay => port !== null)

  if (nodeType === 'ai-call') {
    return dedupePorts([
      {
        name: 'raw',
        label: '原始文本',
        valueType: 'string',
        semanticSlot: 'ai.raw',
      },
      ...explicit,
    ])
  }

  if (nodeType === 'compute') return explicit

  if (nodeType === 'switch') return switchOutputSlots(config)

  if (nodeType === 'memory-query') {
    return [
      {
        name: 'records',
        label: '记忆记录',
        valueType: 'array',
        semanticSlot: 'memory.records',
      },
      {
        name: 'count',
        label: '记录数量',
        valueType: 'number',
        semanticSlot: 'memory.count',
      },
    ]
  }

  if (nodeType === 'state-write') {
    return [
      {
        name: 'upsertedIds',
        label: '写入 ID',
        valueType: 'array',
        semanticSlot: 'state.upsertedIds',
      },
      {
        name: 'deletedIds',
        label: '删除 ID',
        valueType: 'array',
        semanticSlot: 'state.deletedIds',
      },
      {
        name: 'clearedCollections',
        label: '清空集合',
        valueType: 'array',
        semanticSlot: 'state.clearedCollections',
      },
    ]
  }

  if (nodeType === 'template-compose') {
    const name = readStringConfig(config, 'outputName', 'text')
    return [{
      name,
      label: name,
      valueType: config?.parse === 'json' ? 'object' : 'string',
      semanticSlot: 'template.output',
    }]
  }

  if (nodeType === 'record-filter') {
    const name = readStringConfig(config, 'outputName', 'records')
    return [
      {
        name,
        label: '记录',
        valueType: 'array',
        semanticSlot: 'record.records',
      },
      {
        name: 'count',
        label: '记录数量',
        valueType: 'number',
        semanticSlot: 'record.count',
      },
    ]
  }

  if (nodeType === 'record-merge') {
    const name = readStringConfig(config, 'outputName', 'records')
    return [
      {
        name,
        label: '记录',
        valueType: 'array',
        semanticSlot: 'record.records',
      },
      {
        name: 'count',
        label: '记录数量',
        valueType: 'number',
        semanticSlot: 'record.count',
      },
    ]
  }

  if (nodeType === 'record-format') {
    const name = readStringConfig(config, 'outputName', 'text')
    return [
      {
        name,
        label: name,
        valueType: 'string',
        semanticSlot: 'record.text',
      },
      {
        name: 'count',
        label: '记录数量',
        valueType: 'number',
        semanticSlot: 'record.count',
      },
    ]
  }

  return []
}
