import type { WorkspaceFile } from "@tsian/contracts"
import type { TsianApi } from "@tsian/play-bridge"
import { createOpeningControl } from "../../play-frontend-dev/src/lib/opening-interview"
import type { SourceManifest } from "../../play-frontend-dev/src/lib/source"
import { createRuntimeWorkspaceTransaction } from "../src/storage/workspace"
import type { FrontendActionWorkspaceFile } from "../src/storage/frontend-action-workspace"
import { deriveAgentRuntimePermissionProfile } from "../src/agent-runtime/permissions"
import { assembleAgentContext } from "../src/agent-runtime/context"
import { createRuntimeWorkspaceToolSessionState, resolveHelperPath } from "../src/agent-runtime/workspace-tools"
import { executeRunScript } from "../src/agent-runtime/workspace-tools/skill-actions"
import { executeWorkspaceOperation } from "../src/agent-runtime/workspace-operations"
import { createBrowserSkillScriptRunner } from "../src/platform-host/browser-skill-script-executor"
import { createFrontendActionExecutionService } from "../src/platform-host/frontend-actions/service"

export const openingProposal = { protagonist: "少年阿青", startingPoint: "雨夜客栈", openingFocus: "等待父亲归来", constraints: ["角色不预知未来"] }
export const initialWorld = () => ({
  world: { title: "雨夜江湖", power: { tiers: ["初学", "入门"], scale: "gentle" }, dimensions: [
    { name: "力量", kind: "growth", meaning: "身体力量" }, { name: "身法", kind: "hybrid", meaning: "步法" },
    { name: "悟性", kind: "talent", meaning: "领悟能力" }, { name: "根骨", kind: "talent", meaning: "身体资质" },
  ], rules: ["内功需要修习"], equipmentSlots: { 武器: 1 } },
  summary: "雨夜江湖的世界规则已适配。",
})
export const openingTurnPath = "save/history/turns/turn-000000.json"
export const openingStatePath = "save/playthrough/opening-state.json"
export const openingFile = (path: string, value: unknown): WorkspaceFile => ({ path, content: typeof value === "string" ? value : JSON.stringify(value), createdAt: 0, updatedAt: 0 })

/** Disposable fixture. Browser mode uses production Skill Worker and Action service;
 * inline mode is only for fast deterministic unit tests, never evidence of isolation. */
export function createOpeningFixture(resources: WorkspaceFile[], browser = false) {
  const source = { status: "ready", title: "雨夜江湖", importedAt: "2026-09-10T00:00:00Z", normalizationVersion: "v1", chapterCount: 1 } as SourceManifest
  const control = createOpeningControl(source, "original")
  const tx = createRuntimeWorkspaceTransaction([
    ...resources.filter(file => !file.path.startsWith("save/")),
    openingFile("game-card.json", { runtime: { entrypoints: { playerTurn: "storyteller", postTurnMaintenance: "stage-manager" } } }),
    openingFile("save/source/manifest.json", source), openingFile("save/playthrough/opening-interview.json", control),
    openingFile("save/source/chapters.index.json", { chapters: [{ index: 1, title: "雨夜", path: "save/source/chapter.md" }] }),
    openingFile("save/source/chapter.md", "# 雨夜\n阿青在客栈等候父亲。"),
    openingFile("save/playthrough/runtime.json", { turn: 0, protagonistRef: null, location: null, activeSceneRefs: [], weather: "", worldTime: "", extensions: {} }),
    openingFile("save/playthrough/setup-summary.json", { status: "pending", summary: null }),
  ])
  const read = (path: string) => tx.workspaceFiles.find(file => file.path === path)?.content ?? null
  const json = (path: string) => JSON.parse(read(path) ?? "null")
  const write = (path: string, value: unknown) => tx.write(openingFile(path, value))
  const replaceResource = (path: string, content: string) => {
    const index = tx.workspaceFiles.findIndex(file => file.path === path)
    if (path.startsWith("save/") || index < 0) throw new Error("Expected a fixture card resource")
    tx.workspaceFiles[index] = { ...tx.workspaceFiles[index]!, content }
  }
  const workspace = {
    read: async (path: string) => tx.workspaceFiles.find(file => file.path === path) ?? null,
    write: async (path: string, content: string) => tx.write({ path, content }),
  } as unknown as TsianApi["workspace"]
  const sdkCall = async (operation: string, args: Record<string, unknown>) => executeWorkspaceOperation({ ...args, operation } as never, {
    workspaceFiles: tx.workspaceFiles, actorLevel: 1, exposedOperations: ["read", "write", "list", "glob", "delete"],
    mutations: { write: input => tx.write(input), delete: input => ({ scope: input.scope, ...tx.delete(input.path) }) },
    fileFilter: file => !file.path.startsWith("frontend-actions/"),
  })
  const sdk = { trace: () => {}, workspace: Object.fromEntries(["read", "write", "list", "glob", "delete"].map(op => [op, (args: Record<string, unknown>) => sdkCall(op, args)])) }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const realRunner = browser ? createBrowserSkillScriptRunner({ workspaceTransaction: tx }) : null
  async function run(input: Record<string, unknown>, script = "submit_initial_world", agent = script === "propose_opening" ? "storyteller" : "world-architect") {
    const agentContext = assembleAgentContext(tx.workspaceFiles, { agentId: agent, workspaceTrustBoundary: "runtime-game-agent" })!
    const runner: NonNullable<typeof realRunner> = realRunner ?? (async request => {
      const sources = (request.helpers ?? []).map(helper => read(resolveHelperPath(request.skillPath, request.skillName, helper)))
      const fn = new AsyncFunction("input", "tsian", "signal", [...sources, read(request.scriptPath)].join("\n"))
      return { ok: true, item: await fn(request.input, sdk, new AbortController().signal) }
    })
    // The real runner owns its script savepoint; inline tests emulate that boundary.
    const point = browser ? null : tx.createSavepoint()
    try { const result = await executeRunScript({ workspaceFiles: tx.workspaceFiles, agentContext, exposedWorkspaceOperations: deriveAgentRuntimePermissionProfile(agentContext.agent).exposedWorkspaceOperations, workspaceFileFilter: (file: WorkspaceFile) => !file.path.startsWith("frontend-actions/"), sessionState: createRuntimeWorkspaceToolSessionState(), runBrowserScript: runner }, { skill: agent === "stage-manager" ? "回合后维护" : script === "propose_opening" ? "开局访谈" : ["read_source", "locate_source"].includes(script) ? "原著阅读" : "开局建模", script, input }); return (result as { result: { output: unknown } }).result.output }
    catch (error) { if (point) tx.rollbackToSavepoint(point); throw error }
  }
  const actionService = browser ? createFrontendActionExecutionService({
    loadSnapshot: async () => {
      const files: FrontendActionWorkspaceFile[] = tx.workspaceFiles.map(file => ({ ...file,
        provenance: { source: file.path.startsWith("save/") ? "save-workspace" : file.path === "game-card.json" ? "game-card-manifest" : "card-content", rowId: file.path, gameCardId: "opening-fixture", saveId: "opening-save" },
        snapshotSignature: file.content,
      }))
      return { saveId: "opening-save", gameCardId: "opening-fixture", mountedGameCardId: "opening-fixture", effectiveFiles: files, cardContentFiles: files.filter(file => file.provenance.source === "card-content"), cardFrontendFiles: [], saveWorkspaceFiles: files.filter(file => file.provenance.source === "save-workspace") }
    },
    commitWorkspace: async ({ changes }) => {
      for (const path of changes.deletedPaths) tx.delete(path)
      for (const file of changes.writtenFiles) tx.write(file)
      return { saveId: "opening-save", gameCardId: "opening-fixture", changed: !!(changes.writtenFiles.length || changes.deletedPaths.length), writtenPaths: changes.writtenFiles.map(file => file.path), deletedPaths: changes.deletedPaths }
    },
  }) : null
  async function action(input: Record<string, unknown>) {
    if (actionService) return (await actionService.runAction({ mountedGameCardId: "opening-fixture", invocationId: crypto.randomUUID(), actionId: "opening", input })).output
    const point = tx.createSavepoint()
    try {
      const fn = new AsyncFunction("input", "tsian", read("frontend-actions/opening/run.js"))
      return await fn(input, { workspace: { ...sdk.workspace, read: async (args: Record<string, unknown>) => {
        try { return await sdkCall("read", args) } catch (error) { if ((error as { code: string }).code === "WORKSPACE_FILE_NOT_FOUND") return null; throw error }
      } }, action: { fail: (error: unknown) => { throw error } } })
    } catch (error) { tx.rollbackToSavepoint(point); throw error }
  }
  async function confirm() {
    await run(openingProposal, "propose_opening")
    await action({ operation: "confirm", sessionId: control.session.id, proposalId: json(openingStatePath).proposalId })
  }
  function recordStory(valid = true) {
    const state = json(openingStatePath), slot = `opening-story-${state.model.id}-${state.storyAttempt || 0}`
    const assistant = { kind: "assistant", content: "父亲推门而入，向阿青点头。", ...(valid ? { projections: { choices: ["迎上前去"] } } : {}) }
    write(`save/agents/storyteller/transcripts/${slot}.json`, { schema: "tsian.agent.transcript.v1", agentId: "storyteller", slot, entries: [{ assistant }] })
  }
  const actionInput = (operation: string) => ({ operation, sessionId: control.session.id, modelId: json(openingStatePath).model.id })
  const maintenance = (): Record<string, unknown> => {
    const hero = json("save/playthrough/runtime.json").protagonistRef?.ref
    if (hero) return { entities: [{ ref: hero, experiences: ["在客栈迎来父亲"] }], recall: { summary: "父亲归来。", entities: [hero], events: ["对话交流"], tags: ["客栈"], important: true } }
    return {
      entities: [
        { key: "hero", type: "character", name: "阿青", summary: "等候父亲的少年", tier: "初学", identity: { realm: "初学门径", role: "少年" }, ratings: { 力量: 5 }, containers: ["@bag"], experiences: ["来到客栈"], states: { put: [{ name: "淋湿" }] }, gauges: { put: [{ name: "精力", value: 8, min: 0, max: 10 }] } },
        { key: "father", type: "character", name: "父亲", summary: "已经归来", tier: "入门" },
        { key: "inn", type: "location", name: "客栈", summary: "雨中的客栈" },
        { key: "bag", type: "container", name: "行囊", summary: "随身行囊", contents: [{ ref: "@sword", quantity: 1 }] },
        { key: "sword", type: "item", name: "铁剑", summary: "普通铁剑", itemType: "equipment", wearable: { slot: "武器", add: { 力量: 2 } } },
      ],
      scenes: [{ key: "wait", name: "父子相见", location: "@inn", participants: ["@hero", "@father"], situation: "父亲归来" }],
      relationships: [{ from: "@hero", to: "@father", kind: "父亲", description: "阿青是他的儿子" }],
      world: { protagonist: "@hero", location: "@inn", activeScenes: ["@wait"], time: "夜晚", weather: "雨" },
      equipment: [{ character: "@hero", operation: "equip", slot: "武器", index: 0, item: "@sword" }],
      recall: { summary: "父亲归来。", entities: ["@hero", "@father"], events: ["对话交流"], tags: ["客栈"], important: true },
    }
  }

  return { tx, control, workspace, run, action, confirm, recordStory, actionInput, maintenance, json, read, write, replaceResource }
}
