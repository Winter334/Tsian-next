<template>
  <div
    v-if="open && anchorNode"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-void/80 p-4 backdrop-blur"
    role="dialog"
    aria-modal="true"
    aria-label="状态数据库"
    @click.self="handleClose"
  >
    <section class="flex h-[min(90dvh,960px)] w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden border border-[#00FF88]/50 bg-panel shadow-2xl">
      <header class="flex items-center justify-between gap-3 border-b border-neon-muted/30 px-4 py-3">
        <div class="flex min-w-0 items-center gap-3">
          <Database class="h-5 w-5 shrink-0 text-[#00FF88]" />
          <div class="min-w-0">
            <p class="font-mono text-[10px] uppercase tracking-[0.3em] text-neon-muted">
              状态数据库
            </p>
            <p class="mt-1 truncate font-mono text-sm font-bold text-text-main">
              {{ anchorLabel || '状态数据库' }} // {{ anchorId }}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="border border-neon-muted/40 bg-elevated px-3 py-1.5 font-mono text-xs text-text-main transition-colors hover:border-neon hover:text-neon"
          @click="handleClose"
        >
          关闭
        </button>
      </header>

      <div class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[320px_1fr]">
        <aside class="min-h-0 overflow-y-auto border-b border-neon-muted/20 bg-void/30 p-4 lg:border-b-0 lg:border-r">
          <div class="grid gap-4">
            <label class="grid gap-1">
              <span class="field-label">节点名称</span>
              <input
                :value="anchorLabel"
                class="field-input"
                placeholder="状态数据库"
                @change="updateAnchorLabel(($event.target as HTMLInputElement).value)"
              />
            </label>

            <section class="grid gap-2 border border-neon-muted/25 bg-panel/70 p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="field-label">端口</span>
                <button
                  type="button"
                  class="icon-button text-neon disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!canAddPort"
                  title="添加端口"
                  @click="addPort"
                >
                  <Plus class="h-3.5 w-3.5" />
                </button>
              </div>

              <div class="grid gap-2">
                <div
                  v-for="port in anchorPorts"
                  :key="port.id"
                  class="grid gap-2 border border-neon-muted/20 bg-void/50 p-2"
                >
                  <div class="flex items-center gap-2">
                    <select
                      :value="port.collection ?? ''"
                      class="field-input min-w-0 flex-1"
                      @change="updatePortCollection(port.id, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">未绑定</option>
                      <option
                        v-for="name in collectionNames"
                        :key="name"
                        :value="name"
                        :disabled="isCollectionUsedByOtherPort(name, port.id)"
                      >
                        {{ collectionDisplayName(name) }}
                      </option>
                    </select>
                    <button
                      type="button"
                      class="icon-button text-danger"
                      title="删除端口"
                      @click="removePort(port.id)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    :value="port.label ?? ''"
                    class="field-input"
                    placeholder="端口显示名"
                    @change="updatePortLabel(port.id, ($event.target as HTMLInputElement).value)"
                  />
                  <p class="truncate font-mono text-[9px] text-text-dim">
                    {{ port.id }}
                  </p>
                </div>
              </div>
            </section>

            <section class="grid gap-3 border border-neon-muted/25 bg-panel/70 p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="field-label">集合</span>
                <button
                  type="button"
                  class="icon-button text-neon"
                  title="添加集合"
                  @click="addCollection"
                >
                  <Plus class="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                v-if="!schema"
                type="button"
                class="border border-neon bg-neon/10 px-3 py-2 text-left font-mono text-xs text-neon transition-colors hover:bg-neon/20"
                @click="createSchema"
              >
                创建状态模型
              </button>

              <div v-else class="grid gap-1">
                <button
                  v-for="entry in collectionEntries"
                  :key="entry.name"
                  type="button"
                  class="min-w-0 border px-3 py-2 text-left font-mono transition-colors"
                  :class="activeCollectionName === entry.name
                    ? 'border-[#00FF88] bg-[#00FF88]/10 text-[#00FF88]'
                    : 'border-neon-muted/25 bg-void/40 text-text-dim hover:border-neon-muted hover:text-text-main'"
                  @click="activeCollectionName = entry.name"
                >
                  <span class="block truncate text-xs">
                    {{ entry.collection.label || entry.name }}
                  </span>
                  <span class="block truncate text-[9px]">
                    {{ entry.name }}
                  </span>
                </button>
                <p
                  v-if="collectionEntries.length === 0"
                  class="border border-neon-muted/20 bg-void/40 px-3 py-2 font-mono text-xs text-text-dim"
                >
                  暂无集合
                </p>
              </div>
            </section>
          </div>
        </aside>

        <main class="min-h-0 overflow-y-auto p-4">
          <div v-if="!schema" class="grid h-full place-items-center">
            <button
              type="button"
              class="border border-neon bg-neon/10 px-4 py-2 font-mono text-xs text-neon transition-colors hover:bg-neon/20"
              @click="createSchema"
            >
              创建状态模型
            </button>
          </div>

          <div v-else class="grid gap-4">
            <section class="grid gap-3 border border-neon-muted/25 bg-void/35 p-3">
              <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <label class="grid gap-1">
                  <span class="field-label">模型 ID</span>
                  <input
                    :value="schema.id"
                    class="field-input"
                    @change="updateSchemaText('id', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="grid gap-1">
                  <span class="field-label">版本</span>
                  <input
                    :value="schema.version"
                    class="field-input"
                    @change="updateSchemaText('version', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="grid gap-1">
                  <span class="field-label">命名空间</span>
                  <input
                    :value="schema.defaultNamespace ?? ''"
                    class="field-input"
                    @change="updateSchemaOptionalText('defaultNamespace', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="grid gap-1">
                  <span class="field-label">全局状态</span>
                  <select
                    :value="globalsCollection"
                    class="field-input"
                    @change="updateGlobalsCollection(($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">未指定</option>
                    <option
                      v-for="name in collectionNames"
                      :key="name"
                      :value="name"
                    >
                      {{ collectionDisplayName(name) }}
                    </option>
                  </select>
                </label>
              </div>

              <label class="grid gap-1">
                <span class="field-label">模型名称</span>
                <input
                  :value="schema.name ?? ''"
                  class="field-input"
                  @change="updateSchemaOptionalText('name', ($event.target as HTMLInputElement).value)"
                />
              </label>

              <div v-if="schemaIssues.length" class="grid gap-1">
                <p
                  v-for="issue in schemaIssues"
                  :key="`${issue.path}-${issue.code}`"
                  class="border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[10px] text-danger"
                >
                  {{ issue.code }} // {{ issue.path }} // {{ issue.message }}
                </p>
              </div>
              <p
                v-if="formError"
                class="border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[10px] text-danger"
              >
                {{ formError }}
              </p>
            </section>

            <section
              v-if="activeCollection"
              class="grid gap-4 border border-neon-muted/25 bg-void/35 p-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="grid min-w-0 flex-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <label class="grid gap-1">
                    <span class="field-label">集合名</span>
                    <input
                      :value="activeCollectionName"
                      class="field-input"
                      @change="renameCollection(activeCollectionName, ($event.target as HTMLInputElement).value)"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span class="field-label">显示名</span>
                    <input
                      :value="activeCollection.label ?? ''"
                      class="field-input"
                      @change="updateCollectionOptionalText(activeCollectionName, 'label', ($event.target as HTMLInputElement).value)"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span class="field-label">主键</span>
                    <input
                      :value="activeCollection.primaryKey ?? ''"
                      class="field-input"
                      @change="updateCollectionOptionalText(activeCollectionName, 'primaryKey', ($event.target as HTMLInputElement).value)"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span class="field-label">版本</span>
                    <input
                      :value="activeCollection.version ?? ''"
                      class="field-input"
                      @change="updateCollectionOptionalText(activeCollectionName, 'version', ($event.target as HTMLInputElement).value)"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  class="icon-button mt-5 text-danger"
                  title="删除集合"
                  @click="removeCollection(activeCollectionName)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>

              <label class="grid gap-1">
                <span class="field-label">说明</span>
                <input
                  :value="activeCollection.description ?? ''"
                  class="field-input"
                  @change="updateCollectionOptionalText(activeCollectionName, 'description', ($event.target as HTMLInputElement).value)"
                />
              </label>

              <div class="flex items-center justify-between gap-3">
                <span class="field-label">字段</span>
                <button
                  type="button"
                  class="border border-neon bg-neon/10 px-3 py-1.5 font-mono text-xs text-neon transition-colors hover:bg-neon/20"
                  @click="addField(activeCollectionName)"
                >
                  添加字段
                </button>
              </div>

              <div class="overflow-x-auto">
                <table class="min-w-[820px] border-collapse font-mono text-xs">
                  <thead class="bg-panel/70 text-[10px] uppercase tracking-wider text-text-dim">
                    <tr>
                      <th class="table-cell w-[150px]">字段名</th>
                      <th class="table-cell w-[120px]">形态</th>
                      <th class="table-cell w-[150px]">显示名</th>
                      <th class="table-cell w-[72px]">必填</th>
                      <th class="table-cell w-[160px]">默认值</th>
                      <th class="table-cell">说明</th>
                      <th class="table-cell w-[52px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="field in activeFieldEntries"
                      :key="field.name"
                      class="bg-void/30"
                    >
                      <td class="table-cell align-top">
                        <input
                          :value="field.name"
                          class="field-input"
                          @change="renameField(activeCollectionName, field.name, ($event.target as HTMLInputElement).value)"
                        />
                      </td>
                      <td class="table-cell align-top">
                        <select
                          :value="field.field.type"
                          class="field-input"
                          @change="updateFieldType(activeCollectionName, field.name, ($event.target as HTMLSelectElement).value as MemoryFieldType)"
                        >
                          <option
                            v-for="option in fieldTypeOptions"
                            :key="option.type"
                            :value="option.type"
                          >
                            {{ option.label }}
                          </option>
                        </select>
                      </td>
                      <td class="table-cell align-top">
                        <input
                          :value="field.field.label ?? ''"
                          class="field-input"
                          @change="updateFieldOptionalText(activeCollectionName, field.name, 'label', ($event.target as HTMLInputElement).value)"
                        />
                      </td>
                      <td class="table-cell align-top text-center">
                        <input
                          type="checkbox"
                          :checked="field.field.required === true"
                          class="mt-2 accent-cyan-400"
                          @change="updateField(activeCollectionName, field.name, { required: ($event.target as HTMLInputElement).checked || undefined })"
                        />
                      </td>
                      <td class="table-cell align-top">
                        <input
                          :value="formatDefaultValue(field.field)"
                          class="field-input"
                          @change="updateFieldDefault(activeCollectionName, field.name, ($event.target as HTMLInputElement).value)"
                        />
                      </td>
                      <td class="table-cell align-top">
                        <input
                          :value="field.field.description ?? ''"
                          class="field-input"
                          @change="updateFieldOptionalText(activeCollectionName, field.name, 'description', ($event.target as HTMLInputElement).value)"
                        />
                      </td>
                      <td class="table-cell align-top text-center">
                        <button
                          type="button"
                          class="icon-button text-danger"
                          title="删除字段"
                          @click="removeField(activeCollectionName, field.name)"
                        >
                          <Trash2 class="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p
                v-if="activeFieldEntries.length === 0"
                class="border border-neon-muted/20 bg-panel/40 px-3 py-2 font-mono text-xs text-text-dim"
              >
                无字段定义
              </p>
            </section>
          </div>
        </main>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Node } from '@vue-flow/core'
import type {
  JsonValue,
  MemoryCollectionDefinition,
  MemoryFieldDefinition,
  MemoryFieldType,
  MemorySchemaDefinition,
  WorkflowStateModel,
  WorkflowStateModelAnchorPort,
} from '@tsian/contracts'
import { validateMemorySchema } from '@tsian/memory-core'
import { Database, Plus, Trash2 } from 'lucide-vue-next'
import { fromStateAnchorVueNodeId } from '../../composables/useWorkflowEditor'

const fieldTypeOptions: Array<{ type: MemoryFieldType; label: string }> = [
  { type: 'string', label: '文本' },
  { type: 'number', label: '数字' },
  { type: 'boolean', label: '开关' },
  { type: 'json', label: '任意内容' },
  { type: 'array', label: '列表' },
  { type: 'object', label: '结构' },
]

const props = defineProps<{
  open: boolean
  anchorNodeId: string | null
  nodes: Node[]
  stateModel?: WorkflowStateModel
  onUpdateAnchor: (
    anchorNodeId: string,
    patch: { label?: string; ports?: WorkflowStateModelAnchorPort[] },
  ) => void
  onUpdateStateSchema: (
    schema: MemorySchemaDefinition | undefined,
    globalsCollection: string | undefined,
  ) => void
  onRenameCollectionReference: (previousName: string, nextName: string) => void
  onRemoveCollectionReference: (collectionName: string) => void
  onClose: () => void
}>()

const activeCollectionName = ref('')
const formError = ref('')

const anchorNode = computed(() => {
  if (!props.anchorNodeId) return null
  return props.nodes.find((node) => node.id === props.anchorNodeId) ?? null
})

const anchorId = computed(() =>
  props.anchorNodeId ? fromStateAnchorVueNodeId(props.anchorNodeId) : '',
)

const anchorLabel = computed(() =>
  typeof anchorNode.value?.data?.label === 'string' ? anchorNode.value.data.label : '',
)

const schema = computed(() => props.stateModel?.schema)
const globalsCollection = computed(() => props.stateModel?.globalsCollection ?? '')

const anchorPorts = computed<WorkflowStateModelAnchorPort[]>(() => {
  const ports = anchorNode.value?.data?.ports
  if (!Array.isArray(ports) || ports.length === 0) {
    return [{ id: 'port-1' }]
  }
  return ports
    .filter((port): port is WorkflowStateModelAnchorPort =>
      typeof port === 'object' && port !== null && typeof port.id === 'string',
    )
    .map((port) => ({ ...port }))
})

const collectionEntries = computed(() => {
  return Object.entries(schema.value?.collections ?? {})
    .map(([name, collection]) => ({ name, collection }))
    .sort((left, right) => left.name.localeCompare(right.name))
})

const collectionNames = computed(() => collectionEntries.value.map((entry) => entry.name))

const activeCollection = computed(() => {
  if (!schema.value || !activeCollectionName.value) return undefined
  return schema.value.collections[activeCollectionName.value]
})

const activeFieldEntries = computed(() => {
  return Object.entries(activeCollection.value?.fields ?? {})
    .map(([name, field]) => ({ name, field }))
    .sort((left, right) => left.name.localeCompare(right.name))
})

const schemaIssues = computed(() => schema.value ? validateMemorySchema(schema.value) : [])

const canAddPort = computed(() => {
  const used = new Set(anchorPorts.value.map((port) => port.collection).filter(Boolean))
  return collectionNames.value.some((name) => !used.has(name))
})

function optionalText(value: string): string | undefined {
  const normalized = value.trim()
  return normalized || undefined
}

function identifierFromText(value: string): string {
  return value.trim().replace(/\s+/g, '-')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (!isRecord(value)) return false
  return Object.values(value).every(isJsonValue)
}

function nextSchema(): MemorySchemaDefinition {
  return schema.value ?? {
    id: 'custom.state',
    name: '自定义状态',
    version: '1',
    defaultNamespace: 'custom',
    collections: {},
  }
}

function emitSchema(
  next: MemorySchemaDefinition,
  nextGlobalsCollection = globalsCollection.value,
): void {
  const normalizedGlobals = nextGlobalsCollection && next.collections[nextGlobalsCollection]
    ? nextGlobalsCollection
    : undefined
  props.onUpdateStateSchema(next, normalizedGlobals)
  formError.value = ''
}

function createSchema(): void {
  emitSchema(nextSchema())
}

function collectionDisplayName(name: string): string {
  const collection = schema.value?.collections[name]
  const label = collection?.label?.trim()
  return label ? `${label} (${name})` : name
}

function updateAnchorLabel(raw: string): void {
  if (!props.anchorNodeId) return
  props.onUpdateAnchor(props.anchorNodeId, { label: optionalText(raw) })
}

function patchSchema(patch: Partial<MemorySchemaDefinition>): void {
  emitSchema({ ...nextSchema(), ...patch })
}

function updateSchemaText(key: 'id' | 'version', raw: string): void {
  const value = raw.trim()
  if (!value) {
    formError.value = `${key} 不能为空`
    return
  }
  patchSchema({ [key]: value })
}

function updateSchemaOptionalText(
  key: 'name' | 'description' | 'defaultNamespace',
  raw: string,
): void {
  patchSchema({ [key]: optionalText(raw) })
}

function updateGlobalsCollection(collectionName: string): void {
  emitSchema(nextSchema(), optionalText(collectionName))
}

function uniqueCollectionName(base = 'records'): string {
  const current = nextSchema()
  let name = base
  let suffix = 1
  while (current.collections[name]) {
    suffix += 1
    name = `${base}${suffix}`
  }
  return name
}

function addCollection(): void {
  const current = nextSchema()
  const name = uniqueCollectionName('records')
  const next: MemorySchemaDefinition = {
    ...current,
    collections: {
      ...current.collections,
      [name]: {
        primaryKey: 'id',
        fields: {
          id: { type: 'string', label: 'ID', required: true },
        },
      },
    },
  }
  emitSchema(next)
  activeCollectionName.value = name
}

function renameCollection(previousName: string, raw: string): void {
  const nextName = identifierFromText(raw)
  const current = nextSchema()
  if (!nextName || nextName === previousName) return
  if (current.collections[nextName]) {
    formError.value = `collection "${nextName}" 已存在`
    return
  }

  const nextCollections: Record<string, MemoryCollectionDefinition> = {}
  for (const [name, collection] of Object.entries(current.collections)) {
    nextCollections[name === previousName ? nextName : name] = collection
  }
  emitSchema(
    { ...current, collections: nextCollections },
    globalsCollection.value === previousName ? nextName : globalsCollection.value,
  )
  props.onRenameCollectionReference(previousName, nextName)
  activeCollectionName.value = nextName
}

function removeCollection(name: string): void {
  const current = nextSchema()
  const nextCollections = { ...current.collections }
  delete nextCollections[name]
  emitSchema(
    { ...current, collections: nextCollections },
    globalsCollection.value === name ? undefined : globalsCollection.value,
  )
  props.onRemoveCollectionReference(name)
  activeCollectionName.value = Object.keys(nextCollections)[0] ?? ''
}

function patchCollection(
  collectionName: string,
  patch: Partial<MemoryCollectionDefinition>,
): void {
  const current = nextSchema()
  const collection = current.collections[collectionName]
  if (!collection) return
  emitSchema({
    ...current,
    collections: {
      ...current.collections,
      [collectionName]: { ...collection, ...patch },
    },
  })
}

function updateCollectionOptionalText(
  collectionName: string,
  key: 'label' | 'description' | 'version' | 'primaryKey',
  raw: string,
): void {
  patchCollection(collectionName, { [key]: optionalText(raw) })
}

function patchFields(
  collectionName: string,
  fields: Record<string, MemoryFieldDefinition>,
): void {
  patchCollection(collectionName, { fields })
}

function uniqueFieldName(collection: MemoryCollectionDefinition, base = 'field'): string {
  let name = base
  let suffix = 1
  while (collection.fields[name]) {
    suffix += 1
    name = `${base}${suffix}`
  }
  return name
}

function addField(collectionName: string): void {
  const collection = nextSchema().collections[collectionName]
  if (!collection) return
  const fieldName = uniqueFieldName(collection)
  patchFields(collectionName, {
    ...collection.fields,
    [fieldName]: { type: 'string' },
  })
}

function renameField(collectionName: string, previousName: string, raw: string): void {
  const nextName = identifierFromText(raw)
  const collection = nextSchema().collections[collectionName]
  if (!collection || !nextName || nextName === previousName) return
  if (collection.fields[nextName]) {
    formError.value = `字段 "${nextName}" 已存在`
    return
  }
  const nextFields: Record<string, MemoryFieldDefinition> = {}
  for (const [name, field] of Object.entries(collection.fields)) {
    nextFields[name === previousName ? nextName : name] = field
  }
  patchFields(collectionName, nextFields)
}

function updateField(
  collectionName: string,
  fieldName: string,
  patch: Partial<MemoryFieldDefinition>,
): void {
  const collection = nextSchema().collections[collectionName]
  const field = collection?.fields[fieldName]
  if (!collection || !field) return
  patchFields(collectionName, {
    ...collection.fields,
    [fieldName]: { ...field, ...patch },
  })
}

function updateFieldType(
  collectionName: string,
  fieldName: string,
  type: MemoryFieldType,
): void {
  updateField(collectionName, fieldName, {
    type,
    item: type === 'array' ? nextSchema().collections[collectionName]?.fields[fieldName]?.item : undefined,
    fields: type === 'object' ? nextSchema().collections[collectionName]?.fields[fieldName]?.fields : undefined,
  })
}

function updateFieldOptionalText(
  collectionName: string,
  fieldName: string,
  key: 'label' | 'description',
  raw: string,
): void {
  updateField(collectionName, fieldName, { [key]: optionalText(raw) })
}

function removeField(collectionName: string, fieldName: string): void {
  const collection = nextSchema().collections[collectionName]
  if (!collection) return
  const nextFields = { ...collection.fields }
  delete nextFields[fieldName]
  patchFields(collectionName, nextFields)
}

function formatDefaultValue(field: MemoryFieldDefinition): string {
  if (field.default === undefined) return ''
  if (field.type === 'string' && typeof field.default === 'string') return field.default
  if (
    (field.type === 'number' && typeof field.default === 'number') ||
    (field.type === 'boolean' && typeof field.default === 'boolean')
  ) {
    return String(field.default)
  }
  return JSON.stringify(field.default)
}

function parseDefaultValue(field: MemoryFieldDefinition, raw: string): JsonValue | undefined {
  if (!raw.trim()) return undefined
  if (field.type === 'string') return raw
  if (field.type === 'number') {
    const numberValue = Number(raw.trim())
    if (!Number.isFinite(numberValue)) throw new Error('数字默认值无效')
    return numberValue
  }
  if (field.type === 'boolean') {
    const normalized = raw.trim().toLowerCase()
    if (['true', '1', 'yes', 'on', '是', '开'].includes(normalized)) return true
    if (['false', '0', 'no', 'off', '否', '关'].includes(normalized)) return false
    throw new Error('开关默认值只能是 true/false')
  }
  const parsed = JSON.parse(raw) as unknown
  if (!isJsonValue(parsed)) throw new Error('默认值必须兼容 JSON')
  return parsed
}

function updateFieldDefault(collectionName: string, fieldName: string, raw: string): void {
  const field = nextSchema().collections[collectionName]?.fields[fieldName]
  if (!field) return
  try {
    updateField(collectionName, fieldName, {
      default: parseDefaultValue(field, raw),
    })
    formError.value = ''
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error)
  }
}

function isCollectionUsedByOtherPort(collectionName: string, portId: string): boolean {
  return anchorPorts.value.some((port) =>
    port.id !== portId && port.collection === collectionName,
  )
}

function nextPortId(collectionName: string): string {
  const existing = new Set(anchorPorts.value.map((port) => port.id))
  if (!existing.has(collectionName)) return collectionName
  let suffix = 1
  let id = `port-${suffix}`
  while (existing.has(id)) {
    suffix += 1
    id = `port-${suffix}`
  }
  return id
}

function updatePorts(ports: WorkflowStateModelAnchorPort[]): void {
  if (!props.anchorNodeId) return
  props.onUpdateAnchor(props.anchorNodeId, { ports })
}

function addPort(): void {
  const used = new Set(anchorPorts.value.map((port) => port.collection).filter(Boolean))
  const collectionName = collectionNames.value.find((name) => !used.has(name))
  if (!collectionName) return
  updatePorts([
    ...anchorPorts.value,
    {
      id: nextPortId(collectionName),
      collection: collectionName,
      label: collectionName,
    },
  ])
}

function updatePortCollection(portId: string, raw: string): void {
  const collection = optionalText(raw)
  if (collection && isCollectionUsedByOtherPort(collection, portId)) return
  updatePorts(anchorPorts.value.map((port) =>
    port.id === portId
      ? {
        ...port,
        collection,
        label: port.label || collection,
      }
      : port,
  ))
}

function updatePortLabel(portId: string, raw: string): void {
  updatePorts(anchorPorts.value.map((port) =>
    port.id === portId
      ? { ...port, label: optionalText(raw) }
      : port,
  ))
}

function removePort(portId: string): void {
  updatePorts(anchorPorts.value.filter((port) => port.id !== portId))
}

function handleClose(): void {
  props.onClose()
}

watch(
  () => [props.open, props.anchorNodeId, collectionNames.value.join('\n')],
  () => {
    if (!props.open) return
    if (
      !activeCollectionName.value ||
      !collectionNames.value.includes(activeCollectionName.value)
    ) {
      activeCollectionName.value = collectionNames.value[0] ?? ''
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.field-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 10px;
  line-height: 1rem;
  letter-spacing: 0;
  text-transform: uppercase;
  color: var(--color-text-dim, #608996);
}

.field-input {
  width: 100%;
  border: 1px solid rgba(0, 139, 139, 0.4);
  background: var(--color-void, #080c11);
  padding: 0.375rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  color: var(--color-text-main, #e0f7fa);
  outline: none;
}

.field-input:focus {
  border-color: var(--color-neon, #00f0ff);
}

.icon-button {
  display: inline-flex;
  height: 1.75rem;
  width: 1.75rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(0, 139, 139, 0.4);
  background: var(--color-elevated, #1c2633);
  transition: border-color 150ms ease, background-color 150ms ease;
}

.icon-button:hover:not(:disabled) {
  border-color: var(--color-neon, #00f0ff);
  background: rgba(0, 240, 255, 0.08);
}

.table-cell {
  border: 1px solid rgba(0, 139, 139, 0.22);
  padding: 0.375rem;
  text-align: left;
}
</style>
