import type {
  DeepQueryRequest,
  DeepQueryResult,
  GameCardRuntimeEntrypoints,
  PlayFrontendBridge,
} from "@tsian/contracts"
import { createDebugBridge } from "../bridge"
import { getActiveSaveId } from "../storage"
import { invokeAgent } from "./ai-invocation"
import { formatActiveFrontendId } from "./game-cards"
import { waitForPlatformHostReady } from "./host-state"
import { getPlatformActiveGameCard } from "./internal"
import { executePlatformAction } from "./platform-actions"
import { queryResource } from "./resource-queries"
import { sendMessage, stopRuntimeTurn } from "./runtime-turn"
import {
  listBridgeWorkspace,
  readBridgeWorkspace,
  searchBridgeWorkspace,
  writeBridgeWorkspace,
} from "./workspace-actions"

export const playFrontendBridge: PlayFrontendBridge = {
  platform: {
    async getPlatformContext() {
      const activeCard = await getPlatformActiveGameCard()
      return {
        version: "0.0.0",
        activeFrontendId: formatActiveFrontendId(activeCard?.manifest.frontend),
        activeSaveId: (await getActiveSaveId()) ?? undefined,
      }
    },

    async runAction(request) {
      return executePlatformAction(request)
    },
  },
  query: {
    async query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>> {
      return queryResource<T>(request)
    },
  },
  workspace: {
    read: readBridgeWorkspace,
    list: listBridgeWorkspace,
    search: searchBridgeWorkspace,
    write: writeBridgeWorkspace,
  },
  card: {
    /** 返回当前卡 runtime.entrypoints；卡未配置时返回空对象 {}。
     *  前端用它决定调用哪个 agent（如回合后维护入口），不硬编码 agent 名。 */
    async getEntrypoints(): Promise<GameCardRuntimeEntrypoints> {
      const activeCard = await getPlatformActiveGameCard()
      const entrypoints = activeCard?.manifest.runtime?.entrypoints
      if (!entrypoints) return {}
      // 只透出已声明的字段，避免 manifest 解析外的字段泄漏到前端。
      const result: GameCardRuntimeEntrypoints = {}
      if (entrypoints.playerTurn) result.playerTurn = entrypoints.playerTurn
      if (entrypoints.postTurnMaintenance) result.postTurnMaintenance = entrypoints.postTurnMaintenance
      return result
    },
  },
  interaction: {
    sendMessage,
    invokeAgent,
    /** 中断当前正在进行的 turn（流式输出/工具执行）。
     *  abort 触发后，sendMessage 的 promise 会以 AbortError reject，
     *  前端 onTurnEnd 不会触发——由 useTsian.stop 负责把前端状态切回 standby。
     *  无 turn 进行中时空操作（幂等）。 */
    stop: stopRuntimeTurn,
  },
  debug: createDebugBridge(),
}


export {
  runAssistantChat,
  type AssistantChatInput,
  type AssistantChatResult,
} from "./assistant-chat"
export {
  setPlatformGameCardCover,
  type PlatformGameCardCoverInput,
} from "./covers"
export {
  listPlatformWorkspaceDirectory,
  listPlatformWorkspaceRoots,
  searchPlatformWorkspace,
  readPlatformWorkspaceFile,
  writePlatformWorkspaceFile,
  deletePlatformWorkspacePath,
  copyPlatformWorkspacePath,
  movePlatformWorkspacePath,
  validatePlatformWorkspaceFile,
  type PlatformWorkspaceRootEntry,
} from "./workspace-ops"
export {
  getPlatformStudioSnapshot,
  getPlatformStudioAgentContext,
  getPlatformStudioSkillDetail,
  writePlatformStudioAgentFile,
  updatePlatformStudioAgentSkillEnabled,
  deletePlatformStudioSkill,
  updatePlatformStudioAgentPlatformToolEnabled,
  updatePlatformStudioAgentToolEnabled,
  updatePlatformStudioAgentWorkspaceAccess,
  updatePlatformStudioAgentProviderPreset,
  updatePlatformStudioAgentContextPaths,
  updatePlatformStudioAgentModuleEnabled,
  isPlatformStudioToolEnabledForAgent,
  type PlatformStudioSnapshot,
  type PlatformStudioProviderPresetOption,
  type PlatformStudioAgentFileWriteInput,
  type PlatformStudioAgentSkillToggleInput,
  type PlatformStudioAgentSkillDeleteInput,
  type PlatformStudioAgentPlatformToolToggleInput,
  type PlatformStudioAgentToolToggleInput,
  type PlatformStudioAgentWorkspaceAccessInput,
  type PlatformStudioAgentProviderPresetInput,
  type PlatformStudioAgentContextPathsUpdateInput,
  type PlatformStudioAgentModuleToggleInput,
  type PlatformStudioModuleInfo,
} from "./studio-agents"
export {
  getLocalAssistantProviderPreset,
  updateLocalAssistantProviderPreset,
  updateLocalAssistantModel,
  getLocalAssistantConfig,
  refreshLocalAssistantKnowledge,
  updateLocalAssistantSkillEnabled,
  updateLocalAssistantSkillConfig,
  updateLocalAssistantPlatformToolEnabled,
  updateLocalAssistantToolEnabled,
  updateLocalAssistantWorkspaceAccess,
  getLocalAssistantToolCallMode,
  type LocalAssistantConfig,
  type LocalAssistantSkillToggleInput,
  type LocalAssistantPlatformToolToggleInput,
  type LocalAssistantToolToggleInput,
} from "./local-assistant"
export {
  initializePlatformHost,
  listPlatformSaves,
  createPlatformSave,
  listPlatformGameCards,
  getPlatformGameCard,
  updatePlatformGameCardMetadata,
  copyPlatformGameCardAsLocal,
  createDefaultPlatformGameCard,
  deletePlatformGameCard,
  listPlatformGameCardFrontendFiles,
  updatePlatformGameCardFrontend,
  importPlatformGameCardPackage,
  inspectPlatformGameCardPackage,
  exportPlatformGameCardPackage,
  importPlatformGameCardFrontendPackage,
  exportPlatformGameCardFrontendPackage,
  createPlatformSaveFromGameCard,
  selectPlatformSave,
  renamePlatformSave,
  updatePlatformSaveGameCardVersion,
  deletePlatformSave,
  getPlatformActiveSaveId,
  getPlatformActiveGameCardId,
  setPlatformActiveGameCard,
  type PlatformGameCardFrontendFileSummary,
  type PlatformGameCardMetadataInput,
  type PlatformGameCardCopyInput,
  type PlatformGameCardDeleteResult,
} from "./game-cards"
export {
  WORKSHOP_GAME_CARD_UPDATE_MIN_INTERVAL_MS,
  WORKSHOP_GAME_CARD_UPDATE_RESUME_INTERVAL_MS,
  gameCardMarketOriginFromPackage,
  getWorkshopGameCardUpdate,
  hasWorkshopGameCardUpdates,
  installWorkshopGameCardUpdate,
  refreshWorkshopGameCardUpdates,
  workshopGameCardUpdateCount,
  workshopGameCardUpdates,
  workshopGameCardUpdatesChecking,
  workshopGameCardUpdatesLastErrorMessage,
  workshopGameCardUpdatesLastSuccessfulCheckAt,
  type WorkshopGameCardUpdateInfo,
  type WorkshopGameCardUpdateRefreshOptions,
} from "./game-card-updates"
export {
  exportAgentPackage,
  exportSkillPackage,
  exportToolPackage,
  inspectResourcePackage,
  installAgentPackage,
  installSkillPackage,
  installToolPackage,
  replaceCardContentDirectory,
  replaceAssistantDefinition,
  replaceAssistantSkillDirectory,
  replaceAssistantToolDirectory,
  type AgentPackageSource,
  type SkillPackageSource,
  type ToolPackageSource,
  type AgentInstallTarget,
  type SkillInstallTarget,
  type ToolInstallTarget,
  type ResourcePackageInspection,
} from "./resource-packages"
export {
  backupPlatformSaveToCloud,
  CloudBackupConflictError,
  deleteCloudBackup,
  deleteCloudBackupForSave,
  exportPlatformSaveBackup,
  importPlatformSaveBackup,
  listAllCloudBackups,
  listCloudBackupsForCard,
  pullCloudBackupToLocal,
  scheduleAutoBackupForSave,
} from "./cloud-backups"
export { getPlatformActiveGameCard, waitForPlatformHostReady }
