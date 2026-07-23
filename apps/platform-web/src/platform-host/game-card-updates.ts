import type { MarketPackage } from "@tsian/contracts"
import { computed, readonly, ref } from "vue"
import type { LocalGameCardMarketOrigin, LocalGameCardRecord } from "../storage"
import { inspectGameCardPackage, listLocalGameCards, type LocalGameCardView } from "../storage"
import { marketApi } from "./api-client"
import { importPlatformGameCardPackage } from "./game-cards"

export const WORKSHOP_GAME_CARD_UPDATE_MIN_INTERVAL_MS = 60_000
export const WORKSHOP_GAME_CARD_UPDATE_RESUME_INTERVAL_MS = 10 * 60_000

export interface WorkshopGameCardUpdateInfo {
  cardId: string
  packageId: string
  resourceId: string
  currentVersion: string
  latestVersion: string
  marketPackage: MarketPackage
}

export interface WorkshopGameCardUpdateRefreshOptions {
  force?: boolean
  minIntervalMs?: number
}

const updatesByCardId = ref<Map<string, WorkshopGameCardUpdateInfo>>(new Map())
const checking = ref(false)
const lastSuccessfulCheckAt = ref(0)
const lastErrorMessage = ref("")
let inFlightRefresh: Promise<void> | null = null

export const workshopGameCardUpdates = computed(() =>
  Array.from(updatesByCardId.value.values()).sort((left, right) => left.cardId.localeCompare(right.cardId))
)
export const workshopGameCardUpdateCount = computed(() => updatesByCardId.value.size)
export const hasWorkshopGameCardUpdates = computed(() => updatesByCardId.value.size > 0)
export const workshopGameCardUpdatesChecking = readonly(checking)
export const workshopGameCardUpdatesLastSuccessfulCheckAt = readonly(lastSuccessfulCheckAt)
export const workshopGameCardUpdatesLastErrorMessage = readonly(lastErrorMessage)

export function gameCardMarketOriginFromPackage(pkg: MarketPackage): LocalGameCardMarketOrigin {
  if (pkg.resourceType !== "game_card") {
    throw new Error("只有创意工坊游戏卡资源可以记录游戏卡来源。")
  }
  return {
    packageId: requireMarketText(pkg.id),
    resourceId: requireMarketText(pkg.resourceId),
    resourceVersion: requireMarketText(pkg.resourceVersion),
  }
}

export function getWorkshopGameCardUpdate(cardId: string): WorkshopGameCardUpdateInfo | null {
  const id = cardId.trim()
  return id ? updatesByCardId.value.get(id) ?? null : null
}

export async function refreshWorkshopGameCardUpdates(
  options: WorkshopGameCardUpdateRefreshOptions = {},
): Promise<void> {
  if (inFlightRefresh) {
    if (!options.force) {
      return inFlightRefresh
    }
    await inFlightRefresh
  }

  const minIntervalMs = options.minIntervalMs ?? WORKSHOP_GAME_CARD_UPDATE_MIN_INTERVAL_MS
  const lastCheckedAt = lastSuccessfulCheckAt.value
  if (!options.force && lastCheckedAt > 0 && Date.now() - lastCheckedAt < minIntervalMs) {
    return
  }

  checking.value = true
  const refresh = runRefreshWorkshopGameCardUpdates()
  inFlightRefresh = refresh
  try {
    await refresh
  } finally {
    if (inFlightRefresh === refresh) {
      inFlightRefresh = null
      checking.value = false
    }
  }
}

export async function installWorkshopGameCardUpdate(
  update: WorkshopGameCardUpdateInfo,
): Promise<LocalGameCardRecord> {
  const latestPackage = await marketApi.get(update.marketPackage.id)
  const blob = await marketApi.download(latestPackage.id)
  const inspection = await inspectGameCardPackage(blob)
  if (inspection.manifest.id !== update.cardId) {
    throw new Error("新版卡包与本地游戏卡不匹配，无法更新。")
  }
  const imported = await importPlatformGameCardPackage(blob, {
    marketOrigin: gameCardMarketOriginFromPackage(latestPackage),
  })
  await refreshWorkshopGameCardUpdates({ force: true })
  return imported
}

async function runRefreshWorkshopGameCardUpdates(): Promise<void> {
  try {
    const cards = await listLocalGameCards()
    const cardsWithOrigin = cards
      .map((card) => ({ card, origin: normalizedMarketOrigin(card.marketOrigin) }))
      .filter((entry): entry is { card: LocalGameCardView; origin: LocalGameCardMarketOrigin } => entry.origin !== null)

    const results = await Promise.all(cardsWithOrigin.map(async ({ card, origin }) => {
      const pkg = await marketApi.get(origin.packageId)
      return updateInfoForCard(card, origin, pkg)
    }))

    const next = new Map<string, WorkshopGameCardUpdateInfo>()
    for (const update of results) {
      if (update) {
        next.set(update.cardId, update)
      }
    }
    updatesByCardId.value = next
    lastSuccessfulCheckAt.value = Date.now()
    lastErrorMessage.value = ""
  } catch (error) {
    lastErrorMessage.value = error instanceof Error ? error.message : "创意工坊更新检测失败。"
  }
}

function updateInfoForCard(
  card: LocalGameCardRecord,
  origin: LocalGameCardMarketOrigin,
  pkg: MarketPackage,
): WorkshopGameCardUpdateInfo | null {
  if (pkg.resourceType !== "game_card") {
    return null
  }
  const currentVersion = origin.resourceVersion.trim()
  const latestVersion = pkg.resourceVersion.trim()
  if (!currentVersion || !latestVersion || currentVersion === latestVersion) {
    return null
  }
  return {
    cardId: card.id,
    packageId: origin.packageId,
    resourceId: origin.resourceId,
    currentVersion,
    latestVersion,
    marketPackage: pkg,
  }
}

function normalizedMarketOrigin(origin: LocalGameCardMarketOrigin | undefined): LocalGameCardMarketOrigin | null {
  if (!origin) {
    return null
  }
  const packageId = origin.packageId.trim()
  const resourceId = origin.resourceId.trim()
  const resourceVersion = origin.resourceVersion.trim()
  if (!packageId || !resourceId || !resourceVersion) {
    return null
  }
  return { packageId, resourceId, resourceVersion }
}

function requireMarketText(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("创意工坊资源版本信息不完整。")
  }
  return trimmed
}
