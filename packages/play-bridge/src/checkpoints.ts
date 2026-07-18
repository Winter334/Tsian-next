// @tsian/play-bridge — 检查点数据层封装
//
// 检查点 RPC 包装成纯函数，表现层不直接 import contracts、
// 不直接拼 platform.runAction / query.query 的字面量。

import type {
  CheckpointSummary,
  CreateCheckpointOptions,
  DeepQueryResult,
  ListCheckpointOptions,
  OverwriteCheckpointOptions,
  PlatformActionResult,
  UpdateCheckpointOptions,
} from "@tsian/contracts"
import type { Bridge } from "./bridge"

function actionError(result: PlatformActionResult | null | undefined, fallback: string): Error {
  const err = result?.error
  const e = new Error(err?.message ?? fallback)
  if (err) (e as Error & { code?: string }).code = err.code
  return e
}

/**
 * 查询当前存档的检查点。
 * 一次 RPC 调用 host 的 "checkpoints" resource，host 默认按 createdAt 降序（新→旧）返回。
 * 无激活存档时返回空数组。
 */
export async function listCheckpoints(
  bridge: Bridge,
  options?: ListCheckpointOptions,
): Promise<CheckpointSummary[]> {
  const result = await bridge.call<DeepQueryResult<CheckpointSummary>>(
    "query.query",
    { resource: "checkpoints", ...(options ? { params: options } : {}) },
  )
  return result?.items ?? []
}

/**
 * 恢复到指定检查点：回滚当前存档的运行时状态 + workspace 文件到该检查点。
 * 成功返回恢复后的 turn 号；失败（检查点不存在 / 无激活存档）抛出 error 对象。
 *
 * 这是破坏性操作——UI 侧应做二次确认。
 */
export async function restoreCheckpoint(
  bridge: Bridge,
  checkpointId: string,
): Promise<{ turn: number }> {
  const result = await bridge.call<PlatformActionResult<{ turn: number }>>(
    "platform.runAction",
    { action: "restore-checkpoint", params: { checkpointId } },
  )
  if (!result || !result.ok) {
    throw actionError(result, "恢复检查点失败。")
  }
  return result.item as { turn: number }
}

export async function createCheckpoint(
  bridge: Bridge,
  options?: string | CreateCheckpointOptions,
): Promise<CheckpointSummary> {
  const params = typeof options === "string"
    ? { label: options }
    : options ?? {}
  const result = await bridge.call<PlatformActionResult<CheckpointSummary>>(
    "platform.runAction",
    { action: "create-checkpoint", params },
  )
  if (!result || !result.ok) {
    throw actionError(result, "创建检查点失败。")
  }
  return result.item as CheckpointSummary
}

export async function updateCheckpoint(
  bridge: Bridge,
  checkpointId: string,
  patch: UpdateCheckpointOptions,
): Promise<CheckpointSummary> {
  const result = await bridge.call<PlatformActionResult<CheckpointSummary>>(
    "platform.runAction",
    { action: "update-checkpoint", params: { checkpointId, ...patch } },
  )
  if (!result || !result.ok) {
    throw actionError(result, "更新检查点失败。")
  }
  return result.item as CheckpointSummary
}

export async function overwriteCheckpoint(
  bridge: Bridge,
  checkpointId: string,
  options?: OverwriteCheckpointOptions,
): Promise<CheckpointSummary> {
  const result = await bridge.call<PlatformActionResult<CheckpointSummary>>(
    "platform.runAction",
    { action: "overwrite-checkpoint", params: { checkpointId, ...(options ?? {}) } },
  )
  if (!result || !result.ok) {
    throw actionError(result, "覆盖检查点失败。")
  }
  return result.item as CheckpointSummary
}

export async function deleteCheckpoint(
  bridge: Bridge,
  checkpointId: string,
): Promise<void> {
  const result = await bridge.call<PlatformActionResult<void>>(
    "platform.runAction",
    { action: "delete-checkpoint", params: { checkpointId } },
  )
  if (!result || !result.ok) {
    throw actionError(result, "删除检查点失败。")
  }
}
