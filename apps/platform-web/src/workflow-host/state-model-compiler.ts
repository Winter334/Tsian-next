import type {
  MemorySchemaDefinition,
  StateQueryNodeConfig,
  StateWriteNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowStateModel,
  WorkflowStateModelLink,
} from '@tsian/contracts'

interface LinkTarget {
  namespace: string
  collection: string
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readDefaultNamespace(schema: MemorySchemaDefinition | undefined): string | undefined {
  return optionalText(schema?.defaultNamespace)
}

function collectionTarget(
  stateModel: WorkflowStateModel,
  link: WorkflowStateModelLink,
): LinkTarget {
  const schema = stateModel.schema
  const namespace = readDefaultNamespace(schema)
  if (!namespace) {
    throw new Error(`stateModel link "${link.id}" requires schema.defaultNamespace`)
  }

  const anchor = stateModel.anchors?.find((item) => item.id === link.anchorId)
  if (!anchor) {
    throw new Error(`stateModel link "${link.id}" references missing anchor "${link.anchorId}"`)
  }

  const port = anchor.ports.find((item) => item.id === link.portId)
  if (!port) {
    throw new Error(`stateModel link "${link.id}" references missing port "${link.portId}"`)
  }

  const collection = optionalText(port.collection)
  if (!collection) {
    throw new Error(`stateModel link "${link.id}" references an unbound database port`)
  }

  if (!schema?.collections?.[collection]) {
    throw new Error(`stateModel link "${link.id}" references unknown collection "${collection}"`)
  }

  return { namespace, collection }
}

function ensureSingleBinding(
  map: Map<string, LinkTarget>,
  link: WorkflowStateModelLink,
  target: LinkTarget,
): void {
  const existing = map.get(link.nodeId)
  if (existing) {
    throw new Error(
      `stateModel node "${link.nodeId}" has multiple ${link.kind} database links`,
    )
  }
  map.set(link.nodeId, target)
}

function addWriteBinding(
  map: Map<string, LinkTarget[]>,
  link: WorkflowStateModelLink,
  target: LinkTarget,
): void {
  const existing = map.get(link.nodeId) ?? []
  if (
    existing.some((item) =>
      item.namespace === target.namespace && item.collection === target.collection,
    )
  ) {
    return
  }
  map.set(link.nodeId, [...existing, target])
}

function compileStateModelBindings(
  stateModel: WorkflowStateModel,
): {
  readTargets: Map<string, LinkTarget>
  writeTargets: Map<string, LinkTarget[]>
} {
  const readTargets = new Map<string, LinkTarget>()
  const writeTargets = new Map<string, LinkTarget[]>()

  for (const link of stateModel.links ?? []) {
    const target = collectionTarget(stateModel, link)
    if (link.kind === 'read') {
      ensureSingleBinding(readTargets, link, target)
      continue
    }
    if (link.kind === 'write') {
      addWriteBinding(writeTargets, link, target)
      continue
    }
    throw new Error(`stateModel link "${link.id}" has unsupported kind "${String(link.kind)}"`)
  }

  return { readTargets, writeTargets }
}

function compileNode(
  node: WorkflowNode,
  stateModel: WorkflowStateModel,
  readTargets: ReadonlyMap<string, LinkTarget>,
  writeTargets: ReadonlyMap<string, LinkTarget[]>,
): WorkflowNode {
  const readTarget = readTargets.get(node.id)
  if (readTarget) {
    if (node.type !== 'state-query') {
      throw new Error(`stateModel read link targets non-query node "${node.id}"`)
    }
    const config: StateQueryNodeConfig = {
      ...(node.config as Partial<StateQueryNodeConfig>),
      source: 'collection',
      namespace: readTarget.namespace,
      collection: readTarget.collection,
    }
    return { ...node, config: config as unknown as Record<string, unknown> }
  }

  const writeTargetsForNode = writeTargets.get(node.id)
  if (writeTargetsForNode?.length) {
    if (node.type !== 'state-write') {
      throw new Error(`stateModel write link targets non-write node "${node.id}"`)
    }
    const [firstTarget] = writeTargetsForNode
    const singleTarget = writeTargetsForNode.length === 1 ? firstTarget : undefined
    const config: StateWriteNodeConfig = {
      ...(node.config as Partial<StateWriteNodeConfig>),
      operationsVarName: optionalText(node.config.operationsVarName) ?? 'operations',
      namespace: firstTarget.namespace,
      collection: singleTarget?.collection,
      schema: stateModel.schema,
    }
    return { ...node, config: config as unknown as Record<string, unknown> }
  }

  return node
}

export function compileWorkflowStateModel(def: WorkflowDefinition): WorkflowDefinition {
  const stateModel = def.stateModel
  if (!stateModel?.links?.length) return def

  const { readTargets, writeTargets } = compileStateModelBindings(stateModel)
  if (readTargets.size === 0 && writeTargets.size === 0) return def

  return {
    ...def,
    nodes: def.nodes.map((node) =>
      compileNode(node, stateModel, readTargets, writeTargets),
    ),
  }
}
