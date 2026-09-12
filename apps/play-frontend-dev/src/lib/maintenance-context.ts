import type { TsianApi } from "@tsian/play-bridge"


type Workspace = TsianApi["workspace"]
type Document = Record<string, unknown>
export interface MaintenanceFields { entityFields: Record<string, string>; worldRuleSections: string[] }
const FIELDS_PATH = "agents/stage-manager/skills/回合后维护/semantic-fields.json"
export const MAINTENANCE_CONTEXT_PATH = "save/maintenance/context.md"
export const MAINTENANCE_SESSION_PATH = "save/maintenance/session.json"
const object = (value: unknown): Document => value && typeof value === "object" && !Array.isArray(value) ? value as Document : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []

export function maintenanceRefPath(ref: string): string {
  const match = /^(character|item|container|location|scene):([^:/\\\0]+)$/.exec(ref)
  if (!match || match[2] === "." || match[2] === "..") throw new Error(`无效的资料标识：${ref}`)
  return match[1] === "scene" ? `save/scenes/${match[2]}.json` : `save/entities/${match[1]}/${match[2]}.json`
}

/** Card-local semantic view. Mapping data is shared with the maintenance scripts. */
export function projectMaintenanceEntity(entity: Document, fields: MaintenanceFields): Document {
  const view: Document = { ref: entity.id, name: entity.name }
  for (const [name, source] of Object.entries(fields.entityFields)) {
    if (name === "itemType" && !String(entity.id).startsWith("item:")) continue
    if (entity[source] !== undefined) view[name] = entity[source]
  }
  for (const [name, source, keys] of [
    ["states", "status", ["id", "name", "description", "polarity"]],
    ["traits", "traits", ["id", "name", "description", "effects"]],
    ["gauges", "gauges", ["id", "name", "value", "min", "max", "unit"]],
  ] as const) {
    view[name] = array(entity[source]).map(value => Object.fromEntries(keys.filter(key => object(value)[key] !== undefined).map(key => [key, object(value)[key]])))
  }
  view.experiences = array(entity.history).map(value => typeof value === "string" ? value : object(value).event).filter(value => typeof value === "string")
  view.attributes = object(entity.attributes)
  for (const [name, field] of [["tier", "powerTier"], ["level", "powerLevel"], ["ratings", "ratings"]] as const) {
    if (entity[field] !== undefined) view[name] = entity[field]
  }
  view.containers = array(entity.containers).map(value => object(value).ref)
  view.contents = array(entity.contents).map(value => ({ ref: object(value).ref, quantity: object(value).count ?? 1 }))
  view.equipment = String(entity.id).startsWith("character:") ? Object.entries(object(entity.equipment)).flatMap(([slot, entries]) => array(entries).map((value, index) => ({ slot, index, item: object(value).ref ?? null }))) : []
  if (String(entity.id).startsWith("item:") && entity.equipment) {
    const equipment = object(entity.equipment)
    view.wearable = { slot: equipment.slotType, add: equipment.add, percent: equipment.percent, effects: equipment.effects }
  }
  view.details = Object.fromEntries(Object.entries(object(entity.extensions)).map(([name, value]) => [name, object(value).value]))
  return view
}

export function maintenanceWorldRules(text: string, fields: MaintenanceFields): string {
  let include = false
  return text.split(/\r?\n/).filter(line => {
    if (/^## /.test(line)) include = fields.worldRuleSections.includes(line.slice(3).trim())
    return include
  }).join("\n").trim()
}

export interface PreparedMaintenance { turn: number; token: string; alreadyApplied: boolean }

export async function prepareMaintenanceContext(workspace: Workspace, turn: number): Promise<PreparedMaintenance> {
  if (!Number.isSafeInteger(turn) || turn < 0) throw new Error("正文回合编号无效。")
  const baselines: Record<string, string | null> = {}
  async function read(path: string, required = false): Promise<string | null> {
    const file = await workspace.read(path, "effective")
    if (!file && required) throw new Error("维护所需资料尚未准备好。")
    const text = file?.content ?? null
    baselines[path] = text
    return text
  }
  async function json(path: string, required = false): Promise<Document> {
    const text = await read(path, required)
    return text === null ? {} : object(JSON.parse(text))
  }
  if (turn === 0) {
    const opening = await json("save/playthrough/opening-state.json", true)
    if (opening.published !== true || opening.approved !== true) throw new Error("开局正文尚未落定，不能维护。")
  }
  const turnPath = `save/history/turns/turn-${String(turn).padStart(6, "0")}.json`
  const history = await json(turnPath, true)
  const timeline = array(history.timeline)
  const prose = timeline.filter(value => object(value).kind === "assistant").map(value => object(value).content).filter(value => typeof value === "string").join("\n\n")
  if (!prose.trim()) throw new Error("本轮尚无已落定正文。")
  const source = JSON.stringify(history.timeline)
  const previous = object(object(history.meta).maintenance)
  if (previous.token) {
    if (previous.source !== source) throw new Error("本轮维护后正文发生变化，请先回溯再重新生成。")
    return { turn, token: String(previous.token), alreadyApplied: true }
  }
  const fields = JSON.parse((await read(FIELDS_PATH, true))!) as MaintenanceFields
  const runtime = await json("save/playthrough/runtime.json", true)
  const opening = turn === 0 ? await json("save/playthrough/opening-state.json", true) : null
  const worldSchema = await json("save/schema/world.json")
  const rules = maintenanceWorldRules(await read("save/schema/current.md") ?? "", fields)
  const refs = new Set<string>()
  const protagonist = object(runtime.protagonistRef).ref
  if (typeof protagonist === "string") refs.add(protagonist)
  const scenes: Document[] = []
  for (const entry of array(runtime.activeSceneRefs)) {
    const ref = object(entry).ref
    if (typeof ref !== "string") continue
    const scene = await json(maintenanceRefPath(ref), true)
    const participants = array(scene.present).map(value => object(value).ref).filter((value): value is string => typeof value === "string")
    participants.forEach(value => refs.add(value))
    scenes.push({ ref: scene.id, name: scene.name, location: object(scene.location).ref, participants, status: scene.status,
      situation: object(object(scene.extensions)["来客"]).value, time: object(object(scene.extensions)["时间"]).value })
  }
  const entities: Document[] = []
  const relationships: Document[] = []
  for (const ref of [...refs].slice(0, 20)) {
    entities.push(projectMaintenanceEntity(await json(maintenanceRefPath(ref), true), fields))
    if (ref.startsWith("character:")) {
      const relation = await json(`save/relationships/character-${ref.slice(10)}.json`)
      for (const edge of array(relation.edges)) {
        const row = object(edge)
        relationships.push({ from: ref, to: row.to, kind: row.type, description: row.description ?? row.note ?? "" })
      }
    }
  }
  const records = (await read("save/memory/records.md") ?? "").split(/\r?\n/).filter(line => /^- \[\d+\]/.test(line)).slice(-8).map(line => line.replace(/^- \[\d+\] /, ""))
  const seeds = (await read("save/memory/seeds.md") ?? "").split(/\r?\n/).flatMap(line => {
    const match = /^- \[(.+)\] 状态: (planted|developing|resolved|abandoned);/.exec(line)
    return match && !["resolved", "abandoned"].includes(match[2]!) ? [{ name: match[1], status: match[2] }] : []
  })
  const context = {
    playerInput: timeline.filter(value => object(value).kind === "user").map(value => object(value).content),
    confirmedPremises: opening?.proposal ?? null, worldSchema,
    prose, world: { time: runtime.worldTime, weather: runtime.weather, location: object(runtime.location).ref,
      protagonist, activeScenes: scenes.map(scene => scene.ref),
      details: Object.fromEntries(Object.entries(object(runtime.extensions)).map(([name, value]) => [name, object(value).value])) },
    scenes, entities, relationships, recentRecords: records, seeds,

  }
  const token = crypto.randomUUID()
  await workspace.write(MAINTENANCE_SESSION_PATH, JSON.stringify({ turn, token, source, baselines }), "save-runtime")
  await workspace.write(MAINTENANCE_CONTEXT_PATH, `# 本轮剧情与已有资料\n\n${JSON.stringify(context, null, 2)}\n\n# 世界规则\n\n${rules}\n`, "save-runtime")
  return { turn, token, alreadyApplied: false }
}

export async function verifyMaintenance(workspace: Workspace, prepared: PreparedMaintenance): Promise<void> {
  const file = await workspace.read(`save/history/turns/turn-${String(prepared.turn).padStart(6, "0")}.json`, "save-runtime")
  const history = object(JSON.parse(file?.content ?? "null"))
  const receipt = object(object(history.meta).maintenance)
  if (receipt.token !== prepared.token || receipt.source !== JSON.stringify(history.timeline)) {
    throw new Error("本轮尚未成功提交资料变化。")
  }
}
