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
import { inferMediaTypeFromPath } from "../lib/media-type"
import { normalizeWorkspacePath } from "../lib/workspace-path"

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

// tsian SDK：精简为 workspace.* + log + trace。
// fetch 已放开为 Worker 原生裸 fetch（标准 Response），不再包装。
const tsian = Object.freeze({
  workspace: Object.freeze({
    read(input) {
      return rpc("workspace.read", typeof input === "string" ? { scope: "effective", path: input } : input);
    },
    list(input) {
      return rpc("workspace.list", typeof input === "string" || input === undefined ? { scope: "effective", path: input } : input);
    },
    search(queryOrInput, limit) {
      const input = isRecord(queryOrInput)
        ? queryOrInput
        : { scope: "effective", query: queryOrInput, limit };
      return rpc("workspace.search", input);
    },
    glob(input) {
      return rpc("workspace.glob", typeof input === "string" ? { scope: "effective", pattern: input } : input);
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

// importScripts stub：vendor 库已由主线程预拼接进脚本源码（见 resolveAndInlineImportScripts），
// 运行时不需要真正加载。脚本如果动态调用 importScripts 会得到清晰提示而非 ReferenceError。
const importScriptsStub = function importScripts() {
  throw Object.assign(new Error("importScripts is not available at runtime. Vendor libraries are pre-inlined by the host before script execution; declare them with importScripts('lib/foo.min.js') at the top of your script."), {
    code: "BROWSER_SCRIPT_IMPORTSCRIPTS_UNAVAILABLE"
  });
};

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
    // 形参放开策略：
    //   - 删除 fetch / globalThis / self → 脚本直接拿 Worker 原生（裸 fetch + UMD 库挂载依赖 globalThis）
    //   - console / setTimeout / setInterval / clearTimeout / clearInterval 本就不在形参里（自由变量），已可用
    //   - importScripts 传 stub（vendor 已由主线程预拼接，运行时调用给清晰提示）
    //   - window / document / navigator / location / 存储 / 网络 API 维持 undefined 屏蔽（Worker 本就无 DOM）
    const runner = new AsyncFunction(
      "input",
      "tsian",
      "signal",
      "importScripts",
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
      "indexedDB",
      "caches",
      "\"use strict\";\n" + String(message.source || "")
    );
    const output = await runner(
      toJsonValue(message.input),
      tsian,
      signal,
      importScriptsStub,
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
      size: file.binary?.size ?? file.content.length,
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

/**
 * importScripts 调用匹配：支持单/多参数、单/双引号、跨行。
 * 路径必须是字符串字面量（不支持动态拼接）。
 */
const IMPORT_SCRIPTS_RE = /importScripts\s*\(\s*([\s\S]*?)\s*\)/g

/**
 * 从 importScripts 参数字符串里提取字符串字面量路径。
 * 只认 '...' / "..." 形式，非字符串参数跳过。
 */
function extractStringLiterals(argsText: string): string[] {
  const paths: string[] = []
  // 按逗号分割后逐个 trim + 去引号；不处理嵌套表达式（动态拼接不支持）
  const literalRe = /(['"])(.*?)\1/g
  let match: RegExpExecArray | null
  while ((match = literalRe.exec(argsText)) !== null) {
    paths.push(match[2])
  }
  return paths
}

/**
 * 解析脚本源码里的 importScripts(...) 调用，把 vendor 库源码预拼接到脚本前。
 * 路径相对 skill 目录解析，逃逸即报错。vendor 文件从 workspaceFiles 读取。
 *
 * 设计见 design.md §2。源码预拼接方案：主线程读 vendor 文件 → 拼到 source 前 →
 * 移除 importScripts 调用。Worker 内 importScripts 形参传 stub（运行时调用给提示）。
 */
function resolveAndInlineImportScripts(
  source: string,
  request: RuntimeBrowserScriptExecutorRequest,
  workspaceFiles: WorkspaceFile[],
): PlatformActionResult {
  const skillDirectory = skillDirectoryPath(request.skillPath)
  if (!skillDirectory) {
    return actionError(
      "BROWSER_SCRIPT_PATH_INVALID",
      "Browser script requires a skill directory to resolve vendor imports.",
      { skillPath: request.skillPath },
    )
  }

  const vendorSources: string[] = []
  let match: RegExpExecArray | null
  // 重置 lastIndex（全局正则复用安全）
  IMPORT_SCRIPTS_RE.lastIndex = 0
  const seenPaths = new Set<string>()

  while ((match = IMPORT_SCRIPTS_RE.exec(source)) !== null) {
    const argsText = match[1]
    const paths = extractStringLiterals(argsText)
    if (paths.length === 0) {
      // 没有字符串字面量参数（可能是动态拼接或注释里的误匹配）→ 跳过
      continue
    }
    for (const rawPath of paths) {
      const trimmed = rawPath.trim()
      if (!trimmed) continue

      // 拒绝绝对 URL / 绝对路径（协议前缀或 / 开头）——vendor 必须是 skill 目录内相对路径
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) || trimmed.startsWith("/")) {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_PATH_INVALID",
          `importScripts path must be a relative path under the skill directory (no absolute URLs): ${trimmed}`,
          { skillPath: request.skillPath, vendorPath: trimmed },
        )
      }

      // 路径相对 skill 目录拼接，再规范化（解析 .. 和 . 段）
      // 规范化后校验逃逸：skills/my-skill/../escape.js → skills/escape.js → 不以 skillDir/ 开头 → 拦截
      const combined = trimmed.startsWith(`${skillDirectory}/`)
        ? trimmed
        : `${skillDirectory}/${trimmed}`
      const normalized = normalizeWorkspacePath(combined, {
        allowEmpty: false,
        rejectTrailingSlash: true,
      })
      if (!normalized.ok) {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_PATH_INVALID",
          `importScripts path is invalid: ${trimmed}`,
          { skillPath: request.skillPath, vendorPath: trimmed, error: normalized.message },
        )
      }
      const resolvedPath = normalized.path

      // 逃逸校验：规范化后必须以 skillDirectory/ 开头（防 ../ 逃逸）
      if (!resolvedPath.startsWith(`${skillDirectory}/`)) {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_PATH_INVALID",
          `importScripts path must stay under the skill directory: ${trimmed}`,
          { skillPath: request.skillPath, vendorPath: trimmed, resolvedPath },
        )
      }

      // 去重（同一库多次 importScripts 只拼接一次）
      if (seenPaths.has(resolvedPath)) continue
      seenPaths.add(resolvedPath)

      // 读 vendor 文件
      const vendorFile = readWorkspaceFileFromFiles(workspaceFiles, resolvedPath)
      if (!vendorFile) {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_NOT_FOUND",
          `importScripts vendor file was not found: ${trimmed}`,
          { skillPath: request.skillPath, vendorPath: trimmed, resolvedPath },
        )
      }

      // MIME 校验：必须是 JavaScript
      const mediaType = inferMediaTypeFromPath(resolvedPath)
      if (mediaType !== "text/javascript") {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_NOT_JS",
          `importScripts vendor file must be JavaScript (.js/.mjs): ${trimmed}`,
          { skillPath: request.skillPath, vendorPath: trimmed, mediaType },
        )
      }

      vendorSources.push(vendorFile.content)
    }
  }

  // 无 importScripts 调用 → 原样返回（ok=true，item 是 source 本身）
  if (vendorSources.length === 0) {
    return { ok: true, item: source }
  }

  // vendor 源码拼到 source 前，移除 importScripts 调用
  // 每个 vendor 后加 \n;\n 分隔（防末尾注释吞噬后续代码）
  const inlinedHeader = vendorSources.join("\n;\n") + "\n;\n"
  const strippedSource = source.replace(IMPORT_SCRIPTS_RE, "")
  return { ok: true, item: inlinedHeader + strippedSource }
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
            ...(input.data ? { data: input.data } : {}),
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

    // vendor 预拼接：解析脚本里的 importScripts(...) 调用，把 skill 目录内的
    // UMD 库源码拼到脚本前。路径逃逸/文件缺失/非 JS 都在此校验。
    const inlined = resolveAndInlineImportScripts(
      scriptFile.content,
      request,
      options.workspaceTransaction.workspaceFiles,
    )
    if (!inlined.ok) {
      return inlined
    }
    const finalSource = inlined.item as string

    return runWorkerScript(options, request, finalSource, executorContext)
  }
}
