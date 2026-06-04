import type { JsonValue, MemoryWriteOperation } from "./runtime"

export type MemoryFieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "json"

export type MemoryRelationCardinality = "one" | "many"

export interface MemoryFieldRelation {
  targetNamespace?: string
  targetCollection: string
  /** Defaults to the target collection primary key, then "id". */
  targetField?: string
  cardinality: MemoryRelationCardinality
}

export interface MemoryFieldRenderMetadata {
  kind?: string
  label?: string
  description?: string
  group?: string
  order?: number
  hidden?: boolean
}

export interface MemoryFieldDefinition {
  type: MemoryFieldType
  label?: string
  description?: string
  required?: boolean
  default?: JsonValue
  enum?: JsonValue[]
  item?: MemoryFieldDefinition
  fields?: Record<string, MemoryFieldDefinition>
  relation?: MemoryFieldRelation
  render?: MemoryFieldRenderMetadata
}

export interface MemoryIndexDefinition {
  name?: string
  fields: string[]
  unique?: boolean
  description?: string
}

export interface MemoryAdditionalFieldsDefinition {
  type: "json"
  description?: string
}

export interface MemoryCollectionDefinition {
  label?: string
  description?: string
  version?: string
  primaryKey?: string
  fields: Record<string, MemoryFieldDefinition>
  indexes?: MemoryIndexDefinition[]
  additionalFields?: MemoryAdditionalFieldsDefinition
}

export interface MemorySchemaDefinition {
  id: string
  name?: string
  description?: string
  version: string
  defaultNamespace?: string
  collections: Record<string, MemoryCollectionDefinition>
}

export interface MemoryWriteOperationDefaults {
  namespace?: string
  collection?: string
}

export interface NormalizedMemoryWriteOperation extends MemoryWriteOperation {
  namespace: string
  collection: string
}

export interface MemoryValidationIssue {
  code: string
  path: string
  message: string
}
