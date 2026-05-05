import type {
  ArchiveRecord,
  JsonValue,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
} from "./runtime"

export interface ModManifest {
  id: string
  name: string
  version: string
  author?: string
  description?: string
}

export interface ModFrontendConfig {
  frontendId?: string
  [key: string]: JsonValue | undefined
}

export interface EntityFieldDefinition {
  key: string
  label: string
  valueType: "string" | "number" | "boolean" | "string[]" | "json"
  required?: boolean
  description?: string
}

export interface EntityTypeDefinition {
  type: string
  label: string
  fields: EntityFieldDefinition[]
  description?: string
}

export interface CatalogEventTrigger {
  notBefore?: string
  notAfter?: string
  requiredGlobals?: Record<string, JsonValue | JsonValue[]>
  requiredEntityNames?: string[]
}

export interface CatalogEventRecord {
  id: string
  name: string
  entityTags: string[]
  content: string
  trigger?: CatalogEventTrigger
  guidance?: string
}

export interface ModStaticContent {
  manifest: ModManifest
  frontendConfig: ModFrontendConfig
  entityTypeDefinitions: EntityTypeDefinition[]
  archiveCatalog: Array<Omit<ArchiveRecord, "id">>
  eventCatalog: CatalogEventRecord[]
  globalsDefaults: RuntimeGlobalsMap
}

export interface ModInitialSavePayload {
  snapshot: RuntimeSnapshotShell
  events: Array<{
    time: string
    status: string
    entityTags: string[]
    content: string
  }>
  archives: Array<Omit<ArchiveRecord, "id">>
}
