// @tsian/play-bridge — createSessionHistory 数据层封装
//
// 从 workspace turn 文件重建完整玩家视角(正文 + 过程节点),不碰渲染.
// 内部通过 bridge.call("query.query") 调 host 的 "session-history" resource,
// host 一次返回全部 turn 的 SessionHistoryEntry[],无 N 次 RPC 往返.
//
// 游戏前端 `import { createBridge, createSessionHistory }` 即用:
//   const bridge = createBridge()
//   const history = await createSessionHistory(bridge)
//   // history.entries: SessionHistoryEntry[] — 按 turn 升序,含 timeline(TurnTimelineItem[])
//   // history.turn: number — 当前 turn 号(最大 turn + 1,即即将开始的轮)

import type { DeepQueryResult, SessionHistoryEntry } from "@tsian/contracts"
import type { Bridge } from "./bridge"

export interface SessionHistory {
  /** 按 turn 升序排列的完整会话历史(正文 + 过程节点).空存档为 []. */
  entries: SessionHistoryEntry[]
  /** 当前 turn 号(已完成的最大 turn + 1,即即将开始的轮).无 turn 文件时为 0. */
  turn: number
}

/**
 * 从 workspace turn 文件重建完整会话历史.
 * 一次 RPC 调用 host 的 "session-history" resource,host 内部读 turn 文件并拼合,
 * 前端无需逐文件 workspace.read(超长存档上千轮也不怕).
 *
 * 返回 { entries, turn }:entries 按 turn 升序,每个 entry 含 timeline(单一有序数组,
 * 含 user/assistant/interim/thought/tool/options 项);turn 是当前轮号(最大 turn + 1).
 *
 * 空存档/无 turn 文件 → { entries: [], turn: 0 }.
 */
export async function createSessionHistory(bridge: Bridge): Promise<SessionHistory> {
  const result = await bridge.call<DeepQueryResult<SessionHistoryEntry>>(
    "query.query",
    { resource: "session-history" },
  )
  const entries = result?.items ?? []
  const maxTurn = entries.reduce((max, entry) => Math.max(max, entry.turn), 0)
  return { entries, turn: maxTurn + 1 }
}
