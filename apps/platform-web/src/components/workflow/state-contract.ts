import type {
  MemoryCollectionDefinition,
  MemorySchemaDefinition,
  StateQueryNodeConfig,
  StateWriteNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowStateModelLink,
} from '@tsian/contracts'
import { validateMemorySchema } from '@tsian/memory-core'

export interface StateContractIssue {
  nodeId: string
  message: string
}

export interface StateContractCollectionSummary {
  key: string
  namespace: string
  collection: string
  readNodeIds: string[]
  writeNodeIds: string[]
  schemaNodeIds: string[]
  schemaId?: string
  schemaVersion?: string
  schemaCollection?: MemoryCollectionDefinition
  storageOnly: boolean
}

export interface StateContractReport {
  collections: StateContractCollectionSummary[]
  issues: StateContractIssue[]
  dynamicWriteNodeIds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readStateQueryConfig(node: WorkflowNode): StateQueryNodeConfig | null {
  if (node.type !== 'state-query' || !isRecord(node.config)) return null
  const config = node.config as Partial<StateQueryNodeConfig>
  if (config.source !== 'collection') return null
  return config as StateQueryNodeConfig
}

function readStateWriteConfig(node: WorkflowNode): StateWriteNodeConfig | null {
  if (node.type !== 'state-write' || !isRecord(node.config)) return null
  return node.config as unknown as StateWriteNodeConfig
}

function readSchema(value: unknown): MemorySchemaDefinition | undefined {
  if (!isRecord(value)) return undefined
  return value as unknown as MemorySchemaDefinition
}

function formatIssuePath(path: string): string {
  return path.replace(/^schema\./, '')
}

function collectionKey(namespace: string, collection: string): string {
  return `${namespace}/${collection}`
}

function ensureCollection(
  map: Map<string, StateContractCollectionSummary>,
  namespace: string | undefined,
  collection: string | undefined,
): StateContractCollectionSummary | null {
  const nextNamespace = readText(namespace)
  const nextCollection = readText(collection)
  if (!nextNamespace || !nextCollection) return null
  const key = collectionKey(nextNamespace, nextCollection)
  const existing = map.get(key)
  if (existing) return existing
  const summary: StateContractCollectionSummary = {
    key,
    namespace: nextNamespace,
    collection: nextCollection,
    readNodeIds: [],
    writeNodeIds: [],
    schemaNodeIds: [],
    storageOnly: true,
  }
  map.set(key, summary)
  return summary
}

function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value)
}

function stateModelLinkTarget(
  workflow: WorkflowDefinition,
  link: WorkflowStateModelLink,
): { namespace?: string; collection?: string } {
  const stateModel = workflow.stateModel
  const anchor = stateModel?.anchors?.find((item) => item.id === link.anchorId)
  const port = anchor?.ports.find((item) => item.id === link.portId)
  return {
    namespace: readText(stateModel?.schema?.defaultNamespace),
    collection: readText(port?.collection),
  }
}

function addStateModelCollections(
  workflow: WorkflowDefinition,
  collections: Map<string, StateContractCollectionSummary>,
  issues: StateContractIssue[],
  dynamicWriteNodeIds: string[],
): void {
  const schema = readSchema(workflow.stateModel?.schema)
  const namespace = readText(schema?.defaultNamespace)

  if (schema) {
    for (const issue of validateMemorySchema(schema)) {
      issues.push({
        nodeId: 'stateModel',
        message: `${issue.code} at ${formatIssuePath(issue.path)}: ${issue.message}`,
      })
    }
  }

  if (schema && namespace && isRecord(schema.collections)) {
    const schemaNodeIds = workflow.stateModel?.anchors?.map((anchor) => anchor.id) ?? ['stateModel']
    for (const [collection, schemaCollection] of Object.entries(schema.collections)) {
      const summary = ensureCollection(collections, namespace, collection)
      if (!summary) continue
      for (const id of schemaNodeIds) addUnique(summary.schemaNodeIds, id)
      summary.schemaId = readText(schema.id)
      summary.schemaVersion = readText(schema.version)
      summary.schemaCollection = schemaCollection
      summary.storageOnly = false
    }
  }

  const writeLinkCounts = new Map<string, number>()
  for (const link of workflow.stateModel?.links ?? []) {
    const target = stateModelLinkTarget(workflow, link)
    const summary = ensureCollection(collections, target.namespace, target.collection)
    if (!summary) {
      issues.push({
        nodeId: link.nodeId || 'stateModel',
        message: `状态模型连线 ${link.id} 缺少有效 collection 端口。`,
      })
      continue
    }

    if (link.kind === 'read') {
      addUnique(summary.readNodeIds, link.nodeId)
    } else {
      addUnique(summary.writeNodeIds, link.nodeId)
      writeLinkCounts.set(link.nodeId, (writeLinkCounts.get(link.nodeId) ?? 0) + 1)
    }
  }

  for (const [nodeId, count] of writeLinkCounts) {
    if (count > 1) addUnique(dynamicWriteNodeIds, nodeId)
  }
}

export function analyzeWorkflowStateContract(
  workflow: WorkflowDefinition,
): StateContractReport {
  const collections = new Map<string, StateContractCollectionSummary>()
  const issues: StateContractIssue[] = []
  const dynamicWriteNodeIds: string[] = []

  addStateModelCollections(workflow, collections, issues, dynamicWriteNodeIds)

  for (const node of workflow.nodes) {
    const queryConfig = readStateQueryConfig(node)
    if (queryConfig) {
      const summary = ensureCollection(
        collections,
        queryConfig.namespace,
        queryConfig.collection,
      )
      if (summary) addUnique(summary.readNodeIds, node.id)
      continue
    }

    const writeConfig = readStateWriteConfig(node)
    if (!writeConfig) continue

    const defaults = {
      namespace: readText(writeConfig.namespace),
      collection: readText(writeConfig.collection),
    }
    const directWrite = ensureCollection(
      collections,
      defaults.namespace,
      defaults.collection,
    )
    if (directWrite) {
      addUnique(directWrite.writeNodeIds, node.id)
    } else {
      addUnique(dynamicWriteNodeIds, node.id)
    }

    const schema = readSchema(writeConfig.schema)
    if (!schema) continue

    for (const issue of validateMemorySchema(schema)) {
      issues.push({
        nodeId: node.id,
        message: `${issue.code} at ${formatIssuePath(issue.path)}: ${issue.message}`,
      })
    }

    const schemaNamespace = readText(defaults.namespace) ?? readText(schema.defaultNamespace)
    if (!schemaNamespace || !isRecord(schema.collections)) {
      continue
    }

    for (const [collection, schemaCollection] of Object.entries(schema.collections)) {
      const summary = ensureCollection(collections, schemaNamespace, collection)
      if (!summary) continue
      addUnique(summary.schemaNodeIds, node.id)
      addUnique(summary.writeNodeIds, node.id)
      summary.schemaId = readText(schema.id)
      summary.schemaVersion = readText(schema.version)
      summary.schemaCollection = schemaCollection
      summary.storageOnly = false
    }
  }

  return {
    collections: Array.from(collections.values()).sort((left, right) =>
      left.key.localeCompare(right.key),
    ),
    issues,
    dynamicWriteNodeIds,
  }
}
