// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import type { WorkspaceFile } from "@tsian/contracts"
import { prepareMaintenanceContext, verifyMaintenance, MAINTENANCE_CONTEXT_PATH, MAINTENANCE_SESSION_PATH, projectMaintenanceEntity } from "../../../play-frontend-dev/src/lib/maintenance-context"
import { formatProtagonistBlock } from "../../../play-frontend-dev/src/lib/context-injection"
import { assembleAgentContext } from "../agent-runtime/context"
import { buildEnabledToolSchemas } from "../agent-runtime/tool-schemas"
import { deriveAgentRuntimePermissionProfile } from "../agent-runtime/permissions"
import { createRuntimeWorkspaceToolSessionState, executeRuntimeWorkspaceToolCalls, resolveHelperPath } from "../agent-runtime/workspace-tools"
import { executeRunScript, parseActionDeclarations } from "../agent-runtime/workspace-tools/skill-actions"
import { createRuntimeWorkspaceTransaction } from "../storage/workspace"
import { executeWorkspaceOperation } from "../agent-runtime/workspace-operations"

const resourcePrefix = "../../../../cards/沉浸阅读器.tsian-card/workspace/"
const sources = import.meta.glob<string>("../../../../cards/沉浸阅读器.tsian-card/workspace/**/*.{md,json,js}", { eager: true, query: "?raw", import: "default" })
const resources: WorkspaceFile[] = Object.entries(sources).map(([path, content]) => ({ path: path.slice(resourcePrefix.length), content, createdAt: 0, updatedAt: 0 }))
const skillPath = "agents/stage-manager/skills/回合后维护/SKILL.md"
const fields = JSON.parse(sources[resourcePrefix + "agents/stage-manager/skills/回合后维护/semantic-fields.json"]!)
const historyPath = "save/history/turns/turn-000002.json"
const file = (path: string, value: unknown): WorkspaceFile => ({ path, content: typeof value === "string" ? value : JSON.stringify(value), createdAt: 0, updatedAt: 0 })
const hero = {
  id: "character:hero", name: "萧澈", brief: "婚礼前的少年", attributes: { 力量: 10 },
  status: [{ id: "damaged", name: "玄脉残损", description: "无法修炼", polarity: "negative", tone: "danger" }],
  goals: { longTerm: "寻找修复玄脉之法" }, history: [{ event: "婚礼前苏醒" }],
  containers: [{ ref: "container:bag" }], equipment: { 武器: [{ ref: null }] },
  updatedAtTurn: 1, extensions: { 秘密: { render: "text", tone: "warning", value: "持有天毒珠" } },
}
const fixtures = [
  file(historyPath, { timeline: [
    { kind: "user", content: "让医师诊脉。" }, { kind: "thought", text: "不应进入事实材料的思考" },
    { kind: "assistant", content: "司徒允诊脉后称无病无毒，玄脉残损依旧，但脉象出奇平稳。他与萧鸿离去。萧烈留下询问迎亲安排。" },
    { kind: "options", options: ["尚未发生的未来选项"] },
  ], meta: { untouched: "keep" } }),
  file("save/playthrough/runtime.json", { turn: 2, plotOrder: 5, worldTime: "清晨", protagonistRef: { ref: "character:hero" }, location: { ref: "location:room" }, activeSceneRefs: [{ ref: "scene:diagnosis" }], updatedAtTurn: 1 }),
  file("save/playthrough/frontier.json", { timeline: [{ kind: "source", order: 5, label: "诊脉", summary: "诊脉结束" }, { kind: "source", order: 6, label: "迎亲", summary: "前往迎亲" }], machineField: "hidden" }),
  file("save/entities/character/hero.json", hero),
  file("save/entities/character/doctor.json", { id: "character:doctor", name: "司徒允", aliases: ["医师"], status: [] }),
  file("save/entities/character/elder.json", { id: "character:elder", name: "萧烈" }),
  file("save/entities/character/steward.json", { id: "character:steward", name: "萧鸿" }),
  file("save/entities/location/room.json", { id: "location:room", name: "卧房" }),
  file("save/entities/container/bag.json", { id: "container:bag", name: "行囊", type: "container", contents: [{ ref: "item:sword", count: 1 }] }),
  file("save/entities/container/chest.json", { id: "container:chest", name: "木箱", type: "container", contents: [] }),
  file("save/entities/item/sword.json", { id: "item:sword", name: "铁剑", type: "equipment", equipment: { slotType: "武器", add: { 力量: 2 } } }),
  file("save/scenes/diagnosis.json", { id: "scene:diagnosis", name: "诊脉", location: { ref: "location:room" }, present: ["hero", "doctor", "elder", "steward"].map(id => ({ ref: `character:${id}` })), status: "active" }),
  file("save/schema/current.md", "# 世界规则\n## 文件结构\n不应注入的物理维护规则\n## 力量体系阶梯\n初玄、入玄\n## 维度定义\n力量代表体力\n## 装备计算\n不应注入的计算公式\n## 世界观术语与称呼约定\n医师是职业"),
  file("save/memory/records.md", "# 记录\n- [7] recall 关键词: 苏醒; 摘要: 婚礼前苏醒\n"),
  file("save/memory/seeds.md", "# 伏笔\n- [玄脉疑云] 状态: planted; 关联回合: 1\n"),
]
const recall = { summary: "诊脉未发现病毒，玄脉残损未变；医师离开，萧烈留下商议迎亲。", entities: ["character:hero", "character:doctor", "character:elder"], events: ["对话交流", "场景变化"], tags: ["诊脉", "迎亲"] }
const diagnosis = () => ({
  entities: [{ ref: "character:hero", experiences: ["司徒允诊脉称无病无毒，玄脉残损未变，脉象异常平稳。"], goals: { current: "商议迎亲安排" } }],
  scenes: [{ ref: "scene:diagnosis", participants: ["character:hero", "character:elder"], situation: "医师与萧鸿已离开，萧烈留下询问迎亲安排。" }],
  records: [{ kind: "recall", keywords: "诊脉", summary: "医师未发现病毒，玄脉残损依旧。" }],
  seeds: [{ name: "玄脉疑云", status: "developing" }], recall,
})
async function setup() {
  const tx = createRuntimeWorkspaceTransaction([...resources, ...fixtures])
  const sdkCall = async (operation: string, args: Record<string, unknown>) => {
    try {
      return await executeWorkspaceOperation({ ...args, operation } as never, {
        workspaceFiles: tx.workspaceFiles, actorLevel: 1,
        exposedOperations: ["read", "write", "list", "glob"],
        mutations: { write: input => tx.write(input), delete: input => ({ scope: input.scope, ...tx.delete(input.path) }) },
        fileFilter: entry => !entry.path.startsWith("frontend-actions/"),
      })
    } catch (error) {
      throw error
    }
  }
  const sdk = { workspace: Object.fromEntries(["read", "write", "list", "glob"].map(op => [op, (args: Record<string, unknown>) => sdkCall(op, args)])) }
  const workspace = {
    read: async (path: string, scope: string) => {
      try { return await sdkCall("read", { path, scope }) }
      catch (error) { if ((error as { code?: string }).code === "WORKSPACE_FILE_NOT_FOUND") return null; throw error }
    },
    write: (path: string, content: string, scope: string) => sdkCall("write", { path, content, scope }),
  } as unknown as Parameters<typeof prepareMaintenanceContext>[0]
  const prepared = await prepareMaintenanceContext(workspace, 2)
  const agentContext = assembleAgentContext(tx.workspaceFiles, { agentId: "stage-manager", workspaceTrustBoundary: "runtime-game-agent" })!
  const runBrowserScript = async (request: { scriptPath: string; helpers?: string[]; skillPath: string; skillName: string; input: unknown }) => {
    const get = (path: string) => tx.workspaceFiles.find(value => value.path === path)!.content
    const helperSources = (request.helpers ?? []).map(value => get(resolveHelperPath(request.skillPath, request.skillName, value)))
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const fn = new AsyncFunction("input", "tsian", "signal", [...helperSources, get(request.scriptPath)].join("\n"))
    return { ok: true as const, item: await fn(request.input, sdk, new AbortController().signal) }
  }
  const context = { workspaceFiles: tx.workspaceFiles, agentContext, sessionState: createRuntimeWorkspaceToolSessionState(), runBrowserScript }
  const run = (input: Record<string, unknown>, script = "submit_changes") => executeRunScript(context, { skill: "回合后维护", script, input })
  const read = (path: string) => tx.workspaceFiles.find(value => value.path === path)!.content
  const json = (path: string) => JSON.parse(read(path))
  return { tx, workspace, prepared, agentContext, context, run, read, json }
}

describe("card-owned stage-manager semantic maintenance (no model calls)", () => {
  it("loads only the semantic Skill/tools and still permits its script SDK", async () => {
    const { agentContext, context } = await setup()
    expect(agentContext.skillIndex.map(value => value.name)).toEqual(["回合后维护"])
    expect(agentContext.toolIndex).toHaveLength(0)
    const permissions = deriveAgentRuntimePermissionProfile(agentContext.agent)
    expect(permissions.exposedWorkspaceOperations).toEqual(expect.arrayContaining(["read", "write"]))
    expect(buildEnabledToolSchemas({ disabledToolNames: agentContext.agent.disabledTools, enabledPlatformTools: permissions.enabledTools, visibleContacts: [], allowAgentCall: false, userTools: agentContext.toolIndex }).map(value => value.name)).toEqual(["use_skill", "run_script"])
    const output = await executeRuntimeWorkspaceToolCalls(context, [{ raw: "read", call: { name: "read", arguments: { path: "save/playthrough/runtime.json" } } }])
    expect(output[0]).toMatchObject({ ok: false, error: { code: "TOOL_DISABLED" } })
    expect(parseActionDeclarations(resources.find(value => value.path === skillPath)!.content).errors).toEqual([])
    const loaded = await executeRuntimeWorkspaceToolCalls(context, [{ raw: "use_skill", call: { name: "use_skill", arguments: { name: "回合后维护" } } }])
    expect(loaded[0]).toMatchObject({ ok: true, result: { loaded: true, actionCount: 2 } })

  })
  it("prepares semantic evidence without thoughts, options, storage metadata or formatting instructions", async () => {
    const { read, agentContext } = await setup()
    const text = read(MAINTENANCE_CONTEXT_PATH)
    for (const forbidden of ["不应进入", "尚未发生", "updatedAtTurn", '"render"', '"tone"', "计算公式", "物理维护", "machineField", '"turn"', '"token"']) expect(text).not.toContain(forbidden)
    expect(text).toContain('"plotOrder": 5')
    expect(text).toContain("力量代表体力")
    expect(JSON.stringify(agentContext.contextInjectionsByPosition)).toContain("诊脉")
  })
  it("queries names and returns the same semantic projection as the prepared context", async () => {
    const { run } = await setup()
    const result = await run({ refs: ["character:hero"], names: ["医师", "不存在的人"] }, "lookup")
    expect(result.result).toMatchObject({ output: { entities: expect.arrayContaining([projectMaintenanceEntity(hero, fields), expect.objectContaining({ name: "司徒允" })]), unmatchedNames: ["不存在的人"] } })
  })
  it("applies a diagnosis fixture without inventing recovery/discovery and writes renderable history + recall", async () => {
    const { run, json, read, workspace, prepared } = await setup()
    await run(diagnosis())
    const updated = json("save/entities/character/hero.json")
    expect(updated.status).toEqual(hero.status)
    expect(updated.attributes).toEqual(hero.attributes)
    expect(updated.history.at(-1)).toEqual({ event: diagnosis().entities[0]!.experiences[0] })
    expect(formatProtagonistBlock(updated, "character:hero")).toContain(diagnosis().entities[0]!.experiences[0])
    expect(updated.goals.longTerm).toBe(hero.goals.longTerm)
    expect(json("save/scenes/diagnosis.json").present).toEqual([{ ref: "character:hero" }, { ref: "character:elder" }])
    expect(json("save/playthrough/runtime.json")).toMatchObject({ turn: 3, updatedAtTurn: 2, plotOrder: 5 })
    expect(json(historyPath).meta).toMatchObject({ untouched: "keep", recall: { 摘要: recall.summary, 剧情坐标: 5 } })
    expect(read("save/memory/records.md")).toContain("- [8] recall")
    await expect(verifyMaintenance(workspace, prepared)).resolves.toBeUndefined()
    const before = txSnapshot(read)
    await run(diagnosis())
    expect(txSnapshot(read)).toEqual(before)
    expect((await prepareMaintenanceContext(workspace, 2)).alreadyApplied).toBe(true)
  })
  it("allocates refs, resolves same-batch references and writes both sides of mutual relationships", async () => {
    const { run, json, tx } = await setup()
    await run({ entities: [{ key: "guest", type: "character", name: "访客", states: { put: [{ name: "等待", description: "门外等候" }] }, details: { 到访目的: "祝贺" } }], scenes: [{ key: "meeting", name: "会客", location: "location:room", participants: ["@guest", "character:hero"] }], relationships: [{ from: "character:hero", to: "@guest", kind: "相识", description: "互报姓名", mutual: true }], world: { activeScenes: ["@meeting"], plotOrder: 6 }, recall: { ...recall, entities: ["@guest"] } })
    const newRef = json(historyPath).meta.recall.涉及实体[0]
    const guest = JSON.parse(tx.workspaceFiles.find(entry => entry.path.endsWith(newRef.slice(10) + ".json") && entry.path.includes("/entities/"))!.content)
    expect(guest.status[0].id).toBeTruthy()
    expect(guest.extensions.到访目的).toEqual({ render: "text", value: "祝贺" })
    expect(json("save/relationships/character-hero.json").edges[0].to).toBe(newRef)
    expect(json(`save/relationships/character-${newRef.slice(10)}.json`).edges[0].to).toBe("character:hero")
    expect(json("save/playthrough/runtime.json").plotOrder).toBe(6)
  })
  it("keeps semantic plot milestones while generating their physical turn/time metadata", async () => {
    const { run, json } = await setup()
    const milestone = { label: "主动改变迎亲安排", alignment: "diverged", sourceOrder: 6 }
    await run({ world: { plotOrder: 6, details: { 月相: "新月" } }, milestones: [milestone, milestone], recall })
    const frontier = json("save/playthrough/frontier.json")
    expect(frontier.timeline.filter((node: { kind: string }) => node.kind === "player")).toEqual([{ kind: "player", order: 6, turn: 2, time: "清晨", label: milestone.label, alignment: "diverged", sourceRef: 6 }])
    expect(json("save/playthrough/runtime.json").extensions.月相).toEqual({ render: "text", value: "新月" })
  })
  it("uses the real equipment helper to maintain numerical projection", async () => {
    const { run, json } = await setup()
    await run({ equipment: [{ character: "character:hero", operation: "equip", slot: "武器", index: 0, item: "item:sword" }], recall })
    expect(json("save/entities/character/hero.json").attributes.力量).toBe(12)
    expect(json("save/entities/character/hero.json").equipment.武器[0].ref).toBe("item:sword")
  })
  it("repairs equipment ownership and removes contributions after an equipped item leaves its owner", async () => {
    const { run, tx, workspace, json } = await setup()
    tx.write({ path: "save/entities/character/hero.json", content: JSON.stringify({ ...hero, attributes: { 力量: 12 }, equipment: { 武器: [{ ref: "item:sword", applied: { 力量: 2 } }] } }) })
    await prepareMaintenanceContext(workspace, 2)
    await run({ transfers: [{ item: "item:sword", from: "container:bag", to: "container:chest", quantity: 1 }], recall })
    expect(json("save/entities/character/hero.json")).toMatchObject({ attributes: { 力量: 10 }, equipment: { 武器: [{ ref: null }] } })
  })
  it("recomputes equipped effects when the item's semantic effect changes", async () => {
    const { run, tx, workspace, json } = await setup()
    tx.write({ path: "save/entities/character/hero.json", content: JSON.stringify({ ...hero, attributes: { 力量: 12 }, equipment: { 武器: [{ ref: "item:sword", applied: { 力量: 2 } }] } }) })
    await prepareMaintenanceContext(workspace, 2)
    await run({ refs: ["item:sword"] }, "lookup")
    await run({ entities: [{ ref: "item:sword", wearable: { slot: "武器", add: { 力量: 3 }, effects: ["剑身更稳固"] } }], recall })
    expect(json("save/entities/character/hero.json").attributes.力量).toBe(13)
  })
  it("moves existing items deterministically without duplicating inventory", async () => {
    const { run, json } = await setup()
    await run({ transfers: [{ item: "item:sword", from: "container:bag", to: "container:chest", quantity: 1 }], recall })
    expect(json("save/entities/container/bag.json").contents).toEqual([])
    expect(json("save/entities/container/chest.json").contents).toEqual([{ ref: "item:sword", count: 1 }])
  })
  it.each([
    { entities: [{ ref: "character:hero", updatedAtTurn: 999 }] },
    { entities: [{ ref: "character:hero", states: { put: [{ name: "伤势", polarity: "invented" }] } }] },
    { entities: [{ ref: "character:hero", refPath: "save/whatever" }] },
    { world: { plotOrder: 4 } },
    { scenes: [{ key: "new", name: "缺少地点" }] },
    { scenes: [{ ref: "scene:diagnosis", participants: ["character:missing"] }] },
    { transfers: [{ item: "item:sword", from: "container:bag", to: "container:chest", quantity: -1 }] },
    { equipment: [{ character: "character:hero", operation: "equip" }] },
    { entities: [{ key: "loop", type: "container", name: "循环容器", contents: [{ ref: "@loop" }] }] },
  ])("rejects invalid semantic changes before writing: %j", async changes => {
    const { run, tx } = await setup()
    const before = JSON.stringify(tx.workspaceFiles)
    await expect(run({ ...changes, recall })).rejects.toBeTruthy()
    expect(JSON.stringify(tx.workspaceFiles)).toBe(before)
  })
  it("rejects stale evidence and a changed source instead of silently overwriting", async () => {
    const { run, tx, json } = await setup()
    tx.write({ path: "save/entities/character/hero.json", content: JSON.stringify({ ...hero, name: "已修改" }) })
    const before = JSON.stringify(tx.workspaceFiles)
    await expect(run(diagnosis())).rejects.toThrow("资料已经变化")
    expect(JSON.stringify(tx.workspaceFiles)).toBe(before)
    const history = json(historyPath); history.timeline.push({ kind: "assistant", content: "新正文" })
    tx.write({ path: historyPath, content: JSON.stringify(history) })
    await expect(run(diagnosis())).rejects.toThrow("正文已经变化")
  })
  it("requires a submission receipt, not just prepared materials", async () => {
    const { workspace, prepared, read } = await setup()
    expect(read(MAINTENANCE_SESSION_PATH)).toContain(prepared.token)
    await expect(verifyMaintenance(workspace, prepared)).rejects.toThrow("尚未成功提交")
  })
})
function txSnapshot(read: (path: string) => string) {
  return [historyPath, "save/playthrough/runtime.json", "save/memory/records.md", "save/memory/seeds.md", "save/entities/character/hero.json"].map(read)
}
