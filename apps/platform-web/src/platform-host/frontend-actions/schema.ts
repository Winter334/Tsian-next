import type { JsonValue } from "@tsian/contracts"
import Ajv2020, {
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020"
import {
  canonicalizeStrictJson,
  validateStrictJson,
} from "./json"

export const FRONTEND_ACTION_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"
export const FRONTEND_ACTION_SCHEMA_MAX_BYTES = 64 * 1024
export const FRONTEND_ACTION_SCHEMA_MAX_DEPTH = 64
export const FRONTEND_ACTION_SCHEMA_MAX_NODES = 10_000
export const FRONTEND_ACTION_VALIDATION_MAX_ERRORS = 50
export const FRONTEND_ACTION_VALIDATOR_CACHE_MAX_ENTRIES = 128

const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$async",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$dynamicRef",
  "$recursiveAnchor",
  "$recursiveRef",
])

export interface FrontendActionSchemaIssue {
  code:
    | "invalid_schema_json"
    | "schema_too_large"
    | "schema_too_deep"
    | "schema_too_many_nodes"
    | "schema_dialect_unsupported"
    | "schema_feature_unsupported"
    | "schema_ref_unsupported"
    | "schema_ref_unresolved"
    | "schema_compile_failed"
  path: string
  message: string
}

export interface FrontendActionValidationIssue {
  instancePath: string
  schemaPath: string
  keyword: string
  message: string
}

export type FrontendActionSchemaCompileResult =
  | { ok: true; validator: FrontendActionCompiledValidator; cacheHit: boolean }
  | { ok: false; issue: FrontendActionSchemaIssue }

export type FrontendActionDataValidationResult =
  | { ok: true; value: JsonValue }
  | { ok: false; errors: FrontendActionValidationIssue[]; truncated: boolean }

interface CacheEntry {
  validate: ValidateFunction
}

const SCHEMA_MAP_KEYWORDS = new Set([
  "$defs",
  "definitions",
  "properties",
  "patternProperties",
  "dependentSchemas",
])

const SCHEMA_ARRAY_KEYWORDS = new Set([
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
])

const SCHEMA_VALUE_KEYWORDS = new Set([
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
])

const validatorCache = new Map<string, CacheEntry>()

function schemaPath(path: string, key: string): string {
  return `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`
}

function decodeJsonPointerToken(token: string): string | undefined {
  if (/~(?:[^01]|$)/.test(token)) return undefined
  return token.replace(/~1/g, "/").replace(/~0/g, "~")
}

function resolveLocalJsonPointer(root: JsonValue, reference: string): boolean {
  if (reference === "#") return true
  if (!reference.startsWith("#/")) return false

  let current: JsonValue = root
  const encodedTokens = reference.slice(2).split("/")
  for (const encodedToken of encodedTokens) {
    let token: string
    try {
      const decodedFragment = decodeURIComponent(encodedToken)
      const decodedPointer = decodeJsonPointerToken(decodedFragment)
      if (decodedPointer === undefined) return false
      token = decodedPointer
    } catch {
      return false
    }

    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return false
      const index = Number(token)
      if (!Number.isSafeInteger(index) || index >= current.length) return false
      current = current[index]!
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return false
      current = current[token]!
    } else {
      return false
    }
  }
  return true
}

function inspectSchema(schema: JsonValue): FrontendActionSchemaIssue | undefined {
  const visit = (current: JsonValue, path: string): FrontendActionSchemaIssue | undefined => {
    if (typeof current === "boolean") return undefined
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return {
        code: "schema_compile_failed",
        path,
        message: "A schema position must contain an object or boolean schema.",
      }
    }

    for (const [key, value] of Object.entries(current)) {
      const currentPath = schemaPath(path, key)
      if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
        return {
          code: "schema_feature_unsupported",
          path: currentPath,
          message: `${key} is not supported in Frontend Action schemas.`,
        }
      }
      if (key === "$schema") {
        if (value !== FRONTEND_ACTION_SCHEMA_DIALECT) {
          return {
            code: "schema_dialect_unsupported",
            path: currentPath,
            message: "Only JSON Schema Draft 2020-12 is supported.",
          }
        }
      } else if (key === "$vocabulary") {
        return {
          code: "schema_feature_unsupported",
          path: currentPath,
          message: "$vocabulary is not supported in Frontend Action schemas.",
        }
      } else if (key === "$ref") {
        if (typeof value !== "string" || (value !== "#" && !value.startsWith("#/"))) {
          return {
            code: "schema_ref_unsupported",
            path: currentPath,
            message: "$ref must be a same-document JSON Pointer fragment.",
          }
        }
        if (!resolveLocalJsonPointer(schema, value)) {
          return {
            code: "schema_ref_unresolved",
            path: currentPath,
            message: "$ref does not resolve within this schema document.",
          }
        }
      }

      if (SCHEMA_MAP_KEYWORDS.has(key) && value !== null && typeof value === "object" && !Array.isArray(value)) {
        for (const [childKey, childSchema] of Object.entries(value)) {
          const issue = visit(childSchema, schemaPath(currentPath, childKey))
          if (issue) return issue
        }
      } else if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const issue = visit(value[index]!, `${currentPath}/${index}`)
          if (issue) return issue
        }
      } else if (SCHEMA_VALUE_KEYWORDS.has(key)) {
        const issue = visit(value, currentPath)
        if (issue) return issue
      }
    }
    return undefined
  }
  return visit(schema, "#")
}

function cacheGet(key: string): ValidateFunction | undefined {
  const entry = validatorCache.get(key)
  if (!entry) return undefined
  validatorCache.delete(key)
  validatorCache.set(key, entry)
  return entry.validate
}

function cacheSet(key: string, validate: ValidateFunction): void {
  validatorCache.set(key, { validate })
  while (validatorCache.size > FRONTEND_ACTION_VALIDATOR_CACHE_MAX_ENTRIES) {
    const oldestKey = validatorCache.keys().next().value as string | undefined
    if (oldestKey === undefined) break
    validatorCache.delete(oldestKey)
  }
}

function compile(schema: JsonValue): ValidateFunction {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    validateFormats: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    $data: false,
    addUsedSchema: false,
    ownProperties: true,
  })
  return ajv.compile(schema as AnySchema)
}

function normalizedValidationErrors(errors: ErrorObject[] | null | undefined): {
  errors: FrontendActionValidationIssue[]
  truncated: boolean
} {
  const source = errors ?? []
  return {
    errors: source.slice(0, FRONTEND_ACTION_VALIDATION_MAX_ERRORS).map((error) => ({
      instancePath: error.instancePath,
      schemaPath: error.schemaPath,
      keyword: error.keyword,
      message: error.message ?? "Value does not satisfy the schema.",
    })),
    truncated: source.length > FRONTEND_ACTION_VALIDATION_MAX_ERRORS,
  }
}

export class FrontendActionCompiledValidator {
  constructor(
    readonly cacheKey: string,
    private readonly validateFunction: ValidateFunction,
  ) {}

  validate(value: JsonValue): FrontendActionDataValidationResult {
    if (this.validateFunction(value)) return { ok: true, value }
    return { ok: false, ...normalizedValidationErrors(this.validateFunction.errors) }
  }
}

export function compileFrontendActionSchema(
  schema: unknown,
): FrontendActionSchemaCompileResult {
  const structural = validateStrictJson(schema, {
    maxBytes: FRONTEND_ACTION_SCHEMA_MAX_BYTES,
    maxDepth: FRONTEND_ACTION_SCHEMA_MAX_DEPTH,
    maxNodes: FRONTEND_ACTION_SCHEMA_MAX_NODES,
  })
  if (!structural.ok) {
    const code = structural.issue.code === "max_bytes"
      ? "schema_too_large"
      : structural.issue.code === "max_depth"
        ? "schema_too_deep"
        : structural.issue.code === "max_nodes"
          ? "schema_too_many_nodes"
          : "invalid_schema_json"
    return {
      ok: false,
      issue: {
        code,
        path: structural.issue.path,
        message: structural.issue.message,
      },
    }
  }

  const preflightIssue = inspectSchema(structural.value)
  if (preflightIssue) return { ok: false, issue: preflightIssue }

  const cacheKey = canonicalizeStrictJson(structural.value)
  const cached = cacheGet(cacheKey)
  if (cached) {
    return {
      ok: true,
      validator: new FrontendActionCompiledValidator(cacheKey, cached),
      cacheHit: true,
    }
  }

  let validate: ValidateFunction
  try {
    validate = compile(structural.value)
  } catch {
    return {
      ok: false,
      issue: {
        code: "schema_compile_failed",
        path: "#",
        message: "Schema could not be compiled under strict Draft 2020-12 rules.",
      },
    }
  }

  cacheSet(cacheKey, validate)
  return {
    ok: true,
    validator: new FrontendActionCompiledValidator(cacheKey, validate),
    cacheHit: false,
  }
}

export function validateFrontendActionData(
  validator: FrontendActionCompiledValidator,
  value: unknown,
): FrontendActionDataValidationResult {
  const structural = validateStrictJson(value)
  if (!structural.ok) {
    return {
      ok: false,
      errors: [{
        instancePath: structural.issue.path,
        schemaPath: "",
        keyword: "strictJson",
        message: structural.issue.message,
      }],
      truncated: false,
    }
  }
  return validator.validate(structural.value)
}

/** Test and diagnostics seam; production callers should not enumerate cached schemas. */
export function getFrontendActionValidatorCacheSize(): number {
  return validatorCache.size
}

export function clearFrontendActionValidatorCache(): void {
  validatorCache.clear()
}
