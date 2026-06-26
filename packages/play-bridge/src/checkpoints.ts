// @tsian/play-bridge — 检查点数据层封装
//
// 检查点回溯的两个 RPC 包装成纯函数，表现层不直接 import contracts、
// 不直接拼 platform.runAction / query.query 的字面量：
//   listCheckpoints(bridge)    → 查询当前存档的全部检查点（host 已按新→旧排序）
//   restoreCheckpoint(bridge)  → 恢复到指定检查点（回滚存档运行时状态）
//
// host 实现：
//   列表  query.query { resource: "checkpoints" }      → apps/platform-web/.../index.ts:531-539
//   恢复  platform.runAction { action: "restore-checkpoint",
//                               params: { checkpointId } } → apps/platform-web/.../index.ts:374-405
// 检查点只在 turn 边界产生（initial / after-turn / manual），无任意 turn seek。

import type {
  CheckpointSummary,
  DeepQueryResult,
  PlatformActionResult,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import type { Bridge } from "./bridge"

/**
 * 查询当前存档的全部检查点。
 * 一次 RPC 调用 host 的 "checkpoints" resource，host 按 createdAt 降序（新→旧）返回。
 * 无激活存档时返回空数组。
 */
export async function listCheckpoints(bridge: Bridge): Promise<CheckpointSummary[]> {
  const result = await bridge.call<DeepQueryResult<CheckpointSummary>>(
    "query.query",
    { resource: "checkpoints" },
  )
  return result?.items ?? []
}

/**
 * 恢复到指定检查点：回滚当前存档的运行时状态 + workspace 文件到该检查点。
 * 成功返回恢复后的快照；失败（检查点不存在 / 无激活存档）抛出 error 对象，
 * 调用方按 PlatformActionResult.error 处理。
 *
 * 这是破坏性操作——UI 侧应做二次确认（对齐 DebugView.vue 的恢复确认习惯）。
 */
export async function restoreCheckpoint(
  bridge: Bridge,
  checkpointId: string,
): Promise<RuntimeSnapshotShell> {
  const result = await bridge.call<PlatformActionResult<RuntimeSnapshotShell>>(
    "platform.runAction",
    { action: "restore-checkpoint", params: { checkpointId } },
  )
  if (!result || !result.ok) {
    const err = result?.error
    const e = new Error(err?.message ?? "恢复检查点失败。")
    if (err) (e as Error & { code?: string }).code = err.code
    throw e
  }
  return result.item as RuntimeSnapshotShell
}
