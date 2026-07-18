import type {
  JsonValue,
  PlatformActionError,
  PlatformActionResult,
  SkillConfigItem,
  WorkspaceOperationRequest,
  WorkspaceFile,
} from "@tsian/contracts"
import type {
  RuntimeBrowserScriptExecutorRequest,
  RuntimeControlledExecutorContext,
} from "../agent-runtime/workspace-tools"
import type {
  RuntimeBrowserScriptRunner,
  RuntimeTestSkillScriptInput,
  RuntimeTestSkillScriptRunner,
} from "../agent-runtime/workspace-tools-types"
import type { RuntimeTraceEmitter } from "../agent-runtime/trace"
import { summarizeTraceValue } from "../agent-runtime/trace"
import { executeWorkspaceOperation } from "../agent-runtime/workspace-operations"
import { buildSkillRegistry } from "../agent-runtime/registry"
import {
  parseActionDeclarations,
  resolveBrowserScriptPath,
  resolveHelperPath,
} from "../agent-runtime/workspace-tools"
import {
  readSkillConfig,
  readWorkspaceFileFromFiles,
  type RuntimeWorkspaceTransaction,
  WorkspaceStorageError,
} from "../storage"
import { inferMediaTypeFromPath } from "../lib/media-type"
import { normalizeWorkspacePath } from "../lib/workspace-path"
import { projectAssistantReply } from "./reply-projection"

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
    var name = typeof error.name === "string" ? error.name : "Error";
    var message = typeof error.message === "string" ? error.message : "Browser script failed.";
    var stack = typeof error.stack === "string" ? error.stack.slice(0, 1000) : null;
    var details = error.details === undefined ? null : toJsonValue(error.details);
    // 脚本自定义错误（fail() 带 .code）→ 原始 code 透传，不覆盖
    if (typeof error.code === "string" && error.code) {
      return { code: error.code, name: name, message: message, stack: stack, details: details };
    }
    // SyntaxError（new AsyncFunction parse 失败）→ 专属 code
    if (name === "SyntaxError") {
      return { code: "BROWSER_SCRIPT_SYNTAX_ERROR", name: name, message: message, stack: stack, details: details };
    }
    // 普通 Error → 运行时错误
    return { code: "BROWSER_SCRIPT_RUNTIME_ERROR", name: name, message: message, stack: stack, details: details };
  }
  return { code: "BROWSER_SCRIPT_RUNTIME_ERROR", name: "Error", message: String(error), stack: null, details: null };
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

// tsian SDK：精简为 workspace.* + log + trace + config。
// fetch 已放开为 Worker 原生裸 fetch（标准 Response），不再包装。
// config 是 skill 声明 + 玩家覆盖合并后的平铺对象（见主线程 mergeConfig），
// 无配置的 skill 拿到空对象 {}，脚本 config.API_KEY 返回 undefined 自行处理。
// config 通过 getter 从 execute 消息动态读取（message 只在 onmessage 里有定义，
// 顶层不能直接引用）。
let currentConfig = {};
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
    write(input) {
      return rpc("workspace.write", input).then((result) => isRecord(result) && isRecord(result.file) ? result.file : result);
    },
    edit(input) {
      return rpc("workspace.edit", input).then((result) => isRecord(result) && isRecord(result.file) ? result.file : result);
    },
    copy(input) {
      return rpc("workspace.copy", input);
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
  },
  reply: Object.freeze({
    project(text) {
      return rpc("reply.project", { text: String(text || "") });
    }
  }),
  // config 通过 Proxy 动态读取 currentConfig（execute 消息到达后赋值），
  // 避免顶层引用未定义的 message 变量。
  config: new Proxy({}, {
    get(_t, key) {
      return currentConfig[key];
    },
    ownKeys() {
      return Object.keys(currentConfig);
    },
    getOwnPropertyDescriptor(_t, key) {
      const v = currentConfig[key];
      return v !== undefined ? { enumerable: true, configurable: true, value: v, writable: false } : undefined;
    },
  }),
  // tsian.lib.*：脚本可复用的确定性小工具。收纳原则（见 design.md §6）：
  // 纯函数、平台不承担精确算术、无隐藏状态、无 IO、无网络。
  // v1 只有 random（uncertainty 建模）。刻意不加 math / 表达式求值器：AIRP 不是 TTRPG，
  // 衍生数值由前端在状态变更点算好写入 workspace，LLM 只读终值。
  lib: Object.freeze({
    // random：不做加密安全，只做故事骰。Math.random 的可预测性对叙事无害，
    // 不满足需求的场景应绕开 SDK 走宿主 crypto 通道（v1 未开放）。
    random: Object.freeze({
      // nextInt(minInclusive, maxInclusive)：闭区间整数。参数非有限数 / min > max 抛错。
      nextInt(minInclusive, maxInclusive) {
        var lo = Number(minInclusive);
        var hi = Number(maxInclusive);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          throw Object.assign(new Error("tsian.lib.random.nextInt requires finite numbers."), {
            code: "TSIAN_LIB_RANDOM_INVALID_ARGS",
            details: { minInclusive: minInclusive, maxInclusive: maxInclusive },
          });
        }
        lo = Math.floor(lo);
        hi = Math.floor(hi);
        if (lo > hi) {
          throw Object.assign(new Error("tsian.lib.random.nextInt: min must be <= max."), {
            code: "TSIAN_LIB_RANDOM_INVALID_ARGS",
            details: { minInclusive: lo, maxInclusive: hi },
          });
        }
        return lo + Math.floor(Math.random() * (hi - lo + 1));
      },
      // dice({ sides, count?, modifier?, advantage?, disadvantage? })
      // - sides ≥ 2, count ≥ 1（默认 1），modifier 数值（默认 0）
      // - advantage / disadvantage 只在 count === 1 时生效（otherwise silently ignored）
      // - 返回 { rolls, kept, modifier, total }（kept 是应用 adv/dis 之后被计数的骰值数组）
      dice(input) {
        var opts = isRecord(input) ? input : {};
        var sides = Math.floor(Number(opts.sides));
        var count = opts.count === undefined ? 1 : Math.floor(Number(opts.count));
        var modifier = opts.modifier === undefined ? 0 : Number(opts.modifier);
        var advantage = Boolean(opts.advantage);
        var disadvantage = Boolean(opts.disadvantage);
        if (!Number.isFinite(sides) || sides < 2) {
          throw Object.assign(new Error("tsian.lib.random.dice: sides must be >= 2."), {
            code: "TSIAN_LIB_RANDOM_INVALID_ARGS",
            details: { sides: opts.sides },
          });
        }
        if (!Number.isFinite(count) || count < 1) {
          throw Object.assign(new Error("tsian.lib.random.dice: count must be >= 1."), {
            code: "TSIAN_LIB_RANDOM_INVALID_ARGS",
            details: { count: opts.count },
          });
        }
        if (!Number.isFinite(modifier)) {
          throw Object.assign(new Error("tsian.lib.random.dice: modifier must be a finite number."), {
            code: "TSIAN_LIB_RANDOM_INVALID_ARGS",
            details: { modifier: opts.modifier },
          });
        }
        var rolls = [];
        // adv/dis 对 count === 1：滚两次取高/低；其他 count 忽略（design.md §6）
        var rollTimes = (count === 1 && (advantage || disadvantage)) ? 2 : count;
        for (var i = 0; i < rollTimes; i++) {
          rolls.push(1 + Math.floor(Math.random() * sides));
        }
        var kept;
        if (count === 1 && (advantage || disadvantage) && !(advantage && disadvantage)) {
          kept = [advantage ? Math.max(rolls[0], rolls[1]) : Math.min(rolls[0], rolls[1])];
        } else {
          kept = rolls.slice();
        }
        var sum = 0;
        for (var j = 0; j < kept.length; j++) sum += kept[j];
        return { rolls: rolls, kept: kept, modifier: modifier, total: sum + modifier };
      },
    }),
  })
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

  // 把 execute 消息里的 config 存到模块级变量，供 tsian.config Proxy 动态读取
  currentConfig = isRecord(message.config) ? message.config : {};

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

/**
 * Resolve the owning directory for a browser-script request.
 *
 * - Tool owner (`ownerType === "tool"`): use the explicit `rootDirectory`
 *   carried by the Tool dispatch branch. An empty/missing value returns "" —
 *   downstream code treats that as an invalid request.
 * - Skill owner (default): derive from `skillPath`. Callers that omit
 *   `ownerType` entirely still work — the pre-Tool code path is preserved.
 */
function resolveOwnerRoot(request: RuntimeBrowserScriptExecutorRequest): string {
  if (request.ownerType === "tool") {
    return request.rootDirectory ?? ""
  }
  return skillDirectoryPath(request.skillPath)
}

/**
 * Owner-agnostic label for diagnostics. `"skill"` (default) preserves the
 * existing wording so Skill-owned errors remain unchanged.
 */
function ownerLabel(request: RuntimeBrowserScriptExecutorRequest): "skill" | "tool" {
  return request.ownerType === "tool" ? "tool" : "skill"
}

function isScriptUnderOwnerDirectory(request: RuntimeBrowserScriptExecutorRequest): boolean {
  const root = resolveOwnerRoot(request)
  return Boolean(root) && request.scriptPath.startsWith(`${root}/`)
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
  const ownerRoot = resolveOwnerRoot(request)
  const label = ownerLabel(request)
  if (!ownerRoot) {
    return actionError(
      "BROWSER_SCRIPT_PATH_INVALID",
      `Browser script requires a ${label} directory to resolve vendor imports.`,
      { skillPath: request.skillPath, rootDirectory: request.rootDirectory ?? null },
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

      // 拒绝绝对 URL / 绝对路径（协议前缀或 / 开头）——vendor 必须是 owner 目录内相对路径
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) || trimmed.startsWith("/")) {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_PATH_INVALID",
          `importScripts path must be a relative path under the ${label} directory (no absolute URLs): ${trimmed}`,
          { skillPath: request.skillPath, rootDirectory: request.rootDirectory ?? null, vendorPath: trimmed },
        )
      }

      // 路径相对 owner 目录拼接，再规范化（解析 .. 和 . 段）
      const combined = trimmed.startsWith(`${ownerRoot}/`)
        ? trimmed
        : `${ownerRoot}/${trimmed}`
      const normalized = normalizeWorkspacePath(combined, {
        allowEmpty: false,
        rejectTrailingSlash: true,
      })
      if (!normalized.ok) {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_PATH_INVALID",
          `importScripts path is invalid: ${trimmed}`,
          { skillPath: request.skillPath, rootDirectory: request.rootDirectory ?? null, vendorPath: trimmed, error: normalized.message },
        )
      }
      const resolvedPath = normalized.path

      // 逃逸校验：规范化后必须以 ownerRoot/ 开头（防 ../ 逃逸）
      if (!resolvedPath.startsWith(`${ownerRoot}/`)) {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_PATH_INVALID",
          `importScripts path must stay under the ${label} directory: ${trimmed}`,
          { skillPath: request.skillPath, rootDirectory: request.rootDirectory ?? null, vendorPath: trimmed, resolvedPath },
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
          { skillPath: request.skillPath, rootDirectory: request.rootDirectory ?? null, vendorPath: trimmed, resolvedPath },
        )
      }

      // MIME 校验：必须是 JavaScript
      const mediaType = inferMediaTypeFromPath(resolvedPath)
      if (mediaType !== "text/javascript") {
        return actionError(
          "BROWSER_SCRIPT_VENDOR_NOT_JS",
          `importScripts vendor file must be JavaScript (.js/.mjs): ${trimmed}`,
          { skillPath: request.skillPath, rootDirectory: request.rootDirectory ?? null, vendorPath: trimmed, mediaType },
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

/**
 * Read each declared helper file and concatenate its source between the
 * (already importScripts-inlined) header and the script body. Helper paths
 * resolve relative to the Skill directory by default; absolute paths resolve
 * from workspace root (discouraged — breaks Skill self-containment).
 *
 * Returns `{ ok: true, item: header + helpers + scriptBody }` on success, or
 * `{ ok: false, error }` when a helper file is missing or its path escapes.
 */
async function resolveAndConcatHelpers(
  inlinedSource: string,
  request: RuntimeBrowserScriptExecutorRequest,
  workspaceFiles: WorkspaceFile[],
): Promise<PlatformActionResult> {
  const helpers = request.helpers
  if (!helpers || helpers.length === 0) {
    return { ok: true, item: inlinedSource }
  }

  const parts: string[] = []
  for (const rawPath of helpers) {
    let resolvedPath: string
    try {
      resolvedPath = request.ownerType === "tool"
        ? resolveToolHelperPath(request, rawPath)
        : resolveHelperPath(request.skillPath, request.skillName, rawPath)
    } catch (error) {
      return actionError(
        "BROWSER_SCRIPT_HELPER_PATH_INVALID",
        error instanceof Error ? error.message : "Helper path is invalid.",
        { helperPath: rawPath, skillPath: request.skillPath, rootDirectory: request.rootDirectory ?? null },
      )
    }

    const helperFile = readWorkspaceFileFromFiles(workspaceFiles, resolvedPath)
    if (!helperFile) {
      return actionError(
        "BROWSER_SCRIPT_HELPER_NOT_FOUND",
        `Helper file was not found: ${resolvedPath}`,
        { helperPath: rawPath, resolvedPath, scriptPath: request.scriptPath },
      )
    }

    parts.push(helperFile.content)
  }

  if (parts.length === 0) {
    return { ok: true, item: inlinedSource }
  }

  return { ok: true, item: parts.join("\n") + "\n" + inlinedSource }
}

/**
 * Tool-owned helper path resolution. Stricter than Skill:
 * - Only root-relative paths (relative to Tool's `rootDirectory`).
 * - Absolute paths (starting with `/` or containing `:` protocol) rejected.
 * - `../` escaping the Tool root rejected.
 *
 * Tools are single-directory units — cross-tool helper reuse is not a design
 * goal. Keep Tool boundary tight; if reuse ever matters, revisit here.
 */
function resolveToolHelperPath(
  request: RuntimeBrowserScriptExecutorRequest,
  helperPath: string,
): string {
  const root = request.rootDirectory ?? ""
  if (!root) {
    throw new Error("Tool helper resolution requires a rootDirectory.")
  }
  const trimmed = helperPath.trim()
  if (!trimmed) {
    throw new Error(`Tool helper path is empty.`)
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) || trimmed.startsWith("/")) {
    throw new Error(`Tool helper path must be relative to the tool directory: ${helperPath}`)
  }
  const stripped = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed
  const combined = stripped.startsWith(`${root}/`) ? stripped : `${root}/${stripped}`
  const normalized = normalizeWorkspacePath(combined, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
  if (!normalized.ok) {
    throw new Error(`Tool helper path is invalid: ${helperPath} (${normalized.message})`)
  }
  if (!normalized.path.startsWith(`${root}/`)) {
    throw new Error(`Tool helper path must stay under the tool directory: ${helperPath}`)
  }
  return normalized.path
}

async function handleSdkRequest(
  options: BrowserSkillScriptRunnerOptions,
  message: BrowserScriptWorkerMessage,
  executorContext: RuntimeControlledExecutorContext | undefined,
): Promise<unknown> {
  const op = typeof message.op === "string" ? message.op : ""
  const args = isRecord(message.args) ? message.args : {}

  if (op === "reply.project") {
    const text = typeof args.text === "string" ? args.text : ""
    const projected = projectAssistantReply(text, options.workspaceTransaction.workspaceFiles)
    for (const diagnostic of projected.diagnostics) {
      options.emitTrace?.({
        type: diagnostic.scope === "config"
          ? "reply_projection_config_failed"
          : "reply_projection_rule_failed",
        ok: false,
        data: {
          code: diagnostic.code,
          message: diagnostic.message,
          path: diagnostic.path ?? "",
          ruleId: diagnostic.ruleId ?? "",
          ruleIndex: diagnostic.ruleIndex ?? -1,
        },
      })
    }
    options.emitTrace?.({
      type: "reply_projection_completed",
      ok: true,
      data: {
        source: "browser-script-sdk",
        configPresent: projected.configPresent,
        ruleCount: projected.ruleCount,
        appliedRuleCount: projected.appliedRuleCount,
        diagnosticCount: projected.diagnostics.length,
        rawContentLength: text.length,
        contentLength: projected.content.length,
        displayContentLength: projected.displayContent?.length ?? null,
        projectionKeys: Object.keys(projected.projections ?? {}).sort(),
      },
    })
    return {
      kind: "assistant",
      content: projected.content,
      ...(projected.displayContent !== undefined ? { displayContent: projected.displayContent } : {}),
      ...(projected.projections ? { projections: projected.projections } : {}),
    }
  }

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
  config: Record<string, string>,
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
      const errorEvent = event.error
      settle(actionError(
        "BROWSER_SCRIPT_WORKER_ERROR",
        event.message || "Browser script worker failed.",
        {
          scriptPath: request.scriptPath,
          line: event.lineno,
          column: event.colno,
          ...(errorEvent && typeof errorEvent.stack === "string"
            ? { stack: errorEvent.stack.slice(0, 1000) }
            : {}),
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
            ...(error.stack === undefined ? {} : { stack: toJsonValue(error.stack) }),
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
      config: toJsonValue(config),
    })
  })
}

/**
 * Merge a skill's declared config defaults with the player's saved overrides.
 * Player overrides win over `skill.config` defaults; keys the player left
 * unset fall back to the declared default. Both sides are string-valued —
 * scripts convert types themselves (`Number(config.MAX_RESULTS)`).
 */
function mergeSkillConfig(
  configItems: SkillConfigItem[] | undefined,
  playerValues: Record<string, string>,
): Record<string, string> {
  if (!configItems || configItems.length === 0) {
    return {}
  }
  const merged: Record<string, string> = {}
  for (const item of configItems) {
    merged[item.key] = item.defaultValue
  }
  for (const [key, value] of Object.entries(playerValues)) {
    // Only override keys the skill actually declares — a stale saved value
    // for a removed config key is ignored (the skill no longer reads it).
    if (key in merged) {
      merged[key] = value
    }
  }
  return merged
}

export function createBrowserSkillScriptRunner(
  options: BrowserSkillScriptRunnerOptions,
) {
  return async (
    request: RuntimeBrowserScriptExecutorRequest,
    executorContext?: RuntimeControlledExecutorContext,
  ): Promise<PlatformActionResult> => {
    if (!isScriptUnderOwnerDirectory(request)) {
      return actionError(
        "BROWSER_SCRIPT_PATH_INVALID",
        `Browser script path must stay under the declaring ${ownerLabel(request)} directory.`,
        {
          skillPath: request.skillPath,
          rootDirectory: request.rootDirectory ?? null,
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

    // helper 拼接：读 executor.helpers 声明的 helper 文件源码，拼到
    // vendor 库之后、脚本本体之前。helper 路径支持相对（Skill 目录）和绝对
    // （workspace 根）。文件缺失/路径逃逸报清晰错误，不静默跳过。
    const helperSource = await resolveAndConcatHelpers(
      inlined.item as string,
      request,
      options.workspaceTransaction.workspaceFiles,
    )
    if (!helperSource.ok) {
      return helperSource
    }
    const finalSource = helperSource.item as string

    // Merge declared config defaults with player-saved overrides, then inject
    // as `tsian.config`. A skill without configItems yields an empty object —
    // `config.API_KEY` returns undefined and the script handles the missing key.
    // Tool owner: `tsian.config` is always `{}` by design (PRD R12) — never
    // touch readSkillConfig even if a stray configItems field slipped in.
    const isToolOwner = request.ownerType === "tool"
    const playerValues = !isToolOwner && request.configItems && request.configItems.length > 0
      ? await readSkillConfig(request.skillPath)
      : {}
    const mergedConfig = isToolOwner
      ? {}
      : mergeSkillConfig(request.configItems, playerValues)

    return runWorkerScript(options, request, finalSource, executorContext, mergedConfig)
  }
}

/**
 * 创建 test_skill_script runner：从 workspace 文件中按 name 定位 Skill，
 * 解析 tsian-actions 找到 action 声明，校验 browser_script executor，
 * 然后直接调 runBrowserScript 执行——不需要先 use_skill 激活。
 *
 * 复用当前 turn 的 workspace 事务（脚本写入走 staged transaction）。
 */
export function createTestSkillScriptRunner(
  workspaceFiles: WorkspaceFile[],
  runBrowserScript: RuntimeBrowserScriptRunner,
): RuntimeTestSkillScriptRunner {
  return async (input: RuntimeTestSkillScriptInput, executorContext?: RuntimeControlledExecutorContext): Promise<PlatformActionResult> => {
    // ① 在 workspaceFiles 中找 skills/<dir>/SKILL.md，frontmatter name 匹配 skillName
    const registry = buildSkillRegistry(workspaceFiles)
    const skill = registry.find(
      (entry) => entry.name === input.skillName || entry.id === input.skillName,
    )
    if (!skill) {
      return actionError(
        "SKILL_NOT_FOUND",
        `Skill "${input.skillName}" was not found.`,
        {
          skillName: input.skillName,
          availableSkills: registry.map((entry) => entry.name).filter(Boolean),
        },
      )
    }

    // ② 读 SKILL.md 内容，解析 tsian-actions block，找 actionName
    const skillFile = workspaceFiles.find((file) => file.path === skill.path)
    if (!skillFile) {
      return actionError(
        "SKILL_FILE_MISSING",
        `Skill file was not found: ${skill.path}`,
        { skillPath: skill.path },
      )
    }

    const parseResult = parseActionDeclarations(skillFile.content)
    const action = parseResult.actions.find((decl) => decl.name === input.actionName)
    if (!action) {
      return actionError(
        "ACTION_NOT_FOUND",
        `Action "${input.actionName}" was not found in skill "${input.skillName}".`,
        {
          skillName: input.skillName,
          actionName: input.actionName,
          availableActions: parseResult.actions.map((decl) => decl.name),
        },
      )
    }

    // ③ 校验 executor.type === "browser_script"
    if (action.executor.type !== "browser_script") {
      return actionError(
        "ACTION_NOT_BROWSER_SCRIPT",
        `Action "${input.actionName}" is not a browser_script action (type: "${action.executor.type}").`,
        { skillName: input.skillName, actionName: input.actionName, executorType: action.executor.type },
      )
    }

    // ④ 解析 scriptPath（相对 skill 目录），校验文件存在
    const scriptPath = resolveBrowserScriptPath(skill, action.executor)
    if (!workspaceFiles.some((file) => file.path === scriptPath)) {
      return actionError(
        "BROWSER_SCRIPT_NOT_FOUND",
        `Browser script file was not found: ${scriptPath}`,
        { scriptPath, skillPath: skill.path },
      )
    }

    // ⑤ 调 runBrowserScript 执行（复用现有执行器，错误透传来自 Step 1 改造）
    // 透传 executorContext（exposedWorkspaceOperations + agentContext），
    // 否则 Worker 内 tsian.workspace.* 全部因 WORKSPACE_OPERATION_NOT_EXPOSED 失败。
    const timeoutMs = action.executor.timeoutMs ?? 10000
    return runBrowserScript(
      {
        skillName: skill.name,
        skillPath: skill.path,
        actionName: action.name,
        scriptPath,
        input: input.input,
        timeoutMs,
        ...(action.executor.helpers && action.executor.helpers.length > 0
          ? { helpers: action.executor.helpers }
          : {}),
        ...(skill.configItems && skill.configItems.length > 0
          ? { configItems: skill.configItems }
          : {}),
      },
      executorContext,
    )
  }
}

/**
 * 创建 runBrowserScript + runTestSkillScript 一对 runner。
 *
 * 三处 runAgentRuntimeTurn 调用点（sendMessage / invokeAgent / assistant-chat）
 * 的脚本能力注入完全相同，只是变量名不同。此工厂消除重复——新增脚本相关能力
 * 只需在此处加一行，三处自动生效。
 */
export function createBrowserScriptRunners(options: {
  workspaceTransaction: Pick<RuntimeWorkspaceTransaction, "workspaceFiles" | "write" | "delete">
  signal?: AbortSignal
  emitTrace?: RuntimeTraceEmitter
}): {
  runBrowserScript: RuntimeBrowserScriptRunner
  runTestSkillScript: RuntimeTestSkillScriptRunner
} {
  const runBrowserScript = createBrowserSkillScriptRunner(options)
  const runTestSkillScript = createTestSkillScriptRunner(
    options.workspaceTransaction.workspaceFiles,
    runBrowserScript,
  )
  return { runBrowserScript, runTestSkillScript }
}
