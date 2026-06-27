/**
 * 平台配置读写层 + 内存缓存（task 06-27-platform-config）。
 *
 * 把散落在 localStorage（provider/embedding）和硬编码常量（tunables）里的平台配置
 * 统一到 `.tsian/local/platform-config.json`。读层提供同步 cache（46 个现有同步调用点
 * 不改 async），启动预热 + 写后立即更新 cache。热路径（embed-queue/assistant-chat）
 * 读 cache 不读 Dexie。
 *
 * 保存语义（方案 A）：`savePlatformConfig(input)` 是全量写，调用方负责
 * "读全量 → merge 本屏 section → 写回"。不暴露 section 写函数，cache 天然一致。
 *
 * schema 变更：破坏性重置。preheat 时若 JSON parse 失败或 schema 严重不符 →
 * 删文件 + 返 DEFAULT + toast 告警。tunables 逐字段校验，单字段不符用默认值（不整体重置）。
 */
import type { BrowserEmbeddingConfig, BrowserPlatformConfigDraft } from "./ai"
import { toast } from "@/composables/useToast"
import {
  deleteLocalPlatformConfigFile,
  readLocalPlatformConfigFileContent,
  saveLocalPlatformConfigFile,
} from "../storage"

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformConfigCheckpointPrune {
  keepRecent: number
  sparseEvery: number
}

export interface PlatformConfigContextCompression {
  triggerRatio: number
  keepRecentTurns: number
  /** task 模式(助手/子代理)压缩时保留最近 N 轮工具交互不压缩.
   *  与 keepRecentTurns 分离——narrative 保留正文轮次,task 保留工具交互轮次,
   *  计数单位不同(一个 turn = 一对 user+assistant 正文;一个 round = 一对 assistant toolCalls + observation),
   *  token 量差异大,不应共用同一值. */
  taskKeepRecentRounds: number
}

export interface PlatformConfigRag {
  defaultLimit: number
  maxLimit: number
}

export interface PlatformConfigAi {
  chatTimeoutMs: number
}

export interface PlatformConfigAssistant {
  maxStoredMessages: number
}

/**
 * 平台配置根 schema。`embeddingConfig` 保留在 `provider`（BrowserPlatformConfigDraft）
 * 内，不另设独立字段——避免两份副本不同步（ai.ts 现有结构如此，P3 改动最小）。
 */
export interface PlatformConfig {
  provider: BrowserPlatformConfigDraft
  checkpointPrune: PlatformConfigCheckpointPrune
  contextCompression: PlatformConfigContextCompression
  rag: PlatformConfigRag
  ai: PlatformConfigAi
  assistant: PlatformConfigAssistant
}

export type PlatformConfigSectionKey =
  | "provider"
  | "checkpointPrune"
  | "contextCompression"
  | "rag"
  | "ai"
  | "assistant"

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

function createDefaultEmbeddingConfig(): BrowserEmbeddingConfig {
  return { enabled: false, baseUrl: "", apiKey: "", model: "", dimensions: 0 }
}

function createEmptyPlatformConfigDraft(): BrowserPlatformConfigDraft {
  return {
    activeProviderId: "",
    providerTypes: [],
    embeddingConfig: createDefaultEmbeddingConfig(),
  }
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  provider: createEmptyPlatformConfigDraft(),
  checkpointPrune: { keepRecent: 50, sparseEvery: 20 },
  contextCompression: { triggerRatio: 0.85, keepRecentTurns: 5, taskKeepRecentRounds: 5 },
  rag: { defaultLimit: 5, maxLimit: 8 },
  ai: { chatTimeoutMs: 600_000 },
  assistant: { maxStoredMessages: 200 },
}

// ─────────────────────────────────────────────────────────────────────────────
// 内存 cache
// ─────────────────────────────────────────────────────────────────────────────

let cache: PlatformConfig | null = null
let preheatPromise: Promise<void> | null = null

/**
 * 同步读配置。未预热时返 DEFAULT（不阻塞——provider 未配时本就走 env/默认，
 * 短暂窗口无感）。热路径调用方不应 mutate 返回值。
 */
export function getPlatformConfig(): PlatformConfig {
  return cache ?? DEFAULT_PLATFORM_CONFIG
}

/** 按 section 取（同步读 cache），供 tunables 消费点用。 */
export function getPlatformConfigSection<K extends PlatformConfigSectionKey>(
  key: K,
): PlatformConfig[K] {
  return getPlatformConfig()[key]
}

/**
 * 启动预热：读 `.tsian/local/platform-config.json` → merge 默认 → cache。
 * 防重复并发（preheatPromise 复用）。App.vue onMounted 调一次。
 * parse 失败 / schema 严重不符 → 删文件 + cache = DEFAULT + toast 告警。
 */
export async function preheatPlatformConfig(): Promise<void> {
  if (cache) {
    return
  }
  if (preheatPromise) {
    return preheatPromise
  }
  preheatPromise = (async () => {
    try {
      const raw = await readLocalPlatformConfigFileContent()
      if (raw === null) {
        // 无配置文件（首次启动）——用默认，不建文件（首次保存时才落盘）。
        cache = cloneConfig(DEFAULT_PLATFORM_CONFIG)
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        await deleteLocalPlatformConfigFile()
        cache = cloneConfig(DEFAULT_PLATFORM_CONFIG)
        toast.error("平台配置文件格式损坏，已重置为默认值。")
        return
      }
      const merged = mergePlatformConfig(parsed)
      if (!merged) {
        await deleteLocalPlatformConfigFile()
        cache = cloneConfig(DEFAULT_PLATFORM_CONFIG)
        toast.error("平台配置 schema 不符，已重置为默认值。")
        return
      }
      cache = merged
    } catch (e) {
      // 读文件本身失败（Dexie 异常等）——用默认，不阻塞启动。
      cache = cloneConfig(DEFAULT_PLATFORM_CONFIG)
      console.warn("[platform-config] preheat failed, using defaults:", e)
    } finally {
      preheatPromise = null
    }
  })()
  return preheatPromise
}

/**
 * 全量写配置。先写文件成功再更新 cache（写失败抛错，cache 不动，避免不一致）。
 * input 应是规范化的完整 PlatformConfig；调用方负责 merge 本屏 section（方案 A）。
 */
export async function savePlatformConfig(input: PlatformConfig): Promise<void> {
  const serialized = JSON.stringify(input, null, 2)
  await saveLocalPlatformConfigFile(serialized)
  cache = input
}

// ─────────────────────────────────────────────────────────────────────────────
// schema 校验 + merge 默认
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && Number.isInteger(value)
    ? Math.floor(value)
    : fallback
}

function normalizeRatio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : fallback
}

function normalizeTimeoutMs(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1000
    ? Math.floor(value)
    : fallback
}

/**
 * 把 raw parse 结果 merge 成规范 PlatformConfig。
 * provider/embedding 透传 + 缺字段补空 draft（深度规范化交给 ai.ts 读函数，幂等）；
 * tunables 逐字段校验类型/范围，不符用默认。
 * 返回 null = schema 严重不符（非对象），调用方应删文件重置。
 */
function mergePlatformConfig(raw: unknown): PlatformConfig | null {
  if (!isPlainObject(raw)) {
    return null
  }

  // provider section：确保是 object 且有 providerTypes 数组；否则用空 draft。
  const rawProvider = raw.provider
  const provider: BrowserPlatformConfigDraft = isPlainObject(rawProvider) && Array.isArray((rawProvider as Record<string, unknown>).providerTypes)
    ? (rawProvider as unknown as BrowserPlatformConfigDraft)
    : createEmptyPlatformConfigDraft()

  const rawCheckpoint = raw.checkpointPrune
  const checkpointPrune: PlatformConfigCheckpointPrune = isPlainObject(rawCheckpoint)
    ? {
        keepRecent: normalizePositiveInt((rawCheckpoint as Record<string, unknown>).keepRecent, DEFAULT_PLATFORM_CONFIG.checkpointPrune.keepRecent),
        sparseEvery: normalizePositiveInt((rawCheckpoint as Record<string, unknown>).sparseEvery, DEFAULT_PLATFORM_CONFIG.checkpointPrune.sparseEvery),
      }
    : { ...DEFAULT_PLATFORM_CONFIG.checkpointPrune }

  const rawCompression = raw.contextCompression
  const contextCompression: PlatformConfigContextCompression = isPlainObject(rawCompression)
    ? {
        triggerRatio: normalizeRatio((rawCompression as Record<string, unknown>).triggerRatio, DEFAULT_PLATFORM_CONFIG.contextCompression.triggerRatio),
        keepRecentTurns: normalizePositiveInt((rawCompression as Record<string, unknown>).keepRecentTurns, DEFAULT_PLATFORM_CONFIG.contextCompression.keepRecentTurns),
        taskKeepRecentRounds: normalizePositiveInt((rawCompression as Record<string, unknown>).taskKeepRecentRounds, DEFAULT_PLATFORM_CONFIG.contextCompression.taskKeepRecentRounds),
      }
    : { ...DEFAULT_PLATFORM_CONFIG.contextCompression }

  const rawRag = raw.rag
  let rag: PlatformConfigRag
  if (isPlainObject(rawRag)) {
    const defaultLimit = normalizePositiveInt((rawRag as Record<string, unknown>).defaultLimit, DEFAULT_PLATFORM_CONFIG.rag.defaultLimit)
    let maxLimit = normalizePositiveInt((rawRag as Record<string, unknown>).maxLimit, DEFAULT_PLATFORM_CONFIG.rag.maxLimit)
    if (maxLimit < defaultLimit) {
      maxLimit = defaultLimit
    }
    rag = { defaultLimit, maxLimit }
  } else {
    rag = { ...DEFAULT_PLATFORM_CONFIG.rag }
  }

  const rawAi = raw.ai
  const ai: PlatformConfigAi = isPlainObject(rawAi)
    ? { chatTimeoutMs: normalizeTimeoutMs((rawAi as Record<string, unknown>).chatTimeoutMs, DEFAULT_PLATFORM_CONFIG.ai.chatTimeoutMs) }
    : { ...DEFAULT_PLATFORM_CONFIG.ai }

  const rawAssistant = raw.assistant
  const assistant: PlatformConfigAssistant = isPlainObject(rawAssistant)
    ? { maxStoredMessages: normalizePositiveInt((rawAssistant as Record<string, unknown>).maxStoredMessages, DEFAULT_PLATFORM_CONFIG.assistant.maxStoredMessages) }
    : { ...DEFAULT_PLATFORM_CONFIG.assistant }

  return { provider, checkpointPrune, contextCompression, rag, ai, assistant }
}

function cloneConfig(config: PlatformConfig): PlatformConfig {
  return {
    provider: {
      activeProviderId: config.provider.activeProviderId,
      providerTypes: config.provider.providerTypes.map((type) => ({
        ...type,
        presets: type.presets.map((preset) => ({
          ...preset,
          models: preset.models.map((model) => ({ ...model, parameters: { ...model.parameters } })),
          fetchedModels: preset.fetchedModels.map((m) => ({ ...m })),
        })),
      })),
      embeddingConfig: { ...config.provider.embeddingConfig },
    },
    checkpointPrune: { ...config.checkpointPrune },
    contextCompression: { ...config.contextCompression },
    rag: { ...config.rag },
    ai: { ...config.ai },
    assistant: { ...config.assistant },
  }
}
