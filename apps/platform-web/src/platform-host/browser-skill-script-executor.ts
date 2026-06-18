import type {
  JsonValue,
  PlatformActionError,
  PlatformActionResult,
  WorkspaceOperationRequest,
  WorkspaceFile,
} from "@tsian/contracts"
import type {
  RuntimeBrowserScriptExecutorRequest,
  RuntimeControlledExecutorContext,
} from "../agent-runtime/workspace-tools"
import type { RuntimeTraceEmitter } from "../agent-runtime/trace"
import { summarizeTraceValue } from "../agent-runtime/trace"
import { executeWorkspaceOperation } from "../agent-runtime/workspace-operations"
import {
  readWorkspaceFileFromFiles,
  type RuntimeWorkspaceTransaction,
  WorkspaceStorageError,
} from "../storage"

interface BrowserSkillScriptRunnerOptions {
  workspaceTransaction: Pick<RuntimeWorkspaceTransaction, "workspaceFiles" | "write" | "delete">
  signal?: AbortSignal
  emitTrace?: RuntimeTraceEmitter
}

interface BrowserScriptWorkerMessage {
  type?: unknown
  id?: unknown
  op?: unknown
  args?: unknown
  ok?: unknown
  output?: unknown
  error?: unknown
  level?: unknown
  message?: unknown
  data?: unknown
}

const BROWSER_SCRIPT_WORKER_SOURCE = String.raw`
const pending = new Map();
let nextRpcId = 1;
let aborted = false;
const globalFetch = typeof fetch === "function" ? fetch.bind(globalThis) : null;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value, seen) {
  const activeSeen = seen || new WeakSet();
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    return null;
  }
  if (Array.isArray(value)) {
    if (activeSeen.has(value)) return "[Circular]";
    activeSeen.add(value);
    return value.map((item) => toJsonValue(item, activeSeen));
  }
  if (typeof value === "object") {
    if (activeSeen.has(value)) return "[Circular]";
    activeSeen.add(value);
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = toJsonValue(entry, activeSeen);
    }
    return output;
  }
  return String(value);
}

function errorPayload(error) {
  if (isRecord(error)) {
    return {
      code: typeof error.code === "string" ? error.code : "BROWSER_SCRIPT_ERROR",
      name: typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : "Browser script failed.",
      details: error.details === undefined ? null : toJsonValue(error.details)
    };
  }
  return {
    code: "BROWSER_SCRIPT_ERROR",
    name: "Error",
    message: String(error)
  };
}

function rpc(op, args) {
  if (aborted) {
    return Promise.reject(Object.assign(new Error("Browser script was aborted."), {
      code: "BROWSER_SCRIPT_ABORTED"
    }));
  }
  const id = nextRpcId++;
  self.postMessage({
    type: "sdk-request",
    id,
    op,
    args: toJsonValue(args)
  });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function settleRpc(message) {
  const id = Number(message.id);
  const callbacks = pending.get(id);
  if (!callbacks) {
    return;
  }
  pending.delete(id);
  if (message.ok) {
    callbacks.resolve(message.result);
    return;
  }
  const payload = message.error || {};
  const error = Object.assign(new Error(
    typeof payload.message === "string" ? payload.message : "SDK request failed."
  ), {
    code: typeof payload.code === "string" ? payload.code : "BROWSER_SCRIPT_SDK_FAILED",
    details: payload.details
  });
  callbacks.reject(error);
}

function postLog(level, message, data) {
  self.postMessage({
    type: "script-log",
    level,
    message: String(message),
    data: toJsonValue(data)
  });
}

async function sdkFetch(resource, init) {
  if (!globalFetch) {
    throw Object.assign(new Error("fetch is not available in this browser worker."), {
      code: "BROWSER_SCRIPT_FETCH_UNAVAILABLE"
    });
  }
  const response = await globalFetch(resource, init);
  const body = await response.text();
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  postLog("trace", "fetch", {
    url: typeof resource === "string" ? resource : String(resource),
    ok: response.ok,
    status: response.status,
    bodyLength: body.length
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    body
  };
}

const tsian = Object.freeze({
  workspace: Object.freeze({
    read(input) {
      return rpc("workspace.read", typeof input === "string" ? { scope: "effective", path: input } : input);
    },
    list(input) {
      return rpc("workspace.list", typeof input === "string" || input === undefined ? { scope: "effective", path: input } : input);
    },
    search(query, limit) {
      return rpc("workspace.search", isRecord(query) ? query : { scope: "effective", query, limit });
    },
    diff(input) {
      return rpc("workspace.diff", input);
    },
    patch(input) {
      return rpc("workspace.patch", input);
    },
    write(input) {
      return rpc("workspace.write", input).then((result) => isRecord(result) && isRecord(result.file) ? result.file : result);
    },
    move(input) {
      return rpc("workspace.move", input);
    },
    delete(input) {
      return rpc("workspace.delete", typeof input === "string" ? { scope: "save-runtime", path: input } : input);
    },
    validate(input) {
      return rpc("workspace.validate", input);
    }
  }),
  fetch: sdkFetch,
  log(message, data) {
    postLog("info", message, data);
  },
  trace(label, data) {
    postLog("trace", label, data);
  }
});

const signal = Object.freeze({
  get aborted() {
    return aborted;
  },
  throwIfAborted() {
    if (aborted) {
      throw Object.assign(new Error("Browser script was aborted."), {
        code: "BROWSER_SCRIPT_ABORTED"
      });
    }
  }
});

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "sdk-response") {
    settleRpc(message);
    return;
  }
  if (message.type === "abort") {
    aborted = true;
    for (const callbacks of pending.values()) {
      callbacks.reject(Object.assign(new Error("Browser script was aborted."), {
        code: "BROWSER_SCRIPT_ABORTED"
      }));
    }
    pending.clear();
    return;
  }
  if (message.type !== "execute") {
    return;
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runner = new AsyncFunction(
      "input",
      "tsian",
      "signal",
      "fetch",
      "importScripts",
      "indexedDB",
      "caches",
      "globalThis",
      "self",
      "window",
      "document",
      "localStorage",
      "sessionStorage",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "Worker",
      "SharedWorker",
      "navigator",
      "location",
      "\"use strict\";\n" + String(message.source || "")
    );
    const output = await runner(
      toJsonValue(message.input),
      tsian,
      signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
    self.postMessage({
      type: "script-result",
      ok: true,
      output: toJsonValue(output)
    });
  } catch (error) {
    self.postMessage({
      type: "script-result",
      ok: false,
      error: errorPayload(error)
    });
  }
};
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (
    value === undefined
    || typeof value === "function"
    || typeof value === "symbol"
    || typeof value === "bigint"
  ) {
    return null
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return value.map((item) => toJsonValue(item, seen))
  }

  if (isRecord(value)) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry, seen)]),
    )
  }

  return String(value)
}

function actionError(
  code: string,
  message: string,
  details?: Record<string, JsonValue>,
): PlatformActionResult {
  const error: PlatformActionError = { code, message }
  if (details && Object.keys(details).length > 0) {
    error.details = details
  }
  return { ok: false, error }
}

function errorResult(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): PlatformActionResult {
  if (error instanceof WorkspaceStorageError) {
    return actionError(error.code, error.message)
  }

  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return actionError(error.code, error.message, {
      ...(error.details === undefined ? {} : { details: toJsonValue(error.details) }),
    })
  }

  return actionError(
    fallbackCode,
    error instanceof Error ? error.message : fallbackMessage,
  )
}

function emitWorkspaceWriteTrace(
  emitTrace: RuntimeTraceEmitter | undefined,
  file: WorkspaceFile,
): void {
  emitTrace?.({
    type: "workspace_mutation",
    ok: true,
    data: {
      platformAction: "browser-script-sdk",
      mutation: "write",
      path: file.path,
      mediaType: file.mediaType,
      size: file.content.length,
      updatedAt: file.updatedAt,
    },
  })
}

function emitWorkspaceDeleteTrace(
  emitTrace: RuntimeTraceEmitter | undefined,
  deletedPaths: string[],
): void {
  emitTrace?.({
    type: "workspace_mutation",
    ok: true,
    data: {
      platformAction: "browser-script-sdk",
      mutation: "delete",
      deletedPaths,
      deletedCount: deletedPaths.length,
    },
  })
}

function emitScriptLogTrace(
  emitTrace: RuntimeTraceEmitter | undefined,
  request: RuntimeBrowserScriptExecutorRequest,
  message: BrowserScriptWorkerMessage,
): void {
  const level = typeof message.level === "string" ? message.level : "info"
  const text = typeof message.message === "string" ? message.message : ""
  emitTrace?.({
    type: "script_log",
    ok: true,
    data: {
      skill: request.skillName,
      action: request.actionName,
      scriptPath: request.scriptPath,
      level,
      messageLength: text.length,
      messagePreview: text.slice(0, 160),
      dataSummary: summarizeTraceValue(message.data),
    },
  })
}

function skillDirectoryPath(skillPath: string): string {
  const slashIndex = skillPath.lastIndexOf("/")
  return slashIndex >= 0 ? skillPath.slice(0, slashIndex) : ""
}

function isScriptUnderSkillDirectory(request: RuntimeBrowserScriptExecutorRequest): boolean {
  const skillDirectory = skillDirectoryPath(request.skillPath)
  return Boolean(skillDirectory) && request.scriptPath.startsWith(`${skillDirectory}/`)
}

async function handleSdkRequest(
  options: BrowserSkillScriptRunnerOptions,
  message: BrowserScriptWorkerMessage,
  executorContext: RuntimeControlledExecutorContext | undefined,
): Promise<unknown> {
  const op = typeof message.op === "string" ? message.op : ""
  const args = isRecord(message.args) ? message.args : {}

  if (op.startsWith("workspace.")) {
    const operation = op.slice("workspace.".length)
    const request = {
      ...args,
      operation,
      scope: args.scope ?? (
        operation === "read" || operation === "list" || operation === "search"
          ? "effective"
          : "save-runtime"
      ),
    } as WorkspaceOperationRequest
    const result = await executeWorkspaceOperation(request, {
      workspaceFiles: options.workspaceTransaction.workspaceFiles,
      agentContext: executorContext?.agentContext,
      exposedOperations: executorContext?.exposedWorkspaceOperations
        ?? [],
      mutations: {
        write: (input) => {
          const file = options.workspaceTransaction.write({
            path: input.path,
            content: input.content,
            mediaType: input.mediaType,
          })
          emitWorkspaceWriteTrace(options.emitTrace, file)
          return file
        },
        delete: (input) => {
          const result = options.workspaceTransaction.delete(input.path)
          emitWorkspaceDeleteTrace(options.emitTrace, result.deletedPaths)
          return {
            scope: input.scope,
            deletedPaths: result.deletedPaths,
          }
        },
      },
    })
    return result
  }

  throw {
    code: "BROWSER_SCRIPT_SDK_OPERATION_UNSUPPORTED",
    message: `Unsupported browser script SDK operation: ${op}`,
    details: { op },
  }
}

function createWorker(): { worker: Worker; url: string } {
  const blob = new Blob([BROWSER_SCRIPT_WORKER_SOURCE], {
    type: "text/javascript",
  })
  const url = URL.createObjectURL(blob)
  return {
    worker: new Worker(url, { name: "tsian-browser-skill-script" }),
    url,
  }
}

function postSdkResponse(
  worker: Worker,
  message: BrowserScriptWorkerMessage,
  result: PlatformActionResult,
): void {
  worker.postMessage({
    type: "sdk-response",
    id: message.id,
    ok: result.ok,
    ...(result.ok
      ? { result: toJsonValue(result.item ?? null) }
      : { error: result.error ?? null }),
  })
}

async function runWorkerScript(
  options: BrowserSkillScriptRunnerOptions,
  request: RuntimeBrowserScriptExecutorRequest,
  source: string,
  executorContext: RuntimeControlledExecutorContext | undefined,
): Promise<PlatformActionResult> {
  if (typeof Worker === "undefined" || typeof Blob === "undefined") {
    return actionError(
      "BROWSER_SCRIPT_UNAVAILABLE",
      "Browser script execution requires Web Worker support.",
    )
  }

  const { worker, url } = createWorker()
  return new Promise<PlatformActionResult>((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      options.signal?.removeEventListener("abort", onAbort)
      worker.terminate()
      URL.revokeObjectURL(url)
    }

    const settle = (result: PlatformActionResult) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }

    const onAbort = () => {
      try {
        worker.postMessage({ type: "abort" })
      } catch {
        // The worker may already be unavailable; terminate below.
      }
      settle(actionError(
        "BROWSER_SCRIPT_ABORTED",
        "Browser script execution was aborted.",
        { scriptPath: request.scriptPath },
      ))
    }

    timeoutId = setTimeout(() => {
      settle(actionError(
        "BROWSER_SCRIPT_TIMEOUT",
        `Browser script timed out after ${request.timeoutMs}ms.`,
        {
          scriptPath: request.scriptPath,
          timeoutMs: request.timeoutMs,
        },
      ))
    }, request.timeoutMs)

    options.signal?.addEventListener("abort", onAbort, { once: true })

    worker.onerror = (event) => {
      settle(actionError(
        "BROWSER_SCRIPT_WORKER_ERROR",
        event.message || "Browser script worker failed.",
        {
          scriptPath: request.scriptPath,
          line: event.lineno,
          column: event.colno,
        },
      ))
    }

    worker.onmessageerror = () => {
      settle(actionError(
        "BROWSER_SCRIPT_MESSAGE_ERROR",
        "Browser script worker sent an unserializable message.",
        { scriptPath: request.scriptPath },
      ))
    }

    worker.onmessage = (event: MessageEvent<BrowserScriptWorkerMessage>) => {
      const message = event.data ?? {}
      if (message.type === "script-log") {
        emitScriptLogTrace(options.emitTrace, request, message)
        return
      }

      if (message.type === "sdk-request") {
        void handleSdkRequest(options, message, executorContext)
          .then((item) => {
            if (!settled) {
              postSdkResponse(worker, message, { ok: true, item })
            }
          })
          .catch((error) => {
            if (!settled) {
              postSdkResponse(worker, message, errorResult(
                error,
                "BROWSER_SCRIPT_SDK_FAILED",
                "Browser script SDK request failed.",
              ))
            }
          })
        return
      }

      if (message.type === "script-result") {
        if (message.ok) {
          settle({ ok: true, item: toJsonValue(message.output) })
          return
        }

        const error = isRecord(message.error) ? message.error : {}
        settle(actionError(
          typeof error.code === "string" ? error.code : "BROWSER_SCRIPT_FAILED",
          typeof error.message === "string" ? error.message : "Browser script failed.",
          {
            scriptPath: request.scriptPath,
            ...(error.name === undefined ? {} : { name: toJsonValue(error.name) }),
            ...(error.details === undefined ? {} : { details: toJsonValue(error.details) }),
          },
        ))
      }
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }

    worker.postMessage({
      type: "execute",
      source,
      input: toJsonValue(request.input),
    })
  })
}

export function createBrowserSkillScriptRunner(
  options: BrowserSkillScriptRunnerOptions,
) {
  return async (
    request: RuntimeBrowserScriptExecutorRequest,
    executorContext?: RuntimeControlledExecutorContext,
  ): Promise<PlatformActionResult> => {
    if (!isScriptUnderSkillDirectory(request)) {
      return actionError(
        "BROWSER_SCRIPT_PATH_INVALID",
        "Browser script path must stay under the declaring Skill directory.",
        {
          skillPath: request.skillPath,
          scriptPath: request.scriptPath,
        },
      )
    }

    const scriptFile = readWorkspaceFileFromFiles(
      options.workspaceTransaction.workspaceFiles,
      request.scriptPath,
    )
    if (!scriptFile) {
      return actionError(
        "BROWSER_SCRIPT_NOT_FOUND",
        `Browser script file was not found: ${request.scriptPath}`,
        { scriptPath: request.scriptPath },
      )
    }

    options.emitTrace?.({
      type: "script_log",
      ok: true,
      data: {
        skill: request.skillName,
        action: request.actionName,
        scriptPath: request.scriptPath,
        level: "trace",
        messagePreview: "browser_script_started",
        sourceLength: scriptFile.content.length,
        timeoutMs: request.timeoutMs,
      },
    })

    return runWorkerScript(options, request, scriptFile.content, executorContext)
  }
}
