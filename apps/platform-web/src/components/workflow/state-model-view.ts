import type {
  ComputedRef,
  InjectionKey,
} from 'vue'
import type {
  MemoryCollectionDefinition,
  MemoryFieldDefinition,
  MemoryFieldType,
  WorkflowNode,
  WorkflowStateModel,
  WorkflowStateModelLinkKind,
} from '@tsian/contracts'

export const workflowStateModelContextKey: InjectionKey<ComputedRef<WorkflowStateModel | undefined>> =
  Symbol('workflow-state-model-context')

export interface StateCollectionView {
  value: string
  key: string
  namespace: string
  collection: string
  label: string
  description: string
  displayName: string
  isGlobals: boolean
  schemaCollection?: MemoryCollectionDefinition
}

export interface StateFieldPathRow {
  name: string
  label: string
  typeLabel: string
  required: boolean
  description: string
  path: string
}

export const stateFieldTypeLabels: Record<MemoryFieldType, string> = {
  string: '文本',
  number: '数字',
  boolean: '开关',
  json: '任意内容',
  array: '列表',
  object: '结构',
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collectionKey(namespace: string, collection: string): string {
  return `${namespace}/${collection}`
}

function collectionValue(namespace: string, collection: string): string {
  return `${encodeURIComponent(namespace)}:${encodeURIComponent(collection)}`
}

function describeCollection(
  namespace: string,
  collection: string,
  schemaCollection: MemoryCollectionDefinition | undefined,
  globalsCollection: string | undefined,
): StateCollectionView {
  const label = readText(schemaCollection?.label) || collection
  const key = collectionKey(namespace, collection)
  const isGlobals = collection === globalsCollection
  return {
    value: collectionValue(namespace, collection),
    key,
    namespace,
    collection,
    label,
    description: readText(schemaCollection?.description),
    displayName: isGlobals ? `全局状态 (${key})` : `${label} (${key})`,
    isGlobals,
    schemaCollection,
  }
}

export function listStateCollectionViews(
  stateModel: WorkflowStateModel | undefined,
): StateCollectionView[] {
  const schema = stateModel?.schema
  const namespace = readText(schema?.defaultNamespace)
  return Object.entries(schema?.collections ?? {})
    .map(([collection, schemaCollection]) =>
      describeCollection(
        namespace,
        collection,
        schemaCollection,
        stateModel?.globalsCollection,
      ),
    )
    .sort((left, right) => left.collection.localeCompare(right.collection))
}

export function findStateCollectionView(
  stateModel: WorkflowStateModel | undefined,
  namespace: string | undefined,
  collection: string | undefined,
): StateCollectionView | undefined {
  const nextNamespace = readText(namespace)
  const nextCollection = readText(collection)
  if (!nextCollection) return undefined
  return listStateCollectionViews(stateModel).find((option) =>
    option.namespace === nextNamespace && option.collection === nextCollection,
  )
}

export function stateCollectionViewFromConfig(
  stateModel: WorkflowStateModel | undefined,
  config: { namespace?: unknown; collection?: unknown },
): StateCollectionView | undefined {
  const namespace = readText(config.namespace)
  const collection = readText(config.collection)
  if (!collection) return undefined
  return findStateCollectionView(stateModel, namespace, collection) ??
    describeCollection(namespace, collection, undefined, stateModel?.globalsCollection)
}

export function stateCollectionViewByValue(
  stateModel: WorkflowStateModel | undefined,
  value: string,
): StateCollectionView | undefined {
  return listStateCollectionViews(stateModel).find((option) => option.value === value)
}

export function resolveStateModelLinkTargets(
  stateModel: WorkflowStateModel | undefined,
  nodeId: string,
  kind: WorkflowStateModelLinkKind,
): StateCollectionView[] {
  const namespace = readText(stateModel?.schema?.defaultNamespace)
  const options = listStateCollectionViews(stateModel)
  const byCollection = new Map(options.map((option) => [option.collection, option]))
  const targets = new Map<string, StateCollectionView>()

  for (const link of stateModel?.links ?? []) {
    if (link.nodeId !== nodeId || link.kind !== kind) continue
    const anchor = stateModel?.anchors?.find((item) => item.id === link.anchorId)
    const port = anchor?.ports.find((item) => item.id === link.portId)
    const collection = readText(port?.collection)
    if (!collection) continue

    const view = byCollection.get(collection) ??
      describeCollection(namespace, collection, undefined, stateModel?.globalsCollection)
    targets.set(view.key, view)
  }

  return Array.from(targets.values()).sort((left, right) =>
    left.collection.localeCompare(right.collection),
  )
}

export function formatStateTargetList(targets: ReadonlyArray<StateCollectionView>): string {
  if (targets.length === 0) return '未绑定'
  return targets.map((target) => target.displayName).join('、')
}

export function formatStateNodeTargetSummary(
  stateModel: WorkflowStateModel | undefined,
  node: Pick<WorkflowNode, 'id' | 'type' | 'config'>,
): string {
  if (node.type === 'state-query') {
    const linkedTargets = resolveStateModelLinkTargets(stateModel, node.id, 'read')
    const target = linkedTargets[0] ??
      stateCollectionViewFromConfig(stateModel, node.config)
    return `读取: ${target ? target.displayName : '未绑定'}`
  }

  if (node.type === 'state-write') {
    const linkedTargets = resolveStateModelLinkTargets(stateModel, node.id, 'write')
    const targets = linkedTargets.length > 0
      ? linkedTargets
      : [
        stateCollectionViewFromConfig(
          stateModel,
          node.config,
        ),
      ].filter((target): target is StateCollectionView => target !== undefined)

    if (targets.length > 1) {
      return `写回: ${formatStateTargetList(targets)} · operations 需携带 collection`
    }
    const target = targets[0]
    if (!target) return '写回: operation 指定目标'
    const prefix = target.isGlobals ? '更新全局状态' : '写回'
    return `${prefix}: ${target.displayName} · 添加/更新/删除/清空`
  }

  return ''
}

export function collectionFieldPathRows(
  collection: MemoryCollectionDefinition | undefined,
): StateFieldPathRow[] {
  return Object.entries(collection?.fields ?? {}).map(([name, field]) => {
    const typedField = field as MemoryFieldDefinition
    return {
      name,
      label: typedField.label || typedField.render?.label || name,
      typeLabel: stateFieldTypeLabels[typedField.type] ?? typedField.type,
      required: typedField.required === true,
      description: typedField.description || typedField.render?.description || '',
      path: `records[].data.${name}`,
    }
  })
}
