import type {
  AiCallNodeConfig,
  ModStaticContent,
  WorkflowDefinition,
  WorkflowNode,
} from "@tsian/contracts"
import { listBuiltinMods } from "../../../../builtin/mods"
import { builtinPromptPresetSeeds } from "../workflow-host/builtin-presets"
import {
  localDb,
  type LocalPromptPresetResourceRecord,
  type LocalWorkflowPresetResourceRecord,
  type LocalWorldBookResourceRecord,
} from "./db"

const BUILTIN_RESOURCE_ID_PREFIX = "builtin."

type ResourceInput<TRecord extends { name: string }> = Partial<
  Omit<TRecord, "createdAt" | "updatedAt">
> & Pick<TRecord, "name">

function createResourceId(): string {
  return crypto.randomUUID()
}

function normalizeName(name: string): string {
  const normalized = name.trim()
  if (!normalized) {
    throw new Error("资源名称不能为空")
  }
  return normalized
}

function normalizeResourceId(id: string | undefined, options: { allowBuiltinId?: boolean } = {}): string {
  const normalized = id?.trim() || createResourceId()
  if (!options.allowBuiltinId && normalized.startsWith(BUILTIN_RESOURCE_ID_PREFIX)) {
    throw new Error("用户资源 id 不能以 builtin. 开头")
  }
  return normalized
}

function normalizeBuiltinResourceId(id: string): string {
  const normalized = id.trim()
  if (!normalized.startsWith(BUILTIN_RESOURCE_ID_PREFIX)) {
    throw new Error("内置资源 id 必须以 builtin. 开头")
  }
  return normalized
}

function builtinModWorkflowResourceId(mod: ModStaticContent): string {
  return `${BUILTIN_RESOURCE_ID_PREFIX}mod.${mod.manifest.id}.workflow`
}

function builtinModWorldBookResourceId(worldBookId: string): string {
  return worldBookId.trim()
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (tags ?? [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  )
}

function byUpdatedAtDesc<T extends { updatedAt: number }>(a: T, b: T): number {
  return b.updatedAt - a.updatedAt
}

function isAiCallNode(node: WorkflowNode): boolean {
  return node.type === "ai-call"
}

function getAiCallNodeConfig(node: WorkflowNode): Partial<AiCallNodeConfig> {
  return node.config as Partial<AiCallNodeConfig>
}

/**
 * 写 IndexedDB 前剥掉 Vue 响应式 Proxy / Vue Flow 内部不可克隆字段。
 * fail loud：循环引用 / Symbol / function 等会让 JSON.stringify 抛错或丢字段，
 * 此时直接 throw 让用户立即看到，而不是写一份残缺数据进去。
 */
function toCloneable<T>(value: T, fieldHint: string): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${fieldHint} 序列化失败：${message}`)
  }
}

async function upsertResourceRecord<TRecord extends {
  id: string
  name: string
  description?: string
  tags: string[]
  createdAt: number
  updatedAt: number
}>(
  existing: TRecord | undefined,
  input: ResourceInput<TRecord>,
  buildRecord: (base: Omit<TRecord, "createdAt" | "updatedAt">, timestamps: {
    createdAt: number
    updatedAt: number
  }) => TRecord,
  options: { allowBuiltinId?: boolean } = {},
): Promise<TRecord> {
  const now = Date.now()
  const id = normalizeResourceId(input.id, options)
  const base = {
    ...input,
    id,
    name: normalizeName(input.name),
    description: input.description?.trim() || undefined,
    tags: normalizeTags(input.tags),
  } as Omit<TRecord, "createdAt" | "updatedAt">

  return buildRecord(base, {
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}

export async function listPromptPresetResources(): Promise<LocalPromptPresetResourceRecord[]> {
  const records = await localDb.promptPresets.toArray()
  return records.sort(byUpdatedAtDesc)
}

export async function getPromptPresetResource(
  id: string,
): Promise<LocalPromptPresetResourceRecord | undefined> {
  return localDb.promptPresets.get(id)
}

export async function upsertPromptPresetResource(
  input: ResourceInput<LocalPromptPresetResourceRecord>,
  options: { allowBuiltinId?: boolean } = {},
): Promise<LocalPromptPresetResourceRecord> {
  const id = normalizeResourceId(input.id, options)
  const existing = await localDb.promptPresets.get(id)
  const rawContent = input.content ?? input.preset
  const content = toCloneable(rawContent, "提示词预设内容")
  const record = await upsertResourceRecord(existing, { ...input, id }, (base, timestamps) => ({
    ...base,
    preset: content,
    content,
    ...timestamps,
  }), options)

  await localDb.promptPresets.put(record)
  return record
}

export async function deletePromptPresetResource(id: string): Promise<void> {
  await localDb.promptPresets.delete(id)
}

export async function listWorldBookResources(): Promise<LocalWorldBookResourceRecord[]> {
  const records = await localDb.worldBooks.toArray()
  return records.sort(byUpdatedAtDesc)
}

export async function getWorldBookResource(
  id: string,
): Promise<LocalWorldBookResourceRecord | undefined> {
  return localDb.worldBooks.get(id)
}

export async function upsertWorldBookResource(
  input: ResourceInput<LocalWorldBookResourceRecord>,
  options: { allowBuiltinId?: boolean } = {},
): Promise<LocalWorldBookResourceRecord> {
  const id = normalizeResourceId(input.id, options)
  const existing = await localDb.worldBooks.get(id)
  const rawContent = input.content ?? input.worldBook
  const content = toCloneable(rawContent, "世界书内容")
  const record = await upsertResourceRecord(existing, { ...input, id }, (base, timestamps) => ({
    ...base,
    worldBook: content,
    content,
    ...timestamps,
  }), options)

  await localDb.worldBooks.put(record)
  return record
}

export async function deleteWorldBookResource(id: string): Promise<void> {
  await localDb.worldBooks.delete(id)
}

export async function seedBuiltinPromptPresetResources(): Promise<void> {
  for (const seed of builtinPromptPresetSeeds) {
    const id = normalizeBuiltinResourceId(seed.id)
    const existing = await localDb.promptPresets.get(id)
    if (existing) {
      continue
    }

    await upsertPromptPresetResource({
      id,
      name: seed.name,
      description: seed.description,
      tags: normalizeTags(["builtin", "prompt-preset"]),
      preset: seed.preset,
    }, { allowBuiltinId: true })
  }
}

export async function seedBuiltinModWorldBookResources(): Promise<void> {
  for (const mod of listBuiltinMods()) {
    const worldBooks = mod.worldBooks ?? mod.manifest.worldBooks
    if (!worldBooks) {
      continue
    }

    for (const [worldBookKey, worldBook] of Object.entries(worldBooks)) {
      const id = builtinModWorldBookResourceId(worldBookKey)
      if (!id) {
        throw new Error(`内置模组 ${mod.manifest.id} 的世界书 id 不能为空`)
      }

      const existing = await localDb.worldBooks.get(id)
      if (existing) {
        continue
      }

      await upsertWorldBookResource({
        id,
        name: `${mod.manifest.name} 世界书：${worldBookKey}`,
        description: `来自内置模组 ${mod.manifest.name} (${mod.manifest.id}) 的世界书资源。`,
        tags: normalizeTags(["builtin", "mod", mod.manifest.id, "world-book"]),
        worldBook,
      }, { allowBuiltinId: id.startsWith(BUILTIN_RESOURCE_ID_PREFIX) })
    }
  }
}

export async function seedBuiltinModWorkflowPresetResources(): Promise<void> {
  for (const mod of listBuiltinMods()) {
    const workflow = mod.manifest.workflow
    if (!workflow) {
      continue
    }

    const id = normalizeBuiltinResourceId(builtinModWorkflowResourceId(mod))
    const existing = await localDb.workflowPresets.get(id)
    if (existing) {
      continue
    }

    await upsertWorkflowPresetResource({
      id,
      name: `${mod.manifest.name} 工作流`,
      description: `来自内置模组 ${mod.manifest.name} (${mod.manifest.id}) manifest.workflow 的工作流预设。`,
      tags: normalizeTags(["builtin", "mod", mod.manifest.id, "workflow-preset"]),
      workflow,
    }, { allowBuiltinId: true })
  }
}

export async function seedBuiltinResourceLibraryResources(): Promise<void> {
  await seedBuiltinPromptPresetResources()
  await seedBuiltinModWorldBookResources()
  await seedBuiltinModWorkflowPresetResources()
}

export async function listWorkflowPresetResources(): Promise<LocalWorkflowPresetResourceRecord[]> {
  const records = await localDb.workflowPresets.toArray()
  return records.sort(byUpdatedAtDesc)
}

export async function getWorkflowPresetResource(
  id: string,
): Promise<LocalWorkflowPresetResourceRecord | undefined> {
  return localDb.workflowPresets.get(id)
}

export async function upsertWorkflowPresetResource(
  input: ResourceInput<LocalWorkflowPresetResourceRecord>,
  options: { allowBuiltinId?: boolean } = {},
): Promise<LocalWorkflowPresetResourceRecord> {
  const rawWorkflow = input.workflow ?? input.definition
  if (!rawWorkflow) {
    throw new Error("工作流预设不能为空")
  }
  const workflow = toCloneable(rawWorkflow, "工作流定义")

  const id = normalizeResourceId(input.id, options)
  const existing = await localDb.workflowPresets.get(id)
  const record = await upsertResourceRecord(existing, { ...input, id }, (base, timestamps) => ({
    ...base,
    workflow,
    definition: workflow,
    ...timestamps,
  }), options)

  await localDb.workflowPresets.put(record)
  return record
}

export async function deleteWorkflowPresetResource(id: string): Promise<void> {
  await localDb.workflowPresets.delete(id)
}

function workflowReferencesPromptPreset(
  workflow: WorkflowDefinition,
  promptPresetId: string,
): boolean {
  return workflow.nodes.some((node) => {
    if (!isAiCallNode(node)) {
      return false
    }

    return getAiCallNodeConfig(node).presetId === promptPresetId
  })
}

function workflowReferencesWorldBook(
  workflow: WorkflowDefinition,
  worldBookId: string,
): boolean {
  return workflow.nodes.some((node) => {
    if (!isAiCallNode(node)) {
      return false
    }

    return getAiCallNodeConfig(node).worldBookKeys?.includes(worldBookId) ?? false
  })
}

export async function findWorkflowPresetReferencesToPromptPreset(
  promptPresetId: string,
): Promise<LocalWorkflowPresetResourceRecord[]> {
  const workflowPresets = await localDb.workflowPresets.toArray()
  return workflowPresets
    .filter((record) => workflowReferencesPromptPreset(record.workflow, promptPresetId))
    .sort(byUpdatedAtDesc)
}

export async function findWorkflowPresetReferencesToWorldBook(
  worldBookId: string,
): Promise<LocalWorkflowPresetResourceRecord[]> {
  const workflowPresets = await localDb.workflowPresets.toArray()
  return workflowPresets
    .filter((record) => workflowReferencesWorldBook(record.workflow, worldBookId))
    .sort(byUpdatedAtDesc)
}
