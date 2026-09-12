import type { TsianApi, InjectionMessage } from "@tsian/play-bridge"
import { buildOpeningInjection, openingModelMarker, type OpeningInterviewControl } from "./opening-interview"
import { prepareMaintenanceContext, verifyMaintenance } from "./maintenance-context"

import { buildStorySourceMaterial } from "./story-source"

export const OPENING_STATE_PATH = "save/playthrough/opening-state.json"
export interface OpeningProposal { protagonist: string; startingPoint: string; openingFocus: string; constraints: string[] }
export interface OpeningState {
  sessionId: string
  proposalId: string
  proposal: OpeningProposal
  approved: boolean
  model: { id: string; files: Record<string, string> } | null
  published?: boolean
  complete?: boolean
  storyAttempt?: number
}
type Doc = Record<string, unknown>
const object = (value: unknown): Doc => value && typeof value === "object" && !Array.isArray(value) ? value as Doc : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

export async function readOpeningState(workspace: TsianApi["workspace"], sessionId: string): Promise<OpeningState | null> {
  const file = await workspace.read(OPENING_STATE_PATH, "save-runtime")
  if (!file) return null
  const state = JSON.parse(file.content) as OpeningState
  if (state.sessionId !== sessionId || !state.proposalId || !state.proposal || typeof state.approved !== "boolean"
    || (state.model && (typeof state.model.id !== "string" || !state.model.files))) throw new Error("当前开局方案或资料状态无效。")
  return state
}

/** Initial entities deliberately do not exist yet. Confirmed premises + source suffice. */
export async function buildOpeningStoryMaterial(workspace: TsianApi["workspace"], state: OpeningState): Promise<InjectionMessage[]> {
  if (!state.model) throw new Error("世界适配尚未提交。")
  return [{ role: "user", position: "before-input", content: "这是玩家已确认的开局前提。依据相关原著创作开局；实体档案将在正文落定后建立，档案缺失不代表世界中不存在。只创作正文和行动选项，不维护资料。\n" + JSON.stringify(state.proposal) }, ...await buildStorySourceMaterial(workspace)]
}

function validStory(value: unknown): boolean {
  const assistant = object(value), choices = object(assistant.projections).choices
  return assistant.kind === "assistant" && typeof assistant.content === "string" && !!assistant.content.trim()
    && (assistant.displayContent === undefined || (typeof assistant.displayContent === "string" && !!assistant.displayContent.trim()))
    && Array.isArray(choices) && choices.length > 0 && choices.length <= 12 && choices.every(choice => typeof choice === "string" && !!choice.trim() && choice.length <= 300)
}

export interface OpeningPipelineHooks {
  onPhase?: (phase: "model" | "story" | "maintenance") => void
  onInvocation?: (id: string | null) => void
  isCurrent?: () => boolean
  /** Only an explicit user retry may regenerate a recorded malformed reply. */
  retry?: boolean
}

export async function runOpeningPipeline(tsian: TsianApi, control: OpeningInterviewControl, hooks: OpeningPipelineHooks = {}): Promise<void> {
  const assertCurrent = () => { if (hooks.isCurrent && !hooks.isCurrent()) throw new Error("当前开局流程已更换。") }
  const load = async () => {
    assertCurrent()
    const state = await readOpeningState(tsian.workspace, control.session.id)
    if (!state?.approved) throw new Error("请先确认开局方案。")
    return state
  }
  const invoke = async (agent: string, input: string, options: Parameters<TsianApi["invokeAgent"]>[2]) => {
    assertCurrent()
    const invocationId = crypto.randomUUID()
    hooks.onInvocation?.(invocationId)
    try { return await tsian.invokeAgent(agent, input, { ...options, invocationId }) }
    finally { hooks.onInvocation?.(null) }
  }
  let state = await load()
  const entrypoints = await tsian.card.entrypoints()
  const storyteller = entrypoints.playerTurn, stageManager = entrypoints.postTurnMaintenance
  if (!storyteller || !stageManager) throw new Error("当前卡缺少正文或资料维护入口。")
  if (!state.model) {
    hooks.onPhase?.("model")
    await invoke("world-architect", openingModelMarker(control.session.id), {
      purpose: "opening-model", contextSlot: `world-adaptation-${control.session.id}`, persist: true, includeRecentHistory: false,
      transcript: { mode: "full", audience: "player" },
      injection: [{ role: "user", position: "before-input", content: buildOpeningInjection(control, state.proposal) }],
    })
    state = await load()
    if (!state.model) throw new Error("架构师尚未成功提交世界适配，请重试适配。")
  }
  const modelId = state.model.id
  if (!state.published) {
    hooks.onPhase?.("story")
    const readTranscript = async () => {
      const slot = `opening-story-${modelId}-${state.storyAttempt || 0}`
      const file = await tsian.workspace.read(`save/agents/${storyteller}/transcripts/${slot}.json`, "save-runtime")
      const transcript = file ? object(JSON.parse(file.content)) : null
      if (transcript && (transcript.agentId !== storyteller || transcript.slot !== slot)) throw new Error("开局正文记录不属于当前调用。")
      return { slot, transcript }
    }
    let story = await readTranscript()
    if (story.transcript && !validStory(object(array(story.transcript.entries).slice(-1)[0]).assistant) && hooks.retry) {
      await tsian.card.runAction("opening", { operation: "retry_story", sessionId: control.session.id, modelId })
      state = await load()
      story = await readTranscript()
    }
    if (!story.transcript) {
      await invoke(storyteller, "根据提供的确认方案、相关原著和世界规则创作首段剧情，留下玩家可以行动的局面。输出格式遵循你自己的约定。只写正文，不修改资料，也不调用其他 Agent。", {
        purpose: "opening-story", contextSlot: story.slot, persist: true, includeRecentHistory: false,
        transcript: { mode: "full", audience: "player" }, injection: await buildOpeningStoryMaterial(tsian.workspace, state),
      })
    }
    assertCurrent()
    await tsian.card.runAction("opening", { operation: "publish", sessionId: control.session.id, modelId })
  }
  state = await load()
  if (!state.complete) {
    hooks.onPhase?.("maintenance")
    const prepared = await prepareMaintenanceContext(tsian.workspace, 0)
    if (!prepared.alreadyApplied) {
      await invoke(stageManager, "整理已落定的开局正文。加载‘回合后维护’，按已经发生的剧情提交语义变化；这是无预建实体的首次建档：依据正文和确认前提建立主角、地点、活跃场景及必要对象；用 world.protagonist/location/activeScenes 关联。未选选项、比喻和未来计划不是结果。", { purpose: "opening-maintenance", persist: false, includeRecentHistory: false })
    }
    assertCurrent()
    await verifyMaintenance(tsian.workspace, prepared)
    await tsian.card.runAction("opening", { operation: "finish", sessionId: control.session.id, modelId, maintenanceToken: prepared.token })
  }
  assertCurrent()
  const checkpoints = await tsian.checkpoints.list()
  const existing = checkpoints.find(checkpoint => checkpoint.turn === 0 && checkpoint.retention === "auto")
  if (existing) await tsian.checkpoints.overwrite(existing.id, { label: "开局就绪" })
  else await tsian.checkpoints.create({ label: "开局就绪", retention: "auto", source: "card" })
}
