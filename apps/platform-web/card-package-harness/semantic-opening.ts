import type { WorkspaceFile } from "@tsian/contracts"
import { createOpeningFixture, initialWorld, openingStatePath, openingTurnPath } from "./opening-fixture"
import { buildStorySourceMaterial } from "../../play-frontend-dev/src/lib/story-source"
import { historicalNode } from "../../play-frontend-dev/src/lib/history-timeline"
import { prepareMaintenanceContext, verifyMaintenance } from "../../play-frontend-dev/src/lib/maintenance-context"

/** Imported card assets → real browser Skill Worker → real Frontend Action
 * service/opaque Worker → turn-zero stage-manager. No model calls or player writes. */
export async function verifySemanticOpening(resources: WorkspaceFile[]) {
  const f = createOpeningFixture(resources, true)
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
  await f.confirm()
  const beforeModel = JSON.stringify(f.tx.workspaceFiles)
  const bad = initialWorld(); bad.world.dimensions[0]!.name = bad.world.dimensions[1]!.name
  try { await f.run(bad); throw new Error("Invalid model was accepted") } catch (error) {
    if (JSON.stringify(f.tx.workspaceFiles) !== beforeModel) throw new Error("Invalid model left partial writes")
    if (error instanceof Error && error.message === "Invalid model was accepted") throw error
  }
  // Exercise actual runner savepoints after writes: invalid output must roll back.
  const skillPath = "agents/world-architect/skills/开局建模/SKILL.md", original = f.read(skillPath)!
  const match = /```json tsian-actions\s*([\s\S]*?)```/.exec(original)!
  const actions = JSON.parse(match[1]!); actions.find((action: { name: string }) => action.name === "submit_initial_world").outputSchema = { type: "object", required: ["impossible"] }
  f.replaceResource(skillPath, original.replace(match[1]!, JSON.stringify(actions) + "\n"))
  const beforeOutput = JSON.stringify(f.tx.workspaceFiles)
  let rejected = false
  try { await f.run(initialWorld()) } catch { rejected = true }
  check(rejected && JSON.stringify(f.tx.workspaceFiles) === beforeOutput, "Opening output validation failed to roll back")
  f.replaceResource(skillPath, original)
  await f.run(initialWorld())
  const beforeRepeat = JSON.stringify(f.tx.workspaceFiles)
  await f.run(initialWorld())
  check(beforeRepeat === JSON.stringify(f.tx.workspaceFiles), "Opening submission is not idempotent")
  const sourceRead = JSON.stringify(await f.run({ remember: true }, "read_source", "storyteller"))
  check(sourceRead.includes("阿青") && !sourceRead.includes("save/source/"), "Source reader leaks storage paths")
  check(!f.tx.workspaceFiles.some(file => file.path.startsWith("save/entities/") || file.path.startsWith("save/scenes/")), "World adaptation prebuilt objects")
  const actualMaterial = JSON.stringify(await buildStorySourceMaterial(f.workspace))
  check(actualMaterial.includes("阿青在客栈等候父亲") && !actualMaterial.includes("frontier.json"), "Writer did not receive actual source text")
  f.recordStory(false)
  rejected = false
  try { await f.action(f.actionInput("publish")) } catch { rejected = true }
  check(rejected && !f.read(openingTurnPath), "Malformed story was published")
  await f.action(f.actionInput("retry_story"))
  f.recordStory()
  // Invalid Action output must roll back turn/context/state together.
  const actionPath = "frontend-actions/opening/action.json", actionOriginal = f.read(actionPath)!
  f.replaceResource(actionPath, JSON.stringify({ ...JSON.parse(actionOriginal), outputSchema: { type: "object", required: ["impossible"] } }))
  const beforePublish = JSON.stringify(f.tx.workspaceFiles)
  rejected = false
  try { await f.action(f.actionInput("publish")) } catch { rejected = true }
  check(rejected && JSON.stringify(f.tx.workspaceFiles) === beforePublish, "Opening Action publication was not atomic")
  f.replaceResource(actionPath, actionOriginal)
  await f.action(f.actionInput("publish"))
  check(f.json("save/playthrough/setup-summary.json").status === "pending", "Opening completed before maintenance")
  rejected = false
  try { await f.action({ ...f.actionInput("finish"), maintenanceToken: "missing" }) } catch { rejected = true }
  check(rejected, "Opening accepted completion without receipt")
  const prepared = await prepareMaintenanceContext(f.workspace, 0)
  await f.run(f.maintenance(), "submit_changes", "stage-manager")
  await verifyMaintenance(f.workspace, prepared)
  await f.action({ ...f.actionInput("finish"), maintenanceToken: prepared.token })
  check(f.json(openingStatePath).complete && f.json("save/playthrough/runtime.json").turn === 1, "Opening did not advance to first formal turn")
  check(historicalNode(f.json(openingTurnPath))?.summary === "父亲归来。", "History does not reuse the settled recall summary")
  const heroRef = f.json("save/playthrough/runtime.json").protagonistRef.ref as string
  const heroPath = `save/entities/character/${heroRef.slice(10)}.json`
  const hero = f.json(heroPath)
  check(JSON.stringify(hero.attributes) === JSON.stringify({ 力量: 7, 身法: 5, 悟性: 5, 根骨: 5 }), "Partial ratings did not fill all dimensions or equipment projection failed")
  const father = f.tx.workspaceFiles.filter(file => file.path.startsWith("save/entities/character/")).map(file => JSON.parse(file.content)).find(value => value.name === "父亲")
  check(father?.attributes.力量 === 20 && father?.attributes.身法 === 10 && father?.attributes.悟性 === 5, "Omitted ratings did not respect the known higher tier")
  check(hero.identity.realm === "初学门径", "Numeric tier estimate overwrote factual realm prose")
  f.write("save/entities/item/tower.json", { id: "item:tower", name: "紫星塔", aliases: ["星塔"], brief: "原有神器" })
  f.write("save/history/turns/turn-000001.json", { turn: 1, timeline: [{ kind: "assistant", content: "紫星塔再现。" }] })
  const next = await prepareMaintenanceContext(f.workspace, 1)
  check(!f.read("save/maintenance/context.md")!.includes("sourceOrder"), "Stage manager received alignment material")
  const change = { entities: [{ key: "tower", type: "item", name: "紫星塔", summary: "木制仿品" }], recall: { summary: "木制仿品出现。", entities: ["@tower"], events: [], tags: [], important: true } }
  const beforeCandidate = JSON.stringify(f.tx.workspaceFiles)
  const candidate = await f.run(change, "submit_changes", "stage-manager") as { status: string }
  check(candidate.status === "candidates" && JSON.stringify(f.tx.workspaceFiles) === beforeCandidate, "Creation without lookup bypassed candidates or wrote partially")
  const lookedUp = await f.run({ names: ["星塔"] }, "lookup", "stage-manager") as { entities: { ref: string }[] }
  check(lookedUp.entities[0]?.ref === "item:tower", "Alias lookup lost stable ID")
  await f.run({ ...change, entities: [{ ...change.entities[0], distinctFrom: [{ ref: "item:tower", reason: "正文明确是木制仿品，不是原有神器" }] }] }, "submit_changes", "stage-manager")
  await verifyMaintenance(f.workspace, next)
  check(f.json("save/playthrough/runtime.json").turn === 2 && f.json("save/entities/item/tower.json").brief === "原有神器", "Namesakes were merged or turn advancement failed")
  for (const turn of [2, 3]) {
    f.write(`save/history/turns/turn-${String(turn).padStart(6, "0")}.json`, { turn, timeline: [{ kind: "assistant", content: turn === 2 ? "阿青练习后体力提升。" : "阿青继续行动。" }] })
    const prepared = await prepareMaintenanceContext(f.workspace, turn)
    await f.run({ entities: [{ ref: heroRef, tier: "初学", ratings: { 力量: 5 } }], ...(turn === 2 ? { equipment: [{ character: heroRef, operation: "refresh", attributeChanges: { 力量: 3 } }] } : {}), recall: { summary: "阿青继续行动。", entities: [heroRef], events: [], tags: [] } }, "submit_changes", "stage-manager")
    await verifyMaintenance(f.workspace, prepared)
    check(f.json(heroPath).attributes.力量 === 10, "Repeated estimate dropped persistent training or duplicated equipment")
  }
  return { attributeBaselines: true, stableAttributeUpdates: true, noPrebuiltEntities: true, sourceInjection: true, candidateProtection: true, historicalTimeline: true, firstFormalTurn: true, realWorkers: true, sourceRead: true, modelAtomicity: true, actionAtomicity: true, turnZeroMaintenance: true, idempotency: true }
}
