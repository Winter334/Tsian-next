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

  if (nodeType === 'apply-patch') {
    const name = readStringConfig(config, 'patchVarName', 'patch')
    return [{
      name,
      label: 'Patch',
      valueType: 'object',
      semanticSlot: 'maintenance.patch',
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

  if (nodeType === 'memory-write') {
    const name = readStringConfig(config, 'operationsVarName', 'operations')
    return [{
      name,
      label: '写入操作',
      valueType: 'object',
      semanticSlot: 'memory.operations',
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

  if (nodeType === 'apply-patch') {
    return [
      {
        name: 'appliedArchives',
        label: '已应用档案',
        valueType: 'array',
        semanticSlot: 'patch.appliedArchives',
      },
      {
        name: 'appliedEventIds',
        label: '已应用事件',
        valueType: 'array',
        semanticSlot: 'patch.appliedEventIds',
      },
      {
        name: 'globalsChanged',
        label: '全局已变更',
        valueType: 'boolean',
        semanticSlot: 'patch.globalsChanged',
      },
      {
        name: 'currentTimeChanged',
        label: '时间已变更',
        valueType: 'boolean',
        semanticSlot: 'patch.currentTimeChanged',
      },
    ]
  }

  if (nodeType === 'memory-query') {
    return [
      {
        name: 'prompt',
        label: '记忆提示',
        valueType: 'string',
        semanticSlot: 'memory.prompt',
      },
      {
        name: 'directEntities',
        label: '直接实体',
        valueType: 'array',
        semanticSlot: 'memory.directEntities',
      },
      {
        name: 'archives',
        label: '命中档案',
        valueType: 'array',
        semanticSlot: 'memory.archives',
      },
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
      {
        name: 'debug',
        label: '调试信息',
        valueType: 'object',
        semanticSlot: 'memory.debug',
      },
    ]
  }

  if (nodeType === 'memory-write') {
    return [
      {
        name: 'upsertedIds',
        label: '写入 ID',
        valueType: 'array',
        semanticSlot: 'memory.upsertedIds',
      },
      {
        name: 'deletedIds',
        label: '删除 ID',
        valueType: 'array',
        semanticSlot: 'memory.deletedIds',
      },
      {
        name: 'clearedCollections',
        label: '清空集合',
        valueType: 'array',
        semanticSlot: 'memory.clearedCollections',
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

  return []
}
