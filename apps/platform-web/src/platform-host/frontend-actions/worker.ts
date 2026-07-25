import type { JsonValue } from "@tsian/contracts"
import {
  FrontendActionDomainError,
  FrontendActionRuntimeError,
  parseFrontendActionDomainError,
} from "./errors"

export interface FrontendActionWorkerMessageEvent<T = unknown> {
  data: T
}

export interface FrontendActionWorkerErrorEvent {
  error?: unknown
  message?: string
}

export interface FrontendActionWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}

export interface FrontendActionWorkerHandle {
  worker: FrontendActionWorkerLike
  dispose?(): void
}

export type FrontendActionWorkerFactory = () => FrontendActionWorkerHandle

export interface FrontendActionWorkerSdkRequest {
  op: string
  args: unknown
}

interface FrontendActionWorkerMessage {
  type?: unknown
  id?: unknown
  op?: unknown
  args?: unknown
  ok?: unknown
  result?: unknown
  output?: unknown
  error?: unknown
}

interface RunFrontendActionWorkerInput {
  invocationId: string
  source: string
  input: JsonValue
  timeoutMs: number
  signal?: AbortSignal
  workerFactory?: FrontendActionWorkerFactory
  handleSdkRequest(request: FrontendActionWorkerSdkRequest): Promise<JsonValue>
}

export const FRONTEND_ACTION_WORKER_SOURCE = String.raw`
const pending = new Map();
let nextRpcId = 1;
let aborted = false;
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validateStrictJson(value, limits) {
  const maxBytes = limits.maxBytes;
  const maxDepth = limits.maxDepth;
  const maxNodes = limits.maxNodes;
  const active = new WeakSet();
  let nodes = 0;
  let bytes = 0;
  function addBytes(amount) { bytes += amount; return bytes <= maxBytes; }
  function visit(current, depth) {
    if (depth > maxDepth || ++nodes > maxNodes) return false;
    if (current === null) return addBytes(4);
    if (typeof current === "string") return addBytes(new TextEncoder().encode(JSON.stringify(current)).byteLength);
    if (typeof current === "boolean") return addBytes(current ? 4 : 5);
    if (typeof current === "number") return Number.isFinite(current) && addBytes(String(current).length);
    if (typeof current !== "object") return false;
    if (active.has(current)) return false;
    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(current);
      keys = Reflect.ownKeys(current);
    } catch (_) { return false; }
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype || !addBytes(2 + Math.max(0, current.length - 1))) return false;
      const descriptors = new Map();
      for (const key of keys) {
        if (typeof key !== "string") return false;
        if (key === "length") continue;
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= current.length || String(index) !== key) return false;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
        descriptors.set(key, descriptor);
      }
      if (descriptors.size !== current.length) return false;
      active.add(current);
      try {
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors.get(String(index));
          if (!descriptor || !visit(descriptor.value, depth + 1)) return false;
        }
      } finally { active.delete(current); }
      return true;
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (!addBytes(2 + Math.max(0, keys.length - 1))) return false;
    const descriptors = [];
    for (const key of keys) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
      if (!addBytes(new TextEncoder().encode(JSON.stringify(key)).byteLength + 1)) return false;
      descriptors.push(descriptor);
    }
    active.add(current);
    try {
      for (const descriptor of descriptors) if (!visit(descriptor.value, depth + 1)) return false;
    } finally { active.delete(current); }
    return true;
  }
  let valid;
  try { valid = visit(value, 0); } catch (_) { return false; }
  return valid;
}
const OUTPUT_LIMITS = Object.freeze({ maxBytes: 1024 * 1024, maxDepth: 64, maxNodes: 100000 });
const DOMAIN_LIMITS = Object.freeze({ maxBytes: 64 * 1024 + 756, maxDepth: 17, maxNodes: 100000 });
function validDomainEnvelope(value) {
  if (!validateStrictJson(value, DOMAIN_LIMITS) || !isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "code" && key !== "message" && key !== "details"))) return false;
  if (typeof value.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)) return false;
  if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 500) return false;
  return value.details === undefined || validateStrictJson(value.details, { maxBytes: 64 * 1024, maxDepth: 16, maxNodes: 100000 });
}
function rpc(op, args) {
  if (aborted) return Promise.reject(new Error("aborted"));
  if (!validateStrictJson(args, OUTPUT_LIMITS)) return Promise.reject(new Error("invalid sdk arguments"));
  const id = nextRpcId++;
  self.postMessage({ type: "sdk-request", id, op, args });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function settleRpc(message) {
  const callbacks = pending.get(Number(message.id));
  if (!callbacks) return;
  pending.delete(Number(message.id));
  if (message.ok) {
    if (!validateStrictJson(message.result, OUTPUT_LIMITS)) {
      callbacks.reject(new Error("Frontend Action SDK result is invalid."));
      return;
    }
    callbacks.resolve(message.result);
  }
  else callbacks.reject(new Error("Frontend Action SDK request failed."));
}
const domainFailures = new WeakSet();
const tsian = Object.freeze({
  workspace: Object.freeze({
    read(input) { return rpc("workspace.read", typeof input === "string" ? { scope: "effective", path: input } : input); },
    list(input) { return rpc("workspace.list", typeof input === "string" || input === undefined ? { scope: "effective", path: input } : input); },
    glob(input) { return rpc("workspace.glob", typeof input === "string" ? { scope: "effective", pattern: input } : input); },
    write(input) { return rpc("workspace.write", input); },
    delete(input) { return rpc("workspace.delete", typeof input === "string" ? { scope: "save-runtime", path: input } : input); }
  }),
  action: Object.freeze({
    fail(envelope) {
      const failure = {};
      domainFailures.add(failure);
      throw { failure, envelope };
    }
  })
});
const signal = Object.freeze({
  get aborted() { return aborted; },
  throwIfAborted() { if (aborted) throw new Error("aborted"); }
});
function tameAmbientProperty(target, name, replacement) {
  let current = target;
  while (current) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor && descriptor.configurable) {
        Object.defineProperty(current, name, {
          value: replacement,
          writable: false,
          configurable: false,
          enumerable: descriptor.enumerable
        });
      } else if (descriptor && current === target && "value" in descriptor && descriptor.writable) {
        current[name] = replacement;
      }
    } catch (_) {}
    try { current = Object.getPrototypeOf(current); } catch (_) { current = null; }
  }
  try {
    Object.defineProperty(target, name, {
      value: replacement,
      writable: false,
      configurable: false,
      enumerable: false
    });
  } catch (_) {
    try { target[name] = replacement; } catch (_) {}
  }
  return replacement;
}
function blockGlobalImportScripts() {
  const blocked = function importScripts() { throw new Error("importScripts is unavailable at runtime."); };
  tameAmbientProperty(self, "importScripts", blocked);
  return blocked;
}
function tameAmbientCapabilities() {
  tameAmbientProperty(self, "indexedDB", undefined);
  tameAmbientProperty(self, "caches", undefined);
  tameAmbientProperty(self, "Worker", undefined);
  tameAmbientProperty(self, "SharedWorker", undefined);
  try {
    tameAmbientProperty(self.navigator, "storage", undefined);
    tameAmbientProperty(self.navigator, "serviceWorker", undefined);
  } catch (_) {}
}
const importScriptsStub = blockGlobalImportScripts();
tameAmbientCapabilities();
function ambientPropertyUnavailable(target, name) {
  try {
    if (typeof target[name] !== "undefined") return false;
    let current = target;
    while (current) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor) {
        if ("value" in descriptor && typeof descriptor.value !== "undefined") return false;
        if (descriptor.get && typeof descriptor.get.call(target) !== "undefined") return false;
      }
      current = Object.getPrototypeOf(current);
    }
    return true;
  } catch (_) { return false; }
}
function runtimeIsolationReady() {
  try {
    return self.location.origin === "null"
      && ambientPropertyUnavailable(self, "indexedDB")
      && ambientPropertyUnavailable(self, "caches")
      && ambientPropertyUnavailable(self, "Worker")
      && ambientPropertyUnavailable(self, "SharedWorker")
      && ambientPropertyUnavailable(self.navigator, "storage")
      && ambientPropertyUnavailable(self.navigator, "serviceWorker");
  } catch (_) { return false; }
}
const isolationReady = runtimeIsolationReady();
self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "sdk-response") { settleRpc(message); return; }
  if (message.type === "abort") {
    aborted = true;
    for (const callbacks of pending.values()) callbacks.reject(new Error("aborted"));
    pending.clear();
    return;
  }
  if (message.type !== "execute") return;
  if (!isolationReady) {
    self.postMessage({ type: "script-result", ok: false, error: { kind: "runtime-isolation" } });
    return;
  }
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runner = new AsyncFunction(
      "input", "tsian", "signal", "importScripts", "window", "document", "localStorage",
      "sessionStorage", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker",
      "navigator", "location", "indexedDB", "caches", "\"use strict\";\n" + String(message.source || "")
    );
    const output = await runner(
      message.input, tsian, signal, importScriptsStub, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined
    );
    if (!validateStrictJson(output, OUTPUT_LIMITS)) {
      self.postMessage({ type: "script-result", ok: false, error: { kind: "output-invalid" } });
      return;
    }
    self.postMessage({ type: "script-result", ok: true, output });
  } catch (error) {
    if (isRecord(error) && isRecord(error.failure) && domainFailures.has(error.failure)) {
      if (validDomainEnvelope(error.envelope)) {
        self.postMessage({ type: "script-result", ok: false, error: { kind: "domain", envelope: error.envelope } });
      } else {
        self.postMessage({ type: "script-result", ok: false, error: { kind: "runtime" } });
      }
    } else {
      self.postMessage({ type: "script-result", ok: false, error: { kind: "runtime" } });
    }
  }
};
`

function defaultWorkerFactory(): FrontendActionWorkerHandle {
  if (typeof Worker === "undefined") {
    throw new FrontendActionRuntimeError("FRONTEND_ACTION_EXECUTION_FAILED", {
      diagnostics: "Frontend Action Worker support is unavailable.",
    })
  }
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(FRONTEND_ACTION_WORKER_SOURCE)}`
  return {
    worker: new Worker(url, { name: "tsian-frontend-action" }),
  }
}

function executionFailed(invocationId: string, diagnostics?: unknown): FrontendActionRuntimeError {
  return new FrontendActionRuntimeError("FRONTEND_ACTION_EXECUTION_FAILED", {
    correlationId: invocationId,
    diagnostics,
  })
}

function workerError(message: FrontendActionWorkerMessage, invocationId: string): Error {
  const rawError = message.error
  if (
    rawError !== null
    && typeof rawError === "object"
    && !Array.isArray(rawError)
    && (rawError as Record<string, unknown>).kind === "output-invalid"
  ) {
    return new FrontendActionRuntimeError("FRONTEND_ACTION_OUTPUT_INVALID", {
      correlationId: invocationId,
    })
  }
  if (
    rawError !== null
    && typeof rawError === "object"
    && !Array.isArray(rawError)
    && (rawError as Record<string, unknown>).kind === "domain"
  ) {
    const parsed = parseFrontendActionDomainError(
      (rawError as Record<string, unknown>).envelope,
      invocationId,
    )
    if (parsed.ok) return new FrontendActionDomainError(parsed.error)
    return executionFailed(invocationId, parsed.issue)
  }
  return executionFailed(invocationId, rawError)
}

/** Runs the action-specific Worker protocol and owns all timeout/abort cleanup. */
export function runFrontendActionWorker(input: RunFrontendActionWorkerInput): Promise<unknown> {
  if (input.signal?.aborted) {
    return Promise.reject(new FrontendActionRuntimeError("FRONTEND_ACTION_ABORTED", {
      correlationId: input.invocationId,
    }))
  }

  let handle: FrontendActionWorkerHandle
  try {
    handle = (input.workerFactory ?? defaultWorkerFactory)()
  } catch (error) {
    return Promise.reject(error instanceof FrontendActionRuntimeError
      ? error
      : executionFailed(input.invocationId, error))
  }

  return new Promise((resolve, reject) => {
    const { worker } = handle
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      input.signal?.removeEventListener("abort", onAbort)
      worker.onmessage = null
      worker.onmessageerror = null
      worker.onerror = null
      worker.terminate()
      handle.dispose?.()
    }
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const fail = (error: unknown) => settle(() => reject(error))
    const onAbort = () => {
      try {
        worker.postMessage({ type: "abort" })
      } catch {
        // Termination below remains authoritative.
      }
      fail(new FrontendActionRuntimeError("FRONTEND_ACTION_ABORTED", {
        correlationId: input.invocationId,
      }))
    }

    timeoutId = setTimeout(() => {
      fail(new FrontendActionRuntimeError("FRONTEND_ACTION_TIMEOUT", {
        correlationId: input.invocationId,
      }))
    }, input.timeoutMs)
    input.signal?.addEventListener("abort", onAbort, { once: true })

    worker.onerror = (event) => fail(executionFailed(input.invocationId, event.error))
    worker.onmessageerror = () => fail(executionFailed(input.invocationId, "Worker message error."))
    worker.onmessage = (event) => {
      const message = event.data as FrontendActionWorkerMessage
      if (!message || typeof message !== "object") {
        fail(executionFailed(input.invocationId, "Invalid Worker message."))
        return
      }
      if (message.type === "sdk-request") {
        if (typeof message.id !== "number" || typeof message.op !== "string") {
          fail(executionFailed(input.invocationId, "Invalid SDK request."))
          return
        }
        void input.handleSdkRequest({ op: message.op, args: message.args })
          .then((result) => {
            if (settled) return
            worker.postMessage({ type: "sdk-response", id: message.id, ok: true, result })
          })
          .catch((error) => {
            fail(executionFailed(input.invocationId, error))
          })
        return
      }
      if (message.type !== "script-result") {
        fail(executionFailed(input.invocationId, "Unknown Worker message."))
        return
      }
      if (message.ok === true) {
        settle(() => resolve(message.output))
        return
      }
      fail(workerError(message, input.invocationId))
    }

    if (input.signal?.aborted) {
      onAbort()
      return
    }
    try {
      worker.postMessage({ type: "execute", source: input.source, input: input.input })
    } catch (error) {
      fail(executionFailed(input.invocationId, error))
    }
  })
}
