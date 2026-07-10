/**
 * 过渡载体：承载本次未单独拆出、但被已拆子模块（assistant-chat / covers /
 * workspace-ops）依赖的私有 helper。后续任务会按接缝继续从这里抽走 game-cards /
 * history-turns / studio-agents / local-assistant，最终本文件清空删除。
 *
 * 依赖方向单向：internal.ts 只 import 外部模块（../storage、../agent-runtime、
 * ../config/ai、@tsian/contracts），不 import ./index 或其他子模块，无循环依赖。
 *
 * 详见任务 06-22-split-platform-host-index 的 design.md。
 */

import { blobToWorkspaceFile } from "@/lib/workspace-blob"
import type {
  AgentRegistryEntry,
  WorkspaceFile,
  WorkspaceScope,
} from "@tsian/contracts"
import { buildAgentRegistry } from "../agent-runtime/registry"
import {
  resolveBrowserAiConfigForProviderId,
  type BrowserAiConfig,
} from "../config/ai"
import {
  deleteLocalGameCardContentPathForCard,
  deleteLocalGameCardFrontendPathForCard,
  getActiveGameCardId,
  getLocalGameCard,
  initializeWorkspaceForSave,
  listEffectiveWorkspaceFilesForSave,
  listLocalGameCardContentFiles,
  listLocalSaves,
  setActiveGameCardId,
  writeLocalGameCardContentFile,
  writeLocalGameCardFrontendFile,
  toWorkspaceFileFromGameCardContent,
  type LocalGameCardRecord,
  type LocalSaveRecord,
} from "../storage"

// ── 纯工具 ──

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalizeMessageContent(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

// ── Save / Card 编排 ──

export async function gameCardForSave(save: LocalSaveRecord): Promise<LocalGameCardRecord | null> {
  const cardId = save.gameCardId?.trim()
  if (!cardId) {
    return null
  }

  const card = await getLocalGameCard(cardId)
  return card?.source === "builtin" ? null : card
}

async function gameCardForSaveId(saveId: string): Promise<LocalGameCardRecord | null> {
  const save = (await listLocalSaves()).find((item) => item.id === saveId)
  return save ? gameCardForSave(save) : null
}

export async function ensureActiveGameCardId(): Promise<string | null> {
  const existingId = await getActiveGameCardId()
  if (!existingId) {
    return null
  }

  const existing = await getLocalGameCard(existingId)
  if (existing && existing.source !== "builtin") {
    return existing.id
  }

  await setActiveGameCardId(null)
  return null
}

export async function listEffectiveWorkspaceFilesForActiveSave(saveId: string): Promise<WorkspaceFile[]> {
  const sourceCard = await gameCardForSaveId(saveId)
  if (!sourceCard) {
    return []
  }

  await initializeWorkspaceForSave(saveId)
  return listEffectiveWorkspaceFilesForSave(saveId, sourceCard)
}

export async function cardContentFilesToWorkspaceFiles(
  card: NonNullable<Awaited<ReturnType<typeof getLocalGameCard>>>,
): Promise<WorkspaceFile[]> {
  const files = await listLocalGameCardContentFiles(card.id)
  return files.map(toWorkspaceFileFromGameCardContent)
}

// ── 卡片内容文件写入/删除 ──

export async function writeCardContentFileForCard(
  cardId: string,
  input: {
    path: string
    content?: string
    data?: Blob
  },
): Promise<WorkspaceFile> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  // Single-file per-row write; writeLocalGameCardContentFile bumps the card's
  // updatedAt internally (no whole-card putLocalGameCard rewrite).
  const file = await writeLocalGameCardContentFile(cardId, {
    path: input.path,
    ...(input.data ? { data: input.data } : { content: input.content ?? "" }),
  })

  return toWorkspaceFileFromGameCardContent(file)
}

export async function writeCardContentFileForActiveCard(input: {
  path: string
  content?: string
  data?: Blob
}): Promise<WorkspaceFile> {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。")
  }

  const file = await writeLocalGameCardContentFile(activeCard.id, {
    path: input.path,
    ...(input.data ? { data: input.data } : { content: input.content ?? "" }),
  })

  return toWorkspaceFileFromGameCardContent(file)
}

export async function deleteCardContentPathForActiveCard(
  path: string,
): Promise<{ scope: WorkspaceScope; deletedPaths: string[] }> {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。")
  }

  const deletedPaths = await deleteLocalGameCardContentPathForCard(activeCard.id, path)
  return {
    scope: "card-content",
    deletedPaths,
  }
}

// ── 卡片前端文件写入/删除 ──
// Mirrors the card-content helpers above but for the `card-frontend` scope
// (`frontend/**`). Used by the assistant workspace write/delete path so the
// assistant can edit `frontend/src/**` source and trigger the platform rebuild
// (R6). Phase 4 wired the rebuild trigger on `frontend/src/**` writes but the
// assistant write channel for `card-frontend` was missing — these helpers +
// the assistant-chat `card-frontend` branches close that gap.

export async function writeFrontendFileForActiveCard(input: {
  path: string
  content?: string
  data?: Blob
}): Promise<WorkspaceFile> {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。")
  }

  const file = await writeLocalGameCardFrontendFile(activeCard.id, {
    path: input.path,
    // writeLocalGameCardFrontendFile's input takes `data` (Blob | ArrayBuffer |
    // Uint8Array | string), not a separate `content` field — wrap text content
    // as a string payload (the storage layer's toBlob infers media type from
    // the path extension).
    data: input.data ?? input.content ?? "",
  })

  return blobToWorkspaceFile({
    path: file.path,
    blob: file.data,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  })
}

export async function deleteFrontendPathForActiveCard(
  path: string,
): Promise<{ scope: WorkspaceScope; deletedPaths: string[] }> {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。")
  }

  const deletedPaths = await deleteLocalGameCardFrontendPathForCard(activeCard.id, path)
  return {
    scope: "card-frontend",
    deletedPaths,
  }
}

// ── 激活游戏卡访问 ──

export async function getPlatformActiveGameCard() {
  const activeCardId = await ensureActiveGameCardId()
  if (!activeCardId) {
    return null
  }

  return getLocalGameCard(activeCardId)
}

// ── Agent 配置 ──

export function buildAgentProviderPresetMap(
  files: WorkspaceFile[],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const agent of buildAgentRegistry(files)) {
    if (agent.providerPresetId) {
      map.set(agent.id, agent.providerPresetId)
    }
  }
  return map
}

export function resolveAgentModelConfig(
  agentId: string | undefined,
  presetMap: Map<string, string>,
): BrowserAiConfig | null {
  if (!agentId) {
    return null
  }
  const presetId = presetMap.get(agentId)
  if (!presetId) {
    return null
  }
  return resolveBrowserAiConfigForProviderId(presetId)
}
