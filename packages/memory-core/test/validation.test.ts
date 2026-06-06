import type { MemorySchemaDefinition } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import {
  assertValidMemorySchema,
  defaultAirpMemorySchema,
  MemoryValidationError,
  normalizeStateWriteOperation,
  validateMemorySchema,
  validateStateWriteOperation,
} from "../src"

function cloneSchema(): MemorySchemaDefinition {
  return JSON.parse(JSON.stringify(defaultAirpMemorySchema)) as MemorySchemaDefinition
}

describe("memory schema validation", () => {
  it("accepts the default AIRP runtime memory schema", () => {
    expect(() => assertValidMemorySchema(defaultAirpMemorySchema)).not.toThrow()
  })

  it("rejects relation fields that target missing collections", () => {
    const schema = cloneSchema()
    schema.collections.events.fields.entityArchiveIds.relation = {
      targetCollection: "missing",
      targetField: "id",
      cardinality: "many",
    }

    expect(validateMemorySchema(schema)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_RELATION_COLLECTION" }),
      ]),
    )
  })

  it("rejects indexes that reference unknown fields", () => {
    const schema = cloneSchema()
    schema.collections.events.indexes = [{ name: "bad", fields: ["missing"] }]

    expect(validateMemorySchema(schema)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_INDEX_FIELD" }),
      ]),
    )
  })
})

describe("state write operation validation", () => {
  it("normalizes a valid upsert with the schema default namespace", () => {
    const normalized = normalizeStateWriteOperation(defaultAirpMemorySchema, {
      type: "upsert",
      collection: "events",
      id: "event-1",
      data: {
        time: "2026-06-04 20:00",
        status: "ongoing",
        entityTags: ["白沙"],
        content: "白沙开始调查新的记忆模型。",
      },
    })

    expect(normalized.namespace).toBe("airp")
    expect(normalized.collection).toBe("events")
  })

  it("rejects an upsert missing required fields", () => {
    expect(
      validateStateWriteOperation(defaultAirpMemorySchema, {
        type: "upsert",
        collection: "events",
        data: {
          status: "ongoing",
          entityTags: [],
          content: "缺少时间。",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_REQUIRED_FIELD" }),
      ]),
    )
  })

  it("rejects unknown fields by default", () => {
    expect(
      validateStateWriteOperation(defaultAirpMemorySchema, {
        type: "upsert",
        collection: "events",
        data: {
          time: "2026-06-04 20:00",
          status: "ongoing",
          entityTags: [],
          content: "多了未知字段。",
          surprise: true,
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_FIELD" }),
      ]),
    )
  })

  it("allows archive additional fields when the collection opts in", () => {
    expect(
      validateStateWriteOperation(defaultAirpMemorySchema, {
        type: "upsert",
        collection: "archives",
        id: "archive-1",
        data: {
          type: "character",
          name: "白沙",
          aliases: [],
          background: "测试角色。",
          situation: "正在验证 memory schema。",
          linkedNames: [],
          presence: "foreground",
          customAffinity: 7,
        },
      }),
    ).toEqual([])
  })

  it("treats patch as shallow field validation and requires id", () => {
    expect(
      validateStateWriteOperation(defaultAirpMemorySchema, {
        type: "patch",
        collection: "events",
        data: {
          status: "done",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_OPERATION_ID" }),
      ]),
    )

    expect(
      validateStateWriteOperation(defaultAirpMemorySchema, {
        type: "patch",
        collection: "events",
        id: "event-1",
        data: {
          status: "done",
        },
      }),
    ).toEqual([])
  })

  it("rejects invalid operation types and delete without id", () => {
    expect(
      validateStateWriteOperation(defaultAirpMemorySchema, {
        type: "merge",
        collection: "events",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_OPERATION_TYPE" }),
      ]),
    )

    expect(
      validateStateWriteOperation(defaultAirpMemorySchema, {
        type: "delete",
        collection: "events",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_OPERATION_ID" }),
      ]),
    )
  })

  it("throws a structured validation error when normalization fails", () => {
    expect(() =>
      normalizeStateWriteOperation(defaultAirpMemorySchema, {
        type: "clear",
        collection: "missing",
      }),
    ).toThrow(MemoryValidationError)
  })
})
