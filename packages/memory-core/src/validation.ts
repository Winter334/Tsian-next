import type {
  JsonValue,
  MemoryCollectionDefinition,
  MemoryFieldDefinition,
  MemoryFieldType,
  MemorySchemaDefinition,
  MemoryValidationIssue,
  MemoryWriteOperation,
  MemoryWriteOperationDefaults,
  NormalizedMemoryWriteOperation,
} from "@tsian/contracts"

const FIELD_TYPES = new Set<MemoryFieldType>([
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "json",
])

const OPERATION_TYPES = new Set(["upsert", "patch", "delete", "clear"])

export class MemoryValidationError extends Error {
  readonly issues: MemoryValidationIssue[]

  constructor(message: string, issues: MemoryValidationIssue[]) {
    super(message)
    this.name = "MemoryValidationError"
    this.issues = issues
  }
}

function issue(
  issues: MemoryValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (!isPlainObject(value)) {
    return false
  }

  return Object.values(value).every(isJsonValue)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function assertSchema(schema: unknown): MemorySchemaDefinition | null {
  return isPlainObject(schema) ? (schema as unknown as MemorySchemaDefinition) : null
}

function validateField(
  raw: unknown,
  path: string,
  issues: MemoryValidationIssue[],
  schema: MemorySchemaDefinition | null,
): void {
  if (!isPlainObject(raw)) {
    issue(issues, "INVALID_FIELD", path, "memory field must be an object")
    return
  }

  const field = raw as Partial<MemoryFieldDefinition>
  if (!FIELD_TYPES.has(field.type as MemoryFieldType)) {
    issue(issues, "INVALID_FIELD_TYPE", `${path}.type`, "memory field type is invalid")
  }

  if (field.default !== undefined && !isJsonValue(field.default)) {
    issue(issues, "INVALID_FIELD_DEFAULT", `${path}.default`, "field default must be JSON")
  }

  if (field.enum !== undefined) {
    if (!Array.isArray(field.enum)) {
      issue(issues, "INVALID_FIELD_ENUM", `${path}.enum`, "field enum must be an array")
    } else {
      field.enum.forEach((item, index) => {
        if (!isJsonValue(item)) {
          issue(
            issues,
            "INVALID_FIELD_ENUM_VALUE",
            `${path}.enum.${index}`,
            "field enum value must be JSON",
          )
        }
      })
    }
  }

  if (field.item !== undefined) {
    validateField(field.item, `${path}.item`, issues, schema)
  }

  if (field.fields !== undefined) {
    validateFieldMap(field.fields, `${path}.fields`, issues, schema)
  }

  if (field.relation !== undefined) {
    const relationPath = `${path}.relation`
    if (!isPlainObject(field.relation)) {
      issue(issues, "INVALID_RELATION", relationPath, "field relation must be an object")
      return
    }

    if (!nonEmptyString(field.relation.targetCollection)) {
      issue(
        issues,
        "INVALID_RELATION_TARGET",
        `${relationPath}.targetCollection`,
        "relation targetCollection is required",
      )
    } else if (schema) {
      const target = schema.collections[field.relation.targetCollection]
      if (!target) {
        issue(
          issues,
          "UNKNOWN_RELATION_COLLECTION",
          `${relationPath}.targetCollection`,
          `relation target collection "${field.relation.targetCollection}" does not exist`,
        )
      } else {
        const targetField = field.relation.targetField ?? target.primaryKey ?? "id"
        if (!target.fields[targetField]) {
          issue(
            issues,
            "UNKNOWN_RELATION_FIELD",
            `${relationPath}.targetField`,
            `relation target field "${targetField}" does not exist`,
          )
        }
      }
    }

    if (
      field.relation.cardinality !== "one" &&
      field.relation.cardinality !== "many"
    ) {
      issue(
        issues,
        "INVALID_RELATION_CARDINALITY",
        `${relationPath}.cardinality`,
        "relation cardinality must be one or many",
      )
    }
  }
}

function validateFieldMap(
  raw: unknown,
  path: string,
  issues: MemoryValidationIssue[],
  schema: MemorySchemaDefinition | null,
): void {
  if (!isPlainObject(raw)) {
    issue(issues, "INVALID_FIELDS", path, "memory fields must be an object")
    return
  }

  for (const [name, field] of Object.entries(raw)) {
    if (!name.trim()) {
      issue(issues, "INVALID_FIELD_NAME", path, "memory field name is required")
      continue
    }
    validateField(field, `${path}.${name}`, issues, schema)
  }
}

function validateCollection(
  name: string,
  raw: unknown,
  path: string,
  issues: MemoryValidationIssue[],
  schema: MemorySchemaDefinition,
): void {
  if (!name.trim()) {
    issue(issues, "INVALID_COLLECTION_NAME", path, "collection name is required")
  }

  if (!isPlainObject(raw)) {
    issue(issues, "INVALID_COLLECTION", path, "memory collection must be an object")
    return
  }

  const collection = raw as Partial<MemoryCollectionDefinition>
  validateFieldMap(collection.fields, `${path}.fields`, issues, schema)

  if (collection.primaryKey !== undefined) {
    if (!nonEmptyString(collection.primaryKey)) {
      issue(issues, "INVALID_PRIMARY_KEY", `${path}.primaryKey`, "primaryKey must be non-empty")
    } else if (!collection.fields?.[collection.primaryKey]) {
      issue(
        issues,
        "UNKNOWN_PRIMARY_KEY",
        `${path}.primaryKey`,
        `primaryKey field "${collection.primaryKey}" does not exist`,
      )
    }
  }

  if (collection.additionalFields !== undefined) {
    if (!isPlainObject(collection.additionalFields)) {
      issue(
        issues,
        "INVALID_ADDITIONAL_FIELDS",
        `${path}.additionalFields`,
        "additionalFields must be an object",
      )
    } else if (collection.additionalFields.type !== "json") {
      issue(
        issues,
        "INVALID_ADDITIONAL_FIELDS_TYPE",
        `${path}.additionalFields.type`,
        "additionalFields type must be json",
      )
    }
  }

  if (collection.indexes !== undefined) {
    if (!Array.isArray(collection.indexes)) {
      issue(issues, "INVALID_INDEXES", `${path}.indexes`, "indexes must be an array")
    } else {
      collection.indexes.forEach((index, indexPosition) => {
        const indexPath = `${path}.indexes.${indexPosition}`
        if (!isPlainObject(index)) {
          issue(issues, "INVALID_INDEX", indexPath, "index must be an object")
          return
        }
        if (!Array.isArray(index.fields) || index.fields.length === 0) {
          issue(issues, "INVALID_INDEX_FIELDS", `${indexPath}.fields`, "index fields are required")
          return
        }
        index.fields.forEach((fieldName, fieldPosition) => {
          if (!nonEmptyString(fieldName) || !collection.fields?.[fieldName]) {
            issue(
              issues,
              "UNKNOWN_INDEX_FIELD",
              `${indexPath}.fields.${fieldPosition}`,
              `index field "${String(fieldName)}" does not exist`,
            )
          }
        })
      })
    }
  }
}

export function validateMemorySchema(schema: unknown): MemoryValidationIssue[] {
  const issues: MemoryValidationIssue[] = []
  const parsed = assertSchema(schema)
  if (!parsed) {
    issue(issues, "INVALID_SCHEMA", "schema", "memory schema must be an object")
    return issues
  }

  if (!nonEmptyString(parsed.id)) {
    issue(issues, "INVALID_SCHEMA_ID", "schema.id", "schema id is required")
  }

  if (!nonEmptyString(parsed.version)) {
    issue(issues, "INVALID_SCHEMA_VERSION", "schema.version", "schema version is required")
  }

  if (!isPlainObject(parsed.collections)) {
    issue(issues, "INVALID_COLLECTIONS", "schema.collections", "schema collections must be an object")
    return issues
  }

  for (const [name, collection] of Object.entries(parsed.collections)) {
    validateCollection(name, collection, `schema.collections.${name}`, issues, parsed)
  }

  return issues
}

export function assertValidMemorySchema(
  schema: unknown,
): asserts schema is MemorySchemaDefinition {
  const issues = validateMemorySchema(schema)
  if (issues.length > 0) {
    throw new MemoryValidationError("memory schema is invalid", issues)
  }
}

function getCollection(
  schema: MemorySchemaDefinition,
  collectionName: string,
): MemoryCollectionDefinition | undefined {
  return schema.collections[collectionName]
}

function validateFieldValue(
  field: MemoryFieldDefinition,
  value: unknown,
  path: string,
  issues: MemoryValidationIssue[],
): void {
  if (!isJsonValue(value)) {
    issue(issues, "INVALID_JSON_VALUE", path, "field value must be JSON")
    return
  }

  if (field.type === "json") {
    return
  }

  if (field.type === "array") {
    if (!Array.isArray(value)) {
      issue(issues, "INVALID_FIELD_VALUE", path, "field value must be an array")
      return
    }
    if (field.item) {
      const itemField = field.item
      value.forEach((item, index) =>
        validateFieldValue(itemField, item, `${path}.${index}`, issues),
      )
    }
    return
  }

  if (field.type === "object") {
    if (!isPlainObject(value)) {
      issue(issues, "INVALID_FIELD_VALUE", path, "field value must be an object")
    }
    return
  }

  if (typeof value !== field.type) {
    issue(issues, "INVALID_FIELD_VALUE", path, `field value must be ${field.type}`)
    return
  }

  if (field.enum && !field.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    issue(issues, "INVALID_FIELD_ENUM_VALUE", path, "field value is not in enum")
  }
}

function validateRecordData(
  collection: MemoryCollectionDefinition,
  data: unknown,
  path: string,
  requireRequiredFields: boolean,
  issues: MemoryValidationIssue[],
): void {
  if (!isPlainObject(data)) {
    issue(issues, "INVALID_OPERATION_DATA", path, "operation data must be an object")
    return
  }

  if (requireRequiredFields) {
    for (const [fieldName, field] of Object.entries(collection.fields)) {
      if (field.required && data[fieldName] === undefined) {
        issue(
          issues,
          "MISSING_REQUIRED_FIELD",
          `${path}.${fieldName}`,
          `required field "${fieldName}" is missing`,
        )
      }
    }
  }

  for (const [fieldName, value] of Object.entries(data)) {
    const field = collection.fields[fieldName]
    if (!field) {
      if (!collection.additionalFields) {
        issue(
          issues,
          "UNKNOWN_FIELD",
          `${path}.${fieldName}`,
          `field "${fieldName}" is not declared by the collection schema`,
        )
      } else if (!isJsonValue(value)) {
        issue(
          issues,
          "INVALID_ADDITIONAL_FIELD_VALUE",
          `${path}.${fieldName}`,
          "additional field value must be JSON",
        )
      }
      continue
    }
    validateFieldValue(field, value, `${path}.${fieldName}`, issues)
  }
}

export function validateMemoryWriteOperation(
  schema: MemorySchemaDefinition,
  operation: unknown,
  defaults: MemoryWriteOperationDefaults = {},
): MemoryValidationIssue[] {
  const issues = validateMemorySchema(schema)
  if (issues.length > 0) {
    return issues
  }

  if (!isPlainObject(operation)) {
    return [
      {
        code: "INVALID_OPERATION",
        path: "operation",
        message: "memory write operation must be an object",
      },
    ]
  }

  const op = operation as Partial<MemoryWriteOperation>
  if (!OPERATION_TYPES.has(String(op.type))) {
    issue(issues, "INVALID_OPERATION_TYPE", "operation.type", "operation type is invalid")
    return issues
  }

  const namespace = op.namespace ?? defaults.namespace ?? schema.defaultNamespace
  if (!nonEmptyString(namespace)) {
    issue(issues, "MISSING_NAMESPACE", "operation.namespace", "operation namespace is required")
  }

  const collectionName = op.collection ?? defaults.collection
  if (!nonEmptyString(collectionName)) {
    issue(issues, "MISSING_COLLECTION", "operation.collection", "operation collection is required")
    return issues
  }

  const collection = getCollection(schema, collectionName)
  if (!collection) {
    issue(
      issues,
      "UNKNOWN_COLLECTION",
      "operation.collection",
      `collection "${collectionName}" does not exist`,
    )
    return issues
  }

  if ((op.type === "delete" || op.type === "patch") && !nonEmptyString(op.id)) {
    issue(issues, "MISSING_OPERATION_ID", "operation.id", `${op.type} operation requires id`)
  }

  if (op.type === "upsert") {
    validateRecordData(collection, op.data, "operation.data", true, issues)
  }

  if (op.type === "patch") {
    validateRecordData(collection, op.data, "operation.data", false, issues)
  }

  return issues
}

export function normalizeMemoryWriteOperation(
  schema: MemorySchemaDefinition,
  operation: unknown,
  defaults: MemoryWriteOperationDefaults = {},
): NormalizedMemoryWriteOperation {
  const issues = validateMemoryWriteOperation(schema, operation, defaults)
  if (issues.length > 0) {
    throw new MemoryValidationError("memory write operation is invalid", issues)
  }

  const op = operation as MemoryWriteOperation
  return {
    ...op,
    namespace: op.namespace ?? defaults.namespace ?? schema.defaultNamespace!,
    collection: op.collection ?? defaults.collection!,
  }
}
