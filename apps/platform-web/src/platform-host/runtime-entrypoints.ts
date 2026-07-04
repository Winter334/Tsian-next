import type { GameCardManifest } from "@tsian/contracts"
import { getLocalGameCard, listLocalSaves } from "../storage"

export function resolvePlayerTurnAgentIdFromManifest(manifest: GameCardManifest): string {
  const agentId = manifest.runtime?.entrypoints?.playerTurn?.trim()
  if (!agentId) {
    throw new Error(
      "game-card.json 缺少 runtime.entrypoints.playerTurn，无法解析玩家正式回合入口 Agent id。",
    )
  }
  return agentId
}

export async function resolvePlayerTurnAgentIdForSave(saveId: string): Promise<string> {
  const save = (await listLocalSaves()).find((item) => item.id === saveId)
  if (!save) {
    throw new Error(`存档 "${saveId}" 不存在，无法解析玩家正式回合入口。`)
  }

  const gameCardId = save.gameCardId?.trim()
  if (!gameCardId) {
    throw new Error(
      `存档 "${saveId}" 未绑定游戏卡，无法解析玩家正式回合入口。`,
    )
  }

  const card = await getLocalGameCard(gameCardId)
  if (!card) {
    throw new Error(
      `存档 "${saveId}" 绑定的游戏卡 "${gameCardId}" 不存在，无法解析玩家正式回合入口。`,
    )
  }

  return resolvePlayerTurnAgentIdFromManifest(card.manifest)
}
