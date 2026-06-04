import type { MemorySchemaDefinition } from "@tsian/contracts"

export const DEFAULT_AIRP_MEMORY_NAMESPACE = "airp"
export const DEFAULT_AIRP_MEMORY_SCHEMA_ID = "builtin.airp.runtime-memory"

export const defaultAirpMemorySchema: MemorySchemaDefinition = {
  id: DEFAULT_AIRP_MEMORY_SCHEMA_ID,
  name: "Default AIRP Runtime Memory",
  description: "Runtime memory schema for AIRP events, archives, and globals.",
  version: "1",
  defaultNamespace: DEFAULT_AIRP_MEMORY_NAMESPACE,
  collections: {
    events: {
      label: "Events",
      description: "Runtime narrative events.",
      version: "1",
      primaryKey: "id",
      fields: {
        id: {
          type: "string",
          description: "Logical event id. The operation id is authoritative when present.",
          render: { kind: "id", hidden: true },
        },
        time: {
          type: "string",
          required: true,
          description: "Narrative timestamp.",
          render: { kind: "datetime", label: "Time" },
        },
        status: {
          type: "string",
          required: true,
          enum: ["ongoing", "done"],
          render: { kind: "select", label: "Status" },
        },
        entityTags: {
          type: "array",
          required: true,
          item: { type: "string" },
          description: "Weak name references to entities involved in this event.",
          render: { kind: "tags", label: "Entity Tags" },
        },
        entityArchiveIds: {
          type: "array",
          item: { type: "string" },
          description: "Strong archive id references resolved from entity tags.",
          relation: {
            targetCollection: "archives",
            targetField: "id",
            cardinality: "many",
          },
          render: { kind: "relation", label: "Entity Archives" },
        },
        content: {
          type: "string",
          required: true,
          render: { kind: "textarea", label: "Content" },
        },
      },
      indexes: [
        { name: "events_by_time", fields: ["time"] },
        { name: "events_by_status", fields: ["status"] },
      ],
    },
    archives: {
      label: "Archives",
      description: "Runtime entity archives.",
      version: "1",
      primaryKey: "id",
      additionalFields: {
        type: "json",
        description: "Mod-specific archive fields.",
      },
      fields: {
        id: {
          type: "string",
          description: "Logical archive id. The operation id is authoritative when present.",
          render: { kind: "id", hidden: true },
        },
        type: {
          type: "string",
          required: true,
          render: { kind: "select", label: "Type" },
        },
        name: {
          type: "string",
          required: true,
          render: { kind: "text", label: "Name" },
        },
        aliases: {
          type: "array",
          required: true,
          item: { type: "string" },
          render: { kind: "tags", label: "Aliases" },
        },
        background: {
          type: "string",
          required: true,
          render: { kind: "textarea", label: "Background" },
        },
        situation: {
          type: "string",
          required: true,
          render: { kind: "textarea", label: "Situation" },
        },
        focus: {
          type: "string",
          render: { kind: "textarea", label: "Focus" },
        },
        linkedNames: {
          type: "array",
          required: true,
          item: { type: "string" },
          description: "Weak name references to related archives.",
          render: { kind: "tags", label: "Linked Names" },
        },
        linkedArchiveIds: {
          type: "array",
          item: { type: "string" },
          description: "Strong archive id references resolved from linked names.",
          relation: {
            targetCollection: "archives",
            targetField: "id",
            cardinality: "many",
          },
          render: { kind: "relation", label: "Linked Archives" },
        },
        presence: {
          type: "string",
          required: true,
          enum: ["foreground", "background", "retired"],
          render: { kind: "select", label: "Presence" },
        },
      },
      indexes: [
        { name: "archives_by_name", fields: ["name"] },
        { name: "archives_by_type", fields: ["type"] },
        { name: "archives_by_presence", fields: ["presence"] },
      ],
    },
    globals: {
      label: "Globals",
      description: "Runtime global state entries.",
      version: "1",
      primaryKey: "key",
      fields: {
        key: {
          type: "string",
          required: true,
          render: { kind: "id", label: "Key" },
        },
        value: {
          type: "json",
          required: true,
          render: { kind: "json", label: "Value" },
        },
      },
      indexes: [{ name: "globals_by_key", fields: ["key"], unique: true }],
    },
  },
}
