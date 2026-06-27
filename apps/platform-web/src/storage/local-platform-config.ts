import type { WorkspaceFile } from "@tsian/contracts"
import { localDb } from "./db"

/**
 * 平台配置文件的本地存储层（task 06-27-platform-config）。
 *
 * 仿 `local-assistant-files.ts` 模式：Dexie `meta` 表单 KV `platform-local-config`
 * 存一个 path→content map（单条目 `.tsian/local/platform-config.json`）。配置文件作为
 * "虚拟 workspace 文件"存在于 platform-meta scope，actorLevel 4 助手经 workspace 路由
 * 可读写；`.tsian/local/` 被 `isSaveRuntimePersistencePath` 排除，不进 checkpoint、不进
 * game-card 导出，随本地 workspace 走（设备迁移友好）。
 *
 * 不并入 `assistant-local-files` 的 map——配置语义上不属于 assistant 目录，独立 KV 让
 * 配置自成一体，未来 `.tsian/local/` 下加别的平台文件可复用此模式。
 */
const LOCAL_PLATFORM_CONFIG_KEY = "platform-local-config"

export const LOCAL_PLATFORM_CONFIG_DIR = ".tsian/local"
export const LOCAL_PLATFORM_CONFIG_PATH = ".tsian/local/platform-config.json"

interface StoredPlatformConfigFile {
  content: string
}

interface StoredPlatformConfigFileMap {
  [path: string]: StoredPlatformConfigFile
}

export function isLocalPlatformConfigPath(path: string): boolean {
  return path === LOCAL_PLATFORM_CONFIG_PATH
}

/**
 * 加载配置文件为 WorkspaceFile[]（0 或 1 条目）。供 volume enumerate 与
 * workspace list 路由并入 allFiles，让助手 workspace_read/list 能取到配置文件。
 */
export async function loadLocalPlatformConfigFile(): Promise<WorkspaceFile[]> {
  const record = await localDb.meta.get(LOCAL_PLATFORM_CONFIG_KEY)
  if (!record?.value) {
    return []
  }
  try {
    const parsed = JSON.parse(record.value) as StoredPlatformConfigFileMap
    if (!parsed || typeof parsed !== "object") {
      return []
    }
    return Object.entries(parsed).map(([path, file]) => ({
      path,
      content: file.content,
      createdAt: 0,
      updatedAt: 0,
    }))
  } catch {
    // 损坏记录忽略，不阻塞读取（config 读写层会按"无文件"建默认配置）。
    return []
  }
}

/** 读取配置文件原始内容；不存在返回 null。供 config 读写层预热用。 */
export async function readLocalPlatformConfigFileContent(): Promise<string | null> {
  const files = await loadLocalPlatformConfigFile()
  return files[0]?.content ?? null
}

/** 写入配置文件内容（覆盖单条目 map）。写成功后调用方负责更新内存 cache。 */
export async function saveLocalPlatformConfigFile(content: string): Promise<void> {
  const map: StoredPlatformConfigFileMap = {
    [LOCAL_PLATFORM_CONFIG_PATH]: { content },
  }
  await localDb.meta.put({
    key: LOCAL_PLATFORM_CONFIG_KEY,
    value: JSON.stringify(map),
  })
}

/** 删除配置文件（重置/清空场景）。返回是否实际删除。 */
export async function deleteLocalPlatformConfigFile(): Promise<boolean> {
  const record = await localDb.meta.get(LOCAL_PLATFORM_CONFIG_KEY)
  if (!record?.value) {
    return false
  }
  await localDb.meta.delete(LOCAL_PLATFORM_CONFIG_KEY)
  return true
}
