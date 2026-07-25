import type { JsonValue } from "@tsian/contracts"
import { FrontendActionRuntimeError } from "./errors"
import {
  FRONTEND_ACTION_SCHEMA_DIALECT,
  compileFrontendActionSchema,
  validateFrontendActionData,
} from "./schema"
import { runFrontendActionWorker } from "./worker"

export interface FrontendActionRuntimePreflightResult {
  schemaCompiled: true
  validDataAccepted: true
  invalidDataRejected: true
  workerExecuted: true
  workerOrigin: "null"
  indexedDB: "undefined"
  caches: "undefined"
  workerConstructor: "undefined"
  sharedWorkerConstructor: "undefined"
  navigatorStorage: "undefined"
  navigatorServiceWorker: "undefined"
}

interface WorkerIsolationProbe {
  workerExecuted?: unknown
  workerOrigin?: unknown
  indexedDB?: unknown
  caches?: unknown
  workerConstructor?: unknown
  sharedWorkerConstructor?: unknown
  navigatorStorage?: unknown
  navigatorServiceWorker?: unknown
}

const PREFLIGHT_SCHEMA: JsonValue = {
  $schema: FRONTEND_ACTION_SCHEMA_DIALECT,
  type: "object",
  required: ["items", "mode"],
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/item" },
    },
    mode: { enum: ["apply", "preview"] },
  },
  $defs: {
    item: {
      type: "object",
      required: ["id", "quantity"],
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        quantity: { type: "integer", minimum: 1, maximum: 99 },
      },
    },
  },
}

const PREFLIGHT_WORKER_SOURCE = String.raw`
return {
  workerExecuted: true,
  workerOrigin: String(globalThis.location.origin),
  indexedDB: typeof globalThis.indexedDB,
  caches: typeof globalThis.caches,
  workerConstructor: typeof globalThis.Worker,
  sharedWorkerConstructor: typeof globalThis.SharedWorker,
  navigatorStorage: typeof globalThis.navigator.storage,
  navigatorServiceWorker: typeof globalThis.navigator.serviceWorker
}
`

function preflightFailure(diagnostics: unknown): FrontendActionRuntimeError {
  return new FrontendActionRuntimeError("FRONTEND_ACTION_EXECUTION_FAILED", {
    diagnostics: {
      phase: "runtime-preflight",
      detail: diagnostics,
    },
  })
}

function requireIsolationProbe(value: unknown): WorkerIsolationProbe {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw preflightFailure("Frontend Action Worker preflight returned an invalid result.")
  }
  return value as WorkerIsolationProbe
}

async function runPreflight(): Promise<FrontendActionRuntimePreflightResult> {
  const compiled = compileFrontendActionSchema(PREFLIGHT_SCHEMA)
  if (!compiled.ok) throw preflightFailure(compiled.issue)

  const validData = validateFrontendActionData(compiled.validator, {
    items: [{ id: "probe", quantity: 1 }],
    mode: "apply",
  })
  if (!validData.ok) throw preflightFailure("Representative Draft 2020-12 data was rejected.")

  const invalidData = validateFrontendActionData(compiled.validator, {
    items: [{ id: "probe", quantity: 0 }],
    mode: "apply",
  })
  if (invalidData.ok) throw preflightFailure("Invalid representative Draft 2020-12 data was accepted.")

  const output = await runFrontendActionWorker({
    invocationId: "frontend-action-runtime-preflight",
    source: PREFLIGHT_WORKER_SOURCE,
    input: null,
    timeoutMs: 5_000,
    handleSdkRequest: async () => {
      throw preflightFailure("The runtime preflight Worker made an unexpected SDK request.")
    },
  })
  const probe = requireIsolationProbe(output)
  const expected = {
    workerExecuted: true,
    workerOrigin: "null",
    indexedDB: "undefined",
    caches: "undefined",
    workerConstructor: "undefined",
    sharedWorkerConstructor: "undefined",
    navigatorStorage: "undefined",
    navigatorServiceWorker: "undefined",
  } as const
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (probe[key as keyof WorkerIsolationProbe] !== expectedValue) {
      throw preflightFailure(`Frontend Action Worker isolation check failed: ${key}.`)
    }
  }

  return {
    schemaCompiled: true,
    validDataAccepted: true,
    invalidDataRejected: true,
    ...expected,
  }
}

let runtimePreflight: Promise<FrontendActionRuntimePreflightResult> | undefined

/**
 * Compiles the production Ajv schema and executes the production Worker once.
 * The singleton retains rejection so Action execution remains fail-closed.
 */
export function ensureFrontendActionRuntimeReady(): Promise<FrontendActionRuntimePreflightResult> {
  runtimePreflight ??= runPreflight()
  return runtimePreflight
}
