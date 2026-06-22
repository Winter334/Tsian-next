import type { WorkspaceFile, WorkspaceScope } from "@tsian/contracts"

import {
  deleteLocalAssistantPath,
  deleteLocalGameCardContentPathForCard,
  deleteWorkspacePathForSave,
  isLocalAssistantPath,
  isPlatformMetadataPath,
  listLocalGameCardContentFiles,
  listLocalGameCardFrontendFiles,
  listLocalWorkspaceFilesForSave,
  loadLocalAssistantFiles,
  saveLocalAssistantFiles,
  toWorkspaceFileFromGameCardContent,
  writeLocalGameCardContentFile,
  writePlatformWorkspaceFileForSave,
  writeWorkspaceFileForSave,
  type LocalWorkspaceFileRecord,
} from "../storage"
import { binaryPlaceholderText, inferMediaTypeFromPath, isTextMediaType } from "@/lib/media-type"

/**
 * WorkspaceVolume — host 层存储后端适配器（子5: 06-21-workspace-storage-volume-abstraction）。
 *
 * 把 4 个物理后端（gameCardContentFiles / gameCardFrontendFiles / workspaceFiles /
 * meta-local-assistant）包成统一接口，让单一 dispatch 按 (scope, path-prefix) 路由，
 * 取代 3 个 ad-hoc 路由点（executeWorkspaceOperationForActiveSave /
 * executeStudioWorkspaceOperation / executeLocalWorkspaceOperation）各自 if/else。
 *
 * 3 原语足够（勘察依据）：runtime 层把 10 op 里 7 个自己算了（list/glob/search/diff/
 * validate/read/move/patch），volume 只暴露 enumerate/write/delete。
 *
 * content 模型是 text + binary 双轨（06-22 重构后）：write 入参 content?/data? 双字段，
 * agent runtime 只读 content 不碰 binary，对 agent 透明。
 */
export interface WorkspaceVolumeWriteInput {
  path: string
  /** Text content for text files. Mutually exclusive with `data`. */
  content?: string
  /** Binary payload for media files. Mutually exclusive with `content`. */
  data?: Blob
}

export interface WorkspaceVolume {
  readonly scope: WorkspaceScope
  /** 列该 owner 下所有文件（runtime 在此基础上做 list/glob/search/diff/validate）。
   *  返回 WorkspaceFile 含 binary 字段（媒体文件填 binary，content 给 placeholder）。 */
  enumerate(ownerId: string): Promise<WorkspaceFile[]>
  /** 单文件写，返回写入后的 WorkspaceFile（含时间戳 + binary 若是媒体文件）。 */
  write(ownerId: string, input: WorkspaceVolumeWriteInput): Promise<WorkspaceFile>
  /** 删前缀下所有文件，返回已删 path 列表（递归）。 */
  delete(ownerId: string, pathPrefix: string): Promise<string[]>
}

// 本地助手文件是跨 save 全局存储，但走 platform-meta scope；返回 WorkspaceFile 时
// 时间戳用约定值（meta 单行 JSON 不存 per-file 时间戳）。
const LOCAL_ASSISTANT_TIMESTAMP_NOW = (): number => Date.now()

/**
 * CardContentVolume — scope card-content，ownerId = cardId。
 * 后端 gameCardContentFiles（子4 per-file 表，含 data?: Blob）。write/delete 内部
 * 已 bump card updatedAt（game-cards.ts 的事务里顺带 update gameCards）。
 */
export const cardContentVolume: WorkspaceVolume = {
  scope: "card-content",
  async enumerate(cardId) {
    const files = await listLocalGameCardContentFiles(cardId)
    return files.map(toWorkspaceFileFromGameCardContent)
  },
  async write(cardId, { path, content, data }) {
    const rec = await writeLocalGameCardContentFile(cardId, {
      path,
      ...(typeof content === "string" ? { content } : {}),
      ...(data instanceof Blob ? { data } : {}),
    })
    return toWorkspaceFileFromGameCardContent(rec)
  },
  async delete(cardId, pathPrefix) {
    return deleteLocalGameCardContentPathForCard(cardId, pathPrefix)
  },
}

/**
 * CardFrontendVolume — scope card-frontend，ownerId = cardId。
 * 后端 gameCardFrontendFiles（data: Blob 必需，无 content/mediaType，纯二进制）。
 *
 * 本任务（子5）只实现 enumerate（前端文件只读可见，接入 list）；write/delete 占位
 * throw，待子3 补 writeLocalGameCardFrontendFile/deleteLocalGameCardFrontendFile
 * 单文件 API（现状只能整批 putLocalGameCard）。
 */
export const cardFrontendVolume: WorkspaceVolume = {
  scope: "card-frontend",
  async enumerate(cardId) {
    const files = await listLocalGameCardFrontendFiles(cardId)
    // 前端文件存 data: Blob（无 content 字段）。文本类（html/css/js/json/svg 等）
    // → await data.text() 填 content（Explorer 能编辑/查看）；媒体类（图片/音视频）
    // → binary + placeholder（走媒体查看器）。svg 是 image/svg+xml 但实际是文本，
    // 单独判一下。
    return Promise.all(files.map(async (r) => {
      const mediaType = inferMediaTypeFromPath(r.path)
      if (isTextMediaType(mediaType) || mediaType === "image/svg+xml") {
        return {
          path: r.path,
          content: await r.data.text(),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }
      }
      return {
        path: r.path,
        content: binaryPlaceholderText(r.data, r.path),
        binary: r.data,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }
    }))
  },
  async write(_cardId, { path }) {
    throw new Error(
      `card-frontend write not yet implemented for path "${path}" (see task 06-21-game-card-data-fileification 子3)`,
    )
  },
  async delete(_cardId, pathPrefix) {
    throw new Error(
      `card-frontend delete not yet implemented for prefix "${pathPrefix}" (see task 06-21-game-card-data-fileification 子3)`,
    )
  },
}

/**
 * SaveRuntimeVolume — scope save-runtime，ownerId = saveId。
 * 后端 workspaceFiles 表（仅 save/ 路径，assertOrdinarySaveRuntimeMutationPath 校验）。
 */
export const saveRuntimeVolume: WorkspaceVolume = {
  scope: "save-runtime",
  async enumerate(saveId) {
    const records = await listLocalWorkspaceFilesForSave(saveId)
    return records.map(toWorkspaceFileFromRecord)
  },
  async write(saveId, { path, content, data }) {
    return writeWorkspaceFileForSave(saveId, {
      path,
      ...(typeof content === "string" ? { content } : {}),
      ...(data instanceof Blob ? { data } : {}),
    })
  },
  async delete(saveId, pathPrefix) {
    const result = await deleteWorkspacePathForSave(saveId, pathPrefix)
    return result.deletedPaths
  },
}

/**
 * SavePlatformMetaVolume — scope platform-meta save-owned，ownerId = saveId。
 * 后端 workspaceFiles 表（.tsian/ save-owned 路径，assertPlatformSaveRuntimeMutationPath
 * 校验）。与 SaveRuntimeVolume 共用表但路径校验分流。
 *
 * delete 现状：storage 层无 platform-meta 的前缀删除 API（deleteWorkspacePathForSave
 * 内部调 assertOrdinarySaveRuntimeMutationPath 拒绝 .tsian/）。executeLocalWorkspaceOperation
 * 当前是 best-effort（不真删 DB，只返回 path）。本 volume 保持该现状语义，待后续补
 * platform-meta 前缀删除 API 时再实现真实删除。
 */
export const savePlatformMetaVolume: WorkspaceVolume = {
  scope: "platform-meta",
  async enumerate(saveId) {
    const records = await listLocalWorkspaceFilesForSave(saveId)
    return records
      .filter((r) => isPlatformMetadataPath(r.path))
      .map(toWorkspaceFileFromRecord)
  },
  async write(saveId, { path, content, data }) {
    return writePlatformWorkspaceFileForSave(saveId, {
      path,
      ...(typeof content === "string" ? { content } : {}),
      ...(data instanceof Blob ? { data } : {}),
    })
  },
  async delete(_saveId, pathPrefix) {
    // 现状语义：best-effort（与 executeLocalWorkspaceOperation 原 L583-584 一致）。
    // storage 层尚无 platform-meta 前缀删除 API；返回声明已删 path，不真删 DB。
    return [pathPrefix]
  },
}

/**
 * LocalAssistantVolume — scope platform-meta local-assistant，ownerId = saveId 但全局忽略。
 * 后端 meta 表单行 JSON（.tsian/local/assistant/ 路径，跨 save 持久）。
 * saveLocalAssistantFiles 是合并落盘（load → filter 同 path → 合并 → save）。
 */
export const localAssistantVolume: WorkspaceVolume = {
  scope: "platform-meta",
  async enumerate(_saveId) {
    return loadLocalAssistantFiles()
  },
  async write(_saveId, { path, content, data }) {
    const now = LOCAL_ASSISTANT_TIMESTAMP_NOW()
    const written: WorkspaceFile = {
      path,
      content: typeof content === "string" ? content : "",
      ...(data instanceof Blob ? { binary: data } : {}),
      createdAt: 0,
      updatedAt: now,
    }
    const existing = await loadLocalAssistantFiles()
    const updated = [
      ...existing.filter((f) => f.path !== path),
      written,
    ]
    await saveLocalAssistantFiles(updated)
    return written
  },
  async delete(_saveId, pathPrefix) {
    return deleteLocalAssistantPath(pathPrefix)
  },
}

/**
 * LocalWorkspaceFileRecord → WorkspaceFile 映射。与 storage/workspace.ts 的
 * toWorkspaceFile 同构（该函数未 export，这里在 volume 层重实现一份，避免改 storage
 * 的 export 面；映射逻辑简单且稳定）。
 */
function toWorkspaceFileFromRecord(record: LocalWorkspaceFileRecord): WorkspaceFile {
  if (record.data) {
    return {
      path: record.path,
      content: binaryPlaceholderText(record.data, record.path),
      binary: record.data,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
  return {
    path: record.path,
    content: record.content,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Single dispatch（子5 Step 3）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 路由点改造时传给 dispatch 的 owner 解析上下文。card-scope volume 需要 cardId；
 * save-scope / platform-meta volume 需要 saveId；local-assistant volume 忽略 ownerId
 * （全局 meta，但 dispatch 仍传 saveId，volume 内部不用）。
 */
export interface WorkspaceVolumeOwnerContext {
  cardId?: string
  saveId?: string
}

/**
 * 按 (scope, path-prefix) 选 volume。platform-meta scope 二级路由：
 * `.tsian/local/assistant/` → localAssistantVolume（meta 表）；
 * 其它 `.tsian/` save-owned → savePlatformMetaVolume（workspaceFiles 表）。
 *
 * effective scope 不进 dispatch（runtime 在快照层算，不调 mutations）。
 */
export function resolveVolumeForScope(
  scope: WorkspaceScope,
  path: string,
  _ownerContext: WorkspaceVolumeOwnerContext,
): WorkspaceVolume {
  if (scope === "platform-meta") {
    return isLocalAssistantPath(path) ? localAssistantVolume : savePlatformMetaVolume
  }
  if (scope === "card-content") return cardContentVolume
  if (scope === "card-frontend") return cardFrontendVolume
  if (scope === "save-runtime") return saveRuntimeVolume
  throw new Error(`unsupported scope for workspace mutation: ${scope}`)
}

/**
 * 从 ownerContext 解析出 volume 需要的 ownerId。
 * card-scope volume → cardId；save-scope / save-platform-meta volume → saveId；
 * local-assistant volume → 忽略 ownerId（全局 meta，跨 save 持久），返回空串占位。
 */
function resolveOwnerId(
  volume: WorkspaceVolume,
  ownerContext: WorkspaceVolumeOwnerContext,
): string {
  if (volume.scope === "card-content" || volume.scope === "card-frontend") {
    if (!ownerContext.cardId) {
      throw new Error(
        `workspace mutation on scope "${volume.scope}" requires a cardId in ownerContext`,
      )
    }
    return ownerContext.cardId
  }
  // local-assistant volume 是全局 meta，不依赖 saveId（跨 save 持久）。按引用判断，
  // 不能用 scope 判断（与 savePlatformMetaVolume 同为 platform-meta scope）。
  if (volume === localAssistantVolume) {
    return ""
  }
  // save-runtime / save-platform-meta 需要 saveId。
  if (!ownerContext.saveId) {
    throw new Error(
      `workspace mutation on scope "${volume.scope}" requires a saveId in ownerContext`,
    )
  }
  return ownerContext.saveId
}

/**
 * 单一 dispatch：按 (scope, path-prefix) 路由到 volume，调 write 或 delete。
 * 取代 3 个 ad-hoc 路由点（executeWorkspaceOperationForActiveSave 非 staged 分支 /
 * executeStudioWorkspaceOperation / executeLocalWorkspaceOperation）的 if/else。
 *
 * staged turn 的 transaction 攒变更路径不进 dispatch（保留在
 * executeWorkspaceOperationForActiveSave 上层，见 design "staged turn 保留上层处理"）。
 */
export async function executeWorkspaceMutation(input: {
  scope: WorkspaceScope
  path: string
  content?: string
  data?: Blob
  ownerContext: WorkspaceVolumeOwnerContext
  operation: "write" | "delete"
}): Promise<WorkspaceFile | string[]> {
  const volume = resolveVolumeForScope(input.scope, input.path, input.ownerContext)
  const ownerId = resolveOwnerId(volume, input.ownerContext)
  if (input.operation === "write") {
    return volume.write(ownerId, {
      path: input.path,
      ...(typeof input.content === "string" ? { content: input.content } : {}),
      ...(input.data instanceof Blob ? { data: input.data } : {}),
    })
  }
  return volume.delete(ownerId, input.path)
}
