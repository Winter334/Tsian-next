import type { SkillRegistryEntry, ToolRegistryEntry, WorkspaceFile } from "@tsian/contracts"
import { computed, ref, type Ref } from "vue"
import { buildAgentRegistry, buildSkillRegistry, buildToolRegistry } from "@/agent-runtime/registry"
import type {
  AgentUploadOption,
  MarketInstallTargetOption,
  MarketUploadMetadata,
  MarketUploadSelectionPayload,
  SkillUploadOption,
  ToolUploadOption,
} from "@/components/market/types"
import { getPlatformActiveGameCard, listPlatformGameCards } from "@/platform-host"
import {
  listLocalGameCardContentFiles,
  loadLocalAssistantFiles,
  LOCAL_ASSISTANT_AGENT_ID,
} from "@/storage"
import type { LocalGameCardView } from "@/storage/game-cards"

export function useMarketInventory(errorMessage: Ref<string>) {
  const uploadCards = ref<LocalGameCardView[]>([])
  const localCards = ref<LocalGameCardView[]>([])
  const cardFilesById = ref<Record<string, WorkspaceFile[]>>({})
  const assistantFiles = ref<WorkspaceFile[]>([])
  const localResourcesLoading = ref(false)
  let requestSeq = 0

  const agentUploadOptions = computed<AgentUploadOption[]>(() => {
    const options: AgentUploadOption[] = []
    for (const card of localCards.value) {
      for (const agent of buildAgentRegistry(cardFilesById.value[card.id] ?? [])) {
        options.push({
          key: `card:${card.id}:${agent.id}`,
          label: `${agent.title} · ${card.manifest.name || card.id}`,
          summary: agent.summary,
          resourceId: agent.id,
          source: { kind: "card-agent", cardId: card.id, agentId: agent.id },
        })
      }
    }
    const assistant = buildAgentRegistry(assistantFiles.value)
      .find((agent) => agent.id === LOCAL_ASSISTANT_AGENT_ID)
    if (assistant) {
      options.push({
        key: "assistant",
        label: `${assistant.title} · 桌面助手`,
        summary: assistant.summary,
        resourceId: assistant.id,
        source: { kind: "assistant" },
      })
    }
    return options
  })

  const skillUploadOptions = computed<SkillUploadOption[]>(() => {
    const options: SkillUploadOption[] = []
    for (const card of localCards.value) {
      for (const skill of buildSkillRegistry(cardFilesById.value[card.id] ?? [])) {
        options.push(skillUploadOptionFromRegistry(skill, card))
      }
    }
    for (const skill of buildSkillRegistry(assistantFiles.value, {
      includeShared: false,
      includeLocal: true,
      agentId: LOCAL_ASSISTANT_AGENT_ID,
    })) {
      options.push({
        key: `assistant:${skill.id}`,
        label: `${skill.title} · 桌面助手`,
        summary: skill.summary,
        resourceId: skill.id,
        source: { kind: "assistant-local", skillId: skill.id, skillPath: skill.path },
      })
    }
    return options
  })

  const toolUploadOptions = computed<ToolUploadOption[]>(() => {
    const options: ToolUploadOption[] = []
    for (const card of localCards.value) {
      for (const tool of buildToolRegistry(cardFilesById.value[card.id] ?? []).tools) {
        options.push(toolUploadOptionFromRegistry(tool, card))
      }
    }
    for (const tool of buildToolRegistry(assistantFiles.value).tools) {
      if (tool.scope !== "agent-local"
        || tool.agentId !== LOCAL_ASSISTANT_AGENT_ID
        || !tool.path.startsWith(".tsian/local/assistant/tools/")) continue
      options.push({
        key: `assistant:${tool.id}`,
        label: `${tool.title} · 桌面助手`,
        summary: tool.description,
        resourceId: tool.id,
        source: { kind: "assistant-local", toolId: tool.id, toolPath: tool.path },
      })
    }
    return options
  })

  async function loadUploadResources(): Promise<void> {
    const requestId = ++requestSeq
    localResourcesLoading.value = true
    try {
      const [loadedCards, loadedActiveCard, loadedAssistantFiles] = await Promise.all([
        listPlatformGameCards(),
        getPlatformActiveGameCard(),
        loadLocalAssistantFiles(),
      ])
      if (requestId !== requestSeq) return
      const allCards = loadedCards.filter((card) => card.source !== "builtin")
      const activeCard = activeInstallTargetCards(loadedActiveCard)
      const cardsToLoad = cardsById([...allCards, ...activeCard])
      const filesEntries = await loadCardFiles(cardsToLoad)
      if (requestId !== requestSeq) return
      uploadCards.value = allCards
      localCards.value = activeCard
      cardFilesById.value = Object.fromEntries(filesEntries)
      assistantFiles.value = loadedAssistantFiles
    } catch (error) {
      if (requestId === requestSeq) {
        errorMessage.value = error instanceof Error ? error.message : "读取本地资源失败。"
      }
    } finally {
      if (requestId === requestSeq) localResourcesLoading.value = false
    }
  }

  async function loadInstallResources(): Promise<void> {
    const requestId = ++requestSeq
    localResourcesLoading.value = true
    try {
      const [loadedActiveCard, loadedAssistantFiles] = await Promise.all([
        getPlatformActiveGameCard(),
        loadLocalAssistantFiles(),
      ])
      if (requestId !== requestSeq) return
      const cards = activeInstallTargetCards(loadedActiveCard)
      const filesEntries = await loadCardFiles(cards)
      if (requestId !== requestSeq) return
      localCards.value = cards
      cardFilesById.value = Object.fromEntries(filesEntries)
      assistantFiles.value = loadedAssistantFiles
    } catch (error) {
      if (requestId === requestSeq) {
        errorMessage.value = error instanceof Error ? error.message : "读取本地资源失败。"
      }
    } finally {
      if (requestId === requestSeq) localResourcesLoading.value = false
    }
  }

  function dispose(): void {
    requestSeq++
    localResourcesLoading.value = false
  }

  function uploadMetadataDefaults(selection: MarketUploadSelectionPayload): MarketUploadMetadata {
    if (selection.resourceType === "game_card") {
      const card = uploadCards.value.find((candidate) => candidate.id === selection.cardId)
      return {
        title: card?.manifest.name ?? "",
        summary: card?.manifest.summary ?? "",
        author: card?.manifest.author?.name ?? "",
        version: card?.manifest.version ?? "",
      }
    }
    if (selection.resourceType === "agent") {
      const option = agentUploadOptions.value.find((candidate) => sameAgentSource(candidate.source, selection.source))
      return { title: option?.label ?? "", summary: option?.summary ?? "", version: "0.1.0" }
    }
    if (selection.resourceType === "skill") {
      const option = skillUploadOptions.value.find((candidate) => sameSkillSource(candidate.source, selection.source))
      return { title: option?.label ?? "", summary: option?.summary ?? "", version: "0.1.0" }
    }
    const option = toolUploadOptions.value.find((candidate) => sameToolSource(candidate.source, selection.source))
    return { title: option?.label ?? "", summary: option?.summary ?? "", version: "0.1.0" }
  }

  function replacementSelectionLabel(selection: MarketUploadSelectionPayload): string {
    if (selection.resourceType === "game_card") {
      const card = uploadCards.value.find((candidate) => candidate.id === selection.cardId)
      return card?.manifest.name || card?.manifest.id || "游戏卡"
    }
    if (selection.resourceType === "agent") {
      return agentUploadOptions.value.find((candidate) => sameAgentSource(candidate.source, selection.source))?.label ?? "Agent"
    }
    if (selection.resourceType === "skill") {
      return skillUploadOptions.value.find((candidate) => sameSkillSource(candidate.source, selection.source))?.label ?? "Skill"
    }
    return toolUploadOptions.value.find((candidate) => sameToolSource(candidate.source, selection.source))?.label ?? "Tool"
  }

  function buildInstallOptions(resourceType: "agent" | "skill" | "tool", resourceId: string): MarketInstallTargetOption[] {
    if (resourceType === "agent") {
      return [
        ...localCards.value.map((card) => {
          const exists = (cardFilesById.value[card.id] ?? []).some((file) => file.path === `agents/${resourceId}/agent.json`)
          return {
            key: `card:${card.id}`,
            label: `安装到游戏卡：${card.manifest.name || card.id}`,
            description: exists ? "已存在同 id Agent，将替换安装。" : "写入该卡的 agents/ 目录。",
            requiresConfirm: exists,
            confirmTitle: "替换 Agent",
            confirmMessage: `游戏卡「${card.manifest.name || card.id}」中已存在 Agent「${resourceId}」。替换会删除旧目录后写入新资源。`,
            resourceType: "agent" as const,
            target: { kind: "card" as const, cardId: card.id },
          }
        }),
        {
          key: "assistant",
          label: "覆盖桌面助手",
          description: "替换助手定义、skills 和 tools，保留 sessions/traces/notes。",
          severity: "danger" as const,
          requiresConfirm: true,
          confirmTitle: "覆盖桌面助手",
          confirmMessage: "将替换当前桌面助手定义、skills 和 tools，保留会话、trace 和 notes。此操作无法自动撤销。",
          resourceType: "agent" as const,
          target: { kind: "assistant" as const },
        },
      ]
    }
    return resourceType === "skill" ? buildSkillInstallOptions(resourceId) : buildToolInstallOptions(resourceId)
  }

  function buildSkillInstallOptions(resourceId: string): MarketInstallTargetOption[] {
    return [
      ...localCards.value.flatMap((card) => {
        const files = cardFilesById.value[card.id] ?? []
        const options: MarketInstallTargetOption[] = [{
          key: `card-shared:${card.id}`,
          label: `安装到卡共享：${card.manifest.name || card.id}`,
          description: files.some((file) => file.path === `skills/${resourceId}/SKILL.md`)
            ? "共享 Skill 已存在，将替换安装。" : "写入该卡的 skills/ 目录。",
          requiresConfirm: files.some((file) => file.path === `skills/${resourceId}/SKILL.md`),
          confirmTitle: "替换共享 Skill",
          confirmMessage: `游戏卡「${card.manifest.name || card.id}」中已存在共享 Skill「${resourceId}」。替换会删除旧目录后写入新资源。`,
          resourceType: "skill",
          target: { kind: "card-shared", cardId: card.id },
        }]
        for (const agent of buildAgentRegistry(files)) {
          const exists = files.some((file) => file.path === `agents/${agent.id}/skills/${resourceId}/SKILL.md`)
          options.push({
            key: `agent-local:${card.id}:${agent.id}`,
            label: `安装到 ${agent.title}：${card.manifest.name || card.id}`,
            description: exists ? "Agent-local Skill 已存在，将替换安装。" : "写入该 Agent 的 skills/ 目录。",
            requiresConfirm: exists,
            confirmTitle: "替换 Agent Skill",
            confirmMessage: `Agent「${agent.title}」中已存在 Skill「${resourceId}」。替换会删除旧目录后写入新资源。`,
            resourceType: "skill",
            target: { kind: "agent-local", cardId: card.id, agentId: agent.id },
          })
        }
        return options
      }),
      {
        key: "assistant-local",
        label: "安装到桌面助手",
        description: "写入桌面助手的本地 skills/ 目录。",
        requiresConfirm: assistantFiles.value.some((file) => file.path === `.tsian/local/assistant/skills/${resourceId}/SKILL.md`),
        confirmTitle: "替换助手 Skill",
        confirmMessage: `桌面助手中已存在 Skill「${resourceId}」。替换会删除旧目录后写入新资源。`,
        resourceType: "skill",
        target: { kind: "assistant-local" },
      },
    ]
  }

  function buildToolInstallOptions(resourceId: string): MarketInstallTargetOption[] {
    return [
      ...localCards.value.flatMap((card) => {
        const files = cardFilesById.value[card.id] ?? []
        const existsShared = files.some((file) => file.path === `tools/${resourceId}/tool.json`)
        const options: MarketInstallTargetOption[] = [{
          key: `tool-card-shared:${card.id}`,
          label: `安装到卡共享：${card.manifest.name || card.id}`,
          description: existsShared ? "共享 Tool 已存在，将替换安装。" : "写入该卡的 tools/ 目录。",
          requiresConfirm: existsShared,
          confirmTitle: "替换共享 Tool",
          confirmMessage: `游戏卡「${card.manifest.name || card.id}」中已存在共享 Tool「${resourceId}」。替换会删除旧目录后写入新资源。`,
          resourceType: "tool",
          target: { kind: "card-shared", cardId: card.id },
        }]
        for (const agent of buildAgentRegistry(files)) {
          const exists = files.some((file) => file.path === `agents/${agent.id}/tools/${resourceId}/tool.json`)
          options.push({
            key: `tool-agent-local:${card.id}:${agent.id}`,
            label: `安装到 ${agent.title}：${card.manifest.name || card.id}`,
            description: exists ? "Agent-local Tool 已存在，将替换安装。" : "写入该 Agent 的 tools/ 目录。",
            requiresConfirm: exists,
            confirmTitle: "替换 Agent Tool",
            confirmMessage: `Agent「${agent.title}」中已存在 Tool「${resourceId}」。替换会删除旧目录后写入新资源。`,
            resourceType: "tool",
            target: { kind: "agent-local", cardId: card.id, agentId: agent.id },
          })
        }
        return options
      }),
      {
        key: "tool-assistant-local",
        label: "安装到桌面助手",
        description: "写入桌面助手的本地 tools/ 目录。",
        requiresConfirm: assistantFiles.value.some((file) => file.path === `.tsian/local/assistant/tools/${resourceId}/tool.json`),
        confirmTitle: "替换助手 Tool",
        confirmMessage: `桌面助手中已存在 Tool「${resourceId}」。替换会删除旧目录后写入新资源。`,
        resourceType: "tool",
        target: { kind: "assistant-local" },
      },
    ]
  }

  return {
    uploadCards,
    localCards,
    cardFilesById,
    assistantFiles,
    localResourcesLoading,
    agentUploadOptions,
    skillUploadOptions,
    toolUploadOptions,
    loadUploadResources,
    loadInstallResources,
    uploadMetadataDefaults,
    replacementSelectionLabel,
    buildInstallOptions,
    dispose,
  }
}

async function loadCardFiles(cards: LocalGameCardView[]): Promise<readonly (readonly [string, WorkspaceFile[]])[]> {
  return Promise.all(cards.map(async (card) => [
    card.id,
    (await listLocalGameCardContentFiles(card.id)).map(contentFileToWorkspaceFile),
  ] as const))
}

export function activeInstallTargetCards(card: LocalGameCardView | null): LocalGameCardView[] {
  return !card || card.source === "builtin" ? [] : [card]
}

export function cardsById(cards: LocalGameCardView[]): LocalGameCardView[] {
  const seen = new Set<string>()
  return cards.filter((card) => !seen.has(card.id) && Boolean(seen.add(card.id)))
}

export function contentFileToWorkspaceFile(file: {
  path: string
  content: string
  data?: Blob
  createdAt: number
  updatedAt: number
}): WorkspaceFile {
  return {
    path: file.path,
    content: file.content,
    ...(file.data ? { binary: file.data } : {}),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

export function sameAgentSource(left: AgentUploadOption["source"], right: AgentUploadOption["source"]): boolean {
  return left.kind === "assistant"
    ? right.kind === "assistant"
    : right.kind === "card-agent" && left.cardId === right.cardId && left.agentId === right.agentId
}

export function sameSkillSource(left: SkillUploadOption["source"], right: SkillUploadOption["source"]): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === "assistant-local" && right.kind === "assistant-local") {
    return left.skillId === right.skillId && left.skillPath === right.skillPath
  }
  if (left.kind === "agent-local" && right.kind === "agent-local") {
    return left.cardId === right.cardId && left.agentId === right.agentId
      && left.skillId === right.skillId && left.skillPath === right.skillPath
  }
  return left.kind === "card-shared" && right.kind === "card-shared"
    && left.cardId === right.cardId && left.skillId === right.skillId && left.skillPath === right.skillPath
}

export function sameToolSource(left: ToolUploadOption["source"], right: ToolUploadOption["source"]): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === "assistant-local" && right.kind === "assistant-local") {
    return left.toolId === right.toolId && left.toolPath === right.toolPath
  }
  if (left.kind === "agent-local" && right.kind === "agent-local") {
    return left.cardId === right.cardId && left.agentId === right.agentId
      && left.toolId === right.toolId && left.toolPath === right.toolPath
  }
  return left.kind === "card-shared" && right.kind === "card-shared"
    && left.cardId === right.cardId && left.toolId === right.toolId && left.toolPath === right.toolPath
}

function skillUploadOptionFromRegistry(skill: SkillRegistryEntry, card: LocalGameCardView): SkillUploadOption {
  return {
    key: `card:${card.id}:${skill.path}`,
    label: `${skill.title} · ${card.manifest.name || card.id}`,
    summary: skill.summary,
    resourceId: skill.id,
    source: skill.scope === "agent-local" && skill.agentId
      ? { kind: "agent-local", cardId: card.id, agentId: skill.agentId, skillId: skill.id, skillPath: skill.path }
      : { kind: "card-shared", cardId: card.id, skillId: skill.id, skillPath: skill.path },
  }
}

function toolUploadOptionFromRegistry(tool: ToolRegistryEntry, card: LocalGameCardView): ToolUploadOption {
  return {
    key: `card:${card.id}:${tool.path}`,
    label: `${tool.title} · ${card.manifest.name || card.id}`,
    summary: tool.description,
    resourceId: tool.id,
    source: tool.scope === "agent-local" && tool.agentId
      ? { kind: "agent-local", cardId: card.id, agentId: tool.agentId, toolId: tool.id, toolPath: tool.path }
      : { kind: "card-shared", cardId: card.id, toolId: tool.id, toolPath: tool.path },
  }
}
