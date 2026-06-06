<template>
  <section class="space-y-4 border-t border-neon-deep/20 pt-4">
    <div class="flex items-center justify-between gap-3">
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        State Contract
      </label>
      <div class="flex gap-2">
        <button
          v-if="!schema"
          type="button"
          class="font-mono text-[10px] text-neon transition-colors hover:text-neon/80"
          @click="createSchema"
        >
          + 创建
        </button>
        <button
          v-else
          type="button"
          class="font-mono text-[10px] text-danger transition-colors hover:text-danger/80"
          @click="removeSchema"
        >
          移除
        </button>
      </div>
    </div>

    <div v-if="!schema" class="border border-neon-deep/20 bg-void/40 p-3 font-mono text-xs text-text-dim">
      当前 state-write 不携带 schema。
    </div>

    <div v-else class="space-y-4">
      <div
        v-if="schemaIssues.length > 0"
        class="grid gap-1 border border-danger/40 bg-danger/10 p-2"
      >
        <p
          v-for="issue in schemaIssues"
          :key="`${issue.path}-${issue.code}`"
          class="font-mono text-[10px] text-danger"
        >
          {{ issue.code }} // {{ issue.path }} // {{ issue.message }}
        </p>
      </div>

      <div class="grid gap-2 md:grid-cols-2">
        <label class="grid gap-1">
          <span class="field-label">Schema ID</span>
          <input
            :value="schema.id"
            class="field-input"
            placeholder="mod.example.state"
            @change="updateSchemaText('id', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="grid gap-1">
          <span class="field-label">Version</span>
          <input
            :value="schema.version"
            class="field-input"
            placeholder="1"
            @change="updateSchemaText('version', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="grid gap-1">
          <span class="field-label">Name</span>
          <input
            :value="schema.name ?? ''"
            class="field-input"
            placeholder="Runtime State"
            @change="updateSchemaOptionalText('name', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="grid gap-1">
          <span class="field-label">Default Namespace</span>
          <input
            :value="schema.defaultNamespace ?? ''"
            class="field-input"
            placeholder="mod.example"
            @change="updateSchemaOptionalText('defaultNamespace', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>

      <label class="grid gap-1">
        <span class="field-label">Description</span>
        <textarea
          :value="schema.description ?? ''"
          rows="2"
          class="field-textarea"
          @change="updateSchemaOptionalText('description', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="field-label">Collections</span>
          <button
            type="button"
            class="font-mono text-[10px] text-neon transition-colors hover:text-neon/80"
            @click="addCollection"
          >
            + 添加 Collection
          </button>
        </div>

        <article
          v-for="entry in collectionEntries"
          :key="entry.name"
          class="space-y-3 border border-neon-deep/25 bg-void/40 p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
              <label class="grid gap-1">
                <span class="field-label">Collection</span>
                <input
                  :value="entry.name"
                  class="field-input"
                  placeholder="records"
                  @change="renameCollection(entry.name, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label class="grid gap-1">
                <span class="field-label">Primary Key</span>
                <input
                  :value="entry.collection.primaryKey ?? ''"
                  class="field-input"
                  placeholder="id"
                  @change="updateCollectionOptionalText(entry.name, 'primaryKey', ($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>
            <button
              type="button"
              class="font-mono text-xs text-danger transition-colors hover:text-danger/80"
              @click="removeCollection(entry.name)"
            >
              ×
            </button>
          </div>

          <div class="grid gap-2 md:grid-cols-2">
            <label class="grid gap-1">
              <span class="field-label">Label</span>
              <input
                :value="entry.collection.label ?? ''"
                class="field-input"
                @change="updateCollectionOptionalText(entry.name, 'label', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="grid gap-1">
              <span class="field-label">Version</span>
              <input
                :value="entry.collection.version ?? ''"
                class="field-input"
                @change="updateCollectionOptionalText(entry.name, 'version', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <label class="grid gap-1">
            <span class="field-label">Description</span>
            <textarea
              :value="entry.collection.description ?? ''"
              rows="2"
              class="field-textarea"
              @change="updateCollectionOptionalText(entry.name, 'description', ($event.target as HTMLTextAreaElement).value)"
            />
          </label>

          <label class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
            <input
              type="checkbox"
              :checked="!!entry.collection.additionalFields"
              class="accent-cyan-400"
              @change="toggleAdditionalFields(entry.name, ($event.target as HTMLInputElement).checked)"
            />
            additionalFields: json
          </label>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="field-label">Fields</span>
              <button
                type="button"
                class="font-mono text-[10px] text-neon transition-colors hover:text-neon/80"
                @click="addField(entry.name)"
              >
                + 添加 Field
              </button>
            </div>

            <div
              v-for="fieldEntry in fieldEntries(entry.collection)"
              :key="fieldEntry.name"
              class="space-y-2 border border-neon-deep/20 bg-panel/40 p-2"
            >
              <div class="grid gap-2 md:grid-cols-[1fr_120px_auto]">
                <input
                  :value="fieldEntry.name"
                  class="field-input"
                  placeholder="field"
                  @change="renameField(entry.name, fieldEntry.name, ($event.target as HTMLInputElement).value)"
                />
                <select
                  :value="fieldEntry.field.type"
                  class="field-input"
                  @change="updateFieldType(entry.name, fieldEntry.name, ($event.target as HTMLSelectElement).value as MemoryFieldType)"
                >
                  <option v-for="type in fieldTypes" :key="type" :value="type">
                    {{ type }}
                  </option>
                </select>
                <button
                  type="button"
                  class="font-mono text-xs text-danger transition-colors hover:text-danger/80"
                  @click="removeField(entry.name, fieldEntry.name)"
                >
                  ×
                </button>
              </div>

              <div class="grid gap-2 md:grid-cols-2">
                <input
                  :value="fieldEntry.field.label ?? ''"
                  class="field-input"
                  placeholder="label"
                  @change="updateFieldOptionalText(entry.name, fieldEntry.name, 'label', ($event.target as HTMLInputElement).value)"
                />
                <label class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
                  <input
                    type="checkbox"
                    :checked="!!fieldEntry.field.required"
                    class="accent-cyan-400"
                    @change="updateField(entry.name, fieldEntry.name, { required: ($event.target as HTMLInputElement).checked || undefined })"
                  />
                  required
                </label>
              </div>

              <textarea
                :value="fieldEntry.field.description ?? ''"
                rows="2"
                class="field-textarea"
                placeholder="description"
                @change="updateFieldOptionalText(entry.name, fieldEntry.name, 'description', ($event.target as HTMLTextAreaElement).value)"
              />

              <div class="grid gap-2 md:grid-cols-2">
                <input
                  :value="formatJsonInput(fieldEntry.field.enum)"
                  class="field-input"
                  placeholder="enum JSON array"
                  @change="updateFieldJson(entry.name, fieldEntry.name, 'enum', ($event.target as HTMLInputElement).value, 'array')"
                />
                <input
                  :value="formatJsonInput(fieldEntry.field.default)"
                  class="field-input"
                  placeholder="default JSON"
                  @change="updateFieldJson(entry.name, fieldEntry.name, 'default', ($event.target as HTMLInputElement).value, 'value')"
                />
              </div>

              <div v-if="fieldEntry.field.type === 'array'" class="grid gap-1">
                <span class="field-label">Item Type</span>
                <select
                  :value="fieldEntry.field.item?.type ?? ''"
                  class="field-input"
                  @change="updateArrayItemType(entry.name, fieldEntry.name, ($event.target as HTMLSelectElement).value as MemoryFieldType | '')"
                >
                  <option value="">none</option>
                  <option v-for="type in fieldTypes" :key="type" :value="type">
                    {{ type }}
                  </option>
                </select>
              </div>

              <div class="space-y-2 border-t border-neon-deep/20 pt-2">
                <div class="flex items-center justify-between">
                  <span class="field-label">Relation</span>
                  <button
                    v-if="!fieldEntry.field.relation"
                    type="button"
                    class="font-mono text-[10px] text-neon transition-colors hover:text-neon/80"
                    @click="addRelation(entry.name, fieldEntry.name)"
                  >
                    + 添加
                  </button>
                  <button
                    v-else
                    type="button"
                    class="font-mono text-[10px] text-danger transition-colors hover:text-danger/80"
                    @click="removeRelation(entry.name, fieldEntry.name)"
                  >
                    移除
                  </button>
                </div>

                <div v-if="fieldEntry.field.relation" class="grid gap-2 md:grid-cols-3">
                  <select
                    :value="fieldEntry.field.relation.targetCollection"
                    class="field-input"
                    @change="updateRelation(entry.name, fieldEntry.name, { targetCollection: ($event.target as HTMLSelectElement).value })"
                  >
                    <option
                      v-for="collectionName in collectionNames"
                      :key="collectionName"
                      :value="collectionName"
                    >
                      {{ collectionName }}
                    </option>
                  </select>
                  <select
                    :value="fieldEntry.field.relation.targetField ?? ''"
                    class="field-input"
                    @change="updateRelation(entry.name, fieldEntry.name, { targetField: ($event.target as HTMLSelectElement).value || undefined })"
                  >
                    <option value="">primary/id</option>
                    <option
                      v-for="targetField in relationTargetFields(fieldEntry.field.relation.targetCollection)"
                      :key="targetField"
                      :value="targetField"
                    >
                      {{ targetField }}
                    </option>
                  </select>
                  <select
                    :value="fieldEntry.field.relation.cardinality"
                    class="field-input"
                    @change="updateRelation(entry.name, fieldEntry.name, { cardinality: ($event.target as HTMLSelectElement).value as MemoryRelationCardinality })"
                  >
                    <option value="one">one</option>
                    <option value="many">many</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-2 border-t border-neon-deep/20 pt-3">
            <div class="flex items-center justify-between">
              <span class="field-label">Indexes</span>
              <button
                type="button"
                class="font-mono text-[10px] text-neon transition-colors hover:text-neon/80"
                @click="addIndex(entry.name)"
              >
                + 添加 Index
              </button>
            </div>

            <div
              v-for="(index, indexPosition) in entry.collection.indexes ?? []"
              :key="indexPosition"
              class="grid gap-2 border border-neon-deep/20 bg-panel/40 p-2 md:grid-cols-[1fr_1fr_auto_auto]"
            >
              <input
                :value="index.name ?? ''"
                class="field-input"
                placeholder="name"
                @change="updateIndex(entry.name, indexPosition, { name: optionalText(($event.target as HTMLInputElement).value) })"
              />
              <input
                :value="index.fields.join(', ')"
                class="field-input"
                placeholder="fields"
                @change="updateIndexFields(entry.name, indexPosition, ($event.target as HTMLInputElement).value)"
              />
              <label class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
                <input
                  type="checkbox"
                  :checked="!!index.unique"
                  class="accent-cyan-400"
                  @change="updateIndex(entry.name, indexPosition, { unique: ($event.target as HTMLInputElement).checked || undefined })"
                />
                unique
              </label>
              <button
                type="button"
                class="font-mono text-xs text-danger transition-colors hover:text-danger/80"
                @click="removeIndex(entry.name, indexPosition)"
              >
                ×
              </button>
              <input
                :value="index.description ?? ''"
                class="field-input md:col-span-4"
                placeholder="description"
                @change="updateIndex(entry.name, indexPosition, { description: optionalText(($event.target as HTMLInputElement).value) })"
              />
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  JsonValue,
  MemoryCollectionDefinition,
  MemoryFieldDefinition,
  MemoryFieldRelation,
  MemoryFieldType,
  MemoryIndexDefinition,
  MemoryRelationCardinality,
  MemorySchemaDefinition,
} from '@tsian/contracts'
import { validateMemorySchema } from '@tsian/memory-core'

type JsonFieldKey = 'default' | 'enum'

const fieldTypes: MemoryFieldType[] = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'json',
]

const props = defineProps<{
  schema: unknown
  onUpdate: (schema: MemorySchemaDefinition | undefined) => void
}>()

const parseErrors = ref<string[]>([])

const schema = computed(() => {
  return isSchemaLike(props.schema) ? props.schema : undefined
})

const collectionEntries = computed(() => {
  return Object.entries(schema.value?.collections ?? {})
    .map(([name, collection]) => ({ name, collection }))
    .sort((left, right) => left.name.localeCompare(right.name))
})

const collectionNames = computed(() => collectionEntries.value.map((entry) => entry.name))

const schemaIssues = computed(() => {
  if (!schema.value) return []
  return [
    ...validateMemorySchema(schema.value),
    ...parseErrors.value.map((message, index) => ({
      code: 'EDITOR_PARSE_ERROR',
      path: `editor.${index}`,
      message,
    })),
  ]
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSchemaLike(value: unknown): value is MemorySchemaDefinition {
  return isRecord(value) && isRecord(value.collections)
}

function optionalText(value: string): string | undefined {
  const normalized = value.trim()
  return normalized || undefined
}

function nextSchema(): MemorySchemaDefinition {
  return schema.value ?? {
    id: 'custom.state',
    version: '1',
    defaultNamespace: 'custom',
    collections: {},
  }
}

function emitSchema(next: MemorySchemaDefinition): void {
  props.onUpdate(next)
}

function patchSchema(patch: Partial<MemorySchemaDefinition>): void {
  emitSchema({ ...nextSchema(), ...patch })
}

function createSchema(): void {
  emitSchema(nextSchema())
}

function removeSchema(): void {
  props.onUpdate(undefined)
}

function updateSchemaText(key: 'id' | 'version', value: string): void {
  patchSchema({ [key]: value.trim() })
}

function updateSchemaOptionalText(
  key: 'name' | 'description' | 'defaultNamespace',
  value: string,
): void {
  patchSchema({ [key]: optionalText(value) })
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

function addCollection(): void {
  const current = nextSchema()
  let name = 'records'
  let suffix = 1
  while (current.collections[name]) {
    suffix += 1
    name = `records${suffix}`
  }
  emitSchema({
    ...current,
    collections: {
      ...current.collections,
      [name]: { fields: {} },
    },
  })
}

function renameCollection(previousName: string, raw: string): void {
  const nextName = optionalText(raw)
  const current = nextSchema()
  if (!nextName || nextName === previousName || current.collections[nextName]) return
  const nextCollections: Record<string, MemoryCollectionDefinition> = {}
  for (const [name, collection] of Object.entries(current.collections)) {
    nextCollections[name === previousName ? nextName : name] = collection
  }
  emitSchema({ ...current, collections: nextCollections })
}

function removeCollection(name: string): void {
  const current = nextSchema()
  const nextCollections = { ...current.collections }
  delete nextCollections[name]
  emitSchema({ ...current, collections: nextCollections })
}

function updateCollectionOptionalText(
  collectionName: string,
  key: 'label' | 'description' | 'version' | 'primaryKey',
  value: string,
): void {
  patchCollection(collectionName, { [key]: optionalText(value) })
}

function toggleAdditionalFields(collectionName: string, enabled: boolean): void {
  patchCollection(collectionName, {
    additionalFields: enabled ? { type: 'json' } : undefined,
  })
}

function fieldEntries(collection: MemoryCollectionDefinition) {
  return Object.entries(collection.fields ?? {})
    .map(([name, field]) => ({ name, field }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function patchFields(
  collectionName: string,
  fields: Record<string, MemoryFieldDefinition>,
): void {
  patchCollection(collectionName, { fields })
}

function addField(collectionName: string): void {
  const collection = nextSchema().collections[collectionName]
  if (!collection) return
  let name = 'field'
  let suffix = 1
  while (collection.fields[name]) {
    suffix += 1
    name = `field${suffix}`
  }
  patchFields(collectionName, {
    ...collection.fields,
    [name]: { type: 'string' },
  })
}

function renameField(collectionName: string, previousName: string, raw: string): void {
  const nextName = optionalText(raw)
  const collection = nextSchema().collections[collectionName]
  if (!collection || !nextName || nextName === previousName || collection.fields[nextName]) return
  const nextFields: Record<string, MemoryFieldDefinition> = {}
  for (const [name, field] of Object.entries(collection.fields)) {
    nextFields[name === previousName ? nextName : name] = field
  }
  patchFields(collectionName, nextFields)
}

function removeField(collectionName: string, fieldName: string): void {
  const collection = nextSchema().collections[collectionName]
  if (!collection) return
  const nextFields = { ...collection.fields }
  delete nextFields[fieldName]
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
  const patch: Partial<MemoryFieldDefinition> = { type }
  if (type !== 'array') patch.item = undefined
  updateField(collectionName, fieldName, patch)
}

function updateFieldOptionalText(
  collectionName: string,
  fieldName: string,
  key: 'label' | 'description',
  value: string,
): void {
  updateField(collectionName, fieldName, { [key]: optionalText(value) })
}

function formatJsonInput(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value)
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
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item))
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => isJsonValue(item))
}

function parseJsonInput(raw: string, mode: 'array' | 'value'): JsonValue | JsonValue[] | undefined {
  const value = raw.trim()
  if (!value) return undefined
  const parsed = JSON.parse(value) as unknown
  if (mode === 'array' && !Array.isArray(parsed)) {
    throw new Error('enum must be a JSON array')
  }
  if (!isJsonValue(parsed)) {
    throw new Error('value must be JSON-compatible')
  }
  return parsed
}

function updateFieldJson(
  collectionName: string,
  fieldName: string,
  key: JsonFieldKey,
  raw: string,
  mode: 'array' | 'value',
): void {
  try {
    const value = parseJsonInput(raw, mode)
    updateField(collectionName, fieldName, { [key]: value })
    parseErrors.value = parseErrors.value.filter((item) => !item.includes(`${collectionName}.${fieldName}.${key}`))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    parseErrors.value = [
      ...parseErrors.value.filter((item) => !item.includes(`${collectionName}.${fieldName}.${key}`)),
      `${collectionName}.${fieldName}.${key}: ${message}`,
    ]
  }
}

function updateArrayItemType(
  collectionName: string,
  fieldName: string,
  type: MemoryFieldType | '',
): void {
  updateField(collectionName, fieldName, { item: type ? { type } : undefined })
}

function addRelation(collectionName: string, fieldName: string): void {
  const targetCollection = collectionNames.value[0] ?? collectionName
  updateField(collectionName, fieldName, {
    relation: {
      targetCollection,
      cardinality: 'many',
    },
  })
}

function removeRelation(collectionName: string, fieldName: string): void {
  updateField(collectionName, fieldName, { relation: undefined })
}

function updateRelation(
  collectionName: string,
  fieldName: string,
  patch: Partial<MemoryFieldRelation>,
): void {
  const collection = nextSchema().collections[collectionName]
  const field = collection?.fields[fieldName]
  if (!field?.relation) return
  const relation: MemoryFieldRelation = {
    ...field.relation,
    ...patch,
    targetNamespace: undefined,
  }
  if (!relation.targetField) delete relation.targetField
  updateField(collectionName, fieldName, { relation })
}

function relationTargetFields(collectionName: string): string[] {
  const collection = nextSchema().collections[collectionName]
  return Object.keys(collection?.fields ?? {})
}

function addIndex(collectionName: string): void {
  const collection = nextSchema().collections[collectionName]
  if (!collection) return
  patchCollection(collectionName, {
    indexes: [
      ...(collection.indexes ?? []),
      { fields: [collection.primaryKey ?? 'id'] },
    ],
  })
}

function updateIndex(
  collectionName: string,
  indexPosition: number,
  patch: Partial<MemoryIndexDefinition>,
): void {
  const collection = nextSchema().collections[collectionName]
  if (!collection) return
  patchCollection(collectionName, {
    indexes: (collection.indexes ?? []).map((index, position) =>
      position === indexPosition ? { ...index, ...patch } : index,
    ),
  })
}

function updateIndexFields(
  collectionName: string,
  indexPosition: number,
  raw: string,
): void {
  const fields = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  updateIndex(collectionName, indexPosition, { fields })
}

function removeIndex(collectionName: string, indexPosition: number): void {
  const collection = nextSchema().collections[collectionName]
  if (!collection) return
  patchCollection(collectionName, {
    indexes: (collection.indexes ?? []).filter((_, position) => position !== indexPosition),
  })
}
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
  padding: 0.25rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  color: var(--color-text-main, #e0f7fa);
  outline: none;
}

.field-textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid rgba(0, 139, 139, 0.4);
  background: var(--color-void, #080c11);
  padding: 0.25rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  color: var(--color-text-main, #e0f7fa);
  outline: none;
}
</style>
