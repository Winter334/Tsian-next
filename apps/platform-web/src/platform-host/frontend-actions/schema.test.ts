import { beforeEach, describe, expect, it } from "vitest"
import {
  FRONTEND_ACTION_VALIDATION_MAX_ERRORS,
  FRONTEND_ACTION_VALIDATOR_CACHE_MAX_ENTRIES,
  clearFrontendActionValidatorCache,
  compileFrontendActionSchema,
  getFrontendActionValidatorCacheSize,
  validateFrontendActionData,
} from "./schema"

function compiled(schema: unknown) {
  const result = compileFrontendActionSchema(schema)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.issue.code)
  return result.validator
}

describe("Frontend Action schema validation", () => {
  beforeEach(clearFrontendActionValidatorCache)

  it("validates Draft 2020-12 nested data, additionalProperties, enums, and bounds", () => {
    const validator = compiled({
      type: "object",
      additionalProperties: false,
      required: ["mode", "items"],
      properties: {
        mode: { enum: ["take", "drop"] },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["count"],
            properties: { count: { type: "integer", minimum: 1, maximum: 3 } },
          },
        },
      },
    })

    expect(validateFrontendActionData(validator, {
      mode: "take",
      items: [{ count: 2 }],
    }).ok).toBe(true)
    expect(validateFrontendActionData(validator, {
      mode: "other",
      items: [{ count: 4, unknown: true }],
    }).ok).toBe(false)
  })

  it("supports resolvable same-document JSON Pointer references", () => {
    const validator = compiled({
      $defs: {
        identifier: { type: "string", minLength: 2 },
        "slash/key": { type: "integer" },
      },
      type: "object",
      required: ["id", "count"],
      properties: {
        id: { $ref: "#/$defs/identifier" },
        count: { $ref: "#/$defs/slash~1key" },
      },
    })
    expect(validator.validate({ id: "ok", count: 1 }).ok).toBe(true)
    expect(validator.validate({ id: "x", count: 1 }).ok).toBe(false)
  })

  it.each([
    [{ $ref: "https://example.invalid/schema.json" }, "schema_ref_unsupported"],
    [{ $ref: "other.json#/thing" }, "schema_ref_unsupported"],
    [{ $ref: "#/$defs/missing" }, "schema_ref_unresolved"],
    [{ $async: true }, "schema_feature_unsupported"],
    [{ $id: "https://example.invalid/schema" }, "schema_feature_unsupported"],
    [{ $dynamicRef: "#node" }, "schema_feature_unsupported"],
    [{ $schema: "http://json-schema.org/draft-07/schema#" }, "schema_dialect_unsupported"],
    [{ $vocabulary: {} }, "schema_feature_unsupported"],
  ])("rejects unsupported schema %j", (schema, code) => {
    const result = compileFrontendActionSchema(schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issue.code).toBe(code)
  })

  it("uses Ajv strict compilation to reject unknown keywords", () => {
    const result = compileFrontendActionSchema({ type: "string", mysteryKeyword: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issue.code).toBe("schema_compile_failed")
  })

  it("caps exposed validation errors", () => {
    const properties = Object.fromEntries(
      Array.from({ length: FRONTEND_ACTION_VALIDATION_MAX_ERRORS + 10 }, (_, index) => [
        `p${index}`,
        { type: "string" },
      ]),
    )
    const validator = compiled({ type: "object", required: Object.keys(properties), properties })
    const result = validator.validate({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(FRONTEND_ACTION_VALIDATION_MAX_ERRORS)
      expect(result.truncated).toBe(true)
    }
  })

  it("reuses validators and evicts the least-recent cache entry", () => {
    const firstSchema = { const: "first" }
    const first = compileFrontendActionSchema(firstSchema)
    expect(first.ok && first.cacheHit).toBe(false)
    expect(compileFrontendActionSchema(firstSchema)).toMatchObject({ ok: true, cacheHit: true })

    for (let index = 0; index < FRONTEND_ACTION_VALIDATOR_CACHE_MAX_ENTRIES; index += 1) {
      expect(compileFrontendActionSchema({ const: index }).ok).toBe(true)
    }
    expect(getFrontendActionValidatorCacheSize()).toBe(FRONTEND_ACTION_VALIDATOR_CACHE_MAX_ENTRIES)
    expect(compileFrontendActionSchema(firstSchema)).toMatchObject({ ok: true, cacheHit: false })
  })
})
